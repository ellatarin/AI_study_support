/**
 * This module parses and checks the command line, and makes a {@link CliCommand}.
 * It does not run the command, so a test can check a command without a runner, a filesystem
 * or a terminal (technical-design.md §4.7, "CLI Structure").
 *
 * It uses `parseArgs` from `node:util` and not a CLI library. Six commands and
 * a small set of flags need nothing more.
 */

import { parseArgs } from "node:util";
import type { PipelineRunOptions, StageId } from "../types/pipeline.js";
import { DEFAULT_PIPELINE_RUN_OPTIONS } from "../types/pipeline.js";
import { isCalendarDate } from "../utils/date.js";
import { errorMessage, NamedError } from "../utils/errors.js";
import {
	isStageAfter,
	isStageId,
	STAGES_IN_ORDER,
	unknownStageMessage,
} from "../utils/stage-id.js";

/**
 * The error for a command line that the CLI cannot use. The cause is an unknown
 * command or flag, a missing or bad argument, or a flag value out of range. The
 * CLI prints the usage text after this error (technical-design.md §8).
 */
export class CliUsageError extends NamedError {}

/**
 * A command line, parsed and checked. Each command holds only the arguments that
 * it takes (technical-design.md §4.7).
 */
export type CliCommand =
	| { readonly command: "run"; readonly lectureDate: string; readonly options: PipelineRunOptions }
	| {
			readonly command: "batch";
			/** The one module to run, or `null` for every configured module. */
			readonly moduleRoot: string | null;
			readonly options: PipelineRunOptions;
			/** The number of lectures to run at once, from `--concurrency`. `null` means the config's `batch.concurrency`. */
			readonly concurrency: number | null;
	  }
	| {
			readonly command: "cost-report";
			/** The one lecture date to report on, or `null` for every lecture. */
			readonly lectureDate: string | null;
			/** The one module to report on, or `null` for every configured module. */
			readonly moduleRoot: string | null;
	  }
	| { readonly command: "rename"; readonly lectureDate: string; readonly title: string }
	| { readonly command: "delete"; readonly lectureDate: string }
	| {
			readonly command: "change-date";
			readonly lectureDate: string;
			readonly newLectureDate: string;
	  }
	| { readonly command: "help" };

/** Every flag of the CLI, for `parseArgs`. Each command accepts only some of them. */
const OPTION_SPEC = {
	"from-stage": { type: "string" },
	"to-stage": { type: "string" },
	concurrency: { type: "string" },
	"continue-on-error": { type: "boolean" },
	date: { type: "string" },
	module: { type: "string" },
	help: { type: "boolean", short: "h" },
} as const;

/** The flag values, before the command checks them. */
type ParsedFlags = {
	readonly "from-stage"?: string;
	readonly "to-stage"?: string;
	readonly concurrency?: string;
	readonly "continue-on-error"?: boolean;
	readonly date?: string;
	readonly module?: string;
	readonly help?: boolean;
};

/** The name of a flag that a command can accept. `help` is not one, because every command accepts it. */
type FlagName = Exclude<keyof ParsedFlags, "help">;

/** One flag as the usage text shows it. */
type FlagSpec = {
	/** The flag and its argument, as the usage lines and the options list write it. */
	readonly form: string;
	/** The line that describes the flag in the options list. */
	readonly summary: string;
};

/**
 * Every flag of the CLI, with its usage form and description. The usage lines
 * and the options list both use this table, so the two always write a flag the
 * same way.
 */
const FLAG_SPECS: Readonly<Record<FlagName, FlagSpec>> = {
	"from-stage": {
		form: "--from-stage <stage>",
		summary: "Re-run from this stage, discarding it and everything downstream.",
	},
	"to-stage": {
		form: "--to-stage <stage>",
		summary: "Stop after this stage, leaving the stages beyond it unrun.",
	},
	concurrency: {
		form: "--concurrency <n>",
		summary: "Process n lectures at once (batch only), overriding batch.concurrency in the config.",
	},
	"continue-on-error": {
		form: "--continue-on-error",
		summary: "Carry on to the next stage when one fails, rather than halting.",
	},
	date: {
		form: "--date <YYYY-MM-DD>",
		summary: "Narrow a cost report to one lecture date.",
	},
	module: {
		form: "--module <moduleRoot>",
		summary: "Narrow a cost report to one module.",
	},
};

/**
 * Checks a lecture date from the command line.
 *
 * @param args - The date and the usage line.
 * @param args.value - The date as typed, or `undefined` when none was given.
 * @param args.usage - The command's usage line, for the error message.
 * @returns The `YYYY-MM-DD` date.
 * @throws {CliUsageError} When the date is missing or is not a real calendar date.
 */
function requireDate({
	value,
	usage,
}: {
	readonly value: string | undefined;
	readonly usage: string;
}): string {
	if (value === undefined) {
		throw new CliUsageError(`Expected a date: ${usage}`);
	}
	if (!isCalendarDate(value)) {
		throw new CliUsageError(`"${value}" is not a date. Dates are written YYYY-MM-DD: ${usage}`);
	}
	return value;
}

/**
 * Gets the new title from a `rename` command line.
 *
 * @param args - The arguments and the usage line.
 * @param args.positionals - The command's positional arguments.
 * @param args.usage - The command's usage line, for the error message.
 * @returns The title, with the spaces at each end removed.
 * @throws {CliUsageError} When the title is missing or is only white space.
 */
function requireTitle({
	positionals,
	usage,
}: {
	readonly positionals: readonly string[];
	readonly usage: string;
}): string {
	const title = (positionals[1] ?? "").trim();
	if (title === "") {
		throw new CliUsageError(`Expected a new title: ${usage}`);
	}
	return title;
}

/**
 * Refuses a command line with more positional arguments than the command takes.
 *
 * @param args - The arguments and the limit.
 * @param args.positionals - The command's positional arguments.
 * @param args.limit - The largest number of positional arguments the command takes.
 * @param args.usage - The command's usage line, for the error message.
 * @returns Nothing.
 * @throws {CliUsageError} When there are more positional arguments than the limit.
 */
function rejectExtraPositionals({
	positionals,
	limit,
	usage,
}: {
	readonly positionals: readonly string[];
	readonly limit: number;
	readonly usage: string;
}): void {
	if (positionals.length > limit) {
		throw new CliUsageError(`Unexpected argument "${positionals[limit]}". Usage: ${usage}`);
	}
}

/**
 * Checks that a stage flag names a stage that exists. `--from-stage` and
 * `--to-stage` both use this function, so the two accept the same stage ids.
 *
 * @param args - The flag and its value.
 * @param args.value - The flag's value, or `undefined` when the flag was not given.
 * @param args.flag - The flag as written, for the error message.
 * @returns The stage id, or `undefined` when the flag was not given.
 * @throws {CliUsageError} When the value names no stage.
 */
function parseStageFlag({
	value,
	flag,
}: {
	readonly value: string | undefined;
	readonly flag: string;
}): StageId | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!isStageId(value)) {
		throw new CliUsageError(unknownStageMessage({ subject: `${flag} "${value}"` }));
	}
	return value;
}

/**
 * Checks `--concurrency`, the number of lectures that a batch runs at once.
 *
 * @param value - The flag's value, or `undefined` when the flag was not given.
 * @returns The number, or `null` when the flag was not given and the config's `batch.concurrency` applies.
 * @throws {CliUsageError} When the value is not a whole number of 1 or more.
 */
function parseConcurrency(value: string | undefined): number | null {
	if (value === undefined) {
		return null;
	}
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new CliUsageError(`--concurrency must be a whole number of 1 or more, not "${value}"`);
	}
	return parsed;
}

/**
 * Makes the pipeline run options from the flags of `run` or `batch`. When
 * `--continue-on-error` is not given, `onStageFailure` gets its default value.
 * So the options always hold the `onStageFailure` value that the pipeline run uses.
 *
 * @param flags - The flag values.
 * @returns The options for each pipeline run.
 * @throws {CliUsageError} When a stage flag names no stage, or the two stage flags are out of pipeline order.
 */
function toPipelineRunOptions(flags: ParsedFlags): PipelineRunOptions {
	const fromStage = parseStageFlag({ value: flags["from-stage"], flag: "--from-stage" });
	const toStage = parseStageFlag({ value: flags["to-stage"], flag: "--to-stage" });
	if (
		fromStage !== undefined &&
		toStage !== undefined &&
		isStageAfter({ stageId: fromStage, other: toStage })
	) {
		throw new CliUsageError(
			`--to-stage "${toStage}" runs before --from-stage "${fromStage}", so the run would do nothing. Stages run in this order: ${STAGES_IN_ORDER}`,
		);
	}
	return {
		...(fromStage === undefined ? {} : { fromStage }),
		...(toStage === undefined ? {} : { toStage }),
		onStageFailure:
			flags["continue-on-error"] === true
				? "continue"
				: DEFAULT_PIPELINE_RUN_OPTIONS.onStageFailure,
	};
}

/**
 * Splits the command line into positional arguments and flags. An error from
 * `parseArgs` becomes a {@link CliUsageError}.
 *
 * @param argv - The arguments after the program name.
 * @returns The positional arguments, the command word first, and the flag values.
 * @throws {CliUsageError} When a flag is unknown or has no value.
 */
function splitArgv(argv: readonly string[]): {
	readonly positionals: readonly string[];
	readonly flags: ParsedFlags;
} {
	try {
		const { values, positionals } = parseArgs({
			args: [...argv],
			options: OPTION_SPEC,
			allowPositionals: true,
		});
		return { positionals, flags: values };
	} catch (error: unknown) {
		throw new CliUsageError(errorMessage(error));
	}
}

/** The input of a command's `build` function, after the checks against its {@link CommandSpec}. */
type CommandInput = {
	/** The positional arguments after the command word. */
	readonly positionals: readonly string[];
	readonly flags: ParsedFlags;
	/** The command's usage line, for an error message. */
	readonly usage: string;
	/**
	 * Gets and checks the lecture date in the first positional argument. It is a
	 * function because `batch` and `cost-report` take no lecture date, and a check
	 * that always ran would fail for them.
	 */
	readonly lectureDate: () => string;
};

/** One command: its usage, the arguments it accepts, and how to build it. */
type CommandSpec = {
	/** The positional arguments, as the usage line writes them after the command word. */
	readonly positionals: string;
	/** The largest number of positional arguments the command accepts. */
	readonly maxPositionals: number;
	/** The flags that the command accepts. Any other flag is a usage error, so it is never ignored. */
	readonly flags: readonly FlagName[];
	/** The line that describes the command in the usage text. */
	readonly summary: string;
	/** Builds the {@link CliCommand} from a command line that passed the checks. */
	readonly build: (input: CommandInput) => CliCommand;
};

/**
 * The word that a user types to choose a command. It comes from {@link CliCommand},
 * so a command word cannot be in one type and not in the other. `help` is not one. The parser answers `help` before
 * it looks for a command, so `help` has no {@link CommandSpec}.
 */
type CommandName = Exclude<CliCommand, { readonly command: "help" }>["command"];

/**
 * Every command of the CLI. The usage text comes from this table, and the parser
 * calls the command's `build` from it.
 *
 * The key type is {@link CommandName}, not `string`. So a command that is added to
 * {@link CliCommand} and not to this table is a compile error.
 */
const COMMAND_SPECS: Readonly<Record<CommandName, CommandSpec>> = {
	run: {
		positionals: "<date>",
		maxPositionals: 1,
		flags: ["from-stage", "to-stage", "continue-on-error"],
		summary: "Run one lecture, identified by its date (YYYY-MM-DD), through the pipeline.",
		build: (input) => ({
			command: "run",
			lectureDate: input.lectureDate(),
			options: toPipelineRunOptions(input.flags),
		}),
	},
	batch: {
		positionals: "[<moduleRoot>]",
		maxPositionals: 1,
		flags: ["concurrency", "from-stage", "to-stage", "continue-on-error"],
		summary: "Run every lecture in one module, or in every configured module.",
		build: (input) => ({
			command: "batch",
			moduleRoot: input.positionals[0] ?? null,
			options: toPipelineRunOptions(input.flags),
			concurrency: parseConcurrency(input.flags.concurrency),
		}),
	},
	"cost-report": {
		positionals: "",
		maxPositionals: 0,
		flags: ["date", "module"],
		summary: "Report what has been spent, by run and by stage.",
		build: (input) => ({
			command: "cost-report",
			lectureDate:
				input.flags.date === undefined
					? null
					: requireDate({ value: input.flags.date, usage: input.usage }),
			moduleRoot: input.flags.module ?? null,
		}),
	},
	rename: {
		positionals: '<date> "<new title>"',
		maxPositionals: 2,
		flags: [],
		summary: "Give a lecture a new title, renaming its files, workspace, and output.",
		build: (input) => ({
			command: "rename",
			lectureDate: input.lectureDate(),
			title: requireTitle(input),
		}),
	},
	delete: {
		positionals: "<date>",
		maxPositionals: 1,
		flags: [],
		summary: "Remove a lecture and renumber the ones that follow it.",
		build: (input) => ({ command: "delete", lectureDate: input.lectureDate() }),
	},
	"change-date": {
		positionals: "<date> <new date>",
		maxPositionals: 2,
		flags: [],
		summary: "Move a lecture to another date and renumber.",
		build: (input) => ({
			command: "change-date",
			lectureDate: input.lectureDate(),
			newLectureDate: requireDate({ value: input.positionals[1], usage: input.usage }),
		}),
	},
};

/**
 * Writes a command's usage line: the command word, its positional arguments,
 * then each flag it accepts.
 *
 * @param args - The command.
 * @param args.command - The command word.
 * @param args.spec - The command's {@link CommandSpec}.
 * @returns The usage line, without the program name.
 */
function invocationForm({
	command,
	spec,
}: {
	readonly command: string;
	readonly spec: CommandSpec;
}): string {
	const flagForms = spec.flags.map((name) => `[${FLAG_SPECS[name].form}]`);
	return [command, spec.positionals, ...flagForms].filter((part) => part !== "").join(" ");
}

/** The number of spaces between the longest label in a usage-text list and its description. */
const LABEL_GAP = 3;

/**
 * Tells whether a word names a command. It is a type guard, so that the caller
 * can then use the word as a key of {@link COMMAND_SPECS}.
 *
 * @param value - The word that the user typed.
 * @returns `true` when the word is a key of {@link COMMAND_SPECS}.
 */
function isCommandName(value: string): value is CommandName {
	return Object.hasOwn(COMMAND_SPECS, value);
}

/**
 * Writes one list of the usage text: one label on each line, then its
 * description. The descriptions start in the same column.
 *
 * @param entries - The labels and their descriptions.
 * @returns The lines of the list.
 */
function describedLines(
	entries: readonly { readonly label: string; readonly summary: string }[],
): string {
	const width = Math.max(...entries.map((entry) => entry.label.length)) + LABEL_GAP;
	return entries.map((entry) => `  ${entry.label.padEnd(width)}${entry.summary}`).join("\n");
}

/** The usage text. The CLI prints it for `--help` and after a usage error. */
export const USAGE = `lecture-notes — turn lecture recordings and slides into study notes

Usage:
${Object.entries(COMMAND_SPECS)
	.map(([command, spec]) => `  lecture-notes ${invocationForm({ command, spec })}`)
	.join("\n")}

Commands:
${describedLines(
	Object.entries(COMMAND_SPECS).map(([command, spec]) => ({
		label: command,
		summary: spec.summary,
	})),
)}

Options:
${describedLines([
	...Object.values(FLAG_SPECS).map((spec) => ({ label: spec.form, summary: spec.summary })),
	{ label: "-h, --help", summary: "Show this message." },
])}

Dates are ISO 8601 (YYYY-MM-DD). A date matching lectures in several modules
prompts for which of them to act on.`;

/**
 * Refuses a flag that the command does not accept. `parseArgs` accepts every flag
 * after every command, so without this check the command would ignore the flag
 * (technical-design.md §4.7, "Flags belong to commands").
 *
 * @param args - The command line to check.
 * @param args.command - The command word.
 * @param args.flags - The flag values.
 * @param args.spec - The command's {@link CommandSpec}.
 * @param args.usage - The command's usage line, for the error message.
 * @returns Nothing.
 * @throws {CliUsageError} When a flag is not one that the command accepts.
 */
function rejectForeignFlags({
	command,
	flags,
	spec,
	usage,
}: {
	readonly command: string;
	readonly flags: ParsedFlags;
	readonly spec: CommandSpec;
	readonly usage: string;
}): void {
	const supplied = Object.keys(flags).filter((name): name is FlagName => name !== "help");
	const foreign = supplied.filter((name) => !spec.flags.includes(name));
	if (foreign.length === 0) {
		return;
	}
	const accepted =
		spec.flags.length === 0
			? "it takes no options"
			: `it takes ${spec.flags.map((name) => `--${name}`).join(", ")}`;
	throw new CliUsageError(
		`--${foreign[0]} is not an option for ${command}: ${accepted}. Usage: ${usage}`,
	);
}

/**
 * Checks a command line against the command's {@link CommandSpec}, then builds the command.
 *
 * @param args - The command and the rest of the command line.
 * @param args.command - The command word.
 * @param args.spec - The command's {@link CommandSpec}.
 * @param args.positionals - The positional arguments after the command word.
 * @param args.flags - The flag values.
 * @returns The command.
 * @throws {CliUsageError} When an argument is missing, extra or bad.
 */
function buildCommand({
	command,
	spec,
	positionals,
	flags,
}: {
	readonly command: string;
	readonly spec: CommandSpec;
	readonly positionals: readonly string[];
	readonly flags: ParsedFlags;
}): CliCommand {
	const usage = invocationForm({ command, spec });
	rejectExtraPositionals({ positionals, limit: spec.maxPositionals, usage });
	rejectForeignFlags({ command, flags, spec, usage });
	return spec.build({
		positionals,
		flags,
		usage,
		lectureDate: () => requireDate({ value: positionals[0], usage }),
	});
}

/**
 * Parses a command line into a {@link CliCommand}.
 *
 * An empty command line gives `help`. So does `--help` or `-h` at any place in it.
 * The parser checks every other command line in full before it returns
 * (technical-design.md §4.7, "CLI Structure").
 *
 * @param args - The command line.
 * @param args.argv - The arguments after the program name (`process.argv.slice(2)`).
 * @returns The command.
 * @throws {CliUsageError} When the CLI cannot use the command line.
 * @example
 * parseCliArgs({ argv: ["run", "2025-10-10", "--from-stage", "transcription"] });
 */
export function parseCliArgs({ argv }: { readonly argv: readonly string[] }): CliCommand {
	if (argv.length === 0) {
		return { command: "help" };
	}
	const { positionals, flags } = splitArgv(argv);
	if (flags.help === true) {
		return { command: "help" };
	}
	const [command, ...rest] = positionals;
	if (command === undefined || !isCommandName(command)) {
		throw new CliUsageError(
			`Unknown command "${command ?? ""}". Commands are: ${Object.keys(COMMAND_SPECS).join(", ")}`,
		);
	}
	return buildCommand({ command, spec: COMMAND_SPECS[command], positionals: rest, flags });
}
