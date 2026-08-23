import OpenAI from "openai";
import type { Logger } from "pino";
import {
	CONFIG_FILENAME,
	type CostResolution,
	type PipelineConfig,
	type StageConfig,
	type StageCost,
	type StageId,
} from "../types/pipeline.js";
import { NamedError } from "../utils/errors.js";
import { isRecord } from "../utils/record.js";
import { configuredStage, unconfiguredStageMessage } from "../utils/stage-config.js";

const OPENROUTER_APP_TITLE = "Lecture Notes Pipeline";
const CONTEXT_LENGTH_CODE = "context_length_exceeded";

/**
 * OpenRouter's endpoints, relative to the configured base URL.
 *
 * Stated once because three parties address them: this module (`generation`),
 * the config loader's model-ID check (`models`), and the tests that intercept
 * all three. `completions` is the SDK's own path — the pipeline never builds it
 * — and is named here only so a test mocking the call does not have to know it
 * independently of the code under test.
 */
export const OPENROUTER_PATHS = {
	completions: "/chat/completions",
	generation: "/generation",
	models: "/models",
} as const;

/**
 * The environment variable the OpenRouter key is read from, named for the same
 * reason the routes above are: a suite that stubs it names the variable this
 * module reads rather than its own copy. The key itself never leaves the
 * environment (§2, Environment Variables).
 */
export const API_KEY_VARIABLE = "OPENROUTER_API_KEY";

/** Where OpenRouter is and how patiently to wait on it, all from config (§6). */
type OpenRouterSettings = PipelineConfig["openRouter"];

/**
 * Thrown when a completion is rejected because the prompt exceeds the model's
 * context window. Surfaced as a distinct type so the runner can advise switching
 * to a larger-context model rather than treating it as a generic failure
 * (technical-design.md §8).
 */
export class ContextLengthError extends NamedError {}

/**
 * The shape a caller expects the model's reply to take. Stated on every call
 * rather than defaulted, so a caller always declares what it is about to parse
 * (technical-design.md §6).
 */
export type CompletionResponseFormat = "text" | "json";

/**
 * OpenRouter's own routing controls, which ride alongside the OpenAI-compatible
 * request body. The SDK's parameter type has no knowledge of `provider`, so the
 * extension is declared here rather than cast away at the call site.
 */
type OpenRouterRouting = {
	readonly provider: { readonly require_parameters: true };
};

/** The request fields that put a call into JSON mode and keep it there. */
type JsonModeFields = OpenRouterRouting & {
	readonly response_format: { readonly type: "json_object" };
};

/**
 * The request fields carrying the caller's expected response shape.
 *
 * JSON mode travels with `require_parameters` because OpenRouter honours
 * `response_format` per endpoint: without it, a model whose providers cannot
 * produce JSON is still called and the parameter is silently dropped, so the
 * stage pays for a call and receives prose. Requiring it turns that into a
 * routing failure, which names the real problem (technical-design.md §6).
 *
 * @param responseFormat - The shape the caller expects back.
 * @returns The fields to merge into the request body; none, for a text call.
 */
function responseFormatFields(
	responseFormat: CompletionResponseFormat,
): JsonModeFields | Record<string, never> {
	if (responseFormat === "text") {
		return {};
	}
	return {
		response_format: { type: "json_object" },
		provider: { require_parameters: true },
	};
}

// One client is reused across calls, remembering the settings it was built from
// so a differently configured run is never served a client pointed elsewhere or
// waiting to the wrong budget. Tests inject their own client instead.
let sharedClient: { readonly key: string; readonly client: OpenAI } | null = null;

/**
 * Builds an OpenAI SDK client pointed at OpenRouter, with the app title header
 * and the address, timeout, and retry budget the configuration asks for
 * (technical-design.md §6). The API key is read from `OPENROUTER_API_KEY` — the
 * one OpenRouter value that is a secret, and so the one that is not config.
 *
 * @param args - The client's settings.
 * @param args.openRouter - The validated `openRouter` config section.
 * @returns A configured OpenAI client targeting OpenRouter.
 */
export function createOpenRouterClient({
	openRouter,
}: {
	readonly openRouter: OpenRouterSettings;
}): OpenAI {
	return new OpenAI({
		apiKey: process.env[API_KEY_VARIABLE],
		baseURL: openRouter.baseUrl,
		defaultHeaders: { "X-Title": OPENROUTER_APP_TITLE },
		maxRetries: openRouter.completionMaxRetries,
		timeout: openRouter.completionTimeoutMs,
	});
}

function getSharedClient(openRouter: OpenRouterSettings): OpenAI {
	const key = JSON.stringify(openRouter);
	if (sharedClient === null || sharedClient.key !== key) {
		sharedClient = { key, client: createOpenRouterClient({ openRouter }) };
	}
	return sharedClient.client;
}

function stageConfigFor(options: {
	readonly config: PipelineConfig;
	readonly stageId: StageId;
}): StageConfig {
	const stageConfig = configuredStage(options);
	if (stageConfig === null) {
		throw new Error(unconfiguredStageMessage(options));
	}
	return stageConfig;
}

/**
 * Renders a rejected completion as an error that names the model and the stage.
 *
 * Every SDK failure arrives as an `APIError` carrying the provider's own words
 * and nothing else, so the model that was called has to be added here — it is
 * the fact the reader needs to act, whether the model is unavailable, refuses
 * the request, or is unreachable (technical-design.md §8). Context length keeps
 * its own type on top of that, because it has a specific remedy.
 *
 * @param options - The failure and what was being attempted.
 * @param options.error - The caught value.
 * @param options.stageId - The stage the call was made for.
 * @param options.modelId - The model the stage is configured to use.
 * @returns The error to throw, or `null` when the failure did not come from the API.
 */
function toCompletionError(options: {
	readonly error: unknown;
	readonly stageId: StageId;
	readonly modelId: string;
}): Error | null {
	if (!(options.error instanceof OpenAI.APIError)) {
		return null;
	}
	if (options.error.code === CONTEXT_LENGTH_CODE) {
		return new ContextLengthError(
			`Model "${options.modelId}" rejected the request: context length exceeded. Configure a larger-context model for this stage in ${CONFIG_FILENAME}.`,
		);
	}
	return new Error(
		`Model "${options.modelId}" rejected the request for stage "${options.stageId}": ${options.error.message}`,
	);
}

// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- the OpenAI client and message-param types are library types that are not deeply readonly (CLAUDE.md permits dropping readonly when a library requires mutable types)
async function createCompletion(options: {
	readonly client: OpenAI;
	readonly stageId: StageId;
	readonly stageConfig: StageConfig;
	readonly messages: readonly OpenAI.Chat.Completions.ChatCompletionMessageParam[];
	readonly responseFormat: CompletionResponseFormat;
}): Promise<OpenAI.Chat.Completions.ChatCompletion> {
	// Annotated in two steps so the SDK still type-checks the fields it owns, while
	// the assembled body's type openly carries OpenRouter's `provider` extension —
	// spreading straight into an SDK-typed literal would hide it from both.
	const openAiFields: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
		model: options.stageConfig.modelId,
		messages: [...options.messages],
		temperature: options.stageConfig.temperature,
		max_tokens: options.stageConfig.maxTokens,
	};
	const body = { ...openAiFields, ...responseFormatFields(options.responseFormat) };
	try {
		return await options.client.chat.completions.create(body);
	} catch (error: unknown) {
		const completionError = toCompletionError({
			error,
			stageId: options.stageId,
			modelId: options.stageConfig.modelId,
		});
		if (completionError !== null) {
			throw completionError;
		}
		throw error;
	}
}

/** The one field the pipeline reads from a `/generation` reply. */
type GenerationCostReply = { readonly data: { readonly total_cost: number } };

/**
 * Whether a `/generation` reply carries a usable cost.
 *
 * Worth checking rather than trusting: a reply that omits `total_cost`, or sends
 * it as a string, would otherwise be read as a `number` that is nothing of the
 * kind and recorded as this stage's cost (technical-design.md §7).
 *
 * @param value - The parsed reply body.
 * @returns `true` when the body carries a numeric `data.total_cost`.
 */
function isGenerationCostReply(value: unknown): value is GenerationCostReply {
	if (!isRecord(value)) {
		return false;
	}
	const { data } = value;
	return isRecord(data) && typeof data.total_cost === "number";
}

// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- the OpenAI client is a library type that is not deeply readonly (CLAUDE.md permits dropping readonly when a library requires mutable types)
async function lookupCost(options: {
	readonly client: OpenAI;
	readonly generationId: string;
	readonly openRouter: OpenRouterSettings;
}): Promise<CostResolution> {
	try {
		const body: unknown = await options.client.get(OPENROUTER_PATHS.generation, {
			// eslint-disable-next-line id-length -- "id" is OpenRouter's generation-endpoint query parameter name
			query: { id: options.generationId },
			timeout: options.openRouter.costLookupTimeoutMs,
			maxRetries: options.openRouter.costLookupMaxRetries,
		});
		if (!isGenerationCostReply(body)) {
			return {
				costUsd: null,
				costResolutionError: "Cost lookup returned no numeric data.total_cost",
			};
		}
		return { costUsd: body.data.total_cost };
	} catch (error: unknown) {
		return { costUsd: null, costResolutionError: `Cost lookup failed: ${String(error)}` };
	}
}

/**
 * Runs one chat completion for the named stage and returns its text alongside a
 * fully-resolved {@link StageCost}. Token counts are captured from the completion
 * response; the dollar cost is fetched from OpenRouter's generation endpoint and
 * awaited before this promise settles, so the caller never observes a stage as
 * complete while a cost lookup is still outstanding. A failed cost lookup does
 * not fail the call — it yields `costUsd: null` with a `costResolutionError`
 * (technical-design.md §6, §7).
 *
 * @param options - Call options.
 * @param options.messages - The chat messages to send.
 * @param options.stageId - The pipeline stage whose model and parameters to use.
 * @param options.config - The validated pipeline config supplying the stage's model settings.
 * @param options.responseFormat - The reply shape expected; `"json"` also restricts routing to
 *   providers that honour it, and obliges the caller to ask for JSON in its messages too (§6).
 * @param options.logger - The calling stage's logger, already bound to it by the stage factory;
 *   the call is recorded on it at `debug` (§10).
 * @param options.client - An OpenAI client to use; defaults to the shared OpenRouter client.
 * @returns The completion text and its resolved cost.
 * @throws {ContextLengthError} If the prompt exceeds the model's context window.
 * @throws {Error} If the API rejects the call for any other reason, or the model returns no choices;
 *   either way the message names the model and the stage (§8).
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- the OpenAI client, message-param and pino Logger types are library types that are not deeply readonly (CLAUDE.md permits dropping readonly when a library requires mutable types)
export async function makeCompletionCall(options: {
	readonly messages: readonly OpenAI.Chat.Completions.ChatCompletionMessageParam[];
	readonly stageId: StageId;
	readonly config: PipelineConfig;
	readonly responseFormat: CompletionResponseFormat;
	readonly logger: Logger;
	readonly client?: OpenAI;
}): Promise<{ readonly content: string; readonly cost: StageCost }> {
	const stageConfig = stageConfigFor({ config: options.config, stageId: options.stageId });
	const { openRouter } = options.config;
	const client = options.client ?? getSharedClient(openRouter);
	// Measured here rather than handed back for the caller to log: the latency of
	// the call is only observable from inside it (§10).
	const startedAt = performance.now();
	const response = await createCompletion({
		client,
		stageId: options.stageId,
		stageConfig,
		messages: options.messages,
		responseFormat: options.responseFormat,
	});
	const latencyMs = Math.round(performance.now() - startedAt);
	const usage = response.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
	options.logger.debug(
		{ model: stageConfig.modelId, promptTokens: usage.prompt_tokens, latencyMs },
		"Completion call",
	);
	// A provider can reply with no choices at all — content filtering, or an
	// upstream error the SDK does not raise. Reading choices[0] blindly turns that
	// into a TypeError naming nothing; failing here names the stage and the model.
	// Empty content is a different matter and stays tolerated as "" below.
	const [choice] = response.choices;
	if (choice === undefined) {
		throw new Error(
			`Model "${stageConfig.modelId}" returned no choices for stage "${options.stageId}"`,
		);
	}
	const content = choice.message.content ?? "";
	const costResolution = await lookupCost({ client, generationId: response.id, openRouter });
	return {
		content,
		cost: {
			promptTokens: usage.prompt_tokens,
			completionTokens: usage.completion_tokens,
			callCount: 1,
			...costResolution,
		},
	};
}
