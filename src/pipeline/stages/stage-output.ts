/**
 * The writer of a division and its stage record. `choose-division` and
 * `retitle-subtopics` use it, because the output of each is a division
 * (technical-design.md §5, "Dividing the transcript").
 */

import type { StageContext, StageCost, StageResult } from "../../types/pipeline.js";
import type { StageWithStageRecord } from "../layout.js";
import type { Subtopic } from "./division.js";
import { writeStageOutputWithStageRecord } from "./pipeline-stage.js";

/** The output of a stage whose output is a division: the subtopics, in order. */
export type DivisionOutput = { readonly subtopics: readonly Subtopic[] };

/**
 * Writes a division as the output of a stage, with its stage record beside it,
 * and gives the stage result.
 *
 * @param args - The stage, the division, its stage record, and the cost.
 * @param args.stageId - The stage. It must keep a stage record.
 * @param args.context - The stage context of the current lecture.
 * @param args.subtopics - The subtopics of the division, in order.
 * @param args.stageRecord - The stage record: how the stage reached the division, written as JSON.
 * @param args.cost - The cost of the stage's calls, or `null` when it made none.
 * @returns The stage result: the division, its cost, and both files written.
 */
export async function writeDivisionWithStageRecord({
	stageId,
	context,
	subtopics,
	stageRecord,
	cost,
}: {
	readonly stageId: StageWithStageRecord;
	readonly context: StageContext;
	readonly subtopics: readonly Subtopic[];
	readonly stageRecord: unknown;
	readonly cost: StageCost | null;
}): Promise<StageResult<DivisionOutput>> {
	const { filesWritten } = await writeStageOutputWithStageRecord({
		stageId,
		workspaceRoot: context.workspaceRoot,
		value: subtopics,
		stageRecord,
	});
	return { output: { subtopics }, cost, filesWritten };
}
