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

/** The model the trials call when `TRIAL_MODEL` is unset. */
export const DEFAULT_MODEL = "google/gemini-3.7-flash";

/** The model a trial calls: `TRIAL_MODEL`, or the default. */
export const MODEL = process.env["TRIAL_MODEL"] ?? DEFAULT_MODEL;

/** Runs on any other model carry it in their name, so they never overwrite or pool with the default model's runs. */
export const MODEL_TAG = MODEL === DEFAULT_MODEL ? "" : `@${MODEL.split("/").pop() ?? MODEL}`;

/** A thinking level other than the model's default, such as "high"; the model's default when unset. */
export const EFFORT = process.env["TRIAL_EFFORT"];

/** Runs made at a set thinking level carry it in their name, so they never overwrite or pool with default-level runs. */
export const EFFORT_TAG = EFFORT === undefined ? "" : `%${EFFORT}`;

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
	/** An error OpenRouter sent in place of choices, serialised; null when there was none. */
	readonly error: string | null;
};

/** The reply an attempt starts from, and what a call that threw leaves behind. */
export const NO_REPLY: TrialReply = {
	content: "",
	promptTokens: null,
	completionTokens: null,
	finishReason: null,
	nativeFinishReason: null,
	provider: null,
	error: null,
};

/**
 * The words a trial records as its verdict on one call. Every run file and
 * report reads them, so each is spelled once here.
 */
export const VERDICT = {
	ok: "OK",
	empty: "EMPTY",
	unparseable: "PARSE-FAIL",
	wrongShape: "SHAPE",
} as const;

/**
 * The verdict for a call that threw, carrying the start of what it threw.
 *
 * @param error - Whatever the call threw.
 * @returns `THREW:` followed by the first 120 characters of the error.
 */
export function threwVerdict(error: unknown): string {
	return `THREW: ${String(error).slice(0, 120)}`;
}

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
 * @param options.reasoningEffort - A thinking level, such as "high"; the model's default when absent.
 * @returns The reply content alongside usage, finish reason and serving provider.
 */
export async function callTrialModel({
	config,
	modelId,
	messages,
	maxTokens,
	reasoningEffort,
}: {
	readonly config: TrialConfig;
	readonly modelId: string;
	readonly messages: readonly TrialMessage[];
	readonly maxTokens?: number | undefined;
	readonly reasoningEffort?: string | undefined;
}): Promise<TrialReply> {
	const client = createOpenRouterClientProvider({ openRouter: config.openRouter })();
	const response = (await client.chat.completions.create({
		model: modelId,
		messages,
		response_format: { type: "json_object" },
		provider: { require_parameters: true },
		...(maxTokens === undefined ? {} : { max_tokens: maxTokens }),
		...(reasoningEffort === undefined ? {} : { reasoning: { effort: reasoningEffort } }),
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
		error: response["error"] === undefined ? null : JSON.stringify(response["error"]),
	};
}
