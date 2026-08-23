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

/** The usage text printed for `--help` and after any usage error. */
export const USAGE = `lecture-notes — turn lecture recordings and slides into study notes

Usage:
  lecture-notes run <date> [--from-stage <stage>] [--continue-on-error]
  lecture-notes batch [<moduleRoot>] [--concurrency <n>] [--from-stage <stage>] [--continue-on-error]
  lecture-notes cost-report [--date <YYYY-MM-DD>] [--module <moduleRoot>]
  lecture-notes rename <date> "<new title>"
  lecture-notes delete <date>
  lecture-notes change-date <date> <new date>

Commands:
  run           Run one lecture, identified by its date (YYYY-MM-DD), through the pipeline.
  batch         Run every lecture in one module, or in every configured module.
  cost-report   Report what has been spent, by run and by stage.
  rename        Give a lecture a new title, renaming its files, workspace, and output.
  delete        Remove a lecture and renumber the ones that follow it.
  change-date   Move a lecture to another date and renumber.

Options:
  --from-stage <stage>   Re-run from this stage, discarding it and everything downstream.
  --concurrency <n>      Process n lectures at once (batch only). Defaults to 1.
  --continue-on-error    Carry on to the next stage when one fails, rather than halting.
  --date <date>          Narrow a cost report to one lecture date.
  --module <path>        Narrow a cost report to one module.
  -h, --help             Show this message.

Dates are ISO 8601 (YYYY-MM-DD). A date matching lectures in several modules
prompts for which of them to act on.`;

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

/**
 * Whether text is an ISO `YYYY-MM-DD` date that exists in the calendar, so that
 * `2025-02-30` is rejected as firmly as `yesterday`.
 *
 * @param value - The text to test.
 * @returns `true` when the text names a real date.
 */
function isCalendarDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return false;
	}
	const parsed = new Date(`${value}T00:00:00Z`);
	if (Number.isNaN(parsed.getTime())) {
		return false;
	}
	// A date that exists is echoed back unchanged; 2025-02-30 rolls forward to March.
	return parsed.toISOString().startsWith(value);
}

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
		throw new CliUsageError(unknownStageMessage({ subject: `"${value}"` }));
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

/** The flag names a command can declare, matching the keys of {@link OPTION_SPEC}. */
type FlagName = Exclude<keyof ParsedFlags, "help">;

/** What a command looks like: how it is written, and what it accepts. */
type CommandSpec = {
	/** The usage line, quoted back when the command's arguments do not fit. */
	readonly usage: string;
	/** How many positional arguments the command accepts. */
	readonly maxPositionals: number;
	/** The flags this command acts on; any other is a usage error rather than a silent no-op. */
	readonly flags: readonly FlagName[];
};

const COMMAND_SPECS: Readonly<Record<string, CommandSpec>> = {
	run: {
		usage: "run <date>",
		maxPositionals: 1,
		flags: ["from-stage", "continue-on-error"],
	},
	batch: {
		usage: "batch [<moduleRoot>]",
		maxPositionals: 1,
		flags: ["concurrency", "from-stage", "continue-on-error"],
	},
	"cost-report": {
		usage: "cost-report [--date <YYYY-MM-DD>] [--module <moduleRoot>]",
		maxPositionals: 0,
		flags: ["date", "module"],
	},
	rename: { usage: 'rename <date> "<new title>"', maxPositionals: 2, flags: [] },
	delete: { usage: "delete <date>", maxPositionals: 1, flags: [] },
	"change-date": { usage: "change-date <date> <new date>", maxPositionals: 2, flags: [] },
};

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
 * @returns Nothing.
 * @throws {CliUsageError} When a flag outside the command's own set was supplied.
 */
function rejectForeignFlags({
	command,
	flags,
	spec,
}: {
	readonly command: string;
	readonly flags: ParsedFlags;
	readonly spec: CommandSpec;
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
		`--${foreign[0]} is not an option for ${command}: ${accepted}. Usage: ${spec.usage}`,
	);
}

/**
 * Builds the command for an invocation whose command word is already known to be
 * one the CLI offers.
 *
 * @param args - The command word and the rest of the invocation.
 * @param args.command - The command word.
 * @param args.positionals - The positional arguments that followed it.
 * @param args.flags - The parsed flag values.
 * @returns The parsed command.
 * @throws {CliUsageError} When the command's arguments are missing, surplus, or malformed.
 */
function buildCommand({
	command,
	positionals,
	flags,
}: {
	readonly command: string;
	readonly positionals: readonly string[];
	readonly flags: ParsedFlags;
}): CliCommand {
	const spec = COMMAND_SPECS[command] as CommandSpec;
	const { usage, maxPositionals } = spec;
	rejectExtraPositionals({ positionals, limit: maxPositionals, usage });
	rejectForeignFlags({ command, flags, spec });
	if (command === "batch") {
		return { command, moduleRoot: positionals[0] ?? null, options: toBatchOptions(flags) };
	}
	if (command === "cost-report") {
		return {
			command,
			lectureDate: flags.date === undefined ? null : requireDate({ value: flags.date, usage }),
			moduleRoot: flags.module ?? null,
		};
	}
	// Every remaining command addresses a lecture by date as its first argument.
	const lectureDate = requireDate({ value: positionals[0], usage });
	if (command === "rename") {
		const title = (positionals[1] ?? "").trim();
		if (title === "") {
			throw new CliUsageError(`Expected a new title: ${usage}`);
		}
		return { command, lectureDate, title };
	}
	if (command === "change-date") {
		return {
			command,
			lectureDate,
			newLectureDate: requireDate({ value: positionals[1], usage }),
		};
	}
	if (command === "delete") {
		return { command, lectureDate };
	}
	return { command: "run", lectureDate, options: toRunOptions(flags) };
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
	if (command === undefined || COMMAND_SPECS[command] === undefined) {
		throw new CliUsageError(
			`Unknown command "${command ?? ""}". Commands are: ${Object.keys(COMMAND_SPECS).join(", ")}`,
		);
	}
	return buildCommand({ command, positionals: rest, flags });
}
