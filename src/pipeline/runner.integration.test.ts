import { access, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import {
	DEFAULT_BATCH_OPTIONS,
	DEFAULT_RUN_OPTIONS,
	type LectureIdentityChanges,
	type ManifestStageEntry,
	type PipelineConfig,
	type PipelineStage,
	type RunLog,
	type RunManifest,
	type RunSummary,
	type RunType,
	type SourceNormalisationStage,
	type StageContext,
	type StageCost,
	type StageId,
	type StageResult,
} from "../types/pipeline.js";
import { pathExists } from "../utils/files.js";
import {
	aiDerivedLecture,
	corruptJson,
	finishedEntry,
	loggedAt,
	makeConfig,
	makeManifest,
	makeTempDir,
	otherLecture,
	otherModuleName,
	sameDateLecture,
	seedStageOutput,
	stageCompletedAt,
	stagesWith,
	type TestLecture,
	testLecture,
	testModuleName,
	testRunId,
	useStubLogger,
} from "./fixtures.js";
import {
	moduleDirs,
	runsDirPath,
	stageDirectoryPaths,
	stageOutputEntry,
	stageOutputPath,
	workspaceRootFor,
} from "./layout.js";
import { pendingStages, readManifest, writeManifest } from "./manifest.js";
import { PipelineRunner } from "./runner.js";
import { isStageComplete } from "./stages/pipeline-stage.js";

// The runner never parses a workspace folder name — it is handed the path — so
// this suite uses short synthetic names rather than {@link testLecture}'s, which
// would only make the assertions harder to read.
const LECTURE_FOLDER = "L1";
const EMPTY_FOLDER = "L-empty";

// The instant a stage finished on some run before the one under test. Not an ISO
// timestamp on purpose: nothing parses it, and the cases that seed it are
// asserting that the runner carried the *prior* completion forward rather than
// stamping its own, which a value that could plausibly be either would hide.
const BEFORE_THIS_RUN = "earlier";

/** The folder a lecture moves to once Stage 3 has replaced its title. */
const RENAMED_FOLDER = `${LECTURE_FOLDER} - ${aiDerivedLecture.title}`;

// What Stage 3 settles when it replaces the lecture's title: the new title, the
// record of what the model derived, and the base name the files move onto. Two
// suites need it — one with the rename, one without — so it is stated here.
const SETTLED_IDENTITY: LectureIdentityChanges = {
	lectureTitle: aiDerivedLecture.title,
	aiDerivedTitle: aiDerivedLecture.title,
	workspaceFolderName: RENAMED_FOLDER,
};

// The runner is driven through a single configured stage throughout, so the
// stage entry is fixed here rather than restated at each construction site.
const RUNNER_CONFIG: PipelineConfig = makeConfig({
	stages: { "audio-extraction": { modelId: "openrouter/model-a" } },
});

// What a stub stage returns when the test is about whether the stage ran at all
// rather than about what it produced: no output, no cost, no files.
const PRODUCED_NOTHING: StageResult<unknown> = {
	output: undefined,
	cost: null,
	filesWritten: [],
};

// The message a stub audio-extraction stage throws. Five tests state it: four to
// make the stage fail, and one to assert the message reaches the run summary.
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
 * A stage `run` that produces nothing, as a spy — so a test can assert whether
 * the runner reached the stage at all. {@link makeStubStage}'s own default does
 * the same work, but a test asserting on the call needs the spy in its hand.
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
 * The cost of a stage that made one API call, priced only by what it charged:
 * the token counts are not what any test stating a cost here is about.
 *
 * @param costUsd - What the call cost.
 * @returns The stage cost.
 */
function oneCallCosting(costUsd: number): StageCost {
	return { promptTokens: 0, completionTokens: 0, callCount: 1, costUsd };
}

/**
 * Drives a stub stage through the **real** idempotency check.
 *
 * A stand-in written here could agree with `isStageComplete` today and drift
 * from it tomorrow, and the behaviour these tests are about — what a second and
 * third run do with a stage the first one finished — lives entirely inside it.
 *
 * @param stageId - The stage the stub implements.
 * @returns The `isComplete` a stub stage is built with.
 */
function realIsComplete(stageId: StageId): (context: StageContext) => Promise<boolean> {
	return (context) => isStageComplete({ context, stageId });
}

async function readRunLog(workspaceRoot: string, runId: string): Promise<RunLog> {
	const path = join(runsDirPath({ workspaceRoot }), `${runId}.json`);
	return JSON.parse(await readFile(path, "utf8")) as RunLog;
}

/**
 * A matcher for one stage outcome — the stage, and the part of its run-log entry
 * the test actually cares about. Named for what it is rather than what it
 * describes: it never holds an outcome, only the shape one has to have.
 *
 * The entry's fields sit beside `stageId` rather than nested under a key of
 * their own, because one outcome is one description and reads as one.
 *
 * @param args - What the outcome must look like: the stage, then the run-log entry fields that must be present.
 * @param args.stageId - The stage the outcome belongs to.
 * @returns The matcher, for use inside an `expect(...).toEqual`.
 */
function outcomeMatching({
	stageId,
	...entry
}: { readonly stageId: StageId } & Readonly<Record<string, unknown>>): unknown {
	return { stageId, entry: expect.objectContaining(entry) };
}

describe("PipelineRunner integration", () => {
	let tempDir: string;
	let moduleRoot: string;
	let workspaceRoot: string;
	const logged = useStubLogger();
	// Source normalisation does nothing in this suite — the runner is the subject,
	// not the stage. It is a spy rather than a bare no-op so that the one test
	// asserting the batch normalises its module can read the call off it, instead
	// of standing up a second runner to inject a spy of its own.
	let normaliseModule: Mock<() => Promise<undefined>>;

	beforeEach(async () => {
		tempDir = await makeTempDir({ prefix: "runner-" });
		moduleRoot = join(tempDir, testModuleName);
		workspaceRoot = workspaceRootFor({ moduleRoot, folderName: LECTURE_FOLDER });
		normaliseModule = vi.fn(() => Promise.resolve(undefined));
	});

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
		});
	}

	describe("runLecture lifecycle", () => {
		beforeEach(async () => {
			await writeManifest({ workspaceRoot, manifest: makeManifest() });
		});

		it("should execute the stage once when the same lecture is run three times", async () => {
			// Three, not two: the second run is what rewrites the stage's entry from
			// `complete` to `skipped`, and the third is what reads that entry back
			// and decides whether to pay for the work again.
			const run = vi.fn(async ({ context }: { readonly context: StageContext }) => ({
				output: undefined,
				cost: null,
				filesWritten: [
					await seedStageOutput({
						workspaceRoot: context.workspaceRoot,
						stageId: "audio-extraction",
					}),
				],
			}));
			const stage = makeStubStage({
				stageId: "audio-extraction",
				isComplete: realIsComplete("audio-extraction"),
				run,
			});
			const runner = makeRunner([stage]);

			await runner.runLecture({ workspaceRoot });
			await runner.runLecture({ workspaceRoot });
			const third = await runner.runLecture({ workspaceRoot });

			expect(run).toHaveBeenCalledTimes(1);
			expect(third.stageOutcomes).toEqual([
				outcomeMatching({ stageId: "audio-extraction", action: "skipped" }),
			]);
		});

		it("should record a completed stage and its cost when the stage succeeds", async () => {
			const stage = makeStubStage({
				stageId: "audio-extraction",
				run: async ({ context }) => ({
					output: undefined,
					cost: oneCallCosting(0.5),
					filesWritten: [
						await seedStageOutput({
							workspaceRoot: context.workspaceRoot,
							stageId: "audio-extraction",
						}),
					],
				}),
			});

			const summary = await makeRunner([stage]).runLecture({ workspaceRoot });

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
			const runLog = await readRunLog(workspaceRoot, summary.runId);
			expect(runLog.stages["audio-extraction"]).toMatchObject({
				action: "ran",
				status: "complete",
			});
		});

		it("should record the unresolved cost and its reason when a stage's cost lookup failed", async () => {
			const costResolutionError = "the generation endpoint timed out";
			const stage = makeStubStage({
				stageId: "audio-extraction",
				run: async () => ({
					output: undefined,
					cost: {
						promptTokens: 10,
						completionTokens: 20,
						callCount: 1,
						costUsd: null,
						costResolutionError,
					},
					filesWritten: [],
				}),
			});

			const summary = await makeRunner([stage]).runLecture({ workspaceRoot });

			// The stage's own entry is the only record of what it cost, so an
			// unresolved lookup has to survive there for the report to show `n/a`.
			const manifest = await readManifest({ workspaceRoot });
			const entry = manifest.stages["audio-extraction"];
			expect(entry?.status === "complete" && entry.cost).toEqual({
				promptTokens: 10,
				completionTokens: 20,
				callCount: 1,
				costUsd: null,
				costResolutionError,
			});
			// The run log records the unresolved cost but not why: `RunLogCost` is the
			// amount and the call count, and the reason stays on the manifest entry.
			const runLog = await readRunLog(workspaceRoot, summary.runId);
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
						entry: finishedEntry({
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
			expect(summary.overallStatus).toBe("partial");
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
			expect(summary.stageOutcomes).toEqual([
				outcomeMatching({ stageId: "audio-extraction", action: "ran", status: "complete" }),
				outcomeMatching({ stageId: "transcription", action: "ran", status: "failed" }),
				{ stageId: "synthesis", entry: { action: "not-reached" } },
			]);
			const runLog = await readRunLog(workspaceRoot, summary.runId);
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

			// Two acts, each needing the clock somewhere the previous one has already
			// been: the second instant cannot be set before the first run, so this
			// interleaving is what the test is, not a lapse in its arrangement.
			vi.setSystemTime(new Date("2025-10-10T09:00:00Z"));
			const first = await runner.runLecture({ workspaceRoot });
			vi.setSystemTime(new Date("2025-10-10T09:00:05Z"));
			const second = await runner.runLecture({ workspaceRoot });

			const files = await readdir(runsDirPath({ workspaceRoot }));
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

		/**
		 * Fills every directory a stage owns, as a finished run would have left
		 * them, and returns those directories. Used for the stages that write a set
		 * rather than one named file, which {@link writeStageOutput} cannot serve.
		 *
		 * @param stageId - The stage whose directories to fill.
		 * @returns The absolute paths that were filled.
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
		 * Whether each path is still on disk, in the order given.
		 *
		 * @param paths - The absolute paths to test.
		 * @returns One boolean per path.
		 */
		function whichExist(paths: readonly string[]): Promise<readonly boolean[]> {
			return Promise.all(paths.map((path) => pathExists(path)));
		}

		beforeEach(async () => {
			const stages: Record<string, RunManifest["stages"][StageId]> = {};
			for (const stageId of ALREADY_RUN_STAGES) {
				stages[stageId] = finishedEntry({
					status: "complete",
					filesWritten: [await seedStageOutput({ workspaceRoot, stageId })],
				});
			}
			await writeManifest({
				workspaceRoot,
				manifest: makeManifest({
					stages: { ...pendingStages(), ...stages } as RunManifest["stages"],
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
		 * Restarts the lecture from the nominated stage, leaving every other option
		 * at its default: this suite is about what `fromStage` resets, and says
		 * nothing about how a failure would be handled.
		 *
		 * @param fromStage - The stage to run again, along with everything after it.
		 * @returns The run summary.
		 */
		function runFromStage(fromStage: StageId): Promise<RunSummary> {
			return fromStageRunner().runLecture({
				workspaceRoot,
				options: { ...DEFAULT_RUN_OPTIONS, fromStage },
			});
		}

		it("should delete the nominated stage and downstream output when --from-stage is given", async () => {
			const summary = await runFromStage("transcription");

			await expect(access(stageDir("transcription"))).rejects.toThrow();
			await expect(access(stageDir("synthesis"))).rejects.toThrow();
			const runLog = await readRunLog(workspaceRoot, summary.runId);
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

		// qa-loop owns two directories, so what each --from-stage clears is asserted
		// as the survival of both.
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

		// `Final output/` belongs to the module, not to this lecture: every lecture's
		// finished PDF sits in it. A reset that cleared the directory would take all
		// of them, so it takes the one file carrying this lecture's date.
		describe("the module's shared Final output", () => {
			let finalOutput: string;

			beforeEach(async () => {
				finalOutput = moduleDirs({ moduleRoot }).finalOutput;
				await mkdir(finalOutput, { recursive: true });
				for (const lecture of [testLecture, otherLecture]) {
					await writeFile(join(finalOutput, lecture.outputFile), "pdf");
				}
			});

			// Every --from-stage at or before Stage 8 sweeps through it, so each is a
			// route to the same directory.
			it.each([
				"pdf-generation",
				"qa-loop",
				"synthesis",
			] as const satisfies readonly StageId[])("should take this lecture's PDF and leave the module's other lectures alone when --from-stage %s is given", async (fromStage) => {
				await runFromStage(fromStage);

				expect(await pathExists(join(finalOutput, testLecture.outputFile))).toBe(false);
				expect(await pathExists(join(finalOutput, otherLecture.outputFile))).toBe(true);
			});
		});
	});

	describe("scanning the configured modules", () => {
		let moduleA: string;
		let moduleB: string;
		let moduleC: string;

		/** A manifest recording the given lecture's identity, as a scan reads it back. */
		function manifestFor(lecture: TestLecture): RunManifest {
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
			const write = async (root: string, folder: string, manifest: RunManifest): Promise<void> => {
				await writeManifest({
					workspaceRoot: workspaceRootFor({ moduleRoot: root, folderName: folder }),
					manifest,
				});
			};
			// Three lectures, differing in the ways these tests turn on: the test
			// lecture, another in the same module on its own date, and a third in a
			// second module sharing the test lecture's date.
			await write(moduleA, LECTURE_FOLDER, manifestFor(testLecture));
			await write(moduleA, "L2", manifestFor(otherLecture));
			await write(moduleB, "L3", manifestFor(sameDateLecture));
			// Two things the scan has to walk past: a workspace folder holding no
			// manifest, and a module directory the pipeline has never processed, so
			// it has no `Pipeline processing/` at all.
			await mkdir(workspaceRootFor({ moduleRoot: moduleA, folderName: EMPTY_FOLDER }), {
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

		// One count covers both things a scan has to walk past: the folder holding no
		// manifest is not a lecture, and the module with no processing directory has
		// none. Three lectures stand across these modules; only they are counted.
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
			const workspaceIn = (folderName: string): string =>
				workspaceRootFor({ moduleRoot: moduleA, folderName });
			await writeManifest({
				workspaceRoot: workspaceIn(LECTURE_FOLDER),
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
				await writeManifest({
					workspaceRoot: workspaceRootFor({ moduleRoot: moduleB, folderName: folder }),
					manifest: makeManifest({ lectureDate }),
				});
			}
			const ran: string[] = [];
			const recordingStage = makeStubStage({
				stageId: "audio-extraction",
				run: ({ context }) => {
					ran.push(context.lectureDate);
					return Promise.resolve(PRODUCED_NOTHING);
				},
			});

			await makeRunner([recordingStage]).runBatch({ moduleRoots: [moduleB] });

			expect(ran).toEqual(["2025-09-01", "2025-11-20", "2025-12-05"]);
		});

		it("should run every lecture and skip the folder when one holds no manifest", async () => {
			await mkdir(workspaceRootFor({ moduleRoot: moduleA, folderName: EMPTY_FOLDER }), {
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
			await writeManifest({
				workspaceRoot,
				manifest: makeManifest({
					stages: stagesWith({
						stageId: "audio-extraction",
						entry: finishedEntry({
							completedAt: BEFORE_THIS_RUN,
							configUsed: { modelId: "openrouter/model-a" },
							cost: { promptTokens: 1, completionTokens: 1, callCount: 1, costUsd: 0.5 },
						}),
					}),
				}),
			});
			const runLog: RunLog = {
				runId: testRunId,
				startedAt: "2025-10-10T09:00:00Z",
				endedAt: "2025-10-10T09:00:01Z",
				triggeredBy: "manual",
				runType: "normal",
				fromStage: null,
				stages: {},
			};
			const runsDir = runsDirPath({ workspaceRoot });
			await mkdir(runsDir, { recursive: true });
			await writeFile(join(runsDir, `${runLog.runId}.json`), JSON.stringify(runLog));
			// A non-file entry in runs/, a corrupt run log, and a workspace without a
			// manifest — all skipped by the reader.
			await mkdir(join(runsDir, "nested"), { recursive: true });
			await writeFile(join(runsDir, "corrupt.json"), corruptJson);
			await mkdir(workspaceRootFor({ moduleRoot, folderName: EMPTY_FOLDER }), { recursive: true });
		});

		afterEach(() => {
			writeSpy.mockRestore();
		});

		function printed(): string {
			return writeSpy.mock.calls.map((call: readonly unknown[]) => String(call[0])).join("");
		}

		it("should print the current pipeline cost section when reporting all lectures", async () => {
			await makeRunner([]).costReport({ moduleRoots: [moduleRoot] });

			expect(writeSpy).toHaveBeenCalled();
			expect(printed()).toContain("Current pipeline cost");
		});

		it("should print a report when a lecture matches the requested date", async () => {
			await makeRunner([]).costReport({
				moduleRoots: [moduleRoot],
				options: { lectureDate: testLecture.date },
			});

			expect(printed()).toContain("Current pipeline cost");
		});

		// runs/ is scanned, not indexed, so anything that lands in it is offered to
		// the reader. Parsing is not the same as being a run log.
		it("should ignore a file in runs/ when it parses but is not a run log", async () => {
			await writeFile(
				join(runsDirPath({ workspaceRoot }), "debug.json"),
				JSON.stringify({ note: "not a run log" }),
			);

			await makeRunner([]).costReport({ moduleRoots: [moduleRoot] });

			expect(printed()).toContain("Current pipeline cost");
		});

		it("should print nothing when no lecture matches the requested date", async () => {
			await makeRunner([]).costReport({
				moduleRoots: [moduleRoot],
				options: { lectureDate: "2099-01-01" },
			});

			expect(writeSpy).not.toHaveBeenCalled();
		});
	});

	// A run's classification is read off the run log, which is where the cost
	// report picks it up (§7), so the classification is exercised the way the
	// report meets it rather than through the runner's internals.
	describe("classifying the run", () => {
		const TARGET_STAGE = "transcription" as const satisfies StageId;

		/**
		 * The mirror of {@link stagesWith}: the stage map of a manifest that has no
		 * record of one stage at all — every other stage pending, and that stage's
		 * key absent rather than present with a status.
		 *
		 * @param stageId - The stage to leave out of the map.
		 * @returns The stage map.
		 */
		function stagesWithout(stageId: StageId): RunManifest["stages"] {
			const stages = pendingStages();
			delete (stages as Record<string, ManifestStageEntry>)[stageId];
			return stages;
		}

		/**
		 * Runs a lecture whose target stage is in the given state, and reports how
		 * the run log classified the run.
		 *
		 * @param args - The lecture's starting state and how the run was invoked.
		 * @param args.entry - The target stage's manifest entry, or `null` to leave it out of the manifest entirely.
		 * @param args.fromStage - The `--from-stage` target, or `null` for a plain run.
		 * @returns The run type recorded in the run log.
		 */
		async function classificationOf({
			entry,
			fromStage,
		}: {
			readonly entry: ManifestStageEntry | null;
			readonly fromStage: StageId | null;
		}): Promise<RunType> {
			const stages =
				entry === null ? stagesWithout(TARGET_STAGE) : stagesWith({ stageId: TARGET_STAGE, entry });
			await writeManifest({ workspaceRoot, manifest: makeManifest({ stages }) });
			const summary = await makeRunner([makeStubStage({ stageId: "audio-extraction" })]).runLecture(
				{
					workspaceRoot,
					...(fromStage === null ? {} : { options: { ...DEFAULT_RUN_OPTIONS, fromStage } }),
				},
			);
			return (await readRunLog(workspaceRoot, summary.runId)).runType;
		}

		it("should classify the run as normal when no from-stage is given", async () => {
			expect(await classificationOf({ entry: null, fromStage: null })).toBe<RunType>("normal");
		});

		// Re-running a stage whose output already exists is an experiment; anything
		// else the target could be — failed, pending, or never recorded — is a
		// recovery from something that went wrong.
		it.each([
			{ state: "complete", entry: finishedEntry({ status: "complete" }), expected: "experiment" },
			{ state: "skipped", entry: finishedEntry({ status: "skipped" }), expected: "experiment" },
			{
				state: "failed",
				entry: {
					status: "failed",
					failedAt: stageCompletedAt,
					error: "transcription request failed",
					configUsed: null,
					cost: null,
					filesWritten: [],
				} satisfies ManifestStageEntry,
				expected: "error-recovery",
			},
			{
				state: "pending",
				entry: { status: "pending" } satisfies ManifestStageEntry,
				expected: "error-recovery",
			},
			{
				state: "running",
				entry: { status: "running" } satisfies ManifestStageEntry,
				expected: "error-recovery",
			},
			{ state: "absent from the manifest", entry: null, expected: "error-recovery" },
		])("should classify the run as $expected when from-stage targets a stage $state", async ({
			entry,
			expected,
		}) => {
			expect(await classificationOf({ entry, fromStage: TARGET_STAGE })).toBe<RunType>(
				expected as RunType,
			);
		});
	});

	describe("identity a stage settles", () => {
		beforeEach(async () => {
			await writeManifest({ workspaceRoot, manifest: makeManifest() });
		});

		/** A stage that settles the given identity and writes nothing itself. */
		function makeSettlingStage(
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

		it("should write the identity a stage settled when the stage completes", async () => {
			await makeRunner([makeSettlingStage(SETTLED_IDENTITY)]).runLecture({ workspaceRoot });

			expect(await readManifest({ workspaceRoot })).toMatchObject(SETTLED_IDENTITY);
		});

		it("should record the stage complete in the same write when a stage settles identity", async () => {
			await makeRunner([makeSettlingStage(SETTLED_IDENTITY)]).runLecture({ workspaceRoot });

			expect((await readManifest({ workspaceRoot })).stages["audio-extraction"]?.status).toBe(
				"complete",
			);
		});

		it("should leave the lecture's identity alone when a stage settles nothing", async () => {
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

		// Which stage does the renaming does not matter, so long as it runs before
		// the downstream one below. Both the pipeline and the assertions name this.
		const RENAMING_STAGE = "audio-extraction";

		/**
		 * A stage that does what Stage 3 does when it replaces a lecture's title:
		 * moves the workspace out from under the runner and reports the identity it
		 * settled, leaving the manifest write to the runner.
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
						identityChanges: SETTLED_IDENTITY,
					} as StageResult<unknown>;
				},
			});
		}

		/** Runs a pipeline that is nothing but the renaming stage. */
		function runRenamingWorkspace(): Promise<RunSummary> {
			return makeRunner([makeRenamingStage()]).runLecture({ workspaceRoot });
		}

		beforeEach(async () => {
			renamedWorkspaceRoot = workspaceRootFor({ moduleRoot, folderName: RENAMED_FOLDER });
			await writeManifest({ workspaceRoot, manifest: makeManifest() });
		});

		it("should record the completed stage in the manifest at its new path when a stage renames the workspace", async () => {
			await runRenamingWorkspace();

			const manifest = await readManifest({ workspaceRoot: renamedWorkspaceRoot });
			expect(manifest.stages[RENAMING_STAGE]?.status).toBe("complete");
		});

		// Both the title and the path are read off the rebuilt context, and both are
		// expected values only the enclosing beforeEach knows — hence the thunks.
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

			await expect(readRunLog(renamedWorkspaceRoot, summary.runId)).resolves.toMatchObject({
				runId: summary.runId,
			});
		});

		it("should report the workspace's new path in the summary when a stage renames it", async () => {
			const summary = await runRenamingWorkspace();

			expect(summary.workspaceRoot).toBe(renamedWorkspaceRoot);
		});
	});
});
