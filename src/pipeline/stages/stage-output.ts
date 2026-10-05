/**
 * Writing a division a stage produced, with the stage record beside it of how the
 * stage reached it. Shared by `choose-division` and `retitle-subtopics`, whose
 * output is each a division (technical-design.md §5, "Dividing the transcript").
 */

import type { StageContext, StageCost, StageResult } from "../../types/pipeline.js";
import type { StageWithStageRecord } from "../layout.js";
import type { Subtopic } from "./division.js";
import { writeStageOutputWithStageRecord } from "./pipeline-stage.js";

/** What a stage whose output is a division hands on: the division's subtopics, in order. */
export type DivisionOutput = { readonly subtopics: readonly Subtopic[] };

/**
 * Writes a division as the stage's output and its stage record beside it, and gives
 * the stage's result.
 *
 * @param args - The stage, the division, how it was reached, and what reaching it cost.
 * @param args.stageId - The stage whose output this is; only a stage that keeps a stage record.
 * @param args.context - The current lecture run context.
 * @param args.subtopics - The division's subtopics, in order.
 * @param args.stageRecord - How the stage reached the division, written as JSON.
 * @param args.cost - What the stage's calls cost, or `null` when it made none.
 * @returns The stage's result: the division, its cost, and both files written.
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
