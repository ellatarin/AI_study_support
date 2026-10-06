import { access, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import {
	DEFAULT_BATCH_OPTIONS,
	DEFAULT_PIPELINE_RUN_OPTIONS,
	type LectureIdentityChanges,
	type Manifest,
	type PipelineConfig,
	type PipelineRunEvent,
	type PipelineRunSummary,
	type PipelineStage,
	type RunLog,
	type RunType,
	type SourceNormalisationStage,
	type StageContext,
	type StageCost,
	type StageEntry,
	type StageId,
	type StageResult,
} from "../types/pipeline.js";
import { pathExists } from "../utils/files.js";
import {
	aiDerivedLecture,
	completedEntry,
	corruptJson,
	loggedAt,
	makeConfig,
	makeManifest,
	makeTempDir,
	otherLecture,
	otherModuleName,
	readJsonFile,
	sameDateLecture,
	seedStageOutput,
	stageCompletedAt,
	stagesWith,
	type TestLecture,
	testLecture,
	testModuleName,
	testTimestampId,
	useStubLogger,
} from "./fixtures.js";
import {
	moduleDirs,
	runLogsDirPath,
	type StageWithOutputFile,
	stageDirectoryPaths,
	stageOutputEntry,
	stageOutputPath,
	workspaceRootFor,
} from "./layout.js";
import { pendingStages, readManifest, writeManifest } from "./manifest.js";
import { PipelineRunner } from "./runner.js";
import { isStageComplete } from "./stages/pipeline-stage.js";

// The runner never parses a base name. It gets the path. So this suite uses short
// made-up names, not the names of {@link testLecture}, to keep the assertions
// easy to read.
const LECTURE_BASE_NAME = "L1";
const EMPTY_BASE_NAME = "L-empty";

// The instant that a stage completed in an earlier pipeline run. It is not an ISO
// time on purpose. Nothing parses it, and the tests that use it check that the
// runner keeps the earlier completion and does not record its own instant. A
// value that could be either instant would hide a failure.
const BEFORE_THIS_RUN = "earlier";

/** The base name of a lecture after `transcript-structuring` replaces its title. */
const RENAMED_BASE_NAME = `${LECTURE_BASE_NAME} - ${aiDerivedLecture.title}`;

// The identity that `transcript-structuring` decides when it replaces the
// lecture title: the new title, the AI-derived title and the new base name. Two
// suites use it, one with the rename and one without.
const DECIDED_IDENTITY: LectureIdentityChanges = {
	lectureTitle: aiDerivedLecture.title,
	aiDerivedTitle: aiDerivedLecture.title,
	baseName: RENAMED_BASE_NAME,
};

// Each test uses one configured stage, so its configuration is set here once.
const RUNNER_CONFIG: PipelineConfig = makeConfig({
	stages: { "audio-extraction": { modelId: "openrouter/model-a" } },
});

// The result of a stub stage when the test checks only if the stage ran: no
// output, no cost and no files.
const PRODUCED_NOTHING: StageResult<unknown> = {
	output: undefined,
	cost: null,
	filesWritten: [],
};

// The message that a stub audio-extraction stage throws. The tests that make the
// stage fail use it, and one test checks that the run summary shows it.
const AUDIO_EXTRACTION_FAILURE = "audio extraction failed";

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
		run: config.run ?? (() => Promise.resolve(PRODUCED_NOTHING)),
	};
}

/**
 * A stage `run` that makes nothing, as a spy, so a test can check if the runner
 * called the stage. The default of {@link makeStubStage} does the same, but a test
 * needs the spy to check the call.
 *
 * @returns The spy.
 */
function spyingRun(): Mock<() => Promise<StageResult<unknown>>> {
	return vi.fn(() => Promise.resolve(PRODUCED_NOTHING));
}

/**
 * A stub audio-extraction stage that always fails with
 * {@link AUDIO_EXTRACTION_FAILURE}.
 *
 * @returns The stage.
 */
function failingAudioStage(): PipelineStage<unknown, unknown> {
	return makeStubStage({
		stageId: "audio-extraction",
		run: () => Promise.reject(new Error(AUDIO_EXTRACTION_FAILURE)),
	});
}

/**
 * The cost of a stage that made one model call. The token counts are zero,
 * because no test here checks them.
 *
 * @param costUsd - The cost of the call.
 * @returns The stage cost.
 */
function oneCallCosting(costUsd: number): StageCost {
	return { promptTokens: 0, completionTokens: 0, callCount: 1, costUsd };
}

/**
 * Gives a stub stage the **real** `isStageComplete` check. These tests check what
 * the second and third pipeline runs do with a stage that the first completed.
 * `isStageComplete` decides what those pipeline runs do with the stage, and a copy
 * of that check here could become different.
 *
 * @param stageId - The stage of the stub.
 * @returns The `isComplete` for the stub stage.
 */
function realIsComplete(stageId: StageId): (context: StageContext) => Promise<boolean> {
	return (context) => isStageComplete({ context, stageId });
}

async function readRunLog(workspaceRoot: string, pipelineRunId: string): Promise<RunLog> {
	return (await readJsonFile(
		join(runLogsDirPath({ workspaceRoot }), `${pipelineRunId}.json`),
	)) as RunLog;
}

/**
 * A matcher for one stage outcome: the stage, and the run log entry fields that
 * the test checks. The name says that it is a matcher. It holds no outcome, only
 * the shape of one. The entry fields are beside `stageId`, not under a key of
 * their own, so one outcome reads as one description.
 *
 * @param args - The stage, then the run log entry fields that must be present.
 * @param args.stageId - The stage of the outcome.
 * @returns The matcher, for use in an `expect(...).toEqual`.
 */
function outcomeMatching({
	stageId,
	...entry
}: { readonly stageId: StageId } & Readonly<Record<string, unknown>>): unknown {
	return { stageId, entry: expect.objectContaining(entry) };
}

/**
 * Three stages far apart in the pipeline order, so the middle one has a stage on
 * each side. The tests of where a pipeline run starts or ends use these stages.
 */
const SPANNING_STAGES = [
	"audio-extraction",
	"transcription",
	"synthesis",
] as const satisfies readonly StageId[];

/**
 * The outcomes of a pipeline run over {@link SPANNING_STAGES} that did not reach
 * the third stage. The first two stages ran, and the third is `not-reached`. A
 * failed second stage halts a run in this way, and so does a `--to-stage` bound.
 * The parameter tells the two apart.
 *
 * @param secondStageStatus - The status of the second stage.
 * @returns The three outcomes, for use in an `expect(...).toEqual`.
 */
function outcomesStoppingAfterTheSecond(
	secondStageStatus: "complete" | "failed",
): readonly unknown[] {
	const [first, second, third] = SPANNING_STAGES;
	return [
		outcomeMatching({ stageId: first, action: "ran", status: "complete" }),
		outcomeMatching({ stageId: second, action: "ran", status: secondStageStatus }),
		{ stageId: third, entry: { action: "not-reached" } },
	];
}

describe("PipelineRunner integration", () => {
	let tempDir: string;
	let moduleRoot: string;
	let workspaceRoot: string;
	const logged = useStubLogger();
	// Source normalisation does nothing in this suite, because the subject is the
	// runner. It is a spy, so the test that checks that a batch normalises its
	// module can read the call. That test then needs no second runner.
	let normaliseModule: Mock<() => Promise<undefined>>;
	// The events that the runner reported. The suite keeps the events, not lines of
	// text, because the CLI owns the wording.
	let events: PipelineRunEvent[];

	beforeEach(async () => {
		tempDir = await makeTempDir({ prefix: "runner-" });
		moduleRoot = join(tempDir, testModuleName);
		workspaceRoot = workspaceRootFor({ moduleRoot, baseName: LECTURE_BASE_NAME });
		normaliseModule = vi.fn(() => Promise.resolve(undefined));
		events = [];
	});

	/** The events reported, in order, as `<event>` or `<event>:<stageId>`. */
	function reported(): readonly string[] {
		return events.map((event) =>
			event.event === "lecture-started" ? event.event : `${event.event}:${event.stageId}`,
		);
	}

	afterEach(async () => {
		vi.useRealTimers();
		await rm(tempDir, { recursive: true, force: true });
	});

	function makeRunner(lectureStages: readonly PipelineStage<unknown, unknown>[]): PipelineRunner {
		const sourceNormalisation: SourceNormalisationStage = {
			stageId: "source-normalisation",
			normaliseModule,
		};
		return new PipelineRunner({
			config: RUNNER_CONFIG,
			sourceNormalisation,
			lectureStages,
			logger: logged().logger,
			reporter: (event: PipelineRunEvent) => {
				events.push(event);
			},
		});
	}

	/**
	 * An audio-extraction stage that writes its output file and records the given
	 * cost. It uses the real `isStageComplete` check, so a later pipeline run on the
	 * same lecture skips it.
	 *
	 * @param cost - The cost that the stage records.
	 * @returns The stage.
	 */
	function audioStageCosting(cost: StageCost | null): PipelineStage<unknown, unknown> {
		return makeStubStage({
			stageId: "audio-extraction",
			isComplete: realIsComplete("audio-extraction"),
			run: async ({ context }) => ({
				output: undefined,
				cost,
				filesWritten: [
					await seedStageOutput({
						workspaceRoot: context.workspaceRoot,
						stageId: "audio-extraction",
					}),
				],
			}),
		});
	}

	describe("runLecture lifecycle", () => {
		beforeEach(async () => {
			await writeManifest({ workspaceRoot, manifest: makeManifest() });
		});

		it("should execute the stage once when the same lecture is run three times", async () => {
			// Three, not two. The second pipeline run changes the stage entry from
			// `complete` to `skipped`. The third reads that entry and decides if it
			// pays for the work again.
			const stage = audioStageCosting(null);
			const run = vi.spyOn(stage, "run");
			const runner = makeRunner([stage]);

			await runner.runLecture({ workspaceRoot });
			await runner.runLecture({ workspaceRoot });
			const third = await runner.runLecture({ workspaceRoot });

			expect(run).toHaveBeenCalledTimes(1);
			expect(third.stageOutcomes).toEqual([
				outcomeMatching({ stageId: "audio-extraction", action: "skipped" }),
			]);
		});

		describe("a stage skipped on run after run", () => {
			let stage: PipelineStage<unknown, unknown>;
			let runner: PipelineRunner;
			let firstRunEntry: StageEntry | undefined;

			// The first pipeline run completes the stage, and the next two skip it. The
			// third is the first to find a `skipped` stage entry.
			beforeEach(async () => {
				stage = audioStageCosting(oneCallCosting(0.5));
				runner = makeRunner([stage]);
				await runner.runLecture({ workspaceRoot });
				firstRunEntry = (await readManifest({ workspaceRoot })).stages["audio-extraction"];
				await runner.runLecture({ workspaceRoot });
				await runner.runLecture({ workspaceRoot });
			});

			it("should keep the completion's time, settings, cost and files when a skip follows a skip", async () => {
				const manifest = await readManifest({ workspaceRoot });

				expect(manifest.stages["audio-extraction"]).toEqual({
					...firstRunEntry,
					status: "skipped",
				});
			});

			it("should run the stage again when its output is deleted after repeated skips", async () => {
				const run = vi.spyOn(stage, "run");
				await rm(stageOutputPath({ workspaceRoot, stageId: "audio-extraction" }));

				await runner.runLecture({ workspaceRoot });

				expect(run).toHaveBeenCalledTimes(1);
			});
		});

		describe("what the run reports as it goes", () => {
			it("should name the lecture then announce and close each stage when a stage runs", async () => {
				await makeRunner([audioStageCosting(oneCallCosting(0.5))]).runLecture({ workspaceRoot });

				expect(reported()).toEqual([
					"lecture-started",
					"stage-started:audio-extraction",
					"stage-completed:audio-extraction",
				]);
			});

			it("should report the cost the stage recorded when it completes", async () => {
				const cost = oneCallCosting(0.5);

				await makeRunner([audioStageCosting(cost)]).runLecture({ workspaceRoot });

				expect(events).toContainEqual({
					event: "stage-completed",
					stageId: "audio-extraction",
					cost,
				});
			});

			// A pipeline run on a lecture whose stages are all completed stages skips
			// each stage. The user must still see a notice for each skipped stage.
			it("should announce nothing as started when every stage is skipped", async () => {
				const skipping = makeStubStage({
					stageId: "audio-extraction",
					isComplete: async () => true,
					run: spyingRun(),
				});

				await makeRunner([skipping]).runLecture({ workspaceRoot });

				expect(reported()).toEqual(["lecture-started", "stage-skipped:audio-extraction"]);
			});

			it("should report the failure when a stage throws", async () => {
				await makeRunner([failingAudioStage()]).runLecture({ workspaceRoot });

				expect(reported()).toEqual([
					"lecture-started",
					"stage-started:audio-extraction",
					"stage-failed:audio-extraction",
				]);
			});

			it("should say nothing about a later stage when an earlier one halts the run", async () => {
				const failing = failingAudioStage();
				const later = makeStubStage({ stageId: "transcription", run: spyingRun() });

				await makeRunner([failing, later]).runLecture({ workspaceRoot });

				expect(reported()).not.toContain("stage-started:transcription");
			});
		});

		it("should record a completed stage and its cost when the stage succeeds", async () => {
			const summary = await makeRunner([audioStageCosting(oneCallCosting(0.5))]).runLecture({
				workspaceRoot,
			});

			expect(summary.overallStatus).toBe("success");
			expect(summary.stageOutcomes).toEqual([
				outcomeMatching({ stageId: "audio-extraction", action: "ran", status: "complete" }),
			]);
			const manifest = await readManifest({ workspaceRoot });
			const entry = manifest.stages["audio-extraction"];
			expect(entry?.status).toBe("complete");
			expect(entry?.status === "complete" && entry.cost?.costUsd).toBe(0.5);
			expect(entry?.status === "complete" && entry.filesWritten).toEqual([
				stageOutputEntry("audio-extraction"),
			]);
			const runLog = await readRunLog(workspaceRoot, summary.pipelineRunId);
			expect(runLog.stages["audio-extraction"]).toMatchObject({
				action: "ran",
				status: "complete",
			});
		});

		it("should record the unresolved cost and its reason when a stage's cost could not be established", async () => {
			const unknownCostReason = "the generation endpoint timed out";
			const stage = makeStubStage({
				stageId: "audio-extraction",
				run: async () => ({
					output: undefined,
					cost: {
						promptTokens: 10,
						completionTokens: 20,
						callCount: 1,
						costUsd: null,
						unknownCostReason,
					},
					filesWritten: [],
				}),
			});

			const summary = await makeRunner([stage]).runLecture({ workspaceRoot });

			// The stage entry is the only record of the stage's cost. So the unknown
			// cost must stay there, for the cost report to show `n/a`.
			const manifest = await readManifest({ workspaceRoot });
			const entry = manifest.stages["audio-extraction"];
			expect(entry?.status === "complete" && entry.cost).toEqual({
				promptTokens: 10,
				completionTokens: 20,
				callCount: 1,
				costUsd: null,
				unknownCostReason,
			});
			// The run log records the unknown cost, but not the reason. `RunLogCost`
			// holds only the cost and the call count. The reason stays in the stage entry.
			const runLog = await readRunLog(workspaceRoot, summary.pipelineRunId);
			expect(runLog.stages["audio-extraction"]).toMatchObject({
				cost: { costUsd: null, callCount: 1 },
			});
		});

		it("should mark the stage running on disk before it begins when a stage runs", async () => {
			let statusDuringRun: string | undefined;
			const stage = makeStubStage({
				stageId: "audio-extraction",
				run: async ({ context }) => {
					const current = await readManifest({ workspaceRoot: context.workspaceRoot });
					statusDuringRun = current.stages["audio-extraction"]?.status;
					return PRODUCED_NOTHING;
				},
			});

			await makeRunner([stage]).runLecture({ workspaceRoot });

			expect(statusDuringRun).toBe("running");
		});

		it("should log the failure with its stack against the stage when a stage throws", async () => {
			const failure = new Error(AUDIO_EXTRACTION_FAILURE);
			const stage = makeStubStage({
				stageId: "audio-extraction",
				run: () => Promise.reject(failure),
			});

			await makeRunner([stage]).runLecture({ workspaceRoot });

			const errors = loggedAt({ entries: logged().entries, level: "error" });
			expect(errors).toHaveLength(1);
			const [entry] = errors;
			expect(entry?.bindings).toEqual({ stage: "audio-extraction" });
			expect(entry?.payload.err).toBe(failure);
		});

		it("should record a failed stage when the stage throws", async () => {
			const summary = await makeRunner([failingAudioStage()]).runLecture({ workspaceRoot });

			expect(summary.overallStatus).toBe("failed");
			expect(summary.stageOutcomes).toEqual([
				outcomeMatching({
					stageId: "audio-extraction",
					action: "ran",
					status: "failed",
					error: AUDIO_EXTRACTION_FAILURE,
				}),
			]);
			const manifest = await readManifest({ workspaceRoot });
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
				outcomeMatching({
					stageId: "audio-extraction",
					action: "ran",
					status: "failed",
					error: "ffmpeg exited unexpectedly",
				}),
			]);
		});

		it("should skip a stage and not run it when its output already exists", async () => {
			const writtenEntry = await seedStageOutput({ workspaceRoot, stageId: "audio-extraction" });
			await writeManifest({
				workspaceRoot,
				manifest: makeManifest({
					stages: stagesWith({
						stageId: "audio-extraction",
						entry: completedEntry({
							completedAt: BEFORE_THIS_RUN,
							filesWritten: [writtenEntry],
						}),
					}),
				}),
			});
			const run = spyingRun();
			const stage = makeStubStage({
				stageId: "audio-extraction",
				isComplete: async (context) =>
					context.manifest.stages["audio-extraction"]?.status === "complete",
				run,
			});

			const summary = await makeRunner([stage]).runLecture({ workspaceRoot });

			expect(run).not.toHaveBeenCalled();
			// A pipeline run that repeats no work is a success. It is the most usual
			// pipeline run.
			expect(summary.overallStatus).toBe("success");
			expect(summary.stageOutcomes).toEqual([
				{ stageId: "audio-extraction", entry: { action: "skipped" } },
			]);
			const manifest = await readManifest({ workspaceRoot });
			const entry = manifest.stages["audio-extraction"];
			expect(entry?.status).toBe("skipped");
			expect(entry?.status === "skipped" && entry.completedAt).toBe(BEFORE_THIS_RUN);
		});

		it("should mark downstream stages not-reached when an upstream stage fails", async () => {
			const first = makeStubStage({
				stageId: "audio-extraction",
				run: () => Promise.resolve({ ...PRODUCED_NOTHING, cost: oneCallCosting(0.1) }),
			});
			const second = makeStubStage({
				stageId: "transcription",
				run: () => Promise.reject(new Error("transcription request failed")),
			});
			const thirdRun = spyingRun();
			const third = makeStubStage({ stageId: "synthesis", run: thirdRun });

			const summary = await makeRunner([first, second, third]).runLecture({ workspaceRoot });

			expect(thirdRun).not.toHaveBeenCalled();
			expect(summary.overallStatus).toBe("failed");
			expect(summary.stageOutcomes).toEqual(outcomesStoppingAfterTheSecond("failed"));
			const runLog = await readRunLog(workspaceRoot, summary.pipelineRunId);
			expect(runLog.stages.synthesis).toEqual({ action: "not-reached" });
		});

		it("should continue past a failed stage when onStageFailure is continue", async () => {
			const laterRun = spyingRun();
			const later = makeStubStage({ stageId: "transcription", run: laterRun });

			const summary = await makeRunner([failingAudioStage(), later]).runLecture({
				workspaceRoot,
				options: { onStageFailure: "continue" },
			});

			expect(laterRun).toHaveBeenCalledTimes(1);
			expect(summary.overallStatus).toBe("failed");
			expect(summary.stageOutcomes).toEqual([
				outcomeMatching({ stageId: "audio-extraction", action: "ran", status: "failed" }),
				outcomeMatching({ stageId: "transcription", action: "ran", status: "complete" }),
			]);
		});

		it("should write a timestamped run-log file to runs/ when a run is invoked", async () => {
			vi.useFakeTimers({ toFake: ["Date"] });
			const stage = makeStubStage({ stageId: "audio-extraction" });
			const runner = makeRunner([stage]);

			// Two acts, each at its own clock time. The second time cannot be set
			// before the first pipeline run, so the acts and the clock settings
			// alternate on purpose.
			vi.setSystemTime(new Date("2025-10-10T09:00:00Z"));
			const first = await runner.runLecture({ workspaceRoot });
			vi.setSystemTime(new Date("2025-10-10T09:00:05Z"));
			const second = await runner.runLecture({ workspaceRoot });

			const files = await readdir(runLogsDirPath({ workspaceRoot }));
			expect(files).toHaveLength(2);
			expect(files).toContain(`${first.pipelineRunId}.json`);
			expect(files).toContain(`${second.pipelineRunId}.json`);
		});

		// One invocation writes one debug log and can do many pipeline runs. So the
		// debug log records the id of each pipeline run, before the first stage
		// starts. With the id, a reader can find the debug output of a run log.
		it("should record which run it is in the debug log when a run starts", async () => {
			const summary = await makeRunner([makeStubStage({ stageId: "audio-extraction" })]).runLecture(
				{ workspaceRoot },
			);

			expect(logged().entries).toContainEqual(
				expect.objectContaining({
					level: "debug",
					payload: expect.objectContaining({ pipelineRunId: summary.pipelineRunId, workspaceRoot }),
				}),
			);
		});
	});

	describe("runLecture with --from-stage", () => {
		/** The workspace folder of a stage's output file. The function is only for a stage that writes one file. */
		function stageDir(stageId: StageWithOutputFile): string {
			return dirname(stageOutputPath({ workspaceRoot, stageId }));
		}

		/**
		 * Puts a file in each folder of a stage, as a completed stage would, and
		 * returns the folders. It is for a stage that writes a set of files, which
		 * {@link seedStageOutput} cannot make.
		 *
		 * @param stageId - The stage whose folders to fill.
		 * @returns The absolute paths of the folders.
		 */
		async function fillStageDirectories(stageId: StageId): Promise<readonly string[]> {
			const paths = stageDirectoryPaths({ workspaceRoot, stageId });
			for (const path of paths) {
				await mkdir(path, { recursive: true });
				await writeFile(join(path, "left-behind.txt"), "x");
			}
			return paths;
		}

		/**
		 * Tells if each path is on disk, in the given order.
		 *
		 * @param paths - The absolute paths to test.
		 * @returns One boolean for each path.
		 */
		function whichExist(paths: readonly string[]): Promise<readonly boolean[]> {
			return Promise.all(paths.map((path) => pathExists(path)));
		}

		beforeEach(async () => {
			const stages: Record<string, Manifest["stages"][StageId]> = {};
			for (const stageId of SPANNING_STAGES) {
				stages[stageId] = completedEntry({
					status: "complete",
					filesWritten: [await seedStageOutput({ workspaceRoot, stageId })],
				});
			}
			await writeManifest({
				workspaceRoot,
				manifest: makeManifest({
					stages: { ...pendingStages(), ...stages } as Manifest["stages"],
				}),
			});
		});

		function fromStageRunner(): PipelineRunner {
			return makeRunner([
				makeStubStage({
					stageId: "audio-extraction",
					isComplete: realIsComplete("audio-extraction"),
				}),
				makeStubStage({ stageId: "transcription", isComplete: realIsComplete("transcription") }),
				makeStubStage({ stageId: "synthesis", isComplete: realIsComplete("synthesis") }),
			]);
		}

		/**
		 * Does a pipeline run from the given stage. The other options keep their
		 * defaults, because this suite tests only what `fromStage` resets.
		 *
		 * @param fromStage - The stage to run again, with each stage after it.
		 * @returns The run summary.
		 */
		function runFromStage(fromStage: StageId): Promise<PipelineRunSummary> {
			return fromStageRunner().runLecture({
				workspaceRoot,
				options: { ...DEFAULT_PIPELINE_RUN_OPTIONS, fromStage },
			});
		}

		it("should delete the nominated stage and downstream output when --from-stage is given", async () => {
			const summary = await runFromStage("transcription");

			await expect(access(stageDir("transcription"))).rejects.toThrow();
			await expect(access(stageDir("synthesis"))).rejects.toThrow();
			const runLog = await readRunLog(workspaceRoot, summary.pipelineRunId);
			expect(runLog.runType).toBe("experiment");
			expect(runLog.fromStage).toBe("transcription");
		});

		it("should leave upstream stages untouched when --from-stage is given", async () => {
			const summary = await runFromStage("transcription");

			await expect(
				access(stageOutputPath({ workspaceRoot, stageId: "audio-extraction" })),
			).resolves.toBeUndefined();
			expect(summary.stageOutcomes[0]).toEqual({
				stageId: "audio-extraction",
				entry: { action: "skipped" },
			});
		});

		// qa-loop has two folders, so each case checks if each of the two folders
		// stays.
		const clearingCases: readonly {
			readonly clears: string;
			readonly fromStage: StageId;
			readonly qaSurvives: readonly boolean[];
		}[] = [
			{
				clears: "nothing of the stage before it",
				fromStage: "pdf-generation",
				qaSurvives: [true, true],
			},
			{
				clears: "the checked notes with the iterations that produced them",
				fromStage: "qa-loop",
				qaSurvives: [false, false],
			},
		];

		it.each(clearingCases)("should clear $clears when --from-stage $fromStage is given", async ({
			fromStage,
			qaSurvives,
		}) => {
			const qaDirs = await fillStageDirectories("qa-loop");

			await runFromStage(fromStage);

			expect(await whichExist(qaDirs)).toStrictEqual(qaSurvives);
		});

		// `Final output/` holds the PDF of each lecture in the module. So a reset
		// deletes only the file with this lecture's date.
		describe("the module's shared Final output", () => {
			let finalOutput: string;

			beforeEach(async () => {
				finalOutput = moduleDirs({ moduleRoot }).finalOutput;
				await mkdir(finalOutput, { recursive: true });
				for (const lecture of [testLecture, otherLecture]) {
					await writeFile(join(finalOutput, lecture.finalOutputFile), "pdf");
				}
			});

			// Each --from-stage at or before `pdf-generation` resets `pdf-generation`, so
			// each of these cases deletes from the same folder.
			it.each([
				"pdf-generation",
				"qa-loop",
				"synthesis",
			] as const satisfies readonly StageId[])("should take this lecture's PDF and leave the module's other lectures alone when --from-stage %s is given", async (fromStage) => {
				await runFromStage(fromStage);

				expect(await pathExists(join(finalOutput, testLecture.finalOutputFile))).toBe(false);
				expect(await pathExists(join(finalOutput, otherLecture.finalOutputFile))).toBe(true);
			});
		});
	});

	describe("runLecture with --to-stage", () => {
		beforeEach(async () => {
			await writeManifest({ workspaceRoot, manifest: makeManifest() });
		});

		/**
		 * The three stages, each with a spy on its `run`, so a test can tell which
		 * stages ran before the bound.
		 *
		 * @returns The stages in pipeline order, and the spy of each stage by its id.
		 */
		function spyingStages(): {
			readonly stages: readonly PipelineStage<unknown, unknown>[];
			readonly runs: ReadonlyMap<StageId, Mock<() => Promise<StageResult<unknown>>>>;
		} {
			const runs = new Map<StageId, Mock<() => Promise<StageResult<unknown>>>>();
			const stages = SPANNING_STAGES.map((stageId) => {
				const run = spyingRun();
				runs.set(stageId, run);
				return makeStubStage({ stageId, run });
			});
			return { stages, runs };
		}

		/**
		 * Does a pipeline run with a bound at the given stage. The other options keep
		 * their defaults.
		 *
		 * @param toStage - The last stage that the run does.
		 * @returns The run summary, and the spies of the stages.
		 */
		async function runToStage(toStage: StageId): Promise<{
			readonly summary: PipelineRunSummary;
			readonly runs: ReadonlyMap<StageId, Mock<() => Promise<StageResult<unknown>>>>;
		}> {
			const { stages, runs } = spyingStages();
			const summary = await makeRunner(stages).runLecture({
				workspaceRoot,
				options: { ...DEFAULT_PIPELINE_RUN_OPTIONS, toStage },
			});
			return { summary, runs };
		}

		it("should run no stage after the nominated one when --to-stage is given", async () => {
			const { summary, runs } = await runToStage("transcription");

			expect(runs.get("audio-extraction")).toHaveBeenCalledTimes(1);
			expect(runs.get("transcription")).toHaveBeenCalledTimes(1);
			expect(runs.get("synthesis")).not.toHaveBeenCalled();
			expect(summary.stageOutcomes).toEqual(outcomesStoppingAfterTheSecond("complete"));
		});

		it("should leave the stages beyond the bound pending when --to-stage is given", async () => {
			await runToStage("transcription");

			// The run reset nothing and deleted nothing. So the next ordinary pipeline
			// run continues from the bound.
			const manifest = await readManifest({ workspaceRoot });
			expect(manifest.stages.synthesis?.status).toBe("pending");
		});

		it("should record the bound in the run log when --to-stage is given", async () => {
			const { summary } = await runToStage("transcription");

			const runLog = await readRunLog(workspaceRoot, summary.pipelineRunId);
			expect(runLog.toStage).toBe("transcription");
		});

		it("should report success when --to-stage stopped the run short of the last stage", async () => {
			const { summary } = await runToStage("transcription");

			expect(summary.overallStatus).toBe("success");
		});

		it("should run no lecture stage when --to-stage names a stage before them all", async () => {
			// The bound is a position in the pipeline order. It is not matched against
			// the stages that the runner has. `source-normalisation` comes before each
			// lecture stage, so a run with that bound does no lecture stage.
			const { summary, runs } = await runToStage("source-normalisation");

			for (const stageId of SPANNING_STAGES) {
				expect(runs.get(stageId)).not.toHaveBeenCalled();
			}
			expect(summary.stageOutcomes).toEqual(
				SPANNING_STAGES.map((stageId) => ({ stageId, entry: { action: "not-reached" } })),
			);
		});
	});

	describe("scanning the configured modules", () => {
		let moduleA: string;
		let moduleB: string;
		let moduleC: string;

		/** A manifest with the identity of the given lecture. */
		function manifestFor(lecture: TestLecture): Manifest {
			return makeManifest({
				lectureNumber: lecture.number,
				lectureDate: lecture.date,
				lectureTitle: lecture.title,
			});
		}

		beforeEach(async () => {
			moduleA = join(tempDir, otherModuleName);
			moduleB = join(tempDir, "Pharmacology");
			moduleC = join(tempDir, "Microbiology");
			const write = async (root: string, baseName: string, manifest: Manifest): Promise<void> => {
				await writeManifest({
					workspaceRoot: workspaceRootFor({ moduleRoot: root, baseName }),
					manifest,
				});
			};
			// Three lectures. The second is in the same module as the test lecture,
			// with a different date. The third is in a second module, with the same
			// date as the test lecture.
			await write(moduleA, LECTURE_BASE_NAME, manifestFor(testLecture));
			await write(moduleA, "L2", manifestFor(otherLecture));
			await write(moduleB, "L3", manifestFor(sameDateLecture));
			// The runner must skip two things when it lists the workspaces. One is
			// a workspace folder with no manifest. The other is a module folder that the
			// pipeline never processed, with no `Pipeline processing/` folder.
			await mkdir(workspaceRootFor({ moduleRoot: moduleA, baseName: EMPTY_BASE_NAME }), {
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
				lectureDate: otherLecture.date,
			});

			expect(matches).toHaveLength(1);
			expect(matches[0]).toMatchObject({
				lectureNumber: otherLecture.number,
				lectureTitle: otherLecture.title,
			});
		});

		it("should skip the module when its directory holds no Pipeline processing folder", async () => {
			const matches = await resolver().resolveLecturesByDate({
				moduleRoots: [moduleC, moduleA],
				lectureDate: otherLecture.date,
			});

			expect(matches.map((match) => match.lectureTitle)).toEqual([otherLecture.title]);
		});

		it("should return every matching lecture across modules when several match the date", async () => {
			const matches = await resolver().resolveLecturesByDate({
				moduleRoots: [moduleA, moduleB, moduleC],
				lectureDate: testLecture.date,
			});

			expect(matches).toHaveLength(2);
			const titles = matches.map((match) => match.lectureTitle).sort();
			expect(titles).toEqual([testLecture.title, sameDateLecture.title].sort());
			for (const match of matches) {
				expect(match).toMatchObject({
					moduleRoot: expect.any(String),
					workspaceRoot: expect.any(String),
					lectureNumber: expect.any(Number),
					lectureTitle: expect.any(String),
				});
			}
		});

		// One count covers both things that the runner skips. The folder with no
		// manifest is not a lecture, and the module with no processing folder has no
		// lectures. These modules hold three lectures, and the count is three.
		it("should count the lectures a batch would cover when the modules are measured", async () => {
			const count = await resolver().countLectures({ moduleRoots: [moduleA, moduleB, moduleC] });

			expect(count).toBe(3);
		});

		it("should count none when the modules hold no lecture", async () => {
			const count = await resolver().countLectures({ moduleRoots: [moduleC] });

			expect(count).toBe(0);
		});
	});

	describe("runBatch", () => {
		let moduleA: string;

		beforeEach(async () => {
			moduleA = join(tempDir, otherModuleName);
			const workspaceIn = (baseName: string): string =>
				workspaceRootFor({ moduleRoot: moduleA, baseName });
			await writeManifest({
				workspaceRoot: workspaceIn(LECTURE_BASE_NAME),
				manifest: makeManifest({ lectureNumber: 1 }),
			});
			await writeManifest({
				workspaceRoot: workspaceIn("L2"),
				manifest: makeManifest({ lectureNumber: 2 }),
			});
		});

		function batchStage(): PipelineStage<unknown, unknown> {
			return makeStubStage({
				stageId: "audio-extraction",
				run: () => Promise.resolve({ ...PRODUCED_NOTHING, cost: oneCallCosting(0.25) }),
			});
		}

		it.each([
			{ scenario: "the caller asks for none", options: undefined },
			{ scenario: "it is the default of one at a time", options: DEFAULT_BATCH_OPTIONS },
			{ scenario: "it is two at a time", options: { ...DEFAULT_BATCH_OPTIONS, concurrency: 2 } },
		])("should run every lecture in the module when $scenario", async ({ options }) => {
			const summary = await makeRunner([batchStage()]).runBatch({
				moduleRoots: [moduleA],
				options,
			});

			expect(normaliseModule).toHaveBeenCalledWith({ moduleRoot: moduleA });
			expect(summary.lectures).toHaveLength(2);
			expect(summary.overallStatus).toBe("success");
		});

		// Without a notice for each lecture, the stage notices of a batch repeat the
		// same stage names, and nothing tells which lecture each belongs to.
		it("should name each lecture in turn when the batch runs several", async () => {
			await makeRunner([batchStage()]).runBatch({ moduleRoots: [moduleA] });

			expect(reported().filter((entry) => entry === "lecture-started")).toHaveLength(2);
		});

		it("should run the lectures in date order when the batch starts", async () => {
			// The names do not sort in date order, as text or by number. "Lecture 10"
			// sorts before "Lecture 2" as text, and neither order is the date order.
			const byDate = [
				{ baseName: "Lecture 10 - Autumn - 2025-09-01", lectureDate: "2025-09-01" },
				{ baseName: "Lecture 2 - Winter - 2025-11-20", lectureDate: "2025-11-20" },
				{ baseName: "Lecture 1 - Spring - 2025-12-05", lectureDate: "2025-12-05" },
			];
			const moduleB = join(tempDir, "Chronology");
			for (const { baseName, lectureDate } of byDate) {
				await writeManifest({
					workspaceRoot: workspaceRootFor({ moduleRoot: moduleB, baseName }),
					manifest: makeManifest({ lectureDate }),
				});
			}
			const datesInRunOrder: string[] = [];
			const stubThatListsDates = makeStubStage({
				stageId: "audio-extraction",
				run: ({ context }) => {
					datesInRunOrder.push(context.lectureDate);
					return Promise.resolve(PRODUCED_NOTHING);
				},
			});

			await makeRunner([stubThatListsDates]).runBatch({ moduleRoots: [moduleB] });

			expect(datesInRunOrder).toEqual(["2025-09-01", "2025-11-20", "2025-12-05"]);
		});

		it("should run every lecture and skip the folder when one holds no manifest", async () => {
			await mkdir(workspaceRootFor({ moduleRoot: moduleA, baseName: EMPTY_BASE_NAME }), {
				recursive: true,
			});

			const summary = await makeRunner([batchStage()]).runBatch({ moduleRoots: [moduleA] });

			expect(summary.lectures).toHaveLength(2);
			expect(summary.overallStatus).toBe("success");
		});

		it("should report a failed batch when any lecture fails", async () => {
			const runner = makeRunner([failingAudioStage()]);

			const summary = await runner.runBatch({ moduleRoots: [moduleA] });

			expect(summary.overallStatus).toBe("failed");
		});

		it("should report a successful batch when every lecture only skips stages", async () => {
			const skipping = makeStubStage({ stageId: "audio-extraction", isComplete: async () => true });
			const runner = makeRunner([skipping]);

			const summary = await runner.runBatch({ moduleRoots: [moduleA] });

			expect(summary.overallStatus).toBe("success");
		});
	});

	describe("costReport", () => {
		beforeEach(async () => {
			await writeManifest({
				workspaceRoot,
				manifest: makeManifest({
					stages: stagesWith({
						stageId: "audio-extraction",
						entry: completedEntry({
							completedAt: BEFORE_THIS_RUN,
							configUsed: { modelId: "openrouter/model-a" },
							cost: { promptTokens: 1, completionTokens: 1, callCount: 1, costUsd: 0.5 },
						}),
					}),
				}),
			});
			const runLog: RunLog = {
				pipelineRunId: testTimestampId,
				startedAt: "2025-10-10T09:00:00Z",
				endedAt: "2025-10-10T09:00:01Z",
				triggeredBy: "manual",
				runType: "normal",
				fromStage: null,
				toStage: null,
				stages: {},
			};
			const runsDir = runLogsDirPath({ workspaceRoot });
			await mkdir(runsDir, { recursive: true });
			await writeFile(join(runsDir, `${runLog.pipelineRunId}.json`), JSON.stringify(runLog));
			// A folder in `Run logs/`, a corrupt run log and a workspace with no
			// manifest. The cost report ignores each of them.
			await mkdir(join(runsDir, "nested"), { recursive: true });
			await writeFile(join(runsDir, "corrupt.json"), corruptJson);
			await mkdir(workspaceRootFor({ moduleRoot, baseName: EMPTY_BASE_NAME }), { recursive: true });
		});

		it("should return the current pipeline cost section when reporting all lectures", async () => {
			const reports = await makeRunner([]).costReport({ moduleRoots: [moduleRoot] });

			expect(reports).toHaveLength(1);
			expect(reports.join("")).toContain("Current pipeline cost");
		});

		it("should return a report when a lecture matches the requested date", async () => {
			const reports = await makeRunner([]).costReport({
				moduleRoots: [moduleRoot],
				options: { lectureDate: testLecture.date },
			});

			expect(reports.join("")).toContain("Current pipeline cost");
		});

		// The runner reads each file in `Run logs/`, because there is no index. A
		// file that parses as JSON is not always a run log.
		it("should ignore a file in runs/ when it parses but is not a run log", async () => {
			await writeFile(
				join(runLogsDirPath({ workspaceRoot }), "debug.json"),
				JSON.stringify({ note: "not a run log" }),
			);

			const reports = await makeRunner([]).costReport({ moduleRoots: [moduleRoot] });

			expect(reports.join("")).toContain("Current pipeline cost");
		});

		it("should return no reports when no lecture matches the requested date", async () => {
			const reports = await makeRunner([]).costReport({
				moduleRoots: [moduleRoot],
				options: { lectureDate: "2099-01-01" },
			});

			expect(reports).toEqual([]);
		});
	});

	// The cost report reads the run type from the run log (technical-design.md §7).
	// So these tests read it from the run log too, not from the runner's private
	// functions.
	describe("deciding the run type", () => {
		const TARGET_STAGE = "transcription" as const satisfies StageId;

		/**
		 * The opposite of {@link stagesWith}: a stage map with no key for one stage.
		 * Each other stage is `pending`.
		 *
		 * @param stageId - The stage to leave out of the map.
		 * @returns The stage map.
		 */
		function stagesWithout(stageId: StageId): Manifest["stages"] {
			const stages = pendingStages();
			delete (stages as Record<string, StageEntry>)[stageId];
			return stages;
		}

		/**
		 * Does a pipeline run on a lecture whose target stage has the given entry,
		 * and gives the run type from the run log.
		 *
		 * @param args - The target's stage entry and the `--from-stage` target.
		 * @param args.entry - The target's stage entry, or `null` for no entry in the manifest.
		 * @param args.fromStage - The `--from-stage` target, or `null` for an ordinary pipeline run.
		 * @returns The run type in the run log.
		 */
		async function runTypeOf({
			entry,
			fromStage,
		}: {
			readonly entry: StageEntry | null;
			readonly fromStage: StageId | null;
		}): Promise<RunType> {
			const stages =
				entry === null ? stagesWithout(TARGET_STAGE) : stagesWith({ stageId: TARGET_STAGE, entry });
			await writeManifest({ workspaceRoot, manifest: makeManifest({ stages }) });
			const summary = await makeRunner([makeStubStage({ stageId: "audio-extraction" })]).runLecture(
				{
					workspaceRoot,
					...(fromStage === null
						? {}
						: { options: { ...DEFAULT_PIPELINE_RUN_OPTIONS, fromStage } }),
				},
			);
			return (await readRunLog(workspaceRoot, summary.pipelineRunId)).runType;
		}

		it("should give the run type normal when no from-stage is given", async () => {
			expect(await runTypeOf({ entry: null, fromStage: null })).toBe<RunType>("normal");
		});

		// A new run of a completed stage is an experiment. Any other target is a
		// recovery from an error (technical-design.md §7, "Run Classification").
		it.each([
			{ state: "complete", entry: completedEntry({ status: "complete" }), expected: "experiment" },
			{ state: "skipped", entry: completedEntry({ status: "skipped" }), expected: "experiment" },
			{
				state: "failed",
				entry: {
					status: "failed",
					failedAt: stageCompletedAt,
					error: "transcription request failed",
					configUsed: null,
					cost: null,
					filesWritten: [],
				} satisfies StageEntry,
				expected: "error-recovery",
			},
			{
				state: "pending",
				entry: { status: "pending" } satisfies StageEntry,
				expected: "error-recovery",
			},
			{
				state: "running",
				entry: { status: "running" } satisfies StageEntry,
				expected: "error-recovery",
			},
			{ state: "absent from the manifest", entry: null, expected: "error-recovery" },
		])("should give the run type $expected when from-stage targets a stage $state", async ({
			entry,
			expected,
		}) => {
			expect(await runTypeOf({ entry, fromStage: TARGET_STAGE })).toBe<RunType>(
				expected as RunType,
			);
		});
	});

	describe("identity a stage decides", () => {
		beforeEach(async () => {
			await writeManifest({ workspaceRoot, manifest: makeManifest() });
		});

		/** A stage that decides the given identity and writes no file. */
		function makeDecidingStage(
			identityChanges: LectureIdentityChanges,
		): PipelineStage<unknown, unknown> {
			return makeStubStage({
				stageId: "audio-extraction",
				run: async () =>
					({
						output: undefined,
						cost: null,
						filesWritten: [],
						identityChanges,
					}) as StageResult<unknown>,
			});
		}

		it("should write the identity a stage decided when the stage completes", async () => {
			await makeRunner([makeDecidingStage(DECIDED_IDENTITY)]).runLecture({ workspaceRoot });

			expect(await readManifest({ workspaceRoot })).toMatchObject(DECIDED_IDENTITY);
		});

		it("should record the stage complete in the same write when a stage decides identity", async () => {
			await makeRunner([makeDecidingStage(DECIDED_IDENTITY)]).runLecture({ workspaceRoot });

			expect((await readManifest({ workspaceRoot })).stages["audio-extraction"]?.status).toBe(
				"complete",
			);
		});

		it("should leave the lecture's identity alone when a stage decides nothing", async () => {
			await makeRunner([makeStubStage({ stageId: "audio-extraction" })]).runLecture({
				workspaceRoot,
			});

			expect(await readManifest({ workspaceRoot })).toMatchObject({
				lectureTitle: testLecture.title,
				aiDerivedTitle: null,
			});
		});
	});

	describe("following a relocated workspace", () => {
		let renamedWorkspaceRoot: string;

		// Any stage can do the rename, if it runs before the later stage below. The
		// stage list and the assertions both use this name.
		const RENAMING_STAGE = "audio-extraction";

		/**
		 * A stage that acts as `transcript-structuring` does when it replaces the
		 * lecture title. It moves the workspace and returns the identity that it
		 * decided. The runner writes the manifest.
		 */
		function makeRenamingStage(): PipelineStage<unknown, unknown> {
			return makeStubStage({
				stageId: RENAMING_STAGE,
				run: async ({ context }) => {
					await rename(context.workspaceRoot, renamedWorkspaceRoot);
					return {
						output: undefined,
						cost: null,
						filesWritten: [],
						identityChanges: DECIDED_IDENTITY,
					} as StageResult<unknown>;
				},
			});
		}

		/** Does a pipeline run that has only the renaming stage. */
		function runRenamingWorkspace(): Promise<PipelineRunSummary> {
			return makeRunner([makeRenamingStage()]).runLecture({ workspaceRoot });
		}

		beforeEach(async () => {
			renamedWorkspaceRoot = workspaceRootFor({ moduleRoot, baseName: RENAMED_BASE_NAME });
			await writeManifest({ workspaceRoot, manifest: makeManifest() });
		});

		it("should record the completed stage in the manifest at its new path when a stage renames the workspace", async () => {
			await runRenamingWorkspace();

			const manifest = await readManifest({ workspaceRoot: renamedWorkspaceRoot });
			expect(manifest.stages[RENAMING_STAGE]?.status).toBe("complete");
		});

		// The test reads the title and the path from the rebuilt context. Only the
		// beforeEach knows the expected values, so the rows hold functions.
		it.each([
			{
				what: "new lectureTitle",
				read: (context: StageContext) => context.lectureTitle,
				expected: () => aiDerivedLecture.title,
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

			await makeRunner([makeRenamingStage(), downstream]).runLecture({ workspaceRoot });

			expect(seen).toEqual([expected()]);
		});

		it("should write the run log to the renamed workspace when a stage renames it", async () => {
			const summary = await runRenamingWorkspace();

			await expect(readRunLog(renamedWorkspaceRoot, summary.pipelineRunId)).resolves.toMatchObject({
				pipelineRunId: summary.pipelineRunId,
			});
		});

		it("should report the workspace's new path in the summary when a stage renames it", async () => {
			const summary = await runRenamingWorkspace();

			expect(summary.workspaceRoot).toBe(renamedWorkspaceRoot);
		});
	});
});
