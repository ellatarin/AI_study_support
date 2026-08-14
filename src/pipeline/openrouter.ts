import OpenAI from "openai";
import type { PipelineConfig, StageConfig, StageCost, StageId } from "../types/pipeline.js";
import { NamedError } from "../utils/errors.js";

const OPENROUTER_APP_TITLE = "Lecture Notes Pipeline";
const GENERATION_PATH = "/generation";
const CONTEXT_LENGTH_CODE = "context_length_exceeded";

const COMPLETION_TIMEOUT_MS = 120_000;
const COMPLETION_MAX_RETRIES = 5;
const COST_LOOKUP_TIMEOUT_MS = 30_000;
const COST_LOOKUP_MAX_RETRIES = 3;

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

/** A resolved cost, or a null cost carrying the reason the lookup failed. */
type CostResolution =
	| { readonly totalCostUsd: number }
	| { readonly totalCostUsd: null; readonly costResolutionError: string };

// One client is reused across calls, remembering the address it was built for so
// a differently configured run is never served a client pointed elsewhere. Tests
// inject their own client instead.
let sharedClient: { readonly baseUrl: string; readonly client: OpenAI } | null = null;

/**
 * Builds an OpenAI SDK client pointed at OpenRouter, with the app title header,
 * completion timeout, and retry budget the pipeline requires
 * (technical-design.md §6). The API key is read from `OPENROUTER_API_KEY`.
 *
 * @param args - The client's address.
 * @param args.baseUrl - The configured OpenRouter base URL; every call is relative to it.
 * @returns A configured OpenAI client targeting OpenRouter.
 */
export function createOpenRouterClient({ baseUrl }: { readonly baseUrl: string }): OpenAI {
	return new OpenAI({
		apiKey: process.env.OPENROUTER_API_KEY,
		baseURL: baseUrl,
		defaultHeaders: { "X-Title": OPENROUTER_APP_TITLE },
		maxRetries: COMPLETION_MAX_RETRIES,
		timeout: COMPLETION_TIMEOUT_MS,
	});
}

function getSharedClient(baseUrl: string): OpenAI {
	if (sharedClient === null || sharedClient.baseUrl !== baseUrl) {
		sharedClient = { baseUrl, client: createOpenRouterClient({ baseUrl }) };
	}
	return sharedClient.client;
}

function stageConfigFor(options: {
	readonly config: PipelineConfig;
	readonly stageId: StageId;
}): StageConfig {
	const stageConfig = options.config.stages[options.stageId];
	if (stageConfig === undefined) {
		throw new Error(
			`No configuration found for stage "${options.stageId}" in pipeline-config.json`,
		);
	}
	return stageConfig;
}

function toContextLengthError(options: {
	readonly error: unknown;
	readonly modelId: string;
}): ContextLengthError | null {
	if (options.error instanceof OpenAI.APIError && options.error.code === CONTEXT_LENGTH_CODE) {
		return new ContextLengthError(
			`Model "${options.modelId}" rejected the request: context length exceeded. Configure a larger-context model for this stage in pipeline-config.json.`,
		);
	}
	return null;
}

// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- the OpenAI client and message-param types are library types that are not deeply readonly (CLAUDE.md permits dropping readonly when a library requires mutable types)
async function createCompletion(options: {
	readonly client: OpenAI;
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
		const contextError = toContextLengthError({ error, modelId: options.stageConfig.modelId });
		if (contextError !== null) {
			throw contextError;
		}
		throw error;
	}
}

// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- the OpenAI client is a library type that is not deeply readonly (CLAUDE.md permits dropping readonly when a library requires mutable types)
async function lookupCost(options: {
	readonly client: OpenAI;
	readonly generationId: string;
}): Promise<CostResolution> {
	try {
		const body = (await options.client.get(GENERATION_PATH, {
			// eslint-disable-next-line id-length -- "id" is OpenRouter's generation-endpoint query parameter name
			query: { id: options.generationId },
			timeout: COST_LOOKUP_TIMEOUT_MS,
			maxRetries: COST_LOOKUP_MAX_RETRIES,
		})) as { readonly data: { readonly total_cost: number } };
		return { totalCostUsd: body.data.total_cost };
	} catch (error: unknown) {
		return { totalCostUsd: null, costResolutionError: `Cost lookup failed: ${String(error)}` };
	}
}

/**
 * Runs one chat completion for the named stage and returns its text alongside a
 * fully-resolved {@link StageCost}. Token counts are captured from the completion
 * response; the dollar cost is fetched from OpenRouter's generation endpoint and
 * awaited before this promise settles, so the caller never observes a stage as
 * complete while a cost lookup is still outstanding. A failed cost lookup does
 * not fail the call — it yields `totalCostUsd: null` with a `costResolutionError`
 * (technical-design.md §6, §7).
 *
 * @param options - Call options.
 * @param options.messages - The chat messages to send.
 * @param options.stageId - The pipeline stage whose model and parameters to use.
 * @param options.config - The validated pipeline config supplying the stage's model settings.
 * @param options.responseFormat - The reply shape expected; `"json"` also restricts routing to
 *   providers that honour it, and obliges the caller to ask for JSON in its messages too (§6).
 * @param options.client - An OpenAI client to use; defaults to the shared OpenRouter client.
 * @returns The completion text and its resolved cost.
 * @throws {ContextLengthError} If the prompt exceeds the model's context window.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- the OpenAI client and message-param types are library types that are not deeply readonly (CLAUDE.md permits dropping readonly when a library requires mutable types)
export async function makeCompletionCall(options: {
	readonly messages: readonly OpenAI.Chat.Completions.ChatCompletionMessageParam[];
	readonly stageId: StageId;
	readonly config: PipelineConfig;
	readonly responseFormat: CompletionResponseFormat;
	readonly client?: OpenAI;
}): Promise<{ readonly content: string; readonly cost: StageCost }> {
	const stageConfig = stageConfigFor({ config: options.config, stageId: options.stageId });
	const client = options.client ?? getSharedClient(options.config.openRouter.baseUrl);
	const response = await createCompletion({
		client,
		stageConfig,
		messages: options.messages,
		responseFormat: options.responseFormat,
	});
	const usage = response.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
	const content = response.choices[0].message.content ?? "";
	const costResolution = await lookupCost({ client, generationId: response.id });
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
