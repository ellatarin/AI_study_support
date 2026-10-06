import { destination, type Logger, pino } from "pino";
import type { StageId } from "../types/pipeline.js";

/**
 * Creates the root logger of one invocation. It writes the debug log as
 * newline-delimited JSON. It writes only to the file, and not in sync. So its
 * output never reaches stdout or stderr, where it could break the progress bars
 * (technical-design.md §10).
 *
 * The caller gives the whole path, because the layout module declares every
 * path and a utility does not import the pipeline (technical-design.md §3.3).
 *
 * @param args - The path of the debug log.
 * @param args.debugLogFile - Absolute path of the debug log. Its directory is created.
 * @returns A pino logger writing at `debug` level to that file.
 * @example
 * const logger = createDebugLogger({ debugLogFile: debugLogPath({ projectRoot, invocationId }) });
 */
export function createDebugLogger({ debugLogFile }: { readonly debugLogFile: string }): Logger {
	return pino({ level: "debug" }, destination({ dest: debugLogFile, sync: false, mkdir: true }));
}

/**
 * Creates a child logger that adds `{ stage }` to each entry (technical-design.md §10).
 *
 * @param args - The root logger and the stage.
 * @param args.logger - The root logger to derive from.
 * @param args.stageId - The stage the child logs for.
 * @returns A child logger bound to the given stage.
 * @example
 * const stageLogger = createStageLogger({ logger, stageId: "transcription" });
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger has mutable properties, such as `level`. A wrapper type that removes them also removes `child`. This function only reads the logger. CLAUDE.md permits a mutable type that a library requires.
export function createStageLogger({
	logger,
	stageId,
}: {
	readonly logger: Logger;
	readonly stageId: StageId;
}): Logger {
	return logger.child({ stage: stageId });
}
