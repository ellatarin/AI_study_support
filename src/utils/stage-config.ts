/**
 * This module finds the configuration of a stage, and gives the message for a
 * stage that has none. The OpenRouter client and `transcription` both fail when
 * the config file does not configure their stage, and the fix is the same edit
 * (technical-design.md §6). The message is apart from the lookup, because each of
 * the two callers throws its own error type.
 */

import type { PipelineConfig, StageConfig, StageId } from "../types/pipeline.js";
import { CONFIG_FILENAME } from "../types/pipeline.js";

/**
 * Finds the configuration of a stage.
 *
 * @param args - The configuration to look in, and the stage to look up.
 * @param args.config - The loaded configuration.
 * @param args.stageId - The stage to look up.
 * @returns The configuration of the stage, or `null` when the config file does not configure it.
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
 * Gives the message for a stage that the config file does not configure. The
 * message names the file to edit.
 *
 * @param args - The stage to report.
 * @param args.stageId - The stage the file does not configure.
 * @returns The message.
 * @example
 * unconfiguredStageMessage({ stageId: "synthesis" });
 * // 'No configuration found for stage "synthesis" in pipeline-config.json'
 */
export function unconfiguredStageMessage({ stageId }: { readonly stageId: StageId }): string {
	return `No configuration found for stage "${stageId}" in ${CONFIG_FILENAME}`;
}
