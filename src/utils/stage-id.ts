/**
 * This module checks that a string is a stage id, gives the message when it is
 * not, and compares two stages in pipeline order. The stage flags of the CLI and
 * the keys of the `stages` section in the config file both take a stage id. Both
 * show the same list of stages when a value is wrong (technical-design.md §6).
 */

import type { StageId } from "../types/pipeline.js";
import { STAGE_IDS } from "../types/pipeline.js";

/**
 * Every stage id in pipeline order, as text for a message. The message for a
 * wrong stage id and the CLI message for stage flags in the wrong order both
 * show it.
 */
export const STAGES_IN_ORDER = STAGE_IDS.join(", ");

/**
 * Tells if a string is a stage id.
 *
 * @param value - The string to test.
 * @returns `true` when the string is one of {@link STAGE_IDS}.
 */
export function isStageId(value: string): value is StageId {
	return (STAGE_IDS as readonly string[]).includes(value);
}

/**
 * Tells if one stage comes later in the pipeline than another. The order comes
 * from {@link STAGE_IDS}. So the comparison works for a stage that is not built
 * yet, and `--to-stage` can name such a stage.
 *
 * The CLI refuses a `--to-stage` before the `--from-stage`. The runner stops
 * after the `--to-stage`. Both use this function, so they agree on the order of the stages.
 *
 * @param args - The two stages to compare.
 * @param args.stageId - The stage that must come after `other` for a `true` result.
 * @param args.other - The stage to compare it against.
 * @returns `true` when `stageId` runs after `other`. `false` when `stageId` runs before `other` or is the same stage.
 */
export function isStageAfter({
	stageId,
	other,
}: {
	readonly stageId: StageId;
	readonly other: StageId;
}): boolean {
	return STAGE_IDS.indexOf(stageId) > STAGE_IDS.indexOf(other);
}

/**
 * Gives the message for a value that is not a stage id. The message lists the
 * stages.
 *
 * @param args - The bad value to report.
 * @param args.subject - The bad value, quoted, after the flag or config key that it came from.
 * @returns The message.
 * @example
 * unknownStageMessage({ subject: '--from-stage "synthesise"' });
 * // '--from-stage "synthesise" is not a pipeline stage. Stages are: source-normalisation, …'
 */
export function unknownStageMessage(args: { readonly subject: string }): string {
	return `${args.subject} is not a pipeline stage. Stages are: ${STAGES_IN_ORDER}`;
}
