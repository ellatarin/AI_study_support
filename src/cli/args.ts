/**
 * Parsing the command line into a {@link CliCommand}.
 *
 * Argument handling is kept apart from doing the work so a command's shape can
 * be verified without a runner, a filesystem, or a terminal. Parsing uses
 * `node:util`'s `parseArgs` rather than a CLI framework: the surface is six
 * commands and three flags, which the platform already covers
 * (technical-design.md §4.7).
 */

import { parseArgs } from "node:util";
import type { BatchRunOptions, RunOptions, StageId } from "../types/pipeline.js";
import { DEFAULT_BATCH_OPTIONS, DEFAULT_RUN_OPTIONS } from "../types/pipeline.js";
import { isCalendarDate } from "../utils/date.js";
import { errorMessage, NamedError } from "../utils/errors.js";
import { isStageId, unknownStageMessage } from "../utils/stage-id.js";

/**
 * Thrown when a command line cannot be understood: an unknown command or option,
 * a missing or malformed argument, or a flag value outside its permitted range.
 * Distinguished from a runtime failure so the CLI can answer with usage rather
 * than a stack trace (technical-design.md §8).
 */
export class CliUsageError extends NamedError {}

/**
 * A parsed, validated invocation. Discriminated on `command` so each variant
 * carries exactly the arguments that command takes and no others
 * (technical-design.md §4.7).
 */
export type CliCommand =
	| { readonly command: "run"; readonly lectureDate: string; readonly options: RunOptions }
	| {
			readonly command: "batch";
			/** The single module to process, or `null` for every configured module. */
			readonly moduleRoot: string | null;
			readonly options: BatchRunOptions;
	  }
	| {
			readonly command: "cost-report";
			/** Narrows the report to one date, or `null` for every lecture. */
			readonly lectureDate: string | null;
			/** Narrows the report to one module, or `null` for every configured module. */
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

/** The flags every command draws from; each command consumes the ones it documents. */
const OPTION_SPEC = {
	"from-stage": { type: "string" },
	concurrency: { type: "string" },
	"continue-on-error": { type: "boolean" },
	date: { type: "string" },
	module: { type: "string" },
	help: { type: "boolean", short: "h" },
} as const;

/** The parsed flag values, before per-command validation. */
type ParsedFlags = {
	readonly "from-stage"?: string;
	readonly concurrency?: string;
	readonly "continue-on-error"?: boolean;
	readonly date?: string;
	readonly module?: string;
	readonly help?: boolean;
};

/** The flag names a command can declare, matching the keys of {@link OPTION_SPEC}. */
type FlagName = Exclude<keyof ParsedFlags, "help">;

/** How one flag is written on a usage line, and what it does. */
type FlagSpec = {
	/** The flag with its argument, as a usage line and the options list both write it. */
	readonly form: string;
	/** The one-line description in the usage text's options list. */
	readonly summary: string;
};

/**
 * Every flag the CLI offers, described once.
 *
 * Both halves of the usage text are rendered from this: a command's usage line
 * names the flags that command declares, and the options list explains each of
 * them. Written out at each of those, `--module` was `<moduleRoot>` on one line
 * and `<path>` on the other.
 */
const FLAG_SPECS: Readonly<Record<FlagName, FlagSpec>> = {
	"from-stage": {
		form: "--from-stage <stage>",
		summary: "Re-run from this stage, discarding it and everything downstream.",
	},
	concurrency: {
		form: "--concurrency <n>",
		summary: "Process n lectures at once (batch only). Defaults to 1.",
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
 * Returns a validated lecture date, or fails with the command's usage line.
 *
 * @param args - The value and the context to report it in.
 * @param args.value - The candidate date, or `undefined` when it was omitted.
 * @param args.usage - The command's usage line, shown when the date is unusable.
 * @returns The validated `YYYY-MM-DD` date.
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
 * Returns the new title a `rename` was given, or fails with its usage line.
 *
 * @param args - The invocation to read it from.
 * @param args.positionals - The command's positional arguments.
 * @param args.usage - The command's usage line, shown when no title was given.
 * @returns The trimmed title.
 * @throws {CliUsageError} When the title is missing or is only whitespace.
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
 * Fails when a command was given more positional arguments than it takes.
 *
 * @param args - The positionals and the limit for this command.
 * @param args.positionals - The command's positional arguments.
 * @param args.limit - How many the command accepts.
 * @param args.usage - The command's usage line, shown when the limit is exceeded.
 * @returns Nothing.
 * @throws {CliUsageError} When more positionals were supplied than the command takes.
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
 * Validates `--from-stage` against the stages that actually exist.
 *
 * @param value - The flag's value, or `undefined` when it was not given.
 * @returns The stage id, or `undefined` when the flag was absent.
 * @throws {CliUsageError} When the value names no known stage.
 */
function parseFromStage(value: string | undefined): StageId | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!isStageId(value)) {
		throw new CliUsageError(unknownStageMessage({ subject: `--from-stage "${value}"` }));
	}
	return value;
}

/**
 * Validates `--concurrency` as a whole number of lectures to process at once.
 *
 * @param value - The flag's value, or `undefined` when it was not given.
 * @returns The concurrency, or `undefined` when the flag was absent.
 * @throws {CliUsageError} When the value is not a positive whole number.
 */
function parseConcurrency(value: string | undefined): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new CliUsageError(`--concurrency must be a whole number of 1 or more, not "${value}"`);
	}
	return parsed;
}

/**
 * Collects the run flags a `run` invocation carried, resolving each against the
 * default it falls back to so the options say what will happen rather than what
 * was typed.
 *
 * @param flags - The parsed flag values.
 * @returns The options for one lecture's run.
 * @throws {CliUsageError} When `--from-stage` is invalid.
 */
function toRunOptions(flags: ParsedFlags): RunOptions {
	const fromStage = parseFromStage(flags["from-stage"]);
	return {
		...(fromStage === undefined ? {} : { fromStage }),
		onStageFailure:
			flags["continue-on-error"] === true ? "continue" : DEFAULT_RUN_OPTIONS.onStageFailure,
	};
}

/**
 * The same, for a `batch` invocation, which additionally says how many lectures
 * run at once.
 *
 * @param flags - The parsed flag values.
 * @returns The options for a batch run.
 * @throws {CliUsageError} When `--from-stage` or `--concurrency` is invalid.
 */
function toBatchOptions(flags: ParsedFlags): BatchRunOptions {
	return {
		...toRunOptions(flags),
		concurrency: parseConcurrency(flags.concurrency) ?? DEFAULT_BATCH_OPTIONS.concurrency,
	};
}

/**
 * Splits the command line into its command word, remaining positionals, and
 * flags, translating `parseArgs`'s own complaints into usage errors.
 *
 * @param argv - The arguments after the program name.
 * @returns The parsed positionals and flags.
 * @throws {CliUsageError} When an option is unknown or is missing its value.
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

/** What a command's builder is handed, once the invocation has passed its spec. */
type CommandInput = {
	/** The positional arguments that followed the command word. */
	readonly positionals: readonly string[];
	/** The parsed flag values. */
	readonly flags: ParsedFlags;
	/** The command's invocation form, quoted back when an argument does not fit. */
	readonly usage: string;
	/**
	 * The lecture date the command addresses, from its first positional. Taken on
	 * demand rather than supplied, because `batch` and `cost-report` address no one
	 * lecture and would fail on a date they never asked for.
	 */
	readonly lectureDate: () => string;
};

/** What a command looks like: how it is written, what it accepts, and what it builds. */
type CommandSpec = {
	/** The positional arguments, as they follow the command word on a usage line. */
	readonly positionals: string;
	/** How many positional arguments the command accepts. */
	readonly maxPositionals: number;
	/** The flags this command acts on; any other is a usage error rather than a silent no-op. */
	readonly flags: readonly FlagName[];
	/** The one-line description in the usage text's command list. */
	readonly summary: string;
	/** Builds the parsed command from an invocation already checked against this spec. */
	readonly build: (input: CommandInput) => CliCommand;
};

/**
 * Every command the CLI offers, described once.
 *
 * The usage text is rendered from this and so is each command's own usage line,
 * and `build` is what the parser dispatches to — so a command is written down in
 * one place rather than in a usage line, a spec, and a cascade of command words
 * that nothing cross-checked against either.
 */
const COMMAND_SPECS: Readonly<Record<string, CommandSpec>> = {
	run: {
		positionals: "<date>",
		maxPositionals: 1,
		flags: ["from-stage", "continue-on-error"],
		summary: "Run one lecture, identified by its date (YYYY-MM-DD), through the pipeline.",
		build: (input) => ({
			command: "run",
			lectureDate: input.lectureDate(),
			options: toRunOptions(input.flags),
		}),
	},
	batch: {
		positionals: "[<moduleRoot>]",
		maxPositionals: 1,
		flags: ["concurrency", "from-stage", "continue-on-error"],
		summary: "Run every lecture in one module, or in every configured module.",
		build: (input) => ({
			command: "batch",
			moduleRoot: input.positionals[0] ?? null,
			options: toBatchOptions(input.flags),
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
 * How a command is written out in full: the command word, whatever positional
 * arguments it takes, then each flag it declares.
 *
 * @param args - The command to write out.
 * @param args.command - The command word.
 * @param args.spec - Its specification.
 * @returns The invocation form, without the program name.
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

/** Spaces between the widest label in a usage-text list and the descriptions. */
const LABEL_GAP = 3;

/**
 * One list in the usage text: a label per line with its description, indented
 * and padded so the descriptions line up under each other.
 *
 * @param entries - The labels and what each of them means.
 * @returns The rendered lines.
 */
function describedLines(
	entries: readonly { readonly label: string; readonly summary: string }[],
): string {
	const width = Math.max(...entries.map((entry) => entry.label.length)) + LABEL_GAP;
	return entries.map((entry) => `  ${entry.label.padEnd(width)}${entry.summary}`).join("\n");
}

/** The usage text printed for `--help` and after any usage error. */
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
 * Fails when a command was given a flag it does not act on.
 *
 * The flags are declared once for the whole CLI, so `parseArgs` accepts any of
 * them after any command. Without this check the surplus ones would be parsed
 * and then quietly ignored — `run --concurrency 4` would run one lecture and say
 * nothing about the request to run four.
 *
 * @param args - The invocation to check.
 * @param args.command - The command word.
 * @param args.flags - The parsed flag values.
 * @param args.spec - The command's specification.
 * @param args.usage - The command's invocation form, quoted back with the complaint.
 * @returns Nothing.
 * @throws {CliUsageError} When a flag outside the command's own set was supplied.
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
 * Checks an invocation against its command's spec and hands it to that command
 * to build.
 *
 * @param args - The command and the rest of the invocation.
 * @param args.command - The command word.
 * @param args.spec - The command's specification, already looked up.
 * @param args.positionals - The positional arguments that followed the command word.
 * @param args.flags - The parsed flag values.
 * @returns The parsed command.
 * @throws {CliUsageError} When the command's arguments are missing, surplus, or malformed.
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
 * Parses a command line into the command it invokes.
 *
 * An empty command line, `--help`, or `-h` anywhere in it asks for usage; every
 * other invocation is validated in full — the command must exist, its positional
 * arguments must be present and well formed, and every flag value must be within
 * range — so a command reaching the dispatcher is already known to be sound.
 *
 * @param args - The invocation to parse.
 * @param args.argv - The arguments following the program name (`process.argv.slice(2)`).
 * @returns The parsed command.
 * @throws {CliUsageError} When the invocation cannot be understood.
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
	const spec = command === undefined ? undefined : COMMAND_SPECS[command];
	if (command === undefined || spec === undefined) {
		throw new CliUsageError(
			`Unknown command "${command ?? ""}". Commands are: ${Object.keys(COMMAND_SPECS).join(", ")}`,
		);
	}
	return buildCommand({ command, spec, positionals: rest, flags });
}
