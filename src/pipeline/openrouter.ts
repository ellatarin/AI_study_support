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
 * OpenRouter's endpoints, relative to the configured base URL.
 *
 * Stated once because more than one party addresses them: the config loader's
 * model-ID check (`models`), and the tests that intercept both. `completions` is
 * the SDK's own path — the pipeline never builds it — and is named here only so
 * a test mocking the call does not have to know it independently of the code
 * under test.
 */
export const OPENROUTER_PATHS = {
	completions: "/chat/completions",
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
 * Thrown when the provider reports an error because the prompt exceeds the model's
 * context window. Surfaced as a distinct type so the runner can advise switching
 * to a larger-context model rather than treating it as a generic failure
 * (technical-design.md §8).
 */
export class ContextLengthError extends NamedError {}

/**
 * Thrown when the configuration holds no entry for the stage a completion was
 * asked for, so there is no model to call. Named separately from the provider errors
 * below because it is settled before the request is made: nothing was sent, and
 * the remedy is an edit to the config file (technical-design.md §6, §8).
 */
export class UnconfiguredStageError extends NamedError {}

/**
 * Thrown when the provider reports an error for any reason the
 * pipeline does not treat specially — an unavailable model, a busy provider,
 * an unreachable endpoint. {@link ContextLengthError} is the one provider error with a
 * remedy of its own and keeps its own type (technical-design.md §8).
 */
export class ProviderError extends NamedError {}

/**
 * Thrown when a completion is accepted but carries no choices at all, which
 * leaves nothing to read. Distinct from a model answering with empty content,
 * which is a legitimate reply this module hands back as `""`
 * (technical-design.md §8).
 */
export class NoCompletionChoicesError extends NamedError {}

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

/**
 * Supplies the invocation's OpenRouter client, building it the first time one is
 * actually wanted.
 *
 * A function rather than the client itself because constructing one reads
 * `OPENROUTER_API_KEY`, and the SDK refuses to construct without it. Commands
 * that never reach a model — `delete`, `rename`, `change-date`, `cost-report` —
 * would otherwise demand a key to do work that has nothing to do with one.
 */
export type OpenRouterClient = () => OpenAI;

/**
 * Builds the provider the pipeline is handed: one client per invocation, made on
 * first use and reused after it.
 *
 * The memory is a local in this closure, so it lives exactly as long as the
 * invocation that made it. Nothing module-level holds a client, which is what
 * lets tests hand a stage their own provider without a way of clearing shared
 * state (technical-design.md §4.7, §6).
 *
 * @param args - The settings every client it builds is built from.
 * @param args.openRouter - The validated `openRouter` config section.
 * @returns A provider handing back the same client each time it is asked.
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
 * The one wording a provider error is reported in.
 *
 * A provider error reaches this module by two routes — the SDK raising on a failure
 * status, and a provider error arriving inside an accepted reply — and a reader
 * has no reason to care which. Both name the model, the stage, and the
 * provider's own sentence, in the same order, because they describe the same
 * event (technical-design.md §8).
 *
 * @param options - What was being attempted, and what the provider said about it.
 * @param options.stageId - The stage the call was made for.
 * @param options.modelId - The model the stage is configured to use.
 * @param options.providerMessage - The provider's own account of the failure.
 * @returns The message to report the provider error under.
 */
function providerErrorDescription(options: {
	readonly stageId: StageId;
	readonly modelId: string;
	readonly providerMessage: string;
}): string {
	return `Model "${options.modelId}" rejected the request for stage "${options.stageId}": ${options.providerMessage}`;
}

/**
 * The provider's own explanation, when an accepted reply carries one instead of
 * a completion.
 *
 * OpenRouter answers some upstream failures with HTTP 200 and a body holding
 * `{"error": {...}}` and no `choices`, which the SDK hands back as a success.
 * The sentence inside is the only account of what went wrong — it says whether
 * the failure is transient and whether retrying is the remedy — so it is read
 * off a reply the SDK's type says cannot hold it (technical-design.md §8).
 *
 * @param response - The accepted completion reply.
 * @returns The provider's message, or `null` when the reply carries no usable one.
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
 * Renders a provider error as an error that names the model and the stage.
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
}): ContextLengthError | ProviderError | null {
	if (!(options.error instanceof OpenAI.APIError)) {
		return null;
	}
	if (options.error.code === CONTEXT_LENGTH_CODE) {
		return new ContextLengthError(
			`Model "${options.modelId}" rejected the request: context length exceeded. Configure a larger-context model for this stage in ${CONFIG_FILENAME}.`,
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

/**
 * The `usage` a reply carries, read without trusting the SDK's type: OpenRouter
 * adds `cost` to it, and a provider error arrives in the shape of a
 * completion but need not carry any usage at all (technical-design.md §6, §7).
 *
 * @param response - The accepted completion reply.
 * @returns The reply's usage, or an empty record when it carries none.
 */
function usageOf(response: unknown): Readonly<Record<string, unknown>> {
	if (!isRecord(response) || !isRecord(response.usage)) {
		return {};
	}
	return response.usage;
}

/**
 * One token count from a reply's usage, zero when the reply does not report it.
 *
 * @param value - The field as the reply carried it.
 * @returns The count, or `0` when it is not a number.
 */
function tokenCount(value: unknown): number {
	return typeof value === "number" ? value : 0;
}

/**
 * What a send cost, as the reply itself reports it in `usage.cost`.
 *
 * A reply that carries no numeric cost is recorded as unknown with the reason,
 * never as zero and never as a failure: cost is telemetry, and the call has
 * already produced its output (technical-design.md §7). The one exception is a
 * provider error that reports no cost, which is counted as costing nothing,
 * because OpenRouter does not bill a request that produced no output (§6).
 *
 * @param args - The reply's usage, and whether the reply carries a provider error.
 * @param args.usage - The reply's usage.
 * @param args.hasProviderError - Whether the reply carries a provider error.
 * @returns The send's cost, or why it is unknown.
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
	return { costUsd: null, costResolutionError: "Reply carried no numeric usage.cost" };
}

/**
 * Everything one completion call needs. Named rather than written inline so a
 * caller that forwards part of it — the stage helper that asks for a JSON reply
 * — can say which part it forwards instead of restating the fields.
 */
export type CompletionRequest = {
	readonly messages: readonly OpenAI.Chat.Completions.ChatCompletionMessageParam[];
	readonly stageId: StageId;
	readonly config: PipelineConfig;
	readonly responseFormat: CompletionResponseFormat;
	readonly logger: Logger;
	readonly client: OpenRouterClient;
	readonly sendGate: SendGate;
};

/**
 * What one send of a completion cost: its tokens and its dollar cost, both as
 * the reply reports them in its `usage` (technical-design.md §6, §7).
 *
 * @param args - The reply, and whether it carries a provider error.
 * @param args.response - The accepted completion reply.
 * @param args.hasProviderError - Whether the reply carries a provider error.
 * @returns The send's cost.
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
 * A send that brought back an answer, with the provider's error when one came
 * with it, so the error can still be logged once the answer is kept.
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
 * Sends one completion and reads what came back: its text and cost, or the
 * provider error and its cost, to be sent again.
 *
 * @param options - As {@link makeCompletionCall}, with the stage's settings and the client resolved.
 * @param options.stageConfig - The stage's model and tuning.
 * @param options.openAiClient - The client to call through.
 * @returns The completion's text, cost and any provider error that came with it, or the provider error and its cost.
 * @throws {ContextLengthError} If the prompt exceeds the model's context window.
 * @throws {ProviderError} If the API answers the call with a failure status.
 * @throws {NoCompletionChoicesError} If the reply carries neither choices nor a provider error.
 */
async function sendCompletionOnce(
	// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- as for makeCompletionCall: library types that are not deeply readonly
	options: CompletionRequest & { readonly stageConfig: StageConfig; readonly openAiClient: OpenAI },
): Promise<AnsweredSend | FailedSend> {
	const { stageConfig, openAiClient: client } = options;
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
	const [choice] = response.choices ?? [];
	const finishReason = choice?.finish_reason ?? null;
	options.logger.debug(
		{
			model: stageConfig.modelId,
			promptTokens: tokenCount(usageOf(response).prompt_tokens),
			latencyMs,
			finishReason,
		},
		"Completion call",
	);
	// Read before the provider's error: a reply carrying both is an answer, not a
	// failed send, and resending it would throw a complete answer away (§6).
	const content = choice?.message.content ?? "";
	const providerMessage = providerErrorMessage(response);
	if (providerMessage !== null && content === "") {
		return { failure: providerMessage, cost: sendCost({ response, hasProviderError: true }) };
	}
	// A provider can reply with no choices at all — content filtering, or an
	// upstream error the SDK does not raise. Reading choices[0] blindly turns that
	// into a TypeError naming nothing; failing here names the stage and the model.
	// Empty content is a different matter and stays tolerated as "" below.
	if (choice === undefined) {
		throw new NoCompletionChoicesError(
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
 * Runs one chat completion for the named stage and returns its text alongside
 * its {@link StageCost}. Token counts and the dollar cost are both read from the
 * reply's `usage`, where OpenRouter prices every call. A reply that carries no
 * usable cost does not fail the call — it yields `costUsd: null` with a
 * `costResolutionError` (technical-design.md §6, §7).
 *
 * A reply the SDK accepted that carries a provider error in place of a
 * completion is sent again, up to three sends, pausing two seconds and then
 * four; each provider error is logged as a warning, and the cost returned covers every
 * send (technical-design.md §6, "A rejection can arrive inside an accepted reply").
 * A reply carrying the provider's error beside a non-empty answer is not a
 * failed send: the answer is returned and the error logged as a warning with the
 * finish reason and which send it was. The finish reason never causes a resend.
 *
 * @param options - Call options.
 * @param options.messages - The chat messages to send.
 * @param options.stageId - The pipeline stage whose model and parameters to use.
 * @param options.config - The validated pipeline config supplying the stage's model settings.
 * @param options.responseFormat - The reply shape expected; `"json"` also restricts routing to
 *   providers that honour it, and obliges the caller to ask for JSON in its messages too (§6).
 * @param options.logger - The calling stage's logger, already bound to it by the stage factory;
 *   the call is recorded on it at `debug` (§10).
 * @param options.client - Supplies the OpenAI client to call through, provided where the pipeline is
 *   assembled and handed to the stage exactly as its logger is; asked for it here, at the point a
 *   client is actually wanted (§4.7).
 * @param options.sendGate - The stage run's turns to send; every send, a resend after a
 *   provider error included, waits its turn (§6, `sendGapSeconds`).
 * @returns The completion text and its resolved cost.
 * @throws {UnconfiguredStageError} If the configuration holds no entry for the stage.
 * @throws {ContextLengthError} If the prompt exceeds the model's context window.
 * @throws {ProviderError} If the provider reports an error for any other reason, including a
 *   reply the SDK accepted that carries a provider error on every send.
 * @throws {NoCompletionChoicesError} If the call is accepted but the model returns no choices.
 *   Every one of these names the model and the stage in its message (§8).
 */
export async function makeCompletionCall(
	// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- the OpenAI client, message-param and pino Logger types are library types that are not deeply readonly (CLAUDE.md permits dropping readonly when a library requires mutable types)
	options: CompletionRequest,
): Promise<{ readonly content: string; readonly cost: StageCost }> {
	const stageConfig = stageConfigFor({ config: options.config, stageId: options.stageId });
	const { modelId } = stageConfig;
	// Asked for at the one moment a client is genuinely needed. A command that
	// reaches no model never builds one, and so never needs the API key.
	const openAiClient = options.client();
	const { sent, sends, cost } = await sendUntilAccepted({
		send: async () => {
			await options.sendGate.waitTurn();
			return sendCompletionOnce({ ...options, stageConfig, openAiClient });
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
