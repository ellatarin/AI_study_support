import { destination, type Logger, pino } from "pino";
import type { StageId } from "../types/pipeline.js";

/**
 * Creates the root logger for a single pipeline invocation, writing structured
 * output as newline-delimited JSON to the given file. The destination is
 * asynchronous (`sync: false`) and file-only, so debug output never reaches
 * stdout or stderr and cannot interfere with the cli-progress bars
 * (technical-design.md §10).
 *
 * The whole path is taken from the caller rather than assembled here. Every
 * directory and filename the pipeline uses is declared in its layout module
 * (technical-design.md §3.3), and a utility should not reach up into the
 * pipeline to read one — nor name a file of its own that nothing else can find.
 *
 * @param args - Where the invocation's debug output goes.
 * @param args.logFile - Absolute path to write the debug log at; its directory is created.
 * @returns A pino logger writing at `debug` level to that file.
 * @example
 * const logger = createRootLogger({ logFile: debugLogPath({ projectRoot, runId }) });
 */
export function createRootLogger({ logFile }: { readonly logFile: string }): Logger {
	return pino({ level: "debug" }, destination({ dest: logFile, sync: false, mkdir: true }));
}

/**
 * Derives a per-stage child logger that stamps `{ stage }` onto every entry, so
 * stage context is attached automatically without each call site repeating it
 * (technical-design.md §10).
 *
 * @param args - The child-logger inputs.
 * @param args.logger - The root logger to derive from.
 * @param args.stageId - The stage the child logs for.
 * @returns A child logger bound to the given stage.
 * @example
 * const stageLogger = createStageLogger({ logger, stageId: "transcription" });
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger carries mutable properties (`level` among them) that a wrapper type cannot remove without losing `child`; it is only read from here (CLAUDE.md permits dropping readonly where a library requires a mutable type)
export function createStageLogger({
	logger,
	stageId,
}: {
	readonly logger: Logger;
	readonly stageId: StageId;
}): Logger {
	return logger.child({ stage: stageId });
}
