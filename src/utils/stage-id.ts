/**
 * Recognising a string as a pipeline stage, and reporting it when it is not.
 *
 * Two unrelated surfaces take a stage name from the user and must reject
 * anything else: the CLI's `--from-stage` flag, and the keys of the config
 * file's `stages` section. Both owe the reader the same list of what they could
 * have named, so the check and the sentence are written once here rather than at
 * each surface (technical-design.md §6).
 */

import type { StageId } from "../types/pipeline.js";
import { STAGE_IDS } from "../types/pipeline.js";

/**
 * Whether a string names a pipeline stage.
 *
 * A type guard rather than a boolean so a caller that has checked can go on to
 * use the value as a {@link StageId} without asserting it.
 *
 * @param value - The string to test.
 * @returns `true` when the string is one of {@link STAGE_IDS}.
 */
export function isStageId(value: string): value is StageId {
	return (STAGE_IDS as readonly string[]).includes(value);
}

/**
 * Reports that something names no pipeline stage, listing the stages it could
 * have named.
 *
 * @param args - What to report against.
 * @param args.subject - The offending value as it should appear in the message, already quoted or labelled by the caller.
 * @returns The message.
 * @example
 * unknownStageMessage({ subject: '"synthesise"' });
 * // '"synthesise" is not a pipeline stage. Stages are: source-normalisation, …'
 */
export function unknownStageMessage(args: { readonly subject: string }): string {
	return `${args.subject} is not a pipeline stage. Stages are: ${STAGE_IDS.join(", ")}`;
}
