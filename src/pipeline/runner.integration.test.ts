import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { PipelineRunner } from "./runner.js";

const ALL_STAGES: readonly StageId[] = [
	"source-normalisation",
	"audio-extraction",
	"transcription",
	"transcript-structuring",
	"slide-conversion",
	"image-extraction",
	"synthesis",
	"qa-loop",
	"pdf-generation",
];

function pendingStages(): RunManifest["stages"] {
	const entries = ALL_STAGES.map((id) => [id, { status: "pending" }] as const);
	return Object.fromEntries(entries) as RunManifest["stages"];
}

function makeConfig(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
	return {
		version: "1",
		moduleRoots: [],
		openRouter: { rateLimitRpm: 60 },
		stages: { "audio-extraction": { modelId: "openrouter/model-a" } },
		output: { language: "en-GB", pandocEngine: "xelatex" },
		...overrides,
	};
}

function makeManifest(overrides: Partial<RunManifest> = {}): RunManifest {
	return {
		version: "1",
		lectureNumber: 1,
		lectureDate: "2025-10-10",
		provisionalTitle: "Immune System",
		lectureTitle: "Immune System",
		aiDerivedTitle: null,
		workspaceFolderName: "L1",
		createdAt: "2025-10-10T00:00:00Z",
		updatedAt: "2025-10-10T00:00:00Z",
		stages: pendingStages(),
		currentPipelineCost: { totalCostUsd: 0, byStage: {} },
		...overrides,
	};
}

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
	await writeFile(join(workspaceRoot, "manifest.json"), JSON.stringify(manifest));
}

async function readManifest(workspaceRoot: string): Promise<RunManifest> {
	return JSON.parse(await readFile(join(workspaceRoot, "manifest.json"), "utf8")) as RunManifest;
}

async function readRunLog(workspaceRoot: string, runId: string): Promise<RunLog> {
	return JSON.parse(await readFile(join(workspaceRoot, "runs", `${runId}.json`), "utf8")) as RunLog;
}

const noopSourceNormalisation: SourceNormalisationStage = {
	stageId: "source-normalisation",
	normaliseModule: async () => undefined,
};

describe("PipelineRunner integration", () => {
	let tempDir: string;
	let moduleRoot: string;
	let workspaceRoot: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "runner-"));
		moduleRoot = join(tempDir, "Biology of Disease");
		workspaceRoot = join(moduleRoot, "Pipeline processing", "L1");
	});

	afterEach(async () => {
		vi.useRealTimers();
		await rm(tempDir, { recursive: true, force: true });
	});

	function makeRunner(lectureStages: readonly PipelineStage<unknown, unknown>[]): PipelineRunner {
		return new PipelineRunner({
			config: makeConfig(),
			sourceNormalisation: noopSourceNormalisation,
			lectureStages,
		});
	}

	describe("runLecture lifecycle", () => {
		beforeEach(async () => {
			await writeManifest(workspaceRoot, makeManifest());
		});

		it("should record a completed stage and its cost when the stage succeeds", async () => {
			const stage = makeStubStage({
				stageId: "audio-extraction",
				run: async ({ context }) => {
					await mkdir(join(context.workspaceRoot, "Audio"), { recursive: true });
					await writeFile(join(context.workspaceRoot, "Audio", "audio.m4a"), "x");
					return {
						output: undefined,
						cost: { promptTokens: 0, completionTokens: 0, callCount: 1, totalCostUsd: 0.5 },
						filesWritten: ["Audio/audio.m4a"],
					};
				},
			});

			const summary = await makeRunner([stage]).runLecture({ workspaceRoot });

			expect(summary.overallStatus).toBe("success");
			expect(summary.totalCostUsd).toBe(0.5);
			expect(summary.stageOutcomes).toEqual([
				expect.objectContaining({ action: "ran", status: "complete" }),
			]);
			const manifest = await readManifest(workspaceRoot);
			const entry = manifest.stages["audio-extraction"];
			expect(entry?.status).toBe("complete");
			expect(entry?.status === "complete" && entry.filesWritten).toEqual(["Audio/audio.m4a"]);
			const runLog = await readRunLog(workspaceRoot, summary.runId);
			expect(runLog.stages["audio-extraction"]).toMatchObject({
				action: "ran",
				status: "complete",
			});
		});

		it("should record a failed stage when the stage throws", async () => {
			const stage = makeStubStage({
				stageId: "audio-extraction",
				run: () => Promise.reject(new Error("audio extraction failed")),
			});

			const summary = await makeRunner([stage]).runLecture({ workspaceRoot });

			expect(summary.overallStatus).toBe("failed");
			expect(summary.stageOutcomes).toEqual([
				expect.objectContaining({
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
				expect.objectContaining({
					action: "ran",
					status: "failed",
					error: "ffmpeg exited unexpectedly",
				}),
			]);
		});

		it("should skip a stage and not run it when its output already exists", async () => {
			await mkdir(join(workspaceRoot, "Audio"), { recursive: true });
			await writeFile(join(workspaceRoot, "Audio", "audio.m4a"), "x");
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
							filesWritten: ["Audio/audio.m4a"],
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
			expect(summary.stageOutcomes).toEqual([{ action: "skipped" }]);
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
				expect.objectContaining({ action: "ran", status: "complete" }),
				expect.objectContaining({ action: "ran", status: "failed" }),
				{ action: "not-reached" },
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
				expect.objectContaining({ action: "ran", status: "failed" }),
				expect.objectContaining({ action: "ran", status: "complete" }),
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

			const files = await readdir(join(workspaceRoot, "runs"));
			expect(files).toHaveLength(2);
			expect(files).toContain(`${first.runId}.json`);
			expect(files).toContain(`${second.runId}.json`);
		});
	});

	describe("runLecture with --from-stage", () => {
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
			await mkdir(join(workspaceRoot, "Audio"), { recursive: true });
			await mkdir(join(workspaceRoot, "Transcript"), { recursive: true });
			await mkdir(join(workspaceRoot, "Synthesised notes"), { recursive: true });
			await writeFile(join(workspaceRoot, "Audio", "audio.m4a"), "x");
			await writeFile(join(workspaceRoot, "Transcript", "transcript.txt"), "x");
			await writeFile(join(workspaceRoot, "Synthesised notes", "notes.md"), "x");
			const complete = (files: readonly string[]): RunManifest["stages"][StageId] => ({
				status: "complete",
				completedAt: "earlier",
				configUsed: null,
				cost: null,
				filesWritten: files,
			});
			await writeManifest(
				workspaceRoot,
				makeManifest({
					stages: {
						...pendingStages(),
						"audio-extraction": complete(["Audio/audio.m4a"]),
						transcription: complete(["Transcript/transcript.txt"]),
						synthesis: complete(["Synthesised notes/notes.md"]),
					} as RunManifest["stages"],
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

			await expect(access(join(workspaceRoot, "Transcript"))).rejects.toThrow();
			await expect(access(join(workspaceRoot, "Synthesised notes"))).rejects.toThrow();
			const runLog = await readRunLog(workspaceRoot, summary.runId);
			expect(runLog.runType).toBe("experiment");
			expect(runLog.fromStage).toBe("transcription");
		});

		it("should leave upstream stages untouched when --from-stage is given", async () => {
			const summary = await fromStageRunner().runLecture({
				workspaceRoot,
				options: { fromStage: "transcription" },
			});

			await expect(access(join(workspaceRoot, "Audio", "audio.m4a"))).resolves.toBeUndefined();
			expect(summary.stageOutcomes[0]).toEqual({ action: "skipped" });
		});
	});

	describe("resolveLecturesByDate", () => {
		let moduleA: string;
		let moduleB: string;
		let moduleC: string;

		beforeEach(async () => {
			moduleA = join(tempDir, "Immunology");
			moduleB = join(tempDir, "Pharmacology");
			moduleC = join(tempDir, "Microbiology");
			const write = async (root: string, folder: string, manifest: RunManifest): Promise<void> => {
				await writeManifest(join(root, "Pipeline processing", folder), manifest);
			};
			await write(
				moduleA,
				"L1",
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
			await mkdir(join(moduleA, "Pipeline processing", "L-empty"), { recursive: true });
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
			moduleA = join(tempDir, "Immunology");
			await writeManifest(
				join(moduleA, "Pipeline processing", "L1"),
				makeManifest({ lectureNumber: 1 }),
			);
			await writeManifest(
				join(moduleA, "Pipeline processing", "L2"),
				makeManifest({ lectureNumber: 2 }),
			);
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
				config: makeConfig(),
				sourceNormalisation: { stageId: "source-normalisation", normaliseModule },
				lectureStages: [batchStage()],
			});

			const summary = await runner.runBatch({ moduleRoots: [moduleA], options: { concurrency } });

			expect(normaliseModule).toHaveBeenCalledWith({ moduleRoot: moduleA });
			expect(summary.lectures).toHaveLength(2);
			expect(summary.overallStatus).toBe("success");
			expect(summary.totalCostUsd).toBeCloseTo(0.5);
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
			await mkdir(join(workspaceRoot, "runs"), { recursive: true });
			await writeFile(
				join(workspaceRoot, "runs", "2025-10-10T09-00-00Z.json"),
				JSON.stringify(runLog),
			);
			// A non-file entry in runs/, a corrupt run log, and a workspace without a
			// manifest — all skipped by the reader.
			await mkdir(join(workspaceRoot, "runs", "nested"), { recursive: true });
			await writeFile(join(workspaceRoot, "runs", "corrupt.json"), "{ not json");
			await mkdir(join(moduleRoot, "Pipeline processing", "L-empty"), { recursive: true });
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
});
