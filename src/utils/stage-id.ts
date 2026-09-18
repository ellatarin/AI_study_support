/**
 * Recognising a string as a pipeline stage, reporting it when it is not, and
 * ordering two stages against the pipeline.
 *
 * Two unrelated surfaces take a stage name from the user and must reject
 * anything else: the CLI's stage flags, and the keys of the config file's
 * `stages` section. Both owe the reader the same list of what they could have
 * named, so the check and the sentence are written once here rather than at each
 * surface (technical-design.md §6). Ordering joins them because it answers a
 * question about the same values from the same declared list.
 */

import type { StageId } from "../types/pipeline.js";
import { STAGE_IDS } from "../types/pipeline.js";

/**
 * Every stage in pipeline order, written out for a message to show the reader.
 *
 * Two messages show the same list — the one reporting a value that names no
 * stage, and the CLI's refusal of two stage flags given out of order — so it is
 * joined once here rather than at each of them.
 */
export const STAGES_IN_ORDER = STAGE_IDS.join(", ");

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
 * Whether one stage runs later in the pipeline than another.
 *
 * Position comes from {@link STAGE_IDS}, the declared pipeline order, so the
 * comparison holds for a stage the pipeline has not yet built — which is what
 * lets `--to-stage` bound a run at a stage no implementation exists for.
 *
 * Two callers ask it of the same pair of stages and must agree: the CLI, which
 * refuses a `--to-stage` that precedes `--from-stage`, and the runner, which
 * stops once a stage lies beyond the bound.
 *
 * @param args - The two stages to compare.
 * @param args.stageId - The stage in question.
 * @param args.other - The stage to compare it against.
 * @returns `true` when `stageId` runs after `other`; `false` when it runs before it or is the same stage.
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
 * Reports that something names no pipeline stage, listing the stages it could
 * have named.
 *
 * @param args - What to report against.
 * @param args.subject - The offending value as it should appear in the message, already quoted and labelled by the caller with the flag or config key it came from.
 * @returns The message.
 * @example
 * unknownStageMessage({ subject: '--from-stage "synthesise"' });
 * // '--from-stage "synthesise" is not a pipeline stage. Stages are: source-normalisation, …'
 */
export function unknownStageMessage(args: { readonly subject: string }): string {
	return `${args.subject} is not a pipeline stage. Stages are: ${STAGES_IN_ORDER}`;
}
