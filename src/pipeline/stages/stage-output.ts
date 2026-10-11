/**
 * The writer of a division and its stage record. `choose-division` and
 * `retitle-subtopics` use it, because the output of each is a division
 * (technical-design.md §5, "Dividing the transcript").
 */

import type { StageContext, StageResult } from "../../types/pipeline.js";
import type { StageWithStageRecord } from "../layout.js";
import type { Subtopic } from "./division.js";
import { writeStageOutputWithStageRecord } from "./pipeline-stage.js";

/** The output of a stage whose output is a division: the subtopics, in order. */
export type DivisionOutput = { readonly subtopics: readonly Subtopic[] };

/**
 * Writes a division as the output of a stage, with its stage record beside it,
 * and gives the stage result.
 *
 * @param args - The stage, the division and its stage record.
 * @param args.stageId - The stage. It must keep a stage record.
 * @param args.context - The stage context of the current lecture.
 * @param args.subtopics - The subtopics of the division, in order.
 * @param args.stageRecord - The stage record: how the stage reached the division, written as JSON.
 * @returns The stage result: the division and both files written.
 */
export async function writeDivisionWithStageRecord({
	stageId,
	context,
	subtopics,
	stageRecord,
}: {
	readonly stageId: StageWithStageRecord;
	readonly context: StageContext;
	readonly subtopics: readonly Subtopic[];
	readonly stageRecord: unknown;
}): Promise<StageResult<DivisionOutput>> {
	const { filesWritten } = await writeStageOutputWithStageRecord({
		stageId,
		context,
		value: subtopics,
		stageRecord,
	});
	return { output: { subtopics }, filesWritten };
}
