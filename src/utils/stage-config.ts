/**
 * Finding a stage's entry in the configuration, and reporting its absence.
 *
 * Two unrelated callers ask the same question of the config file and act on the
 * same answer: the OpenRouter client, resolving the model and tuning for a
 * completion, and Stage 2, resolving the model to transcribe with. Both must
 * fail when the file configures no such stage, and the remedy is the same edit
 * to the same file — so the lookup and the sentence are written once here rather
 * than at each of them, exactly as `stage-id.ts` does for a stage *name*
 * (technical-design.md §6).
 *
 * The message is separate from the lookup because the two callers raise
 * different errors: a caller keeps its own error type and takes the words.
 */

import type { PipelineConfig, StageConfig, StageId } from "../types/pipeline.js";
import { CONFIG_FILENAME } from "../types/pipeline.js";

/**
 * A stage's configuration, or `null` where the file configures no such stage.
 *
 * @param args - Where to look, and for what.
 * @param args.config - The loaded configuration.
 * @param args.stageId - The stage to look up.
 * @returns The stage's configuration, or `null`.
 */
export function configuredStage({
	config,
	stageId,
}: {
	readonly config: PipelineConfig;
	readonly stageId: StageId;
}): StageConfig | null {
	return config.stages[stageId] ?? null;
}

/**
 * Reports that the configuration holds no entry for a stage, naming the file to
 * edit — which is the whole of the remedy.
 *
 * @param args - What to report.
 * @param args.stageId - The stage the file does not configure.
 * @returns The message.
 * @example
 * unconfiguredStageMessage({ stageId: "synthesis" });
 * // 'No configuration found for stage "synthesis" in pipeline-config.json'
 */
export function unconfiguredStageMessage({ stageId }: { readonly stageId: StageId }): string {
	return `No configuration found for stage "${stageId}" in ${CONFIG_FILENAME}`;
}
