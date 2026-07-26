import OpenAI from "openai";
import type { PipelineConfig, StageConfig, StageCost, StageId } from "../types/pipeline.js";
import { NamedError } from "../utils/errors.js";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
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

/** A resolved cost, or a null cost carrying the reason the lookup failed. */
type CostResolution =
	| { readonly totalCostUsd: number }
	| { readonly totalCostUsd: null; readonly costResolutionError: string };

// The client config never varies within a process, so a single instance is
// reused across calls; tests inject their own client instead.
let sharedClient: OpenAI | null = null;

/**
 * Builds an OpenAI SDK client pointed at OpenRouter, with the app title header,
 * completion timeout, and retry budget the pipeline requires
 * (technical-design.md §6). The API key is read from `OPENROUTER_API_KEY`.
 *
 * @returns A configured OpenAI client targeting OpenRouter.
 */
export function createOpenRouterClient(): OpenAI {
	return new OpenAI({
		apiKey: process.env.OPENROUTER_API_KEY,
		baseURL: OPENROUTER_BASE_URL,
		defaultHeaders: { "X-Title": OPENROUTER_APP_TITLE },
		maxRetries: COMPLETION_MAX_RETRIES,
		timeout: COMPLETION_TIMEOUT_MS,
	});
}

function getSharedClient(): OpenAI {
	if (sharedClient === null) {
		sharedClient = createOpenRouterClient();
	}
	return sharedClient;
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
}): Promise<OpenAI.Chat.Completions.ChatCompletion> {
	try {
		return await options.client.chat.completions.create({
			model: options.stageConfig.modelId,
			messages: [...options.messages],
			temperature: options.stageConfig.temperature,
			max_tokens: options.stageConfig.maxTokens,
		});
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
 * @param options.client - An OpenAI client to use; defaults to the shared OpenRouter client.
 * @returns The completion text and its resolved cost.
 * @throws {ContextLengthError} If the prompt exceeds the model's context window.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- the OpenAI client and message-param types are library types that are not deeply readonly (CLAUDE.md permits dropping readonly when a library requires mutable types)
export async function makeCompletionCall(options: {
	readonly messages: readonly OpenAI.Chat.Completions.ChatCompletionMessageParam[];
	readonly stageId: StageId;
	readonly config: PipelineConfig;
	readonly client?: OpenAI;
}): Promise<{ readonly content: string; readonly cost: StageCost }> {
	const stageConfig = stageConfigFor({ config: options.config, stageId: options.stageId });
	const client = options.client ?? getSharedClient();
	const response = await createCompletion({ client, stageConfig, messages: options.messages });
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
