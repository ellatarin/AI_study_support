import { access, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	PipelineConfig,
	PipelineStage,
	RunLog,
	RunManifest,
	SourceNormalisationStage,
	StageContext,
	StageId,
	StageResult,
} from "../types/pipeline.js";
import {
	makeConfig,
	makeManifest,
	makeStubLogger,
	makeTempDir,
	otherModuleName,
	pendingStages,
	testModuleName,
} from "./fixtures.js";
import { moduleDirs, RUNS_DIR, stageOutputEntry, stageOutputPath } from "./layout.js";
import { manifestPath } from "./manifest.js";
import { PipelineRunner } from "./runner.js";

// The runner never parses a workspace folder name — it is handed the path — so
// this suite uses short synthetic names rather than {@link testLecture}'s, which
// would only make the assertions harder to read.
const LECTURE_FOLDER = "L1";
const EMPTY_FOLDER = "L-empty";

// The runner is driven through a single configured stage throughout, so the
// stage entry is fixed here rather than restated at each construction site.
const RUNNER_CONFIG: PipelineConfig = makeConfig({
	stages: { "audio-extraction": { modelId: "openrouter/model-a" } },
});

type StubConfig = {
	stageId: StageId;
	isComplete?: (context: StageContext) => Promise<boolean>;
	getInput?: (context: StageContext) => Promise<unknown>;
	run?: (args: {
		readonly input: unknown;
		readonly context: StageContext;
	}) => Promise<StageResult<unknown>>;
};

function makeStubStage(config: StubConfig): PipelineStage<unknown, unknown> {
	return {
		stageId: config.stageId,
		isComplete: config.isComplete ?? (async () => false),
		getInput: config.getInput ?? (async () => undefined),
		run:
			config.run ??
			(async () => ({ output: undefined, cost: null, filesWritten: [] }) as StageResult<unknown>),
	};
}

async function writeManifest(workspaceRoot: string, manifest: RunManifest): Promise<void> {
	await mkdir(workspaceRoot, { recursive: true });
	await writeFile(manifestPath({ workspaceRoot }), JSON.stringify(manifest));
}

async function readManifest(workspaceRoot: string): Promise<RunManifest> {
	return JSON.parse(await readFile(manifestPath({ workspaceRoot }), "utf8")) as RunManifest;
}

async function readRunLog(workspaceRoot: string, runId: string): Promise<RunLog> {
	const path = join(workspaceRoot, RUNS_DIR, `${runId}.json`);
	return JSON.parse(await readFile(path, "utf8")) as RunLog;
}

/**
 * Writes a stage's declared output file where the layout says it belongs, as a
 * real stage would, and returns the workspace-relative entry to record in
 * `filesWritten` — so a stub stage never names the path at either end.
 *
 * @param args - Where to write.
 * @param args.workspaceRoot - Absolute path to the lecture workspace.
 * @param args.stageId - The stage whose output to write.
 * @returns The `filesWritten` entry for that output.
 */
async function writeStageOutput({
	workspaceRoot,
	stageId,
}: {
	readonly workspaceRoot: string;
	readonly stageId: StageId;
}): Promise<string> {
	const path = stageOutputPath({ workspaceRoot, stageId });
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, "x");
	return stageOutputEntry(stageId);
}

/**
 * The shape every stage-outcome assertion takes: the stage, and the part of its
 * run-log entry the test actually cares about.
 */
function outcome(stageId: StageId, entry: Record<string, unknown>): unknown {
	return { stageId, entry: expect.objectContaining(entry) };
}

const noopSourceNormalisation: SourceNormalisationStage = {
	stageId: "source-normalisation",
	normaliseModule: async () => undefined,
};

describe("PipelineRunner integration", () => {
	let tempDir: string;
	let moduleRoot: string;
	let workspaceRoot: string;
	let logged: ReturnType<typeof makeStubLogger>;

	beforeEach(async () => {
		tempDir = await makeTempDir({ prefix: "runner-" });
		moduleRoot = join(tempDir, testModuleName);
		workspaceRoot = join(moduleDirs({ moduleRoot }).processing, LECTURE_FOLDER);
		logged = makeStubLogger();
	});

	afterEach(async () => {
		vi.useRealTimers();
		await rm(tempDir, { recursive: true, force: true });
	});

	function makeRunner(lectureStages: readonly PipelineStage<unknown, unknown>[]): PipelineRunner {
		return new PipelineRunner({
			config: RUNNER_CONFIG,
			sourceNormalisation: noopSourceNormalisation,
			lectureStages,
			logger: logged.logger,
		});
	}

	describe("runLecture lifecycle", () => {
		beforeEach(async () => {
			await writeManifest(workspaceRoot, makeManifest());
		});

		it("should record a completed stage and its cost when the stage succeeds", async () => {
			const stage = makeStubStage({
				stageId: "audio-extraction",
				run: async ({ context }) => ({
					output: undefined,
					cost: { promptTokens: 0, completionTokens: 0, callCount: 1, totalCostUsd: 0.5 },
					filesWritten: [
						await writeStageOutput({
							workspaceRoot: context.workspaceRoot,
							stageId: "audio-extraction",
						}),
					],
				}),
			});

			const summary = await makeRunner([stage]).runLecture({ workspaceRoot });

			expect(summary.overallStatus).toBe("success");
			expect(summary.totalCostUsd).toBe(0.5);
			expect(summary.stageOutcomes).toEqual([
				outcome("audio-extraction", { action: "ran", status: "complete" }),
			]);
			const manifest = await readManifest(workspaceRoot);
			const entry = manifest.stages["audio-extraction"];
			expect(entry?.status).toBe("complete");
			expect(entry?.status === "complete" && entry.filesWritten).toEqual([
				stageOutputEntry("audio-extraction"),
			]);
			const runLog = await readRunLog(workspaceRoot, summary.runId);
			expect(runLog.stages["audio-extraction"]).toMatchObject({
				action: "ran",
				status: "complete",
			});
		});

		it("should mark the stage running on disk before it begins when a stage runs", async () => {
			let statusDuringRun: string | undefined;
			const stage = makeStubStage({
				stageId: "audio-extraction",
				run: async ({ context }) => {
					const current = await readManifest(context.workspaceRoot);
					statusDuringRun = current.stages["audio-extraction"]?.status;
					return { output: undefined, cost: null, filesWritten: [] };
				},
			});

			await makeRunner([stage]).runLecture({ workspaceRoot });

			expect(statusDuringRun).toBe("running");
		});

		it("should log the failure with its stack against the stage when a stage throws", async () => {
			const failure = new Error("audio extraction failed");
			const stage = makeStubStage({
				stageId: "audio-extraction",
				run: () => Promise.reject(failure),
			});

			await makeRunner([stage]).runLecture({ workspaceRoot });

			expect(logged.errors).toHaveLength(1);
			const [entry] = logged.errors;
			expect(entry?.bindings).toEqual({ stage: "audio-extraction" });
			expect(entry?.payload.err).toBe(failure);
		});

		it("should record a failed stage when the stage throws", async () => {
			const stage = makeStubStage({
				stageId: "audio-extraction",
				run: () => Promise.reject(new Error("audio extraction failed")),
			});

			const summary = await makeRunner([stage]).runLecture({ workspaceRoot });

			expect(summary.overallStatus).toBe("failed");
			expect(summary.stageOutcomes).toEqual([
				outcome("audio-extraction", {
					action: "ran",
					status: "failed",
					error: "audio extraction failed",
				}),
			]);
			const manifest = await readManifest(workspaceRoot);
			expect(manifest.stages["audio-extraction"]?.status).toBe("failed");
		});

		it("should stringify the failure when a stage throws a non-error value", async () => {
			const stage = makeStubStage({
				stageId: "audio-extraction",
				run: () => {
					const failure: unknown = "ffmpeg exited unexpectedly";
					return Promise.reject(failure);
				},
			});

			const summary = await makeRunner([stage]).runLecture({ workspaceRoot });

			expect(summary.stageOutcomes).toEqual([
				outcome("audio-extraction", {
					action: "ran",
					status: "failed",
					error: "ffmpeg exited unexpectedly",
				}),
			]);
		});

		it("should skip a stage and not run it when its output already exists", async () => {
			const writtenEntry = await writeStageOutput({ workspaceRoot, stageId: "audio-extraction" });
			await writeManifest(
				workspaceRoot,
				makeManifest({
					stages: {
						...pendingStages(),
						"audio-extraction": {
							status: "complete",
							completedAt: "earlier",
							configUsed: null,
							cost: null,
							filesWritten: [writtenEntry],
						},
					} as RunManifest["stages"],
				}),
			);
			const run = vi.fn(
				async () =>
					({
						output: undefined,
						cost: null,
						filesWritten: [],
					}) as StageResult<unknown>,
			);
			const stage = makeStubStage({
				stageId: "audio-extraction",
				isComplete: async (context) =>
					context.manifest.stages["audio-extraction"]?.status === "complete",
				run,
			});

			const summary = await makeRunner([stage]).runLecture({ workspaceRoot });

			expect(run).not.toHaveBeenCalled();
			expect(summary.overallStatus).toBe("partial");
			expect(summary.stageOutcomes).toEqual([
				{ stageId: "audio-extraction", entry: { action: "skipped" } },
			]);
			const manifest = await readManifest(workspaceRoot);
			const entry = manifest.stages["audio-extraction"];
			expect(entry?.status).toBe("skipped");
			expect(entry?.status === "skipped" && entry.completedAt).toBe("earlier");
		});

		it("should mark downstream stages not-reached when an upstream stage fails", async () => {
			const first = makeStubStage({
				stageId: "audio-extraction",
				run: async () => ({
					output: undefined,
					cost: { promptTokens: 0, completionTokens: 0, callCount: 1, totalCostUsd: 0.1 },
					filesWritten: [],
				}),
			});
			const second = makeStubStage({
				stageId: "transcription",
				run: () => Promise.reject(new Error("transcription request failed")),
			});
			const thirdRun = vi.fn(
				async () =>
					({
						output: undefined,
						cost: null,
						filesWritten: [],
					}) as StageResult<unknown>,
			);
			const third = makeStubStage({ stageId: "synthesis", run: thirdRun });

			const summary = await makeRunner([first, second, third]).runLecture({ workspaceRoot });

			expect(thirdRun).not.toHaveBeenCalled();
			expect(summary.overallStatus).toBe("failed");
			expect(summary.stageOutcomes).toEqual([
				outcome("audio-extraction", { action: "ran", status: "complete" }),
				outcome("transcription", { action: "ran", status: "failed" }),
				{ stageId: "synthesis", entry: { action: "not-reached" } },
			]);
			const runLog = await readRunLog(workspaceRoot, summary.runId);
			expect(runLog.stages.synthesis).toEqual({ action: "not-reached" });
		});

		it("should continue past a failed stage when continueOnError is set", async () => {
			const failing = makeStubStage({
				stageId: "audio-extraction",
				run: () => Promise.reject(new Error("audio extraction failed")),
			});
			const laterRun = vi.fn(
				async () =>
					({
						output: undefined,
						cost: null,
						filesWritten: [],
					}) as StageResult<unknown>,
			);
			const later = makeStubStage({ stageId: "transcription", run: laterRun });

			const summary = await makeRunner([failing, later]).runLecture({
				workspaceRoot,
				options: { continueOnError: true },
			});

			expect(laterRun).toHaveBeenCalledTimes(1);
			expect(summary.overallStatus).toBe("failed");
			expect(summary.stageOutcomes).toEqual([
				outcome("audio-extraction", { action: "ran", status: "failed" }),
				outcome("transcription", { action: "ran", status: "complete" }),
			]);
		});

		it("should write a timestamped run-log file to runs/ when a run is invoked", async () => {
			vi.useFakeTimers({ toFake: ["Date"] });
			const stage = makeStubStage({ stageId: "audio-extraction" });
			const runner = makeRunner([stage]);

			vi.setSystemTime(new Date("2025-10-10T09:00:00Z"));
			const first = await runner.runLecture({ workspaceRoot });
			vi.setSystemTime(new Date("2025-10-10T09:00:05Z"));
			const second = await runner.runLecture({ workspaceRoot });

			const files = await readdir(join(workspaceRoot, RUNS_DIR));
			expect(files).toHaveLength(2);
			expect(files).toContain(`${first.runId}.json`);
			expect(files).toContain(`${second.runId}.json`);
		});
	});

	describe("runLecture with --from-stage", () => {
		// Three stages spread across the pipeline order, so a --from-stage at the
		// middle one has something both upstream and downstream of it.
		const ALREADY_RUN_STAGES = [
			"audio-extraction",
			"transcription",
			"synthesis",
		] as const satisfies readonly StageId[];

		/** The workspace directory a stage's output lives in. */
		function stageDir(stageId: StageId): string {
			return dirname(stageOutputPath({ workspaceRoot, stageId }));
		}

		function mirrorIsComplete(stageId: StageId): (context: StageContext) => Promise<boolean> {
			return async (context) => {
				const entry = context.manifest.stages[stageId];
				if (entry?.status !== "complete") {
					return false;
				}
				for (const relativePath of entry.filesWritten) {
					try {
						await access(join(context.workspaceRoot, relativePath));
					} catch {
						return false;
					}
				}
				return true;
			};
		}

		beforeEach(async () => {
			const complete = (files: readonly string[]): RunManifest["stages"][StageId] => ({
				status: "complete",
				completedAt: "earlier",
				configUsed: null,
				cost: null,
				filesWritten: files,
			});
			const stages: Record<string, RunManifest["stages"][StageId]> = {};
			for (const stageId of ALREADY_RUN_STAGES) {
				stages[stageId] = complete([await writeStageOutput({ workspaceRoot, stageId })]);
			}
			await writeManifest(
				workspaceRoot,
				makeManifest({
					stages: { ...pendingStages(), ...stages } as RunManifest["stages"],
				}),
			);
		});

		function fromStageRunner(): PipelineRunner {
			return makeRunner([
				makeStubStage({
					stageId: "audio-extraction",
					isComplete: mirrorIsComplete("audio-extraction"),
				}),
				makeStubStage({ stageId: "transcription", isComplete: mirrorIsComplete("transcription") }),
				makeStubStage({ stageId: "synthesis", isComplete: mirrorIsComplete("synthesis") }),
			]);
		}

		it("should delete the nominated stage and downstream output when --from-stage is given", async () => {
			const summary = await fromStageRunner().runLecture({
				workspaceRoot,
				options: { fromStage: "transcription" },
			});

			await expect(access(stageDir("transcription"))).rejects.toThrow();
			await expect(access(stageDir("synthesis"))).rejects.toThrow();
			const runLog = await readRunLog(workspaceRoot, summary.runId);
			expect(runLog.runType).toBe("experiment");
			expect(runLog.fromStage).toBe("transcription");
		});

		it("should leave upstream stages untouched when --from-stage is given", async () => {
			const summary = await fromStageRunner().runLecture({
				workspaceRoot,
				options: { fromStage: "transcription" },
			});

			await expect(
				access(stageOutputPath({ workspaceRoot, stageId: "audio-extraction" })),
			).resolves.toBeUndefined();
			expect(summary.stageOutcomes[0]).toEqual({
				stageId: "audio-extraction",
				entry: { action: "skipped" },
			});
		});
	});

	describe("resolveLecturesByDate", () => {
		let moduleA: string;
		let moduleB: string;
		let moduleC: string;

		beforeEach(async () => {
			moduleA = join(tempDir, otherModuleName);
			moduleB = join(tempDir, "Pharmacology");
			moduleC = join(tempDir, "Microbiology");
			const write = async (root: string, folder: string, manifest: RunManifest): Promise<void> => {
				await writeManifest(join(moduleDirs({ moduleRoot: root }).processing, folder), manifest);
			};
			await write(
				moduleA,
				LECTURE_FOLDER,
				makeManifest({ lectureNumber: 1, lectureDate: "2025-10-10", lectureTitle: "Cell Injury" }),
			);
			await write(
				moduleA,
				"L2",
				makeManifest({
					lectureNumber: 2,
					lectureDate: "2025-10-11",
					lectureTitle: "Immunity to Infection",
				}),
			);
			await write(
				moduleB,
				"L3",
				makeManifest({ lectureNumber: 3, lectureDate: "2025-10-10", lectureTitle: "Virology" }),
			);
			await mkdir(join(moduleDirs({ moduleRoot: moduleA }).processing, EMPTY_FOLDER), {
				recursive: true,
			});
			await mkdir(moduleC, { recursive: true });
		});

		function resolver(): PipelineRunner {
			return makeRunner([]);
		}

		it("should return an empty list when no lecture matches the date", async () => {
			const matches = await resolver().resolveLecturesByDate({
				moduleRoots: [moduleA, moduleB, moduleC],
				lectureDate: "2099-01-01",
			});

			expect(matches).toEqual([]);
		});

		it("should return a single match when one lecture matches the date", async () => {
			const matches = await resolver().resolveLecturesByDate({
				moduleRoots: [moduleA, moduleB, moduleC],
				lectureDate: "2025-10-11",
			});

			expect(matches).toHaveLength(1);
			expect(matches[0]).toMatchObject({ lectureNumber: 2, lectureTitle: "Immunity to Infection" });
		});

		it("should return every matching lecture across modules when several match the date", async () => {
			const matches = await resolver().resolveLecturesByDate({
				moduleRoots: [moduleA, moduleB, moduleC],
				lectureDate: "2025-10-10",
			});

			expect(matches).toHaveLength(2);
			const titles = matches.map((match) => match.lectureTitle).sort();
			expect(titles).toEqual(["Cell Injury", "Virology"]);
			for (const match of matches) {
				expect(match).toMatchObject({
					moduleRoot: expect.any(String),
					workspaceRoot: expect.any(String),
					lectureNumber: expect.any(Number),
					lectureTitle: expect.any(String),
				});
			}
		});
	});

	describe("runBatch", () => {
		let moduleA: string;

		beforeEach(async () => {
			moduleA = join(tempDir, otherModuleName);
			const processing = moduleDirs({ moduleRoot: moduleA }).processing;
			await writeManifest(join(processing, LECTURE_FOLDER), makeManifest({ lectureNumber: 1 }));
			await writeManifest(join(processing, "L2"), makeManifest({ lectureNumber: 2 }));
		});

		function batchStage(): PipelineStage<unknown, unknown> {
			return makeStubStage({
				stageId: "audio-extraction",
				run: async () => ({
					output: undefined,
					cost: { promptTokens: 0, completionTokens: 0, callCount: 1, totalCostUsd: 0.25 },
					filesWritten: [],
				}),
			});
		}

		it.each([
			{ concurrency: undefined },
			{ concurrency: 1 },
			{ concurrency: 2 },
		])("should run every lecture and aggregate cost when concurrency is $concurrency", async ({
			concurrency,
		}) => {
			const normaliseModule = vi.fn(async () => undefined);
			const runner = new PipelineRunner({
				config: RUNNER_CONFIG,
				sourceNormalisation: { stageId: "source-normalisation", normaliseModule },
				lectureStages: [batchStage()],
				logger: logged.logger,
			});

			const summary = await runner.runBatch({ moduleRoots: [moduleA], options: { concurrency } });

			expect(normaliseModule).toHaveBeenCalledWith({ moduleRoot: moduleA });
			expect(summary.lectures).toHaveLength(2);
			expect(summary.overallStatus).toBe("success");
			expect(summary.totalCostUsd).toBeCloseTo(0.5);
		});

		it("should run the lectures in date order when the batch starts", async () => {
			// Names deliberately at odds with date order in both directions a listing
			// might take them: "Lecture 10" sorts before "Lecture 2" lexicographically,
			// and neither matches the order the dates put them in.
			const byDate = [
				{ folder: "Lecture 10 - Autumn - 2025-09-01", lectureDate: "2025-09-01" },
				{ folder: "Lecture 2 - Winter - 2025-11-20", lectureDate: "2025-11-20" },
				{ folder: "Lecture 1 - Spring - 2025-12-05", lectureDate: "2025-12-05" },
			];
			const moduleB = join(tempDir, "Chronology");
			for (const { folder, lectureDate } of byDate) {
				await writeManifest(
					join(moduleDirs({ moduleRoot: moduleB }).processing, folder),
					makeManifest({ lectureDate }),
				);
			}
			const ran: string[] = [];
			const recordingStage = makeStubStage({
				stageId: "audio-extraction",
				run: ({ context }) => {
					ran.push(context.lectureDate);
					return Promise.resolve({ output: undefined, cost: null, filesWritten: [] });
				},
			});

			await makeRunner([recordingStage]).runBatch({ moduleRoots: [moduleB] });

			expect(ran).toEqual(["2025-09-01", "2025-11-20", "2025-12-05"]);
		});

		it("should report a failed batch when any lecture fails", async () => {
			const failing = makeStubStage({
				stageId: "audio-extraction",
				run: () => Promise.reject(new Error("audio extraction failed")),
			});
			const runner = makeRunner([failing]);

			const summary = await runner.runBatch({ moduleRoots: [moduleA] });

			expect(summary.overallStatus).toBe("failed");
		});

		it("should report a partial batch when every lecture only skips stages", async () => {
			const skipping = makeStubStage({ stageId: "audio-extraction", isComplete: async () => true });
			const runner = makeRunner([skipping]);

			const summary = await runner.runBatch({ moduleRoots: [moduleA] });

			expect(summary.overallStatus).toBe("partial");
		});
	});

	describe("costReport", () => {
		let writeSpy: ReturnType<typeof vi.spyOn>;

		beforeEach(async () => {
			writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
			await writeManifest(
				workspaceRoot,
				makeManifest({
					currentPipelineCost: { totalCostUsd: 0.5, byStage: { "audio-extraction": 0.5 } },
					stages: {
						...pendingStages(),
						"audio-extraction": {
							status: "complete",
							completedAt: "earlier",
							configUsed: { modelId: "openrouter/model-a" },
							cost: { promptTokens: 1, completionTokens: 1, callCount: 1, totalCostUsd: 0.5 },
							filesWritten: [],
						},
					} as RunManifest["stages"],
				}),
			);
			const runLog: RunLog = {
				runId: "2025-10-10T09-00-00Z",
				startedAt: "2025-10-10T09:00:00Z",
				endedAt: "2025-10-10T09:00:01Z",
				triggeredBy: "manual",
				runType: "normal",
				fromStage: null,
				stages: {},
				totalCostThisRun: 0.5,
			};
			const runsDir = join(workspaceRoot, RUNS_DIR);
			await mkdir(runsDir, { recursive: true });
			await writeFile(join(runsDir, `${runLog.runId}.json`), JSON.stringify(runLog));
			// A non-file entry in runs/, a corrupt run log, and a workspace without a
			// manifest — all skipped by the reader.
			await mkdir(join(runsDir, "nested"), { recursive: true });
			await writeFile(join(runsDir, "corrupt.json"), "{ not json");
			await mkdir(join(moduleDirs({ moduleRoot }).processing, EMPTY_FOLDER), { recursive: true });
		});

		afterEach(() => {
			writeSpy.mockRestore();
		});

		function output(): string {
			return writeSpy.mock.calls.map((call: readonly unknown[]) => String(call[0])).join("");
		}

		it("should print the current pipeline cost section when reporting all lectures", async () => {
			await makeRunner([]).costReport({ moduleRoots: [moduleRoot] });

			expect(writeSpy).toHaveBeenCalled();
			expect(output()).toContain("Current pipeline cost");
		});

		it("should print a report when a lecture matches the requested date", async () => {
			await makeRunner([]).costReport({
				moduleRoots: [moduleRoot],
				options: { lectureDate: "2025-10-10" },
			});

			expect(output()).toContain("Current pipeline cost");
		});

		it("should print nothing when no lecture matches the requested date", async () => {
			await makeRunner([]).costReport({
				moduleRoots: [moduleRoot],
				options: { lectureDate: "2099-01-01" },
			});

			expect(writeSpy).not.toHaveBeenCalled();
		});
	});

	describe("following a relocated workspace", () => {
		const RENAMED_FOLDER = "L1 - Innate Immune Response";
		const NEW_TITLE = "Innate Immune Response";
		let renamedWorkspaceRoot: string;

		/**
		 * A stage that does what Stage 3 does when it replaces a lecture's title:
		 * writes the new identity to the manifest where the workspace still stands,
		 * then moves the workspace out from under the runner.
		 */
		function makeRenamingStage(stageId: StageId): PipelineStage<unknown, unknown> {
			return makeStubStage({
				stageId,
				run: async ({ context }) => {
					await writeManifest(context.workspaceRoot, {
						...context.manifest,
						lectureTitle: NEW_TITLE,
						workspaceFolderName: RENAMED_FOLDER,
					});
					await rename(context.workspaceRoot, renamedWorkspaceRoot);
					return { output: undefined, cost: null, filesWritten: [] } as StageResult<unknown>;
				},
			});
		}

		beforeEach(async () => {
			renamedWorkspaceRoot = join(moduleDirs({ moduleRoot }).processing, RENAMED_FOLDER);
			await writeManifest(workspaceRoot, makeManifest());
		});

		it("should record the completed stage in the manifest at its new path when a stage renames the workspace", async () => {
			await makeRunner([makeRenamingStage("audio-extraction")]).runLecture({ workspaceRoot });

			const manifest = await readManifest(renamedWorkspaceRoot);
			expect(manifest.stages["audio-extraction"]?.status).toBe("complete");
		});

		// Both the title and the path are read off the rebuilt context, and both are
		// expected values only the enclosing beforeEach knows — hence the thunks.
		it.each([
			{
				what: "new lectureTitle",
				read: (context: StageContext) => context.lectureTitle,
				expected: () => NEW_TITLE,
			},
			{
				what: "workspace's new path",
				read: (context: StageContext) => context.workspaceRoot,
				expected: () => renamedWorkspaceRoot,
			},
		])("should give a downstream stage the $what when an earlier stage renames the workspace", async ({
			read,
			expected,
		}) => {
			const seen: string[] = [];
			const downstream = makeStubStage({
				stageId: "transcription",
				run: ({ context }) => {
					seen.push(read(context));
					return Promise.resolve({
						output: undefined,
						cost: null,
						filesWritten: [],
					} as StageResult<unknown>);
				},
			});

			await makeRunner([makeRenamingStage("audio-extraction"), downstream]).runLecture({
				workspaceRoot,
			});

			expect(seen).toEqual([expected()]);
		});

		it("should write the run log to the renamed workspace when a stage renames it", async () => {
			const summary = await makeRunner([makeRenamingStage("audio-extraction")]).runLecture({
				workspaceRoot,
			});

			await expect(readRunLog(renamedWorkspaceRoot, summary.runId)).resolves.toMatchObject({
				runId: summary.runId,
			});
		});

		it("should report the workspace's new path in the summary when a stage renames it", async () => {
			const summary = await makeRunner([makeRenamingStage("audio-extraction")]).runLecture({
				workspaceRoot,
			});

			expect(summary.workspaceRoot).toBe(renamedWorkspaceRoot);
		});
	});
});
