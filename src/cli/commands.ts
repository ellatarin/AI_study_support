/**
 * The CLI commands find their lectures and ask the user to choose or approve.
 * Then they call the runner and write the result (technical-design.md §4.7,
 * "CLI Structure").
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

type RunnerOperation =
	| "normaliseSources"
	| "runLecture"
	| "runBatch"
	| "costReport"
	| "resolveLecturesByDate"
	| "countLectures";

/**
 * The commands call the runner through these methods. A test puts a stub of this
 * type in place of a real {@link PipelineRunner} and its stages.
 *
 * A `Pick` type includes the class's methods, and a type with methods is not
 * deeply readonly. So with a `Pick`, the lint rule `prefer-readonly-parameter-types`
 * would report each function that takes {@link CliDeps}. This mapped type holds
 * the same functions as readonly properties.
 */
export type PipelineRunnerFacade = {
	readonly [TOperation in RunnerOperation]: PipelineRunner[TOperation];
};

/**
 * A picker shows the user the lectures on one lecture date, and the user chooses
 * from them. This module declares the type and `prompts.ts` implements it,
 * because the module that asks a question declares the type of that question.
 */
export type MatchQuery = { readonly matches: readonly LectureMatch[] };

/**
 * Asks the user which of several lectures to act on. It returns the chosen
 * lectures, or an empty list when the user cancels.
 */
export type LecturePicker = (args: MatchQuery) => Promise<readonly LectureMatch[]>;

/** Asks the user which one of several lectures to act on. It returns `null` when the user cancels. */
export type SingleLecturePicker = (args: MatchQuery) => Promise<LectureMatch | null>;

/** Writes text that the user reads. The caller puts the line ends in the text. */
export type WriteText = (text: string) => void;

/**
 * A command reads its configuration and calls the runner, the prompts and the
 * output stream through these fields. A test puts stubs in these fields, so it
 * can check a command without a pipeline or a terminal.
 */
export type CliDeps = {
	readonly runner: PipelineRunnerFacade;
	/** A command acts on each of these modules when the user names no module. */
	readonly moduleRoots: readonly string[];
	/**
	 * A batch runs this number of lectures at once when the user gives no
	 * `--concurrency`. The value comes from the config's `batch.concurrency`.
	 */
	readonly batchConcurrency: number;
	readonly formatMoney: MoneyFormatter;
	readonly pickLectures: LecturePicker;
	readonly pickOneLecture: SingleLecturePicker;
	readonly confirm: ConfirmPrompt;
	/** A command shows this path to the user when a stage fails. */
	readonly debugLogPath: string;
	readonly write: WriteText;
};

export const EXIT_SUCCESS = 0;
export const EXIT_FAILURE = 1;

const BLOCK_END = "\n\n";

type CommandArgs<TCommand> = { readonly command: TCommand; readonly deps: CliDeps };

type LectureReport = { readonly deps: CliDeps; readonly summary: PipelineRunSummary };

/**
 * An action receives at least one lecture, because {@link withResolvedLectures}
 * stops before the action when no lecture is on the date.
 */
type ChosenLectures = readonly [LectureMatch, ...LectureMatch[]];

// Builds the picker for the identity changes. The picker returns one lecture, or
// none when the user cancels. Each identity change acts on one lecture only (FR-6.7,
// technical-design.md §4.7, "An identity change acts on exactly one lecture").
function chooseOneLecture(deps: CliDeps): LecturePicker {
	return async ({ matches }) => {
		const chosen = await deps.pickOneLecture({ matches });
		return chosen === null ? [] : [chosen];
	};
}

/**
 * Finds the lectures on a lecture date, and runs an action on them. Each command
 * that takes a lecture date starts here.
 *
 * When several lectures are on the date, the picker asks the user which. When no
 * lecture is on the date, the command fails. When the user cancels the choice,
 * the command succeeds. In both cases, the action does not run
 * (technical-design.md §4.7, "Exit codes").
 *
 * @param args - The search and the action.
 * @param args.deps - The command dependencies.
 * @param args.lectureDate - The lecture date from the command line.
 * @param args.act - The action on the chosen lectures.
 * @param args.choose - The picker that the user sees when several lectures are on the date.
 * @param args.moduleRoot - The one module to search, or `null` for every configured module.
 * @param args.alsoTry - The second remedy that the command suggests when no lecture is on the date.
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
	// TypeScript narrows the type after a destructure, but not after a length test.
	// So the action receives a non-empty tuple and needs no second check.
	const [first, ...rest] = chosen;
	if (first === undefined) {
		return EXIT_SUCCESS;
	}
	return act([first, ...rest]);
}

function scopedModuleRoots({
	moduleRoot,
	deps,
}: {
	readonly moduleRoot: string | null;
	readonly deps: CliDeps;
}): readonly string[] {
	return moduleRoot === null ? deps.moduleRoots : [moduleRoot];
}

function searchScope({ moduleRoot }: { readonly moduleRoot: string | null }): string {
	return moduleRoot === null ? "in the configured modules" : `in ${moduleName({ moduleRoot })}`;
}

/**
 * Every command except `cost-report` uses these search settings. These commands
 * take no `--module`, so they search every configured module.
 */
const ACROSS_EVERY_MODULE = {
	moduleRoot: null,
	alsoTry: ", or add its video and slides and run the pipeline again",
} as const;

/**
 * `cost-report` gives the user no second remedy. A pipeline run would spend
 * money, and it would find no spending that `cost-report` did not find.
 */
const NO_SECOND_REMEDY = "";

// Writes the run summary of one pipeline run, then its failures. It reads each
// stage's model, tokens and cost from the manifest (technical-design.md §7,
// "End-of-Run Summary").
async function printRunSummary({ deps, summary }: LectureReport): Promise<void> {
	const manifest = await readManifest({ workspaceRoot: summary.workspaceRoot });
	deps.write(
		`${formatRunSummary({
			outcomes: summary.stageOutcomes,
			manifest,
			formatMoney: deps.formatMoney,
		})}${BLOCK_END}`,
	);
	reportFailures({ deps, summary });
}

// Writes each failed stage with its error message, then the path of the debug
// log, which holds the stack (technical-design.md §8, "Stage Failure Protocol").
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
	deps.write(`The full stack for each is in ${deps.debugLogPath}.${BLOCK_END}`);
}

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

// Normalises the sources first, so that a workspace exists for a lecture with a
// new source pair (technical-design.md §4.7, "`run <date>` normalises first").
async function runCommand({
	command,
	deps,
}: CommandArgs<Extract<CliCommand, { command: "run" }>>): Promise<number> {
	await deps.runner.normaliseSources({ moduleRoots: deps.moduleRoots });
	return withResolvedLectures({
		deps,
		lectureDate: command.lectureDate,
		...ACROSS_EVERY_MODULE,
		choose: deps.pickLectures,
		act: (matches) => runLectures({ deps, matches, options: command.options }),
	});
}

async function batchCommand({
	command,
	deps,
}: CommandArgs<Extract<CliCommand, { command: "batch" }>>): Promise<number> {
	const moduleRoots = scopedModuleRoots({ moduleRoot: command.moduleRoot, deps });
	const proceed = await confirmReset({
		deps,
		fromStage: command.options.fromStage,
		// This function normalises the sources before it counts. So it also counts a
		// lecture with a new source pair (technical-design.md §4.7, "Counting a batch's scope").
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
		deps.write(`${report}${BLOCK_END}`);
	}
}

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
		choose: deps.pickLectures,
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

function deletionPrompt(lectureMatch: LectureMatch): string {
	return `Permanently delete Lecture ${lectureMatch.lectureNumber} "${lectureMatch.lectureTitle}" — its video, slides, workspace, and final output? This cannot be undone.`;
}

// Asks the user to approve a reset, with the number of lectures whose work the
// reset deletes (NFR-4.3, technical-design.md §4.7). It counts the lectures only
// after a `--from-stage`. The count for a batch needs a normalisation and a scan.
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

// Normalises the module after an identity change. The normalisation stage then
// renumbers the lectures and renames the lecture files to their base names
// (technical-design.md §4.7, "Identity-change commands").
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

// Returns `false` when the user declines. Only `delete` asks the user first,
// because only `delete` destroys work.
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
 * This type includes every command except `help`. The CLI answers `help` before
 * it reads the configuration, so the CLI never passes {@link CliDeps} to `help`
 * (technical-design.md §4.7).
 */
export type RunnableCliCommand = Exclude<CliCommand, { command: "help" }>;

/**
 * Runs a parsed command and returns the exit code.
 *
 * @param args - The command and the dependencies.
 * @param args.command - The command.
 * @param args.deps - The runner, the prompts and the output stream that the command calls.
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
