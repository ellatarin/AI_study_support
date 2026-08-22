/**
 * Carrying out a parsed {@link CliCommand}.
 *
 * This is the layer between a validated command line and the pipeline: it turns
 * a date into the lecture or lectures it names, asks the questions that need
 * asking, calls the runner, and prints what happened. Everything it depends on
 * — the runner, the prompts, and where output goes — is injected, so each
 * command's behaviour can be checked without running a pipeline or a terminal
 * (technical-design.md §4.7).
 */

import { readManifest } from "../pipeline/manifest.js";
import type { PipelineRunner } from "../pipeline/runner.js";
import type { ConfirmPrompt } from "../pipeline/stages/source-normalisation.js";
import type { LectureMatch, RunOptions, RunSummary } from "../types/pipeline.js";
import { formatBatchSummary, formatRunSummary, stageLabel } from "../utils/cost.js";
import type { CliCommand } from "./args.js";
import { changeLectureDate, deleteLecture, renameLecture } from "./lecture-identity.js";

/** The runner operations the commands drive. */
type RunnerOperation =
	| "normaliseSources"
	| "runLecture"
	| "runBatch"
	| "costReport"
	| "resolveLecturesByDate";

/**
 * The runner surface the commands drive. Declared structurally so a test can
 * stand in a stub without constructing a real {@link PipelineRunner} and its
 * stages.
 *
 * Mapped rather than `Pick`ed: `Pick` copies the class's *method* signatures,
 * and a type carrying methods is not deeply readonly, so every function taking
 * {@link CliDeps} was reported by `prefer-readonly-parameter-types`. A mapped
 * type yields readonly properties whose type is the same function, which is
 * what an injected dependency is.
 */
export type PipelineRunnerFacade = {
	readonly [TOperation in RunnerOperation]: PipelineRunner[TOperation];
};

/** What a picker is handed: the lectures a date turned out to name. */
type MatchQuery = { readonly matches: readonly LectureMatch[] };

/**
 * Settles a date that names several lectures, returning those to act on and an
 * empty list when the user cancels. Which picker a command uses depends on
 * whether acting on several at once means anything for it.
 */
type LecturePicker = (args: MatchQuery) => Promise<readonly LectureMatch[]>;

/** Everything a command needs from the world outside it. */
export type CliDeps = {
	/** The pipeline runner the commands drive. */
	readonly runner: PipelineRunnerFacade;
	/** Every module named in the configuration, used when a command names none. */
	readonly moduleRoots: readonly string[];
	/** Pounds per US dollar, for presenting stored costs. */
	readonly gbpPerUsd: number;
	/** Asks which lectures to act on when a date matches several. */
	readonly selectMatches: LecturePicker;
	/** Asks which single lecture to act on, where acting on several would be meaningless. */
	readonly selectMatch: (args: MatchQuery) => Promise<LectureMatch | null>;
	/** Asks the user to approve an irreversible action. */
	readonly confirm: ConfirmPrompt;
	/** Where user-facing output goes. */
	readonly write: (text: string) => void;
};

/** The exit code for a command that did everything the user asked for. */
export const EXIT_SUCCESS = 0;
/** The exit code for anything the user asked for that could not be done. */
export const EXIT_FAILURE = 1;

/**
 * What every command is handed: the invocation to carry out, and the world to
 * carry it out against.
 *
 * @typeParam TCommand - The command variant being carried out.
 */
type CommandArgs<TCommand> = { readonly command: TCommand; readonly deps: CliDeps };

/** What the two halves of reporting a finished lecture are handed. */
type LectureReport = { readonly deps: CliDeps; readonly summary: RunSummary };

/**
 * The lectures an action is handed: at least one, because a date naming none is
 * reported before any action runs.
 */
type ChosenLectures = readonly [LectureMatch, ...LectureMatch[]];

/**
 * The picker every identity mutation uses: exactly one lecture, or none.
 *
 * `rename`, `delete`, and `change-date` each name a single lecture (FR-6.7), so
 * a date that turns out to name several is a question to settle rather than a
 * licence to act on all of them — one new title cannot belong to two lectures,
 * and neither a deletion nor a re-dating is something to do twice on the
 * strength of one command (technical-design.md §4.7).
 *
 * @param deps - The command dependencies.
 * @returns A picker yielding at most one lecture.
 */
function chooseOneLecture(deps: CliDeps): LecturePicker {
	return async ({ matches }) => {
		const chosen = await deps.selectMatch({ matches });
		return chosen === null ? [] : [chosen];
	};
}

/**
 * Runs an action against the lectures a date names.
 *
 * Every command that takes a date shares this preamble: the date is resolved
 * across the modules in scope, a date matching several lectures is put to the
 * user, and only then does the command act. A date naming nothing is a failure —
 * the user asked for something that is not there — while a user who cancels the
 * choice has not failed at anything, so neither reaches the action
 * (technical-design.md §4.7).
 *
 * @param args - The resolution inputs and what to do with the result.
 * @param args.deps - The command dependencies.
 * @param args.lectureDate - The date the command was given.
 * @param args.act - What to do with the resolved lectures.
 * @param args.choose - Which picker settles a date matching several lectures.
 * @param args.moduleRoots - The modules to search; defaults to every configured module.
 * @returns The action's exit code, or the code for an unmatched or cancelled choice.
 */
async function withResolvedLectures({
	deps,
	lectureDate,
	act,
	choose,
	moduleRoots = undefined,
}: {
	readonly deps: CliDeps;
	readonly lectureDate: string;
	readonly act: (matches: ChosenLectures) => Promise<number>;
	readonly choose: LecturePicker;
	readonly moduleRoots?: readonly string[];
}): Promise<number> {
	const searched = moduleRoots ?? deps.moduleRoots;
	const matches = await deps.runner.resolveLecturesByDate({
		moduleRoots: searched,
		lectureDate,
	});
	if (matches.length === 0) {
		deps.write(
			`No lecture is dated ${lectureDate} in the configured modules. Check the date, or add its video and slides and run the pipeline again.\n`,
		);
		return EXIT_FAILURE;
	}
	const chosen = matches.length === 1 ? matches : await choose({ matches });
	if (chosen.length === 0) {
		return EXIT_SUCCESS;
	}
	// The guard above is what makes this true, and it lets an action that works on
	// exactly one lecture take the first without a second emptiness check.
	return act(chosen as ChosenLectures);
}

/**
 * The modules a command covers: the one it named, or every configured module.
 *
 * @param args - The scope inputs.
 * @param args.moduleRoot - The module the command named, or `null` for all of them.
 * @param args.deps - The command dependencies.
 * @returns The modules to act on.
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
 * Prints the end-of-run summary for one lecture, reading the manifest the run
 * has just finished writing for each stage's model, tokens, and cost
 * (technical-design.md §7).
 *
 * @param args - The summary inputs.
 * @param args.deps - The command dependencies.
 * @param args.summary - The lecture's run summary.
 * @returns A promise that resolves once the summary is written.
 */
async function printRunSummary({ deps, summary }: LectureReport): Promise<void> {
	const manifest = await readManifest({ workspaceRoot: summary.workspaceRoot });
	deps.write(
		`${formatRunSummary({
			outcomes: summary.stageOutcomes,
			manifest,
			gbpPerUsd: deps.gbpPerUsd,
		})}\n\n`,
	);
	reportFailures({ deps, summary });
}

/**
 * Names each stage that failed, with the error recorded for it, and points at
 * the debug log for the stack behind it.
 *
 * Without this a failure reads as a summary row with no cost against it and no
 * reason given — the message is in the manifest and the run log, but the user
 * should not have to open either to learn what went wrong (technical-design.md §8).
 *
 * @param args - The report inputs.
 * @param args.deps - The command dependencies.
 * @param args.summary - The lecture's run summary.
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
	deps.write("The full stack for each is in this run's debug log under runs/.\n\n");
}

/**
 * Runs each of the given lectures in turn, printing a summary for each.
 *
 * @param args - The run inputs.
 * @param args.deps - The command dependencies.
 * @param args.matches - The lectures to run.
 * @param args.options - The run options from the command line.
 * @returns The failure exit code when any lecture failed, otherwise success.
 */
async function runLectures({
	deps,
	matches,
	options,
}: {
	readonly deps: CliDeps;
	readonly matches: readonly LectureMatch[];
	readonly options: RunOptions;
}): Promise<number> {
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
 * Runs one lecture by date. Sources are normalised first, so a lecture whose
 * video and slides were only just added has a workspace to run
 * (technical-design.md §4.7, §5).
 *
 * @param args - The command inputs.
 * @param args.command - The parsed `run` command.
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
		choose: deps.selectMatches,
		act: (matches) => runLectures({ deps, matches, options: command.options }),
	});
}

/**
 * Runs every lecture in one module, or in every configured module.
 *
 * @param args - The command inputs.
 * @param args.command - The parsed `batch` command.
 * @param args.deps - The command dependencies.
 * @returns The exit code.
 */
async function batchCommand({
	command,
	deps,
}: CommandArgs<Extract<CliCommand, { command: "batch" }>>): Promise<number> {
	const batch = await deps.runner.runBatch({
		moduleRoots: scopedModuleRoots({ moduleRoot: command.moduleRoot, deps }),
		options: command.options,
	});
	for (const summary of batch.lectures) {
		await printRunSummary({ deps, summary });
	}
	deps.write(`${formatBatchSummary({ batch, gbpPerUsd: deps.gbpPerUsd })}\n`);
	return batch.overallStatus === "failed" ? EXIT_FAILURE : EXIT_SUCCESS;
}

/**
 * Prints the cost report, narrowed to a module or a date when either was given.
 * A date matching several modules is resolved the same way `run` resolves one,
 * and the report then covers exactly the lectures chosen (technical-design.md §7).
 *
 * @param args - The command inputs.
 * @param args.command - The parsed `cost-report` command.
 * @param args.deps - The command dependencies.
 * @returns The exit code.
 */
async function costReportCommand({
	command,
	deps,
}: CommandArgs<Extract<CliCommand, { command: "cost-report" }>>): Promise<number> {
	const moduleRoots = scopedModuleRoots({ moduleRoot: command.moduleRoot, deps });
	const { lectureDate } = command;
	if (lectureDate === null) {
		await deps.runner.costReport({ moduleRoots, options: {} });
		return EXIT_SUCCESS;
	}
	return withResolvedLectures({
		deps,
		moduleRoots,
		lectureDate,
		choose: deps.selectMatches,
		act: async (matches) => {
			await deps.runner.costReport({
				moduleRoots: matches.map((lectureMatch) => lectureMatch.moduleRoot),
				options: { lectureDate },
			});
			return EXIT_SUCCESS;
		},
	});
}

/**
 * The question asked before a lecture is destroyed, naming what is being lost.
 *
 * @param lectureMatch - The lecture about to be deleted.
 * @returns The question to put to the user.
 */
function deletionPrompt(lectureMatch: LectureMatch): string {
	return `Permanently delete Lecture ${lectureMatch.lectureNumber} "${lectureMatch.lectureTitle}" — its video, slides, workspace, and final output? This cannot be undone.`;
}

/**
 * Applies an identity change to the chosen lecture, then re-runs Stage 0 over
 * its module so numbering and file names catch up (technical-design.md §4.7).
 * A change the user declines leaves the module alone, so nothing is normalised.
 *
 * @param args - The mutation inputs.
 * @param args.command - The parsed mutation command.
 * @param args.deps - The command dependencies.
 * @param args.lectureMatch - The lecture to change.
 * @returns The success exit code once the change and any renormalisation are done.
 */
async function mutateLecture({ command, deps, lectureMatch }: MutationTarget): Promise<number> {
	if (await applyMutation({ command, deps, lectureMatch })) {
		await deps.runner.normaliseSources({ moduleRoots: [lectureMatch.moduleRoot] });
	}
	return EXIT_SUCCESS;
}

/**
 * The identity-mutation commands, which share a shape: resolve the date, apply
 * the change, then renormalise (technical-design.md §4.7).
 */
type MutationCommand = Extract<CliCommand, { command: "rename" | "delete" | "change-date" }>;

/** The lecture an identity change is being made to, and the change to make. */
type MutationTarget = {
	readonly command: MutationCommand;
	readonly deps: CliDeps;
	readonly lectureMatch: LectureMatch;
};

/**
 * Applies one lecture's identity change, asking first where the change destroys
 * work.
 *
 * @param args - The change inputs.
 * @param args.command - The parsed mutation command.
 * @param args.deps - The command dependencies.
 * @param args.lectureMatch - The lecture to change.
 * @returns Whether the change was made; `false` when the user declined it.
 */
async function applyMutation({ command, deps, lectureMatch }: MutationTarget): Promise<boolean> {
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
 * Runs an identity-mutation command against the single lecture its date names.
 *
 * @param args - The command inputs.
 * @param args.command - The parsed mutation command.
 * @param args.deps - The command dependencies.
 * @returns The exit code.
 */
function mutationCommand({ command, deps }: CommandArgs<MutationCommand>): Promise<number> {
	return withResolvedLectures({
		deps,
		lectureDate: command.lectureDate,
		choose: chooseOneLecture(deps),
		act: ([lectureMatch]) => mutateLecture({ command, deps, lectureMatch }),
	});
}

/**
 * A command that does pipeline work. `help` is not among them: it is answered
 * before the configuration is even read, so that a misconfigured project can
 * still ask what the commands are.
 */
export type RunnableCliCommand = Exclude<CliCommand, { command: "help" }>;

/**
 * Carries out a parsed command and reports how the process should exit.
 *
 * @param args - The dispatch inputs.
 * @param args.command - The command to carry out.
 * @param args.deps - Everything the command needs from outside itself.
 * @returns The process exit code: `0` when the command did what was asked, `1` when it could not.
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
	return mutationCommand({ command, deps });
}
