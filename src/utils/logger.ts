import { join } from "node:path";
import { destination, type Logger, pino } from "pino";
import type { StageId } from "../types/pipeline.js";

/**
 * Creates the root logger for a single pipeline invocation. All structured
 * output is written as newline-delimited JSON to `runs/<runTimestamp>-debug.log`,
 * alongside the run log that shares the same timestamp. The destination is
 * asynchronous (`sync: false`) and file-only, so debug output never reaches
 * stdout or stderr and cannot interfere with the cli-progress bars
 * (technical-design.md §10).
 *
 * @param args - The invocation identity.
 * @param args.runTimestamp - The run timestamp; names the log file and is shared with the run log.
 * @returns A pino logger writing at `debug` level to the run's debug log file.
 * @example
 * const logger = createRootLogger({ runTimestamp: "2025-10-10T09-00-00-000Z" });
 */
export function createRootLogger({ runTimestamp }: { readonly runTimestamp: string }): Logger {
	const debugLog = destination({
		dest: join("runs", `${runTimestamp}-debug.log`),
		sync: false,
		mkdir: true,
	});
	return pino({ level: "debug" }, debugLog);
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
export function createStageLogger({
	logger,
	stageId,
}: {
	readonly logger: Logger;
	readonly stageId: StageId;
}): Logger {
	return logger.child({ stage: stageId });
}
