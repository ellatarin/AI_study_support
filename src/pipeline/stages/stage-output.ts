/**
 * Writing a division a stage produced, with the record beside it of how the
 * stage reached it. Shared by `choose-division` and `retitle-subtopics`, whose
 * output is each a division (technical-design.md §5, "Dividing the transcript").
 */

import type { StageContext, StageCost, StageResult } from "../../types/pipeline.js";
import type { StageWithRecord } from "../layout.js";
import type { Subtopic } from "./division.js";
import { writeStageOutputWithRecord } from "./pipeline-stage.js";

/** What a stage whose output is a division hands on: the division's subtopics, in order. */
export type DivisionOutput = { readonly subtopics: readonly Subtopic[] };

/**
 * Writes a division as the stage's output and its record beside it, and gives
 * the stage's result.
 *
 * @param args - The stage, the division, how it was reached, and what reaching it cost.
 * @param args.stageId - The stage whose output this is; only a stage that keeps a record.
 * @param args.context - The current lecture run context.
 * @param args.subtopics - The division's subtopics, in order.
 * @param args.record - How the stage reached the division, written as JSON.
 * @param args.cost - What the stage's calls cost, or `null` when it made none.
 * @returns The stage's result: the division, its cost, and both files written.
 */
export async function writeDivisionWithRecord({
	stageId,
	context,
	subtopics,
	record,
	cost,
}: {
	readonly stageId: StageWithRecord;
	readonly context: StageContext;
	readonly subtopics: readonly Subtopic[];
	readonly record: unknown;
	readonly cost: StageCost | null;
}): Promise<StageResult<DivisionOutput>> {
	const { filesWritten } = await writeStageOutputWithRecord({
		stageId,
		workspaceRoot: context.workspaceRoot,
		value: subtopics,
		record,
	});
	return { output: { subtopics }, cost, filesWritten };
}
