import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import {
	changedDate,
	finishedEntry,
	makeLectureTree,
	makeManifest,
	otherModuleName,
	sameDateLecture,
	testLecture,
	testModuleName,
	testRunId,
	testRunSpan,
	transcriptionModelId,
	userChosenTitle,
} from "../pipeline/fixtures.js";
import { stageOutputEntry, workspaceRootFor } from "../pipeline/layout.js";
import { baseNameForLecture } from "../pipeline/lecture-files.js";
import { readManifest, writeManifest } from "../pipeline/manifest.js";
import {
	type BatchSummary,
	DEFAULT_BATCH_OPTIONS,
	DEFAULT_RUN_OPTIONS,
	type LectureMatch,
	type OverallStatus,
	type RunSummary,
} from "../types/pipeline.js";
import {
	type CliDeps,
	executeCommand,
	type PipelineRunnerFacade,
	type RunnableCliCommand,
} from "./commands.js";

// A rate this suite fixes for itself, deliberately NOT `currency.gbpPerUsd`: the
// pounds figure asserted below was worked out by hand at this rate, so taking it
// from config would fail the assertion on an unrelated config edit and blame the
// formatter. Same reasoning as cost.test.ts.
const GBP_PER_USD = 0.74;

// A stage with work both before and after it, so a reset from here is worth
// warning about. Which stage it is does not matter — only that it is named back.
const RESET_FROM = "synthesis";

// What the user is told when they turn a reset down. Written out rather than
// imported: the point is that this wording reaches them, and taking it from the
// code that prints it would assert nothing.
const NOTHING_WAS_RUN = "Nothing was run";

// Where this invocation put its debug log. Any path will do — what is under test
// is that the CLI tells the user the one it was given.
const DEBUG_LOG_PATH = join("/tmp", "project", "runs", `${testRunId}-debug.log`);

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
	}): RunSummary {
		return {
			workspaceRoot: workspace,
			runId: testRunId,
			...testRunSpan,
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

	/** Records one finished transcription, so a cost report has something to show. */
	async function writeLectureManifest(workspace: string, folder?: string): Promise<void> {
		await writeManifest({
			workspaceRoot: workspace,
			manifest: makeManifest({
				...(folder === undefined ? {} : { workspaceFolderName: folder }),
				stages: {
					transcription: finishedEntry({
						configUsed: { modelId: transcriptionModelId },
						cost: { promptTokens: 0, completionTokens: 0, callCount: 1, costUsd: 0.2 },
						filesWritten: [stageOutputEntry("transcription")],
					}),
				} as ReturnType<typeof makeManifest>["stages"],
			}),
		});
	}

	/** A second workspace in the same module, for the multi-match cases. */
	async function makeLectureWorkspace(folder: string): Promise<string> {
		const workspace = workspaceRootFor({ moduleRoot, folderName: folder });
		await writeLectureManifest(workspace, folder);
		return workspace;
	}

	/**
	 * A second configured module. Only ever a path in `moduleRoots` — nothing is
	 * laid out under it — so it is derived rather than stored.
	 *
	 * Not `otherModuleRoot`: `fixtures.ts` exports that name for a synthetic path
	 * no suite writes to, and this one lives under the temporary tree. Two
	 * different values under one name is how a test comes to assert against a
	 * directory it never made.
	 */
	function secondModuleRoot(): string {
		return join(tempDir, otherModuleName);
	}

	function deps(): CliDeps {
		return {
			runner: runner as unknown as PipelineRunnerFacade,
			moduleRoots: [moduleRoot, secondModuleRoot()],
			gbpPerUsd: GBP_PER_USD,
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

	/** The wording of the last question the user was asked. */
	function asked(): string {
		return confirm.mock.calls.at(-1)?.[0].message ?? "";
	}

	/**
	 * The answer to the reset question settles the same two things whichever
	 * route asked it — approving does the work, declining does none of it and
	 * says so — so the rule is stated here and applied to the runner call each
	 * route makes.
	 *
	 * @param args - The route under test.
	 * @param args.resetCommand - The command carrying the `--from-stage` option.
	 * @param args.runsThrough - The runner call that route makes when it goes ahead.
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

	/** Carries a command out against freshly built dependencies, as the CLI does. */
	function invoke(command: RunnableCliCommand): Promise<number> {
		return executeCommand({ command, deps: deps() });
	}

	/** Puts the runner in the state every unmatched-date case shares: the date names nothing. */
	function noLectureCarriesTheDate(): void {
		runner.resolveLecturesByDate.mockResolvedValue([]);
	}

	/** A second lecture sharing the first one's date, for the multi-match cases. */
	async function makeSecondLecture(): Promise<LectureMatch> {
		return {
			moduleRoot,
			workspaceRoot: await makeLectureWorkspace(sameDateLecture.folderName),
			lectureNumber: sameDateLecture.number,
			lectureTitle: sameDateLecture.title,
		};
	}

	beforeEach(async () => {
		// The whole module tree, including the source video and slide the delete
		// and change-date commands move, comes from the shared fixture.
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
			costReport: vi.fn(async () => undefined),
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
			options: DEFAULT_RUN_OPTIONS,
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
				options: DEFAULT_RUN_OPTIONS,
			});
		});

		it("should print the end-of-run summary when a lecture has run", async () => {
			await invoke(runCommand);

			expect(printed()).toContain("Run summary");
			expect(printed()).toContain("Transcription");
			// 0.2 USD at 0.74 = 0.148.
			expect(printed()).toContain("£0.148");
		});

		it("should pass the run options through when flags were given", async () => {
			// Any options that are not the default will do: what is under test is that
			// the dispatcher hands the runner what it was given, whatever that is.
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
			// The path itself, not the bare directory name: the log does not sit
			// anywhere the user can guess from the workspace paths printed above it.
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
				options: { ...DEFAULT_RUN_OPTIONS, fromStage: RESET_FROM },
			} as const;

			it("should name the stage and how many lectures lose work when asking", async () => {
				await invoke(resetCommand);

				expect(asked()).toContain(RESET_FROM);
				expect(asked()).toContain("1 lecture");
			});

			// The count is what the user is being asked about, so it has to follow the
			// choice they just made rather than the matches the date turned up.
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
			options: DEFAULT_BATCH_OPTIONS,
		} as const;

		function batchSummary(overallStatus: OverallStatus): BatchSummary {
			return {
				...testRunSpan,
				lectures: [runSummaryFor({ workspace: workspaceRoot })],
				overallStatus,
			};
		}

		beforeEach(() => {
			runner.runBatch.mockResolvedValue(batchSummary("success"));
		});

		it("should batch every configured module when none is named", async () => {
			const parallel = { ...DEFAULT_BATCH_OPTIONS, concurrency: 2 };

			const code = await invoke({ ...batchCommand, options: parallel });

			expect(code).toBe(0);
			expect(runner.runBatch).toHaveBeenCalledWith({
				moduleRoots: [moduleRoot, secondModuleRoot()],
				options: parallel,
			});
		});

		it("should batch only the named module when one is given", async () => {
			await invoke({ ...batchCommand, moduleRoot });

			expect(runner.runBatch).toHaveBeenCalledWith({
				moduleRoots: [moduleRoot],
				options: DEFAULT_BATCH_OPTIONS,
			});
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
				options: { ...DEFAULT_BATCH_OPTIONS, fromStage: RESET_FROM },
			} as const;

			beforeEach(() => {
				runner.countLectures.mockResolvedValue(12);
			});

			// The number is the whole point of asking: nothing the user typed says how
			// many lectures a batch covers.
			it("should name the stage and how many lectures lose work when asking", async () => {
				await invoke(resetCommand);

				expect(asked()).toContain(RESET_FROM);
				expect(asked()).toContain("12 lectures");
			});

			// Sources are normalised first, so a lecture whose video and slides were
			// only just added is one of the lectures counted.
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

		it("should report on one module only when --module narrows it", async () => {
			await invoke(costReport({ lectureDate: null, moduleRoot }));

			expect(runner.costReport).toHaveBeenCalledWith({ moduleRoots: [moduleRoot], options: {} });
		});

		it("should narrow to the chosen lectures when the date matches several modules", async () => {
			const other: LectureMatch = {
				moduleRoot: secondModuleRoot(),
				workspaceRoot: workspaceRootFor({
					moduleRoot: secondModuleRoot(),
					folderName: sameDateLecture.folderName,
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
			title: userChosenTitle,
		} as const;

		it("should record the new title when renaming", async () => {
			const code = await invoke(renameCommand);

			expect(code).toBe(0);
			expect((await readManifest({ workspaceRoot })).userTitle).toBe(userChosenTitle);
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
				userChosenTitle,
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
			// The same lecture, renamed for its new date by the pipeline's own rule.
			const movedFolder = baseNameForLecture({
				lectureNumber: testLecture.number,
				title: testLecture.title,
				lectureDate: changedDate,
			});
			const moved = workspaceRootFor({ moduleRoot, folderName: movedFolder });
			expect((await readManifest({ workspaceRoot: moved })).lectureDate).toBe(changedDate);
		});

		it("should renormalise the lecture's module when changing the date", async () => {
			await invoke(changeCommand);

			expect(runner.normaliseSources).toHaveBeenCalledWith({ moduleRoots: [moduleRoot] });
		});
	});

	describe("identity mutations on a date several lectures share", () => {
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

			// Each of these names a single lecture (FR-6.7), so a shared date is a
			// question to settle rather than licence to act on both.
			expect(selectMatches).not.toHaveBeenCalled();
			expect(selectMatch).toHaveBeenCalledWith({ matches: [match, other] });
			expect(runner.normaliseSources).toHaveBeenCalledWith({ moduleRoots: [moduleRoot] });
		});
	});
});
