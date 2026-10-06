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
import { type FailedSend, sendUntilAccepted } from "../utils/resend.js";
import type { SendGate } from "../utils/send-gate.js";
import { configuredStage, unconfiguredStageMessage } from "../utils/stage-config.js";

const OPENROUTER_APP_TITLE = "Lecture Notes Pipeline";
const CONTEXT_LENGTH_CODE = "context_length_exceeded";

/**
 * OpenRouter's endpoints, relative to the configured base URL. The config
 * loader's model-ID check uses `models`. The pipeline never builds the
 * `completions` path, because the SDK does. The `completions` path is in this
 * map so that a test which intercepts the call takes the path from the code
 * (technical-design.md §6).
 */
export const OPENROUTER_PATHS = {
	completions: "/chat/completions",
	models: "/models",
} as const;

/**
 * The environment variable that holds the OpenRouter key. It is exported so that
 * a test stubs the variable that this module reads (technical-design.md §2,
 * Environment Variables, and §6).
 */
export const API_KEY_VARIABLE = "OPENROUTER_API_KEY";

type OpenRouterSettings = PipelineConfig["openRouter"];

/**
 * The error for a provider report that the prompt is longer than the model's
 * context window. It has its own type because it has its own remedy: configure
 * a model with a larger context window. Its message gives that remedy
 * (technical-design.md §6, §8).
 */
export class ContextLengthError extends NamedError {}

/**
 * The error for a stage that has no entry in the configuration, so there is no
 * model to call. Nothing was sent, and the remedy is an edit to the config file
 * (technical-design.md §6, §8).
 */
export class UnconfiguredStageError extends NamedError {}

/**
 * The error for every provider error that is not a {@link ContextLengthError}.
 * Examples are an unavailable model, a busy provider or an endpoint that cannot
 * be reached (technical-design.md §8).
 */
export class ProviderError extends NamedError {}

/**
 * The error for an accepted reply that has no choices. A choice with empty content is
 * not this error: `callModel` returns it as `""` (technical-design.md §6, §8).
 */
export class NoReplyChoicesError extends NamedError {}

/**
 * The form of the reply that a caller expects. Every call states it, so that a
 * caller always says what it will parse (technical-design.md §6).
 */
export type ReplyFormat = "text" | "json";

/**
 * OpenRouter's own routing field in the request body. The SDK's request type does
 * not have `provider`, so this type declares it, and no cast hides it.
 */
type OpenRouterRouting = {
	readonly provider: { readonly require_parameters: true };
};

type JsonModeFields = OpenRouterRouting & {
	readonly response_format: { readonly type: "json_object" };
};

/**
 * Gives the request fields for the reply format. A JSON call also sends
 * `require_parameters`. Then OpenRouter sends the call only to an endpoint that
 * can give JSON (technical-design.md §6, "JSON mode is routed for").
 *
 * @param responseFormat - The form of the reply that the caller expects.
 * @returns The fields to add to the request body. A text call adds none.
 */
function responseFormatFields(responseFormat: ReplyFormat): JsonModeFields | Record<string, never> {
	if (responseFormat === "text") {
		return {};
	}
	return {
		response_format: { type: "json_object" },
		provider: { require_parameters: true },
	};
}

/**
 * Makes an OpenAI SDK client for OpenRouter. The address, the timeout and the
 * retry limit come from the configuration. The API key comes from the
 * environment, because it is the one secret (technical-design.md §6).
 *
 * @param args - The client's settings.
 * @param args.openRouter - The checked `openRouter` config section.
 * @returns The client.
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

/**
 * Gives the invocation's OpenRouter client, and makes it the first time. It is a
 * function and not a client, because the SDK cannot make a client without the
 * API key. Commands that call no model, such as `delete` and `cost-report`, must
 * run without a key (technical-design.md §6).
 */
export type OpenRouterClient = () => OpenAI;

/**
 * Makes the provider of one invocation's client. The provider makes the client
 * when it is first asked, and then gives the same client each time. The client
 * is kept in the provider and not in the module, so no shared client needs to be
 * cleared (technical-design.md §4.7, §6).
 *
 * @param args - The client's settings.
 * @param args.openRouter - The checked `openRouter` config section.
 * @returns The provider.
 */
export function createOpenRouterClientProvider({
	openRouter,
}: {
	readonly openRouter: OpenRouterSettings;
}): OpenRouterClient {
	let client: OpenAI | null = null;
	return () => {
		client ??= createOpenRouterClient({ openRouter });
		return client;
	};
}

function stageConfigFor(options: {
	readonly config: PipelineConfig;
	readonly stageId: StageId;
}): StageConfig {
	const stageConfig = configuredStage(options);
	if (stageConfig === null) {
		throw new UnconfiguredStageError(unconfiguredStageMessage(options));
	}
	return stageConfig;
}

/**
 * Gives the message of a {@link ProviderError}: the model, the stage and the
 * provider's own words. A provider error comes as a failed request or inside an
 * accepted reply. Both get this one message, because the reader does not need to
 * know which (technical-design.md §8).
 *
 * @param options - The call and the provider's words.
 * @param options.stageId - The stage that made the call.
 * @param options.modelId - The stage's configured model.
 * @param options.providerMessage - The provider's own words about the error.
 * @returns The message.
 */
function providerErrorDescription(options: {
	readonly stageId: StageId;
	readonly modelId: string;
	readonly providerMessage: string;
}): string {
	return `Model "${options.modelId}" returned an error for stage "${options.stageId}": ${options.providerMessage}`;
}

/**
 * Reads the provider error in an accepted reply. OpenRouter can answer with HTTP
 * 200 and a body that holds `{"error": {...}}`. The SDK's type does not show
 * this field, so the reply is read as `unknown`. See technical-design.md §6, "A
 * rejection can arrive inside an accepted reply", and §8.
 *
 * @param response - The accepted reply.
 * @returns The provider's message, or `null` when the reply has no message.
 */
function providerErrorMessage(response: unknown): string | null {
	if (!isRecord(response)) {
		return null;
	}
	const { error } = response;
	if (!isRecord(error) || typeof error.message !== "string") {
		return null;
	}
	return error.message;
}

/**
 * Turns an SDK `APIError` into a named error. The SDK's error holds only the
 * provider's words, so this function adds the model, which the reader needs in order to
 * act (technical-design.md §8). A context length error gets its own type.
 *
 * @param options - The caught value and the call.
 * @param options.error - The caught value.
 * @param options.stageId - The stage that made the call.
 * @param options.modelId - The stage's configured model.
 * @returns The error to throw, or `null` when the caught value is not an `APIError`.
 */
function toProviderError(options: {
	readonly error: unknown;
	readonly stageId: StageId;
	readonly modelId: string;
}): ContextLengthError | ProviderError | null {
	if (!(options.error instanceof OpenAI.APIError)) {
		return null;
	}
	if (options.error.code === CONTEXT_LENGTH_CODE) {
		return new ContextLengthError(
			`Model "${options.modelId}" returned an error: context length exceeded. Configure a larger-context model for this stage in ${CONFIG_FILENAME}.`,
		);
	}
	return new ProviderError(
		providerErrorDescription({
			stageId: options.stageId,
			modelId: options.modelId,
			providerMessage: options.error.message,
		}),
	);
}

// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- the OpenAI client and message types are library types that are not deeply readonly (CLAUDE.md allows mutable types when a library requires them)
async function createCompletion(options: {
	readonly client: OpenAI;
	readonly stageId: StageId;
	readonly stageConfig: StageConfig;
	readonly messages: readonly OpenAI.Chat.Completions.ChatCompletionMessageParam[];
	readonly responseFormat: ReplyFormat;
}): Promise<OpenAI.Chat.Completions.ChatCompletion> {
	// The body is made in two steps. The SDK's type checks the fields that the SDK
	// knows. The type of the whole body then shows OpenRouter's `provider` field,
	// which a single literal of the SDK's type would hide.
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
		const providerError = toProviderError({
			error,
			stageId: options.stageId,
			modelId: options.stageConfig.modelId,
		});
		if (providerError !== null) {
			throw providerError;
		}
		throw error;
	}
}

/**
 * Reads the `usage` of a reply as `unknown`, and not as the SDK's type.
 * OpenRouter adds `cost` to it, and a reply with a provider error can have no
 * usage (technical-design.md §6, §7).
 *
 * @param response - The accepted reply.
 * @returns The reply's usage, or an empty record when it has none.
 */
function usageOf(response: unknown): Readonly<Record<string, unknown>> {
	if (!isRecord(response) || !isRecord(response.usage)) {
		return {};
	}
	return response.usage;
}

/**
 * Reads one token count from a reply's usage.
 *
 * @param value - The field as the reply has it.
 * @returns The count, or `0` when it is not a number.
 */
function tokenCount(value: unknown): number {
	return typeof value === "number" ? value : 0;
}

/**
 * Reads the cost of a send from `usage.cost` in the reply. A reply with no
 * numeric cost has an unknown cost, and the call does not fail
 * (technical-design.md §7). A failed send with no cost costs zero, because
 * OpenRouter does not bill a request that gave no output (§6).
 *
 * @param args - The reply's usage, and whether the send failed with a provider error.
 * @param args.usage - The reply's usage.
 * @param args.hasProviderError - `true` when the reply has a provider error and no answer.
 * @returns The send's cost, or the reason that it is unknown.
 */
function replyCost({
	usage,
	hasProviderError,
}: {
	readonly usage: Readonly<Record<string, unknown>>;
	readonly hasProviderError: boolean;
}): CostResolution {
	if (typeof usage.cost === "number") {
		return { costUsd: usage.cost };
	}
	if (hasProviderError) {
		return { costUsd: 0 };
	}
	return { costUsd: null, unknownCostReason: "Reply carried no numeric usage.cost" };
}

/**
 * Everything that one model call needs. It has a name so that the stage helpers
 * in `model-stage.ts` can choose the fields that they send to `callModel`.
 */
export type ModelCallRequest = {
	readonly messages: readonly OpenAI.Chat.Completions.ChatCompletionMessageParam[];
	readonly stageId: StageId;
	readonly config: PipelineConfig;
	readonly responseFormat: ReplyFormat;
	readonly logger: Logger;
	readonly client: OpenRouterClient;
	readonly sendGate: SendGate;
};

/**
 * Reads the cost of one send from the reply's `usage`: the token counts and the
 * dollar cost (technical-design.md §6, §7).
 *
 * @param args - The reply, and whether the send failed with a provider error.
 * @param args.response - The accepted reply.
 * @param args.hasProviderError - `true` when the reply has a provider error and no answer.
 * @returns The send's cost, as one call.
 */
function sendCost({
	response,
	hasProviderError,
}: {
	readonly response: unknown;
	readonly hasProviderError: boolean;
}): StageCost {
	const usage = usageOf(response);
	return {
		promptTokens: tokenCount(usage.prompt_tokens),
		completionTokens: tokenCount(usage.completion_tokens),
		callCount: 1,
		...replyCost({ usage, hasProviderError }),
	};
}

/**
 * A send that got an answer. `keptError` holds a provider error that came with
 * the answer, so that `callModel` can log it.
 */
type AnsweredSend = {
	readonly content: string;
	readonly cost: StageCost;
	readonly keptError: {
		readonly providerMessage: string;
		readonly finishReason: string | null;
	} | null;
};

/**
 * Makes one send of a model call, and logs it at `debug`.
 *
 * @param options - As for {@link callModel}, with the stage's configuration and the client.
 * @param options.stageConfig - The stage's model and tuning.
 * @param options.openAiClient - The client for the call.
 * @returns The answer, its cost and any provider error that came with it. Or, for
 *   a reply with a provider error and no answer, the failed send and its cost.
 * @throws {ContextLengthError} If the prompt is longer than the model's context window.
 * @throws {ProviderError} If the send fails with an `APIError`.
 * @throws {NoReplyChoicesError} If the reply has no choices and no provider error.
 */
async function sendOnce(
	// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- the same library types as for callModel, which are not deeply readonly
	options: ModelCallRequest & { readonly stageConfig: StageConfig; readonly openAiClient: OpenAI },
): Promise<AnsweredSend | FailedSend> {
	const { stageConfig, openAiClient: client } = options;
	// The latency is measured here, because only the code that makes the call can
	// measure it (technical-design.md §10).
	const startedAt = performance.now();
	const response = await createCompletion({
		client,
		stageId: options.stageId,
		stageConfig,
		messages: options.messages,
		responseFormat: options.responseFormat,
	});
	const latencyMs = Math.round(performance.now() - startedAt);
	const [choice] = response.choices ?? [];
	const finishReason = choice?.finish_reason ?? null;
	options.logger.debug(
		{
			model: stageConfig.modelId,
			promptTokens: tokenCount(usageOf(response).prompt_tokens),
			latencyMs,
			finishReason,
		},
		"Model call",
	);
	// A reply with an answer and a provider error is an answer, not a failed send.
	// A resend would lose a complete answer (technical-design.md §6).
	const content = choice?.message.content ?? "";
	const providerMessage = providerErrorMessage(response);
	if (providerMessage !== null && content === "") {
		return { failure: providerMessage, cost: sendCost({ response, hasProviderError: true }) };
	}
	// A reply with no choices has no answer to read. Without this check, the call
	// would return "" as if the model answered. This error names the stage and the
	// model. Empty content in a choice does not cause this error: the call returns
	// it as "".
	if (choice === undefined) {
		throw new NoReplyChoicesError(
			`Model "${stageConfig.modelId}" returned no choices for stage "${options.stageId}"`,
		);
	}
	return {
		content,
		cost: sendCost({ response, hasProviderError: false }),
		keptError: providerMessage === null ? null : { providerMessage, finishReason },
	};
}

/**
 * Makes one model call for a stage. It returns the answer and the
 * {@link StageCost}, which it reads from the reply's `usage`. A reply with no
 * numeric cost has an unknown cost, and the call does not fail
 * (technical-design.md §6, §7).
 *
 * A reply with a provider error and no answer is sent again, up to three sends.
 * A reply with an answer is kept. Its provider error is logged as a warning
 * (technical-design.md §6, "A rejection can arrive inside an accepted reply").
 *
 * @param options - The call.
 * @param options.messages - The chat messages to send.
 * @param options.stageId - The stage whose model and tuning the call uses.
 * @param options.config - The checked pipeline config.
 * @param options.responseFormat - The form of the reply. A `"json"` caller must also ask for
 *   JSON in its messages (technical-design.md §6).
 * @param options.logger - The stage's logger. The call is logged on it at `debug` (§10).
 * @param options.client - The provider of the invocation's client (§4.7).
 * @param options.sendGate - The send gate of the stage run. Each send, and each resend,
 *   waits for its turn (§6, `sendGapSeconds`).
 * @returns The answer and its cost.
 * @throws {UnconfiguredStageError} If the configuration has no entry for the stage. Its message
 *   names the stage.
 * @throws {ContextLengthError} If the prompt is longer than the model's context window. Its
 *   message names the model.
 * @throws {ProviderError} If the provider reports any other error, or a provider error on
 *   every send. Its message names the model (§8) and the stage.
 * @throws {NoReplyChoicesError} If an accepted reply has no choices. Its message names the model
 *   and the stage.
 */
export async function callModel(
	// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- the OpenAI client, message and pino Logger types are library types that are not deeply readonly (CLAUDE.md allows mutable types when a library requires them)
	options: ModelCallRequest,
): Promise<{ readonly content: string; readonly cost: StageCost }> {
	const stageConfig = stageConfigFor({ config: options.config, stageId: options.stageId });
	const { modelId } = stageConfig;
	// The client is asked for only here, when a call needs it. So a command that
	// calls no model never needs the API key.
	const openAiClient = options.client();
	const { sent, sends, cost } = await sendUntilAccepted({
		send: async () => {
			await options.sendGate.waitTurn();
			return sendOnce({ ...options, stageConfig, openAiClient });
		},
		onFailure: ({ send, failure }) => {
			options.logger.warn(
				{ model: modelId, send, providerMessage: failure },
				"Provider error on a send",
			);
		},
		exhausted: ({ failure }) =>
			new ProviderError(
				providerErrorDescription({ stageId: options.stageId, modelId, providerMessage: failure }),
			),
	});
	if (sent.keptError !== null) {
		options.logger.warn(
			{ model: modelId, send: sends, ...sent.keptError },
			"Answer kept beside the provider's error",
		);
	}
	return { content: sent.content, cost };
}
