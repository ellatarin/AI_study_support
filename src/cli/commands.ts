/**
 * This module does the work of a parsed {@link CliCommand}. It finds the
 * lectures that a lecture date names, and asks the user which lecture to act on.
 * It asks the user to approve a reset or a deletion. It calls the runner and
 * writes the result.
 *
 * The module gets the runner, the prompts and the output stream as {@link CliDeps}. So a
 * test can check a command without a pipeline or a terminal (technical-design.md
 * §4.7, "CLI Structure").
 */

import { moduleName } from "../pipeline/layout.js";
import { readManifest } from "../pipeline/manifest.js";
import {
	formatBatchSummary,
	formatRunSummary,
	type MoneyFormatter,
	stageLabel,
} from "../pipeline/reports.js";
import type { PipelineRunner } from "../pipeline/runner.js";
import type { ConfirmPrompt } from "../pipeline/stages/source-normalisation/orphaned-workspaces.js";
import type {
	LectureMatch,
	PipelineRunOptions,
	PipelineRunSummary,
	ReportOptions,
	StageId,
} from "../types/pipeline.js";
import { pluralise } from "../utils/text.js";
import type { CliCommand } from "./args.js";
import { changeLectureDate, deleteLecture, renameLecture } from "./lecture-identity.js";

/** The names of the runner methods that the commands call. */
type RunnerOperation =
	| "normaliseSources"
	| "runLecture"
	| "runBatch"
	| "costReport"
	| "resolveLecturesByDate"
	| "countLectures";

/**
 * The runner methods that the commands call. A test can give a stub of this type
 * in place of a real {@link PipelineRunner} and its stages.
 *
 * It is a mapped type and not a `Pick`. `Pick` keeps the class's methods, and a
 * type with methods is not deeply readonly. Then the lint rule
 * `prefer-readonly-parameter-types` reports every function that takes
 * {@link CliDeps}. A mapped type gives readonly properties that hold the same
 * functions.
 */
export type PipelineRunnerFacade = {
	readonly [TOperation in RunnerOperation]: PipelineRunner[TOperation];
};

/**
 * The input of a picker: the lectures that one lecture date names.
 *
 * It is declared here, not in `prompts.ts`. The module that asks a question
 * declares the type of that question. The terminal module, `prompts.ts`,
 * implements that type. `ConfirmPrompt`
 * follows the same rule.
 */
export type MatchQuery = { readonly matches: readonly LectureMatch[] };

/**
 * Asks the user which of several lectures to act on. It returns the chosen
 * lectures, or an empty list when the user cancels.
 */
export type LecturePicker = (args: MatchQuery) => Promise<readonly LectureMatch[]>;

/** Asks the user which one of several lectures to act on. It returns `null` when the user cancels. */
export type SingleLecturePicker = (args: MatchQuery) => Promise<LectureMatch | null>;

/** Writes text that the user reads. The text has its own line ends. */
export type WriteText = (text: string) => void;

/** Everything that a command uses from outside this module. */
export type CliDeps = {
	readonly runner: PipelineRunnerFacade;
	/** Every module in the configuration. A command that names no module uses all of them. */
	readonly moduleRoots: readonly string[];
	/** The config's `batch.concurrency`. A batch uses it when `--concurrency` is not given. */
	readonly batchConcurrency: number;
	/** Shows a stored dollar figure. The CLI makes one formatter, so all the CLI's output shows money the same way. */
	readonly formatMoney: MoneyFormatter;
	/** The picker for `run` and `cost-report`, which can act on several lectures. */
	readonly selectMatches: LecturePicker;
	/** The picker for an identity change, which acts on one lecture only. */
	readonly selectMatch: SingleLecturePicker;
	/** Asks the user to approve an action that cannot be undone. */
	readonly confirm: ConfirmPrompt;
	/** The path of this invocation's debug log. A failure message gives it to the user. */
	readonly debugLogPath: string;
	/** Writes the output that the user reads. */
	readonly write: WriteText;
};

/** The exit code for a command that did all that the user asked. */
export const EXIT_SUCCESS = 0;
/** The exit code for a command that could not do what the user asked. */
export const EXIT_FAILURE = 1;

type CommandArgs<TCommand> = { readonly command: TCommand; readonly deps: CliDeps };

/** The input of {@link printRunSummary} and {@link reportFailures}. */
type LectureReport = { readonly deps: CliDeps; readonly summary: PipelineRunSummary };

/**
 * The lectures that an action gets. There is always at least one, because a
 * lecture date that names no lecture stops before the action.
 */
type ChosenLectures = readonly [LectureMatch, ...LectureMatch[]];

/**
 * Makes the picker for the identity changes. It gives one lecture, or none when
 * the user cancels. Each identity change acts on one lecture only (FR-6.7,
 * technical-design.md §4.7, "An identity change acts on exactly one lecture").
 *
 * @param deps - The command dependencies.
 * @returns A picker that gives at most one lecture.
 */
function chooseOneLecture(deps: CliDeps): LecturePicker {
	return async ({ matches }) => {
		const chosen = await deps.selectMatch({ matches });
		return chosen === null ? [] : [chosen];
	};
}

/**
 * Finds the lectures that a lecture date names, and runs an action on them.
 * Every command that takes a lecture date starts here.
 *
 * When several lectures have the date, the picker asks the user which. A date
 * that names no lecture is a failure. A cancelled choice is a success. Neither
 * reaches the action (technical-design.md §4.7, "Exit codes").
 *
 * @param args - The search and the action.
 * @param args.deps - The command dependencies.
 * @param args.lectureDate - The lecture date from the command line.
 * @param args.act - The action on the chosen lectures.
 * @param args.choose - The picker for a date that names several lectures.
 * @param args.moduleRoot - The one module to search, or `null` for every configured module.
 * @param args.alsoTry - The second remedy that the message gives when no lecture has the date.
 * @returns The action's exit code, or the exit code for no match or a cancelled choice.
 */
async function withResolvedLectures({
	deps,
	lectureDate,
	act,
	choose,
	moduleRoot,
	alsoTry,
}: {
	readonly deps: CliDeps;
	readonly lectureDate: string;
	readonly act: (matches: ChosenLectures) => Promise<number>;
	readonly choose: LecturePicker;
	readonly moduleRoot: string | null;
	readonly alsoTry: string;
}): Promise<number> {
	const matches = await deps.runner.resolveLecturesByDate({
		moduleRoots: scopedModuleRoots({ moduleRoot, deps }),
		lectureDate,
	});
	if (matches.length === 0) {
		deps.write(
			`No lecture is dated ${lectureDate} ${searchScope({ moduleRoot })}. Check the date${alsoTry}.\n`,
		);
		return EXIT_FAILURE;
	}
	const chosen = matches.length === 1 ? matches : await choose({ matches });
	// The code uses a destructure, and not a length test, because only the
	// destructure narrows the type. `[first, ...rest]` is a non-empty tuple, so an action can take the
	// first lecture without a second check.
	const [first, ...rest] = chosen;
	if (first === undefined) {
		return EXIT_SUCCESS;
	}
	return act([first, ...rest]);
}

/**
 * Gives the modules that a command acts on: the one that it named, or every
 * configured module.
 *
 * @param args - The module and the dependencies.
 * @param args.moduleRoot - The module that the command named, or `null` for every module.
 * @param args.deps - The command dependencies.
 * @returns The modules.
 */
function scopedModuleRoots({
	moduleRoot,
	deps,
}: {
	readonly moduleRoot: string | null;
	readonly deps: CliDeps;
}): readonly string[] {
	return moduleRoot === null ? deps.moduleRoots : [moduleRoot];
}

/**
 * Names the modules that a search looked in, for a message that says nothing was
 * found. With `--module`, the message names that one module and not the whole
 * configuration.
 *
 * @param args - The module.
 * @param args.moduleRoot - The module that the command named, or `null` for every module.
 * @returns The words that name the modules.
 */
function searchScope({ moduleRoot }: { readonly moduleRoot: string | null }): string {
	return moduleRoot === null ? "in the configured modules" : `in ${moduleName({ moduleRoot })}`;
}

/**
 * The search settings of every command except `cost-report`. These commands take
 * no `--module`, so they search every configured module. When no lecture has the
 * date, the message tells the user to add the video and slides of the lecture on
 * that date. The next pipeline run
 * then makes the lecture.
 */
const ACROSS_EVERY_MODULE = {
	moduleRoot: null,
	alsoTry: ", or add its video and slides and run the pipeline again",
} as const;

/**
 * The empty second remedy of `cost-report`. A pipeline run would spend money,
 * and it would not find the spending that the report did not find.
 */
const NO_SECOND_REMEDY = "";

/**
 * Writes the run summary of one pipeline run, then its failures. Each stage's
 * model, tokens and cost come from the manifest (technical-design.md §7, "End-of-Run Summary").
 *
 * @param args - The dependencies and the pipeline run.
 * @param args.deps - The command dependencies.
 * @param args.summary - The pipeline run summary from the runner.
 * @returns A promise that resolves when the output is written.
 */
async function printRunSummary({ deps, summary }: LectureReport): Promise<void> {
	const manifest = await readManifest({ workspaceRoot: summary.workspaceRoot });
	deps.write(
		`${formatRunSummary({
			outcomes: summary.stageOutcomes,
			manifest,
			formatMoney: deps.formatMoney,
		})}\n\n`,
	);
	reportFailures({ deps, summary });
}

/**
 * Writes each failed stage with its error message, then the path of the debug
 * log, which holds the stack (technical-design.md §8, "Stage Failure Protocol").
 *
 * @param args - The dependencies and the pipeline run.
 * @param args.deps - The command dependencies.
 * @param args.summary - The pipeline run summary from the runner.
 * @returns Nothing.
 */
function reportFailures({ deps, summary }: LectureReport): void {
	const failures = summary.stageOutcomes.flatMap(({ stageId, entry }) =>
		entry.action === "ran" && entry.status === "failed" ? [{ stageId, error: entry.error }] : [],
	);
	if (failures.length === 0) {
		return;
	}
	for (const { stageId, error } of failures) {
		deps.write(`${stageLabel({ stageId })} failed: ${error}\n`);
	}
	deps.write(`The full stack for each is in ${deps.debugLogPath}.\n\n`);
}

/**
 * Runs the chosen lectures one after another, and writes the run summary of
 * each. With `--from-stage`, it first asks the user to approve the reset.
 *
 * @param args - The lectures and the options.
 * @param args.deps - The command dependencies.
 * @param args.matches - The lectures to run.
 * @param args.options - The pipeline run options from the command line.
 * @returns The failure exit code when a pipeline run failed, otherwise the success exit code.
 */
async function runLectures({
	deps,
	matches,
	options,
}: {
	readonly deps: CliDeps;
	readonly matches: readonly LectureMatch[];
	readonly options: PipelineRunOptions;
}): Promise<number> {
	const proceed = await confirmReset({
		deps,
		fromStage: options.fromStage,
		countLectures: () => Promise.resolve(matches.length),
	});
	if (!proceed) {
		return EXIT_SUCCESS;
	}
	let failed = false;
	for (const lectureMatch of matches) {
		const summary = await deps.runner.runLecture({
			workspaceRoot: lectureMatch.workspaceRoot,
			options,
		});
		await printRunSummary({ deps, summary });
		failed = failed || summary.overallStatus === "failed";
	}
	return failed ? EXIT_FAILURE : EXIT_SUCCESS;
}

/**
 * Does the `run` command. Normalisation goes first, so a lecture with a new
 * source pair has a workspace to run (technical-design.md §4.7, "`run <date>`
 * normalises first").
 *
 * @param args - The command and the dependencies.
 * @param args.command - The `run` command.
 * @param args.deps - The command dependencies.
 * @returns The exit code.
 */
async function runCommand({
	command,
	deps,
}: CommandArgs<Extract<CliCommand, { command: "run" }>>): Promise<number> {
	await deps.runner.normaliseSources({ moduleRoots: deps.moduleRoots });
	return withResolvedLectures({
		deps,
		lectureDate: command.lectureDate,
		...ACROSS_EVERY_MODULE,
		choose: deps.selectMatches,
		act: (matches) => runLectures({ deps, matches, options: command.options }),
	});
}

/**
 * Does the `batch` command: runs every lecture in one module, or in every
 * configured module.
 *
 * @param args - The command and the dependencies.
 * @param args.command - The `batch` command.
 * @param args.deps - The command dependencies.
 * @returns The exit code.
 */
async function batchCommand({
	command,
	deps,
}: CommandArgs<Extract<CliCommand, { command: "batch" }>>): Promise<number> {
	const moduleRoots = scopedModuleRoots({ moduleRoot: command.moduleRoot, deps });
	const proceed = await confirmReset({
		deps,
		fromStage: command.options.fromStage,
		// Normalisation goes first, so the count includes a lecture with a new source
		// pair (technical-design.md §4.7, "Counting a batch's scope").
		countLectures: async () => {
			await deps.runner.normaliseSources({ moduleRoots });
			return deps.runner.countLectures({ moduleRoots });
		},
	});
	if (!proceed) {
		return EXIT_SUCCESS;
	}
	const batch = await deps.runner.runBatch({
		moduleRoots,
		options: { ...command.options, concurrency: command.concurrency ?? deps.batchConcurrency },
	});
	for (const summary of batch.lectures) {
		await printRunSummary({ deps, summary });
	}
	deps.write(`${formatBatchSummary({ batch })}\n`);
	return batch.overallStatus === "failed" ? EXIT_FAILURE : EXIT_SUCCESS;
}

/**
 * Gets the cost reports from the runner and writes them, one for each lecture.
 * Both forms of `cost-report`, with and without a lecture date, end here.
 *
 * When there is no lecture to report on, it writes a message that says so
 * (technical-design.md §7, "Cost Report Command").
 *
 * @param args - The modules, the options and the dependencies.
 * @param args.deps - The command dependencies.
 * @param args.moduleRoots - The modules to report on.
 * @param args.options - The report options, such as the lecture date.
 * @param args.moduleRoot - The module that the command named, or `null` for every module.
 * @returns A promise that resolves when the output is written.
 */
async function reportCosts({
	deps,
	moduleRoots,
	options,
	moduleRoot,
}: {
	readonly deps: CliDeps;
	readonly moduleRoots: readonly string[];
	readonly options: ReportOptions;
	readonly moduleRoot: string | null;
}): Promise<void> {
	const reports = await deps.runner.costReport({ moduleRoots, options });
	if (reports.length === 0) {
		deps.write(
			`No lecture has run ${searchScope({ moduleRoot })}, so there is nothing to report.\n`,
		);
		return;
	}
	for (const report of reports) {
		deps.write(`${report}\n`);
	}
}

/**
 * Does the `cost-report` command, for one module or one lecture date when the
 * command names one. When several lectures have the date, the user chooses with
 * the same picker as `run`. The report then covers only the chosen lectures
 * (technical-design.md §7, "Cost Report Command").
 *
 * @param args - The command and the dependencies.
 * @param args.command - The `cost-report` command.
 * @param args.deps - The command dependencies.
 * @returns The exit code.
 */
async function costReportCommand({
	command,
	deps,
}: CommandArgs<Extract<CliCommand, { command: "cost-report" }>>): Promise<number> {
	const { lectureDate, moduleRoot } = command;
	if (lectureDate === null) {
		await reportCosts({
			deps,
			moduleRoot,
			moduleRoots: scopedModuleRoots({ moduleRoot, deps }),
			options: {},
		});
		return EXIT_SUCCESS;
	}
	return withResolvedLectures({
		deps,
		moduleRoot,
		alsoTry: NO_SECOND_REMEDY,
		lectureDate,
		choose: deps.selectMatches,
		act: async (matches) => {
			await reportCosts({
				deps,
				moduleRoot,
				moduleRoots: matches.map((lectureMatch) => lectureMatch.moduleRoot),
				options: { lectureDate },
			});
			return EXIT_SUCCESS;
		},
	});
}

/**
 * Writes the question that `delete` asks. It names the lecture and the lecture files that go.
 *
 * @param lectureMatch - The lecture to delete.
 * @returns The question.
 */
function deletionPrompt(lectureMatch: LectureMatch): string {
	return `Permanently delete Lecture ${lectureMatch.lectureNumber} "${lectureMatch.lectureTitle}" — its video, slides, workspace, and final output? This cannot be undone.`;
}

/**
 * Asks the user to approve a reset, and gives the number of lectures that lose
 * work (NFR-4.3). When the user declines, nothing runs, and the output says so
 * (technical-design.md §4.7, "The reset is confirmed before anything is deleted").
 *
 * It asks nothing when there is no `--from-stage`, or when the count is zero. It
 * gets the count only when there is a `--from-stage`. The count for a batch
 * costs a normalisation and a scan of the batch's modules.
 *
 * @param args - The reset and the count.
 * @param args.deps - The command dependencies.
 * @param args.fromStage - The stage from `--from-stage`, or `undefined` when there is no reset.
 * @param args.countLectures - Gets the number of lectures that the command covers.
 * @returns `true` when the command can continue.
 */
async function confirmReset({
	deps,
	fromStage,
	countLectures,
}: {
	readonly deps: CliDeps;
	readonly fromStage: StageId | undefined;
	readonly countLectures: () => Promise<number>;
}): Promise<boolean> {
	if (fromStage === undefined) {
		return true;
	}
	const count = await countLectures();
	if (count === 0) {
		return true;
	}
	const approved = await deps.confirm({
		message: `Re-running from "${fromStage}" will delete that stage's output and every later stage's, for ${pluralise({ count, noun: "lecture" })}. This cannot be undone.`,
	});
	if (!approved) {
		deps.write("Nothing was run.\n");
	}
	return approved;
}

/**
 * Makes an identity change to the chosen lecture, then normalises its module.
 * Normalisation renumbers the lectures and gives the lecture files their base
 * names (technical-design.md §4.7, "Identity-change commands"). When the user
 * declines the change, there is no normalisation.
 *
 * @param args - The identity change.
 * @param args.command - The identity-change command.
 * @param args.deps - The command dependencies.
 * @param args.lectureMatch - The lecture to change.
 * @returns The success exit code.
 */
async function changeLectureIdentity({
	command,
	deps,
	lectureMatch,
}: IdentityChangeTarget): Promise<number> {
	if (await applyIdentityChange({ command, deps, lectureMatch })) {
		await deps.runner.normaliseSources({ moduleRoots: [lectureMatch.moduleRoot] });
	}
	return EXIT_SUCCESS;
}

type IdentityChangeCommand = Extract<CliCommand, { command: "rename" | "delete" | "change-date" }>;

type IdentityChangeTarget = {
	readonly command: IdentityChangeCommand;
	readonly deps: CliDeps;
	readonly lectureMatch: LectureMatch;
};

/**
 * Makes one identity change. Only `delete` asks the user first, because only
 * `delete` destroys work.
 *
 * @param args - The identity change.
 * @param args.command - The identity-change command.
 * @param args.deps - The command dependencies.
 * @param args.lectureMatch - The lecture to change.
 * @returns `true` when the change was made, and `false` when the user declined it.
 */
async function applyIdentityChange({
	command,
	deps,
	lectureMatch,
}: IdentityChangeTarget): Promise<boolean> {
	if (command.command === "rename") {
		await renameLecture({ workspaceRoot: lectureMatch.workspaceRoot, title: command.title });
		deps.write(`Renamed to "${command.title}".\n`);
		return true;
	}
	if (command.command === "change-date") {
		await changeLectureDate({ match: lectureMatch, newLectureDate: command.newLectureDate });
		deps.write(`Moved to ${command.newLectureDate}.\n`);
		return true;
	}
	if (!(await deps.confirm({ message: deletionPrompt(lectureMatch) }))) {
		deps.write("Nothing was deleted.\n");
		return false;
	}
	await deleteLecture({ match: lectureMatch });
	deps.write(`Deleted Lecture ${lectureMatch.lectureNumber} "${lectureMatch.lectureTitle}".\n`);
	return true;
}

/**
 * Does an identity-change command on the one lecture that its lecture date names.
 *
 * @param args - The command and the dependencies.
 * @param args.command - The identity-change command.
 * @param args.deps - The command dependencies.
 * @returns The exit code.
 */
function identityChangeCommand({
	command,
	deps,
}: CommandArgs<IdentityChangeCommand>): Promise<number> {
	return withResolvedLectures({
		deps,
		lectureDate: command.lectureDate,
		...ACROSS_EVERY_MODULE,
		choose: chooseOneLecture(deps),
		act: ([lectureMatch]) => changeLectureIdentity({ command, deps, lectureMatch }),
	});
}

/**
 * Every command except `help`. The CLI answers `help` before it reads the
 * configuration, so `help` needs no {@link CliDeps} (technical-design.md §4.7).
 */
export type RunnableCliCommand = Exclude<CliCommand, { command: "help" }>;

/**
 * Does a parsed command and gives the exit code.
 *
 * @param args - The command and the dependencies.
 * @param args.command - The command.
 * @param args.deps - Everything that the command uses from outside this module.
 * @returns The exit code: `0` when the command did what the user asked, and `1` when it could not.
 * @throws {import("./lecture-identity.js").LectureIdentityError} When an identity change cannot be made.
 * @example
 * const code = await executeCommand({ command: parseCliArgs({ argv }), deps });
 */
export function executeCommand({
	command,
	deps,
}: CommandArgs<RunnableCliCommand>): Promise<number> {
	if (command.command === "run") {
		return runCommand({ command, deps });
	}
	if (command.command === "batch") {
		return batchCommand({ command, deps });
	}
	if (command.command === "cost-report") {
		return costReportCommand({ command, deps });
	}
	return identityChangeCommand({ command, deps });
}
