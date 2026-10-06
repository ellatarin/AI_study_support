import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import {
	changedDate,
	completedEntry,
	formatTestMoney,
	makeLectureTree,
	makeManifest,
	otherModuleName,
	sameDateLecture,
	testLecture,
	testModuleName,
	testTimePeriod,
	testTimestampId,
	testUserTitle,
	transcriptionModelId,
} from "../pipeline/fixtures.js";
import { stageOutputEntry, workspaceRootFor } from "../pipeline/layout.js";
import { baseNameForLecture } from "../pipeline/lecture-files.js";
import { readManifest, writeManifest } from "../pipeline/manifest.js";
import {
	type BatchSummary,
	DEFAULT_PIPELINE_RUN_OPTIONS,
	type LectureMatch,
	type OverallStatus,
	type PipelineRunSummary,
} from "../types/pipeline.js";
import {
	type CliDeps,
	executeCommand,
	type PipelineRunnerFacade,
	type RunnableCliCommand,
} from "./commands.js";

// The pounds figure below is worked out by hand at the fixtures' rate,
// `GBP_PER_USD` in `fixtures.ts`. That constant gives the reason for the rate.

// A stage with stages before it and after it, for the reset cases. Any such
// stage will do. The tests check only that the question names it.
const RESET_FROM = "synthesis";

// The message for a declined reset. It is written here and not imported, because
// the test checks the words that the user reads.
const NOTHING_WAS_RUN = "Nothing was run";

// The debug log path of this invocation. Any path will do. The tests check that
// the CLI gives the user the path that it got.
const DEBUG_LOG_PATH = join("/tmp", "project", "debug-logs", `${testTimestampId}-debug.log`);

// The config's batch.concurrency. It is not the example config's 1, because 1 is
// also the runner's default. With 1, the test would pass even for a batch that
// ignored the config.
const CONFIGURED_BATCH_CONCURRENCY = 4;

describe("executeCommand", () => {
	let tempDir: string;
	let moduleRoot: string;
	let workspaceRoot: string;
	let match: LectureMatch;
	let written: string[];
	let runner: {
		readonly normaliseSources: ReturnType<typeof vi.fn>;
		readonly runLecture: ReturnType<typeof vi.fn>;
		readonly runBatch: ReturnType<typeof vi.fn>;
		readonly costReport: ReturnType<typeof vi.fn>;
		readonly resolveLecturesByDate: ReturnType<typeof vi.fn>;
		readonly countLectures: ReturnType<typeof vi.fn>;
	};
	let selectMatches: Mock<
		(args: { readonly matches: readonly LectureMatch[] }) => Promise<readonly LectureMatch[]>
	>;
	let selectMatch: Mock<
		(args: { readonly matches: readonly LectureMatch[] }) => Promise<LectureMatch | null>
	>;
	let confirm: Mock<(args: { readonly message: string }) => Promise<boolean>>;

	function runSummaryFor({
		workspace,
		overallStatus = "success",
	}: {
		readonly workspace: string;
		readonly overallStatus?: OverallStatus;
	}): PipelineRunSummary {
		return {
			workspaceRoot: workspace,
			pipelineRunId: testTimestampId,
			...testTimePeriod,
			stageOutcomes: [
				{
					stageId: "transcription",
					entry: {
						action: "ran",
						status: "complete",
						configUsed: { modelId: transcriptionModelId },
						cost: { costUsd: 0.2, callCount: 1 },
					},
				},
			],
			overallStatus,
		};
	}

	/** Writes a manifest with one completed transcription, so a cost report has a row. */
	async function writeLectureManifest(workspace: string, baseName?: string): Promise<void> {
		await writeManifest({
			workspaceRoot: workspace,
			manifest: makeManifest({
				...(baseName === undefined ? {} : { baseName }),
				stages: {
					transcription: completedEntry({
						configUsed: { modelId: transcriptionModelId },
						cost: { promptTokens: 0, completionTokens: 0, callCount: 1, costUsd: 0.2 },
						filesWritten: [stageOutputEntry("transcription")],
					}),
				} as ReturnType<typeof makeManifest>["stages"],
			}),
		});
	}

	/** Makes a second workspace in the same module, for the cases where a date names several lectures. */
	async function makeLectureWorkspace(baseName: string): Promise<string> {
		const workspace = workspaceRootFor({ moduleRoot, baseName });
		await writeLectureManifest(workspace, baseName);
		return workspace;
	}

	/**
	 * Gives a second configured module. It is only a path in `moduleRoots`, with
	 * no folders in it, so a function gives it and no variable holds it.
	 *
	 * It is not named `otherModuleRoot`. `fixtures.ts` uses that name for a path
	 * outside the temporary folder that no suite writes to. One name for two paths
	 * could make a test check a folder that it never made.
	 */
	function secondModuleRoot(): string {
		return join(tempDir, otherModuleName);
	}

	function deps(): CliDeps {
		return {
			runner: runner as unknown as PipelineRunnerFacade,
			moduleRoots: [moduleRoot, secondModuleRoot()],
			batchConcurrency: CONFIGURED_BATCH_CONCURRENCY,
			formatMoney: formatTestMoney,
			selectMatches,
			selectMatch,
			confirm,
			debugLogPath: DEBUG_LOG_PATH,
			write: (text: string) => {
				written.push(text);
			},
		};
	}

	function printed(): string {
		return written.join("");
	}

	/** Gives the words of the last question that the user was asked. */
	function asked(): string {
		return confirm.mock.calls.at(-1)?.[0].message ?? "";
	}

	/**
	 * Adds the two tests of the reset question that `run` and `batch` share. After
	 * an approval, the command calls its runner method. After a decline, the
	 * command does not call that method, and it writes that nothing was run.
	 *
	 * @param args - The command under test.
	 * @param args.resetCommand - The command with `--from-stage`.
	 * @param args.runsThrough - Gives the runner method that the command calls when it continues.
	 */
	function itHonoursTheResetAnswer({
		resetCommand,
		runsThrough,
	}: {
		readonly resetCommand: RunnableCliCommand;
		readonly runsThrough: () => ReturnType<typeof vi.fn>;
	}): void {
		it("should do the work when the reset is approved", async () => {
			const code = await invoke(resetCommand);

			expect(code).toBe(0);
			expect(runsThrough()).toHaveBeenCalledTimes(1);
		});

		it("should run nothing at all when the reset is declined", async () => {
			confirm.mockResolvedValue(false);

			const code = await invoke(resetCommand);

			expect(code).toBe(0);
			expect(runsThrough()).not.toHaveBeenCalled();
			expect(printed()).toContain(NOTHING_WAS_RUN);
		});
	}

	/** Does a command with new dependencies, as the CLI does. */
	function invoke(command: RunnableCliCommand): Promise<number> {
		return executeCommand({ command, deps: deps() });
	}

	/** Makes the runner find no lecture for the date. */
	function noLectureCarriesTheDate(): void {
		runner.resolveLecturesByDate.mockResolvedValue([]);
	}

	/** Makes a second lecture with the same date as the first, for the cases where a date names several lectures. */
	async function makeSecondLecture(): Promise<LectureMatch> {
		return {
			moduleRoot,
			workspaceRoot: await makeLectureWorkspace(sameDateLecture.baseName),
			lectureNumber: sameDateLecture.number,
			lectureTitle: sameDateLecture.title,
		};
	}

	beforeEach(async () => {
		// The shared fixture makes the module folders, with the video recording and
		// slide deck that delete and change-date act on.
		({ tempDir, moduleRoot, workspaceRoot } = await makeLectureTree({ prefix: "commands-" }));
		await writeLectureManifest(workspaceRoot);
		match = {
			moduleRoot,
			workspaceRoot,
			lectureNumber: testLecture.number,
			lectureTitle: testLecture.title,
		};
		written = [];
		runner = {
			normaliseSources: vi.fn(async () => undefined),
			runLecture: vi.fn(async () => runSummaryFor({ workspace: workspaceRoot })),
			runBatch: vi.fn(),
			costReport: vi.fn(() => Promise.resolve([] as readonly string[])),
			resolveLecturesByDate: vi.fn(async () => [match]),
			countLectures: vi.fn(async () => 1),
		};
		selectMatches = vi.fn(async () => [match]);
		selectMatch = vi.fn(async () => match);
		confirm = vi.fn(async () => true);
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	describe("run", () => {
		const runCommand = {
			command: "run",
			lectureDate: testLecture.date,
			options: DEFAULT_PIPELINE_RUN_OPTIONS,
		} as const;

		it("should normalise every configured module before looking for the lecture when running", async () => {
			await invoke(runCommand);

			expect(runner.normaliseSources).toHaveBeenCalledWith({
				moduleRoots: [moduleRoot, secondModuleRoot()],
			});
		});

		it("should run the lecture without prompting when exactly one matches the date", async () => {
			const code = await invoke(runCommand);

			expect(code).toBe(0);
			expect(selectMatches).not.toHaveBeenCalled();
			expect(runner.runLecture).toHaveBeenCalledWith({
				workspaceRoot,
				options: DEFAULT_PIPELINE_RUN_OPTIONS,
			});
		});

		it("should print the pipeline run summary when a pipeline run finishes", async () => {
			await invoke(runCommand);

			expect(printed()).toContain("Run summary");
			expect(printed()).toContain("Transcription");
			// 0.2 USD at 0.74 = 0.148.
			expect(printed()).toContain("£0.148");
		});

		it("should pass the run options through when flags were given", async () => {
			// Any options other than the default will do. The test checks that the
			// runner gets the options that the command got.
			const flagged = { fromStage: "transcription", onStageFailure: "continue" } as const;

			await invoke({ ...runCommand, options: flagged });

			expect(runner.runLecture).toHaveBeenCalledWith({ workspaceRoot, options: flagged });
		});

		it("should report a failure when the run failed", async () => {
			runner.runLecture.mockResolvedValue(
				runSummaryFor({ workspace: workspaceRoot, overallStatus: "failed" }),
			);

			const code = await invoke(runCommand);

			expect(code).toBe(1);
		});

		it("should name each failed stage and its error when a stage failed", async () => {
			runner.runLecture.mockResolvedValue({
				...runSummaryFor({ workspace: workspaceRoot, overallStatus: "failed" }),
				stageOutcomes: [
					{
						stageId: "transcription",
						entry: {
							action: "ran",
							status: "failed",
							error: "ELEVENLABS_API_KEY is not set",
							configUsed: null,
							cost: { costUsd: null, callCount: 0 },
						},
					},
					{ stageId: "synthesis", entry: { action: "not-reached" } },
				],
			});

			await invoke(runCommand);

			expect(printed()).toContain("Transcription failed: ELEVENLABS_API_KEY is not set");
			// The test checks the full path, not only the folder name. The user cannot find the debug
			// log from the workspace paths in the output.
			expect(printed()).toContain(DEBUG_LOG_PATH);
		});

		it("should report that nothing matched when no lecture carries the date", async () => {
			noLectureCarriesTheDate();

			const code = await invoke(runCommand);

			expect(code).toBe(1);
			expect(printed()).toContain(testLecture.date);
			expect(printed()).toContain("the configured modules");
			expect(runner.runLecture).not.toHaveBeenCalled();
		});

		it("should offer to add the lecture's sources when no lecture carries the date", async () => {
			noLectureCarriesTheDate();

			await invoke(runCommand);

			expect(printed()).toContain("add its video and slides and run the pipeline again");
		});

		it("should ask which lectures to run when several share the date", async () => {
			const other = await makeSecondLecture();
			runner.resolveLecturesByDate.mockResolvedValue([match, other]);
			selectMatches.mockResolvedValue([match, other]);
			runner.runLecture.mockImplementation(async ({ workspaceRoot: workspace }) =>
				runSummaryFor({ workspace }),
			);

			await invoke(runCommand);

			expect(selectMatches).toHaveBeenCalledWith({ matches: [match, other] });
			expect(runner.runLecture).toHaveBeenCalledTimes(2);
		});

		it("should run nothing when the user cancels the choice", async () => {
			runner.resolveLecturesByDate.mockResolvedValue([match, match]);
			selectMatches.mockResolvedValue([]);

			const code = await invoke(runCommand);

			expect(code).toBe(0);
			expect(runner.runLecture).not.toHaveBeenCalled();
		});

		it("should ask nothing when the run deletes no earlier work", async () => {
			await invoke(runCommand);

			expect(confirm).not.toHaveBeenCalled();
		});

		describe("--from-stage", () => {
			const resetCommand = {
				...runCommand,
				options: { ...DEFAULT_PIPELINE_RUN_OPTIONS, fromStage: RESET_FROM },
			} as const;

			it("should name the stage and how many lectures lose work when asking", async () => {
				await invoke(resetCommand);

				expect(asked()).toContain(RESET_FROM);
				expect(asked()).toContain("1 lecture");
			});

			// The count is the number of lectures that the user chose, not the number
			// that the date names.
			it("should count every lecture chosen when the date matches several", async () => {
				const other = await makeSecondLecture();
				runner.resolveLecturesByDate.mockResolvedValue([match, other]);
				selectMatches.mockResolvedValue([match, other]);

				await invoke(resetCommand);

				expect(confirm).toHaveBeenCalledTimes(1);
				expect(asked()).toContain("2 lectures");
			});

			itHonoursTheResetAnswer({ resetCommand, runsThrough: () => runner.runLecture });
		});
	});

	describe("batch", () => {
		const batchCommand = {
			command: "batch",
			moduleRoot: null,
			options: DEFAULT_PIPELINE_RUN_OPTIONS,
			concurrency: null,
		} as const;

		/** The options that the runner gets from a batch with no flags beyond the one under test. */
		const configuredBatchOptions = {
			...DEFAULT_PIPELINE_RUN_OPTIONS,
			concurrency: CONFIGURED_BATCH_CONCURRENCY,
		};

		function batchSummary(overallStatus: OverallStatus): BatchSummary {
			return {
				...testTimePeriod,
				lectures: [runSummaryFor({ workspace: workspaceRoot })],
				overallStatus,
			};
		}

		beforeEach(() => {
			runner.runBatch.mockResolvedValue(batchSummary("success"));
		});

		it("should batch every configured module when none is named", async () => {
			const code = await invoke(batchCommand);

			expect(code).toBe(0);
			expect(runner.runBatch).toHaveBeenCalledWith({
				moduleRoots: [moduleRoot, secondModuleRoot()],
				options: configuredBatchOptions,
			});
		});

		it("should batch only the named module when one is given", async () => {
			await invoke({ ...batchCommand, moduleRoot });

			expect(runner.runBatch).toHaveBeenCalledWith({
				moduleRoots: [moduleRoot],
				options: configuredBatchOptions,
			});
		});

		it.each([
			{
				case: "--concurrency is not given",
				concurrency: null,
				expected: CONFIGURED_BATCH_CONCURRENCY,
			},
			{ case: "--concurrency overrides the config", concurrency: 2, expected: 2 },
		])("should run $expected lectures at once when $case", async ({ concurrency, expected }) => {
			await invoke({ ...batchCommand, concurrency });

			expect(runner.runBatch).toHaveBeenCalledWith(
				expect.objectContaining({ options: expect.objectContaining({ concurrency: expected }) }),
			);
		});

		it("should print each lecture's summary and the batch total when the batch ends", async () => {
			await invoke(batchCommand);

			expect(printed()).toContain("Run summary");
			expect(printed()).toContain("Batch summary");
			expect(printed()).toContain(testModuleName);
		});

		it("should report a failure when any lecture in the batch failed", async () => {
			runner.runBatch.mockResolvedValue(batchSummary("failed"));

			const code = await invoke(batchCommand);

			expect(code).toBe(1);
		});

		it("should ask nothing when the batch deletes no earlier work", async () => {
			await invoke(batchCommand);

			expect(confirm).not.toHaveBeenCalled();
		});

		describe("--from-stage", () => {
			const resetCommand = {
				...batchCommand,
				options: { ...DEFAULT_PIPELINE_RUN_OPTIONS, fromStage: RESET_FROM },
			} as const;

			beforeEach(() => {
				runner.countLectures.mockResolvedValue(12);
			});

			// The question must give the number, because the batch command line does
			// not show how many lectures the batch covers.
			it("should name the stage and how many lectures lose work when asking", async () => {
				await invoke(resetCommand);

				expect(asked()).toContain(RESET_FROM);
				expect(asked()).toContain("12 lectures");
			});

			// Normalisation goes first, so the count includes a lecture with a new source pair.
			it("should count the lectures the batch covers after normalising when asking", async () => {
				await invoke(resetCommand);

				expect(runner.normaliseSources).toHaveBeenCalledBefore(runner.countLectures);
				expect(runner.countLectures).toHaveBeenCalledWith({
					moduleRoots: [moduleRoot, secondModuleRoot()],
				});
			});

			itHonoursTheResetAnswer({ resetCommand, runsThrough: () => runner.runBatch });
		});
	});

	describe("cost-report", () => {
		/** The `cost-report` command, narrowed the way each case below narrows it. */
		function costReport(narrowing: {
			readonly lectureDate: string | null;
			readonly moduleRoot: string | null;
		}): RunnableCliCommand {
			return { command: "cost-report", ...narrowing };
		}

		it("should report across every configured module when nothing narrows it", async () => {
			const code = await invoke(costReport({ lectureDate: null, moduleRoot: null }));

			expect(code).toBe(0);
			expect(runner.costReport).toHaveBeenCalledWith({
				moduleRoots: [moduleRoot, secondModuleRoot()],
				options: {},
			});
		});

		// The runner returns the reports, and the CLI writes them to its output
		// stream. So the test reads them from that stream, and not from stdout.
		it("should write each report followed by a blank line when the runner returns them", async () => {
			runner.costReport.mockResolvedValue(["FIRST REPORT", "SECOND REPORT"]);

			await invoke(costReport({ lectureDate: null, moduleRoot: null }));

			expect(printed()).toBe("FIRST REPORT\n\nSECOND REPORT\n\n");
		});

		it("should report on one module only when --module narrows it", async () => {
			await invoke(costReport({ lectureDate: null, moduleRoot }));

			expect(runner.costReport).toHaveBeenCalledWith({ moduleRoots: [moduleRoot], options: {} });
		});

		// "Nothing spent" is an answer. With no output, the user could not tell it
		// from a command that did not look, or from a wrong --module.
		it("should say there is nothing to report and succeed when no lecture has run", async () => {
			runner.costReport.mockResolvedValue([]);

			const code = await invoke(costReport({ lectureDate: null, moduleRoot: null }));

			expect(code).toBe(0);
			expect(printed()).toContain("nothing to report");
		});

		it("should name the module it looked in when --module narrows an empty report", async () => {
			runner.costReport.mockResolvedValue([]);

			await invoke(costReport({ lectureDate: null, moduleRoot }));

			expect(printed()).toContain(testModuleName);
		});

		it("should narrow to the chosen lectures when the date matches several modules", async () => {
			const other: LectureMatch = {
				moduleRoot: secondModuleRoot(),
				workspaceRoot: workspaceRootFor({
					moduleRoot: secondModuleRoot(),
					baseName: sameDateLecture.baseName,
				}),
				lectureNumber: sameDateLecture.number,
				lectureTitle: sameDateLecture.title,
			};
			runner.resolveLecturesByDate.mockResolvedValue([match, other]);
			selectMatches.mockResolvedValue([other]);

			await invoke(costReport({ lectureDate: testLecture.date, moduleRoot: null }));

			expect(runner.costReport).toHaveBeenCalledWith({
				moduleRoots: [other.moduleRoot],
				options: { lectureDate: testLecture.date },
			});
		});

		it("should report that nothing matched when no lecture carries the date", async () => {
			noLectureCarriesTheDate();

			const code = await invoke(costReport({ lectureDate: testLecture.date, moduleRoot: null }));

			expect(code).toBe(1);
			expect(runner.costReport).not.toHaveBeenCalled();
		});

		it("should name only the module it searched when --module narrowed it and nothing matched", async () => {
			noLectureCarriesTheDate();

			await invoke(costReport({ lectureDate: testLecture.date, moduleRoot }));

			expect(runner.resolveLecturesByDate).toHaveBeenCalledWith({
				moduleRoots: [moduleRoot],
				lectureDate: testLecture.date,
			});
			expect(printed()).toContain(testModuleName);
			expect(printed()).not.toContain("the configured modules");
		});

		it("should not offer to run the pipeline again when no lecture carries the date", async () => {
			noLectureCarriesTheDate();

			await invoke(costReport({ lectureDate: testLecture.date, moduleRoot: null }));

			expect(printed()).toContain("the configured modules");
			expect(printed()).not.toContain("run the pipeline again");
		});

		it("should report on nothing when the user cancels the choice", async () => {
			runner.resolveLecturesByDate.mockResolvedValue([match, match]);
			selectMatches.mockResolvedValue([]);

			const code = await invoke(costReport({ lectureDate: testLecture.date, moduleRoot: null }));

			expect(code).toBe(0);
			expect(runner.costReport).not.toHaveBeenCalled();
		});
	});

	describe("rename", () => {
		const renameCommand = {
			command: "rename",
			lectureDate: testLecture.date,
			title: testUserTitle,
		} as const;

		it("should record the new title when renaming", async () => {
			const code = await invoke(renameCommand);

			expect(code).toBe(0);
			expect((await readManifest({ workspaceRoot })).userTitle).toBe(testUserTitle);
		});

		it("should renormalise the lecture's module when renaming", async () => {
			await invoke(renameCommand);

			expect(runner.normaliseSources).toHaveBeenCalledWith({ moduleRoots: [moduleRoot] });
		});

		it("should report that nothing matched when no lecture carries the date", async () => {
			noLectureCarriesTheDate();

			const code = await invoke(renameCommand);

			expect(code).toBe(1);
			expect(runner.normaliseSources).not.toHaveBeenCalled();
		});

		it("should rename nothing when the user cancels the choice", async () => {
			runner.resolveLecturesByDate.mockResolvedValue([match, match]);
			selectMatch.mockResolvedValue(null);

			const code = await invoke(renameCommand);

			expect(code).toBe(0);
			expect((await readManifest({ workspaceRoot })).userTitle).toBeNull();
			expect(runner.normaliseSources).not.toHaveBeenCalled();
		});

		it("should rename only the lecture chosen when several share the date", async () => {
			const other = await makeSecondLecture();
			runner.resolveLecturesByDate.mockResolvedValue([match, other]);
			selectMatch.mockResolvedValue(other);

			await invoke(renameCommand);

			expect((await readManifest({ workspaceRoot: other.workspaceRoot })).userTitle).toBe(
				testUserTitle,
			);
			expect((await readManifest({ workspaceRoot })).userTitle).toBeNull();
		});
	});

	describe("delete", () => {
		const deleteCommand = { command: "delete", lectureDate: testLecture.date } as const;

		it("should ask before deleting when a lecture is to be removed", async () => {
			await invoke(deleteCommand);

			expect(confirm).toHaveBeenCalledTimes(1);
			expect(asked()).toContain(testLecture.title);
		});

		it("should remove the lecture and renormalise when the deletion is approved", async () => {
			const code = await invoke(deleteCommand);

			expect(code).toBe(0);
			await expect(readManifest({ workspaceRoot })).rejects.toThrow();
			expect(runner.normaliseSources).toHaveBeenCalledWith({ moduleRoots: [moduleRoot] });
		});

		it("should leave the lecture in place when the deletion is declined", async () => {
			confirm.mockResolvedValue(false);

			const code = await invoke(deleteCommand);

			expect(code).toBe(0);
			await expect(readManifest({ workspaceRoot })).resolves.toBeTruthy();
			expect(runner.normaliseSources).not.toHaveBeenCalled();
		});
	});

	describe("change-date", () => {
		const changeCommand = {
			command: "change-date",
			lectureDate: testLecture.date,
			newLectureDate: changedDate,
		} as const;

		it("should move the lecture to the new date when changing it", async () => {
			const code = await invoke(changeCommand);

			expect(code).toBe(0);
			// The pipeline's own function gives the base name at the new date.
			const movedBaseName = baseNameForLecture({
				lectureNumber: testLecture.number,
				title: testLecture.title,
				lectureDate: changedDate,
			});
			const moved = workspaceRootFor({ moduleRoot, baseName: movedBaseName });
			expect((await readManifest({ workspaceRoot: moved })).lectureDate).toBe(changedDate);
		});

		it("should renormalise the lecture's module when changing the date", async () => {
			await invoke(changeCommand);

			expect(runner.normaliseSources).toHaveBeenCalledWith({ moduleRoots: [moduleRoot] });
		});
	});

	describe("identity changes on a date several lectures share", () => {
		it.each([
			{
				command: { command: "rename", lectureDate: testLecture.date, title: "New Title" } as const,
			},
			{ command: { command: "delete", lectureDate: testLecture.date } as const },
			{
				command: {
					command: "change-date",
					lectureDate: testLecture.date,
					newLectureDate: changedDate,
				} as const,
			},
		])("should ask for one lecture only when $command.command is given the date", async ({
			command,
		}) => {
			const other = await makeSecondLecture();
			runner.resolveLecturesByDate.mockResolvedValue([match, other]);
			selectMatch.mockResolvedValue(match);

			await invoke(command);

			// Each identity change acts on one lecture only (FR-6.7). So the user
			// chooses one of the lectures with the date.
			expect(selectMatches).not.toHaveBeenCalled();
			expect(selectMatch).toHaveBeenCalledWith({ matches: [match, other] });
			expect(runner.normaliseSources).toHaveBeenCalledWith({ moduleRoots: [moduleRoot] });
		});
	});
});
