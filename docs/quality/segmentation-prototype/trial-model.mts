/**
 * The prototype's model call, shared by every trial script.
 *
 * The pipeline's own `makeCompletionCall` hides `finish_reason` and the serving
 * provider, and those are exactly what these trials measure — so the prototype
 * talks to the SDK directly. This module is that call and the borrowed stage
 * configuration it needs, in one place, so a second trial script reuses it
 * rather than restating it.
 */

import "dotenv/config";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseConfig } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/pipeline/config.js";
import { createOpenRouterClientProvider } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/pipeline/openrouter.js";

export const PROJECT_ROOT = "/Users/ellatarin/my_repositories/Ella_AI_project";

/** Runs land beside the harness, so the archive stays self-contained across sessions. */
export const OUT_DIR = join(import.meta.dirname, "runs");

/**
 * The stage whose configuration the trials borrow. Nothing here writes to the
 * pipeline; it is only a source of a valid OpenRouter section and stage shape.
 */
export const BORROWED_STAGE_ID = "transcript-structuring";

export type TrialConfig = ReturnType<typeof parseConfig>;

export type TrialMessage = {
	readonly role: "system" | "user";
	readonly content: string;
};

/** Everything the direct SDK path reveals that the pipeline wrapper swallows. */
export type TrialReply = {
	readonly content: string;
	readonly promptTokens: number | null;
	readonly completionTokens: number | null;
	readonly finishReason: string | null;
	readonly nativeFinishReason: string | null;
	readonly provider: string | null;
};

/**
 * Read the real pipeline config and point one stage at the trial model.
 *
 * @param options - Options object.
 * @param options.modelId - The OpenRouter model id the trial should call.
 * @returns The pipeline config with the borrowed stage repointed at `modelId`.
 * @throws Error when the config has no `transcript-structuring` stage to borrow.
 */
export async function loadTrialConfig({
	modelId,
}: {
	readonly modelId: string;
}): Promise<TrialConfig> {
	const baseConfig = parseConfig(
		JSON.parse(await readFile(join(PROJECT_ROOT, "pipeline-config.json"), "utf8")),
	);
	const borrowed = baseConfig.stages[BORROWED_STAGE_ID];
	if (borrowed === undefined) {
		throw new Error("no transcript-structuring config entry to borrow");
	}
	return {
		...baseConfig,
		stages: {
			...baseConfig.stages,
			[BORROWED_STAGE_ID]: {
				...borrowed,
				modelId,
				maxTokens: undefined,
				temperature: undefined,
			},
		},
	};
}

/**
 * Send messages straight to the SDK and report the whole response.
 *
 * @param options - Options object.
 * @param options.config - The config carrying the OpenRouter credentials.
 * @param options.modelId - The model to call.
 * @param options.messages - The system and user messages, in order.
 * @param options.maxTokens - An explicit output ceiling, when one is being tested.
 * @returns The reply content alongside usage, finish reason and serving provider.
 */
export async function callTrialModel({
	config,
	modelId,
	messages,
	maxTokens,
}: {
	readonly config: TrialConfig;
	readonly modelId: string;
	readonly messages: readonly TrialMessage[];
	readonly maxTokens?: number | undefined;
}): Promise<TrialReply> {
	const client = createOpenRouterClientProvider({ openRouter: config.openRouter })();
	const response = (await client.chat.completions.create({
		model: modelId,
		messages,
		response_format: { type: "json_object" },
		provider: { require_parameters: true },
		...(maxTokens === undefined ? {} : { max_tokens: maxTokens }),
	} as never)) as unknown as Record<string, unknown>;
	const choices = (response["choices"] ?? []) as readonly Record<string, unknown>[];
	const first = choices[0] ?? {};
	const message = (first["message"] ?? {}) as Record<string, unknown>;
	const usage = (response["usage"] ?? {}) as Record<string, unknown>;
	return {
		content: typeof message["content"] === "string" ? message["content"] : "",
		promptTokens: typeof usage["prompt_tokens"] === "number" ? usage["prompt_tokens"] : null,
		completionTokens:
			typeof usage["completion_tokens"] === "number" ? usage["completion_tokens"] : null,
		finishReason: first["finish_reason"] === undefined ? null : String(first["finish_reason"]),
		nativeFinishReason:
			first["native_finish_reason"] === undefined ? null : String(first["native_finish_reason"]),
		provider: response["provider"] === undefined ? null : String(response["provider"]),
	};
}
