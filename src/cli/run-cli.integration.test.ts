import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	blockNetwork,
	completedEntry,
	corruptJson,
	factCheckConfig,
	factCorrectionFile,
	factCorrectionReadsFrom,
	factualErrorsFile,
	makeConfig,
	makeManifest,
	makeTempDir,
	openRouterModelId,
	openRouterStageConfig,
	primaryFactCheckModel,
	readJsonFile,
	resetStubbedApi,
	seedEarlierOutputs,
	seededFactualError,
	stubModelList,
	testLecture,
	testModuleName,
} from "../pipeline/fixtures.js";
import {
	DEBUG_LOGS_DIR,
	moduleDirs,
	runLogsDirPath,
	workspaceRootFor,
} from "../pipeline/layout.js";
import { pendingStages, writeManifest } from "../pipeline/manifest.js";
import {
	CONFIG_FILENAME,
	type PipelineConfig,
	type RunLog,
	STAGE_IDS,
	type StageId,
} from "../types/pipeline.js";
import { listFileNames } from "../utils/files.js";
import { EXIT_FAILURE, EXIT_SUCCESS } from "./commands.js";
import { runCli } from "./run-cli.js";

describe("runCli", () => {
	let projectRoot: string;
	let moduleRoot: string;
	let out: string[];
	let errors: string[];

	function invoke(argv: readonly string[]): Promise<number> {
		return runCli({
			argv,
			projectRoot,
			write: (text: string) => {
				out.push(text);
			},
			writeError: (text: string) => {
				errors.push(text);
			},
		});
	}

	async function writeConfig(
		moduleRoots: readonly string[],
		overrides: Partial<PipelineConfig> = {},
	): Promise<void> {
		await writeFile(
			join(projectRoot, CONFIG_FILENAME),
			JSON.stringify(makeConfig({ moduleRoots, ...overrides })),
		);
	}

	/** Writes the source files and the workspace of the test lecture, with each stage of `completeStages` complete. */
	async function writeTestLecture(completeStages: readonly StageId[]): Promise<string> {
		const { videoRecording, slideDeck } = moduleDirs({ moduleRoot });
		await writeFile(join(videoRecording, testLecture.videoRecordingFile), "video");
		await writeFile(join(slideDeck, testLecture.slideDeckFile), "slides");
		const workspaceRoot = workspaceRootFor({ moduleRoot, baseName: testLecture.baseName });
		await mkdir(workspaceRoot, { recursive: true });
		const complete = Object.fromEntries(
			completeStages.map((stageId) => [stageId, completedEntry({})]),
		);
		await writeManifest({
			workspaceRoot,
			manifest: makeManifest({ stages: { ...pendingStages(), ...complete } }),
		});
		return workspaceRoot;
	}

	/** Reads the run log of the one pipeline run of the test lecture. */
	async function readOnlyRunLog(workspaceRoot: string): Promise<RunLog> {
		const [runLogName] = await listFileNames(runLogsDirPath({ workspaceRoot }));
		return (await readJsonFile(
			join(runLogsDirPath({ workspaceRoot }), String(runLogName)),
		)) as RunLog;
	}

	beforeEach(async () => {
		projectRoot = await makeTempDir({ prefix: "run-cli-" });
		moduleRoot = join(projectRoot, testModuleName);
		const { videoRecording, slideDeck } = moduleDirs({ moduleRoot });
		for (const dir of [videoRecording, slideDeck]) {
			await mkdir(dir, { recursive: true });
		}
		out = [];
		errors = [];
	});

	afterEach(async () => {
		await rm(projectRoot, { recursive: true, force: true });
	});

	it("should print the usage text without reading the config when help is asked for", async () => {
		const code = await invoke(["--help"]);

		expect(code).toBe(EXIT_SUCCESS);
		expect(out.join("")).toContain("lecture-notes run <date>");
		expect(errors).toEqual([]);
	});

	it("should print usage and fail when the command line cannot be understood", async () => {
		const code = await invoke(["publish"]);

		expect(code).toBe(EXIT_FAILURE);
		expect(errors.join("")).toContain("publish");
		expect(out.join("")).toContain("Usage:");
	});

	it("should report the problem plainly and fail when the config cannot be read", async () => {
		const code = await invoke(["cost-report"]);

		expect(code).toBe(EXIT_FAILURE);
		expect(errors.join("")).toContain(CONFIG_FILENAME);
		expect(errors.join("")).not.toContain("    at ");
	});

	it("should report the problem plainly and fail when the config is malformed", async () => {
		await writeFile(join(projectRoot, CONFIG_FILENAME), corruptJson);

		const code = await invoke(["cost-report"]);

		expect(code).toBe(EXIT_FAILURE);
		expect(errors.join("")).toContain("not valid JSON");
	});

	it("should report on the configured modules when a cost report is asked for", async () => {
		await writeConfig([moduleRoot]);

		const code = await invoke(["cost-report"]);

		expect(code).toBe(EXIT_SUCCESS);
		expect(errors).toEqual([]);
	});

	it("should give the runner each lecture stage of the stage list, in order, when a lecture runs", async () => {
		await writeConfig([moduleRoot]);
		const workspaceRoot = await writeTestLecture(["audio-extraction"]);

		await invoke(["run", testLecture.date, "--to-stage", "audio-extraction"]);

		const runLog = await readOnlyRunLog(workspaceRoot);
		expect(Object.keys(runLog.stages)).toStrictEqual(
			STAGE_IDS.filter((stageId) => stageId !== "source-normalisation"),
		);
	});

	describe("--fact-correction and --fact-check", () => {
		beforeEach(() => {
			blockNetwork();
		});

		afterEach(() => {
			resetStubbedApi();
		});

		/**
		 * Checks that the run log records the stage as bypassed by the flag.
		 *
		 * @param args - The lecture and the stage.
		 * @param args.workspaceRoot - The workspace of the lecture.
		 * @param args.stageId - The bypassed stage.
		 * @returns A promise that resolves when the check passes.
		 */
		async function expectBypassRecorded({
			workspaceRoot,
			stageId,
		}: {
			readonly workspaceRoot: string;
			readonly stageId: StageId;
		}): Promise<void> {
			expect((await readOnlyRunLog(workspaceRoot)).stages[stageId]).toMatchObject({
				status: "bypassed",
				configUsed: { bypass: true },
			});
		}

		it("should keep the rewrite of a subtopic with a factual error, and record the bypass, when the config runs the fact correction and --fact-correction bypass is given", async () => {
			const stageId = "correct-factual-errors";
			await writeConfig([moduleRoot], {
				stages: { [stageId]: { ...openRouterStageConfig({ stageId }), bypass: false } },
			});
			const workspaceRoot = await writeTestLecture(STAGE_IDS.slice(0, STAGE_IDS.indexOf(stageId)));
			await seedEarlierOutputs({ workspaceRoot, readsFrom: factCorrectionReadsFrom });
			stubModelList({ modelIds: [openRouterModelId] });

			await invoke(["run", testLecture.date, "--to-stage", stageId, "--fact-correction", "bypass"]);

			expect(
				await readJsonFile(join(workspaceRoot, factCorrectionFile(seededFactualError.subtopicId))),
			).toMatchObject({ factCorrectedSubtopic: [seededFactualError.passage], changes: [] });
			await expectBypassRecorded({ workspaceRoot, stageId });
		});

		it("should write the merged file as bypassed, and record the bypass, when the config runs the fact check and --fact-check bypass is given", async () => {
			const stageId = "check-facts";
			await writeConfig([moduleRoot], {
				stages: {
					[stageId]: factCheckConfig({
						models: [{ ...primaryFactCheckModel, modelId: openRouterModelId }],
					}),
				},
			});
			const workspaceRoot = await writeTestLecture(STAGE_IDS.slice(0, STAGE_IDS.indexOf(stageId)));
			await seedEarlierOutputs({
				workspaceRoot,
				readsFrom: ["structure-transcript", "rewrite-subtopics"],
			});
			stubModelList({ modelIds: [openRouterModelId] });

			await invoke(["run", testLecture.date, "--to-stage", stageId, "--fact-check", "bypass"]);

			expect(await readJsonFile(join(workspaceRoot, factualErrorsFile))).toMatchObject({
				bypassed: true,
			});
			await expectBypassRecorded({ workspaceRoot, stageId });
		});
	});

	it("should normalise the module and report no match when the date names no lecture", async () => {
		await writeConfig([moduleRoot]);

		const code = await invoke(["run", testLecture.date]);

		expect(code).toBe(EXIT_FAILURE);
		expect(out.join("")).toContain(testLecture.date);
	});

	// The suite does not change the working directory. So this test fails when the
	// debug log path is relative to the working directory and not to the project root.
	it("should have written the debug log in full under the project root when a command returns", async () => {
		await writeConfig([moduleRoot]);

		await invoke(["run", testLecture.date]);

		const debugLogsDir = join(projectRoot, DEBUG_LOGS_DIR);
		const debugLogs = (await listFileNames(debugLogsDir)).filter((name) =>
			name.endsWith("-debug.log"),
		);
		expect(debugLogs).toHaveLength(1);
		const entries = (await readFile(join(debugLogsDir, debugLogs[0] ?? ""), "utf8"))
			.trim()
			.split("\n");
		expect(entries.length).toBeGreaterThan(0);
		expect(() => entries.map((entry) => JSON.parse(entry))).not.toThrow();
	});
});
