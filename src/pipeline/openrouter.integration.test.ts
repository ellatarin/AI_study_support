import nock from "nock";
import OpenAI from "openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIG_FILENAME, type PipelineConfig } from "../types/pipeline.js";
import {
	captureError,
	configuringStage,
	exampleConfig,
	loggedAt,
	openRouterClientFor,
	openRouterModelId,
	openRouterReplyBody,
	openRouterUrls,
	openRouterUrlsAt,
	resetStubbedApi,
	settleThroughPauses,
	stubbedApiKey,
	stubbedCallCost,
	stubbedCallsCost,
	stubbedCostUsd,
	stubbedReplyUsage,
	stubbedTokenUsage,
	stubOpenRouterApi,
	unspacedSends,
	useStubLogger,
} from "./fixtures.js";
import {
	ContextLengthError,
	callModel,
	createOpenRouterClient,
	createOpenRouterClientProvider,
	NoReplyChoicesError,
	API_KEY_VARIABLE as OPENROUTER_KEY_VARIABLE,
	ProviderError,
	UnconfiguredStageError,
} from "./openrouter.js";

const config: PipelineConfig = configuringStage({ stageId: "transcript-structuring" });

/**
 * The words that OpenRouter sent this account on 2026-08-31, when the upstream
 * provider had too much work. The tests use a real reply, not an invented one.
 */
const PROVIDER_BUSY_MESSAGE =
	"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.";

/** A second address of OpenRouter, for a configuration that points elsewhere. */
const GATEWAY_BASE_URL = "https://gateway.example.test/openrouter/v1";

const messages = [{ role: "user", content: "Structure this transcript." }] as const;

/** The answer of the stubbed model. */
const ANSWER = "Structured notes.";

function replyBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return { ...openRouterReplyBody({ content: ANSWER }), ...overrides };
}

/**
 * Gives the stubbed answer's choices, with a finish reason.
 *
 * @param finishReason - The finish reason, or `null` for none.
 * @returns The `choices` field to put in a reply body.
 */
function answerFinishing(finishReason: string | null): Record<string, unknown> {
	const { choices } = openRouterReplyBody({ content: ANSWER, finishReason });
	return { choices };
}

function mockReply(): nock.Interceptor {
	return nock(openRouterUrls.origin).post(openRouterUrls.completions);
}

/**
 * Mocks one reply with a correct body, and with the fields that a test changes.
 *
 * @param overrides - The fields to replace in the reply body. The default is none.
 */
function mockReplyReturning(overrides: Record<string, unknown> = {}): void {
	mockReply().reply(200, replyBody(overrides));
}

/**
 * Gives the `error` field that OpenRouter puts in an accepted reply.
 *
 * @param message - The provider's words.
 * @returns The reply's `error` field.
 */
function providerError(message: string): Record<string, unknown> {
	return { message, code: 503 };
}

/** The busy provider's `error` field, to add to a reply body. */
const BUSY_ERROR = { error: providerError(PROVIDER_BUSY_MESSAGE) };

/**
 * Mocks a reply with a provider error: HTTP 200, with an `error` field and no
 * choices.
 *
 * @param args - The provider error. The default is the busy provider's words and no usage.
 * @param args.message - The provider's words.
 * @param args.usage - The usage that the reply reports, if any.
 */
function mockProviderError({
	message = PROVIDER_BUSY_MESSAGE,
	usage,
}: {
	readonly message?: string;
	readonly usage?: Readonly<Record<string, unknown>>;
} = {}): void {
	mockReply().reply(200, {
		...(usage === undefined ? {} : { usage }),
		error: providerError(message),
	});
}

const logged = useStubLogger();

/** Gives the payload of each warning that the call logged, in order. */
function warningsLogged(): readonly unknown[] {
	return loggedAt({ entries: logged().entries, level: "warn" }).map((entry) => entry.payload);
}

/**
 * Gives the payload of the warning for the busy provider's error.
 *
 * @param send - The number of the failed send, from 1.
 * @returns The warning's payload.
 */
function providerErrorWarning(send: number): Record<string, unknown> {
	return { model: openRouterModelId, send, providerMessage: PROVIDER_BUSY_MESSAGE };
}

function call(
	overrides: Record<string, unknown> = {},
): Promise<{ content: string; cost: import("../types/pipeline.js").StageCost }> {
	return callModel({
		messages,
		stageId: "transcript-structuring",
		config,
		responseFormat: "text",
		logger: logged().logger,
		// The caller must give the client, because there is no shared client. The
		// default is the client for this suite's config. A test that needs a
		// different client gives it in `overrides`.
		client: openRouterClientFor({ config }),
		sendGate: unspacedSends,
		...overrides,
	});
}

/** The body and the headers of one model call's request. */
type CapturedRequest = {
	readonly body: Record<string, unknown>;
	readonly headers: Record<string, unknown>;
};

/**
 * Mocks a reply that records the request, and then makes the call. The tests
 * that check the request use it.
 */
async function callCapturingRequest(
	overrides: Record<string, unknown> = {},
): Promise<CapturedRequest> {
	const captured: { body: Record<string, unknown>; headers: Record<string, unknown> } = {
		body: {},
		headers: {},
	};
	mockReply().reply(function reply(_uri, body) {
		captured.body = body as Record<string, unknown>;
		captured.headers = this.req.headers as Record<string, unknown>;
		return [200, replyBody()];
	});

	await call(overrides);

	return captured;
}

/**
 * Mocks an accepted reply, and then makes the call.
 *
 * @param overrides - The fields to replace in the reply body. The default is none.
 * @returns The result of the call.
 */
function callSucceeding(overrides: Record<string, unknown> = {}): ReturnType<typeof call> {
	mockReplyReturning(overrides);
	return call();
}

beforeEach(() => {
	stubOpenRouterApi();
});

afterEach(() => {
	resetStubbedApi();
	vi.restoreAllMocks();
});

describe("createOpenRouterClient", () => {
	it("should take its baseURL, timeout, and retries from the config when a client is created", () => {
		// These values are not the values in the example config. So the test fails
		// if the client uses fixed values.
		const openRouter = {
			...exampleConfig.openRouter,
			completionTimeoutMs: 90_000,
			completionMaxRetries: 7,
		};

		const client = createOpenRouterClient({ openRouter });

		expect(client.baseURL).toBe(exampleConfig.openRouter.baseUrl);
		expect(client.timeout).toBe(90_000);
		expect(client.maxRetries).toBe(7);
	});
});

describe("createOpenRouterClientProvider", () => {
	// The SDK cannot make a client without the API key. So the provider must not
	// make a client when the provider is made. `delete`, `rename`, `change-date`
	// and `cost-report` call no model, and must run without a key.
	it("should build no client when a provider is made without an API key", () => {
		vi.stubEnv(OPENROUTER_KEY_VARIABLE, undefined);

		const provider = createOpenRouterClientProvider({ openRouter: config.openRouter });

		expect(provider).toBeTypeOf("function");
		expect(() => provider()).toThrow(/credential/i);
	});

	it("should hand back the client it already built when asked a second time", () => {
		const provider = createOpenRouterClientProvider({ openRouter: config.openRouter });

		expect(provider()).toBe(provider());
	});
});

describe("callModel", () => {
	it("should send the correct baseURL, headers, and model ID when callModel is invoked", async () => {
		const { body, headers } = await callCapturingRequest();

		expect(body.model).toBe(openRouterModelId);
		expect(headers["x-title"]).toBe("Lecture Notes Pipeline");
		expect(headers.authorization).toBe(`Bearer ${stubbedApiKey}`);
	});

	// The reply format and the routing limit are one decision. Only a provider that
	// obeys the format can give a JSON reply. So the test checks both in one request.
	it.each([
		{
			responseFormat: "json",
			asks: "the json_object format and only providers that support it",
			expectedFormat: { type: "json_object" },
			expectedProvider: { require_parameters: true },
		},
		{
			responseFormat: "text",
			asks: "no format and unrestricted routing",
			expectedFormat: undefined,
			expectedProvider: undefined,
		},
	])("should request $asks when responseFormat is $responseFormat", async ({
		responseFormat,
		expectedFormat,
		expectedProvider,
	}) => {
		const { body } = await callCapturingRequest({ responseFormat });

		expect(body.response_format).toEqual(expectedFormat);
		expect(body.provider).toEqual(expectedProvider);
	});

	// With `require_parameters`, the parameters in a request decide which endpoints
	// can serve it. So tuning that a stage does not set must be absent from the
	// body. A `null` would count as a parameter (technical-design.md §6).
	it("should send no tuning parameters at all when the stage configures none", async () => {
		const untuned: PipelineConfig = {
			...config,
			stages: { "transcript-structuring": { modelId: openRouterModelId } },
		};

		const { body } = await callCapturingRequest({ config: untuned });

		expect(body).not.toHaveProperty("temperature");
		expect(body).not.toHaveProperty("max_tokens");
	});

	// A call goes to the address of its client. There is no shared client that a
	// call could get by mistake.
	it("should reach the new address when the client is built for a different address", async () => {
		await callSucceeding();
		const gateway = openRouterUrlsAt(GATEWAY_BASE_URL);
		const gatewayReply = nock(gateway.origin).post(gateway.completions).reply(200, replyBody());
		const openRouter = { ...config.openRouter, baseUrl: GATEWAY_BASE_URL };

		await call({
			config: { ...config, openRouter },
			client: () => createOpenRouterClient({ openRouter }),
		});

		expect(gatewayReply.isDone()).toBe(true);
	});

	it.each([
		{ reported: "stop", finishReason: "stop" },
		{ reported: null, finishReason: null },
	])("should record the model, prompt tokens, latency and finish reason when a call completes reporting $reported", async ({
		reported,
		finishReason,
	}) => {
		await callSucceeding(answerFinishing(reported));

		const [entry] = loggedAt({ entries: logged().entries, level: "debug" });
		expect(entry?.message).toBe("Model call");
		expect(entry?.payload).toEqual({
			model: openRouterModelId,
			promptTokens: stubbedTokenUsage.promptTokens,
			latencyMs: expect.any(Number),
			finishReason,
		});
	});

	// OpenRouter gives the cost of every reply in its `usage`, so no second request
	// is made (technical-design.md §7, "Sources").
	it("should record the cost and token counts the reply carries when a call completes", async () => {
		const result = await callSucceeding();

		expect(result.cost).toEqual(stubbedCallCost);
	});

	// A cost that is missing or not a number does not fail the call. The call returns the answer, and the
	// cost is an unknown cost (technical-design.md §7).
	it.each([
		{
			scenario: "the reply's usage carries no cost",
			usage: { ...stubbedReplyUsage, cost: undefined },
		},
		{
			scenario: "the cost is a string",
			usage: { ...stubbedReplyUsage, cost: String(stubbedCostUsd) },
		},
		{ scenario: "the cost is null", usage: { ...stubbedReplyUsage, cost: null } },
		{
			scenario: "the cost is an object",
			usage: { ...stubbedReplyUsage, cost: { usd: stubbedCostUsd } },
		},
		{ scenario: "the usage is not an object", usage: "garbled" },
		{ scenario: "the reply carries no usage", usage: undefined },
	])("should return the reply and record the cost as unresolved, saying why, when $scenario", async ({
		usage,
	}) => {
		const result = await callSucceeding({ usage });

		expect(result.content).toBe(ANSWER);
		expect(result.cost).toMatchObject({
			callCount: 1,
			costUsd: null,
			unknownCostReason: expect.stringContaining("usage.cost"),
		});
	});

	it("should default token counts to zero when the reply omits usage", async () => {
		const result = await callSucceeding({ usage: undefined });

		expect(result.cost.promptTokens).toBe(0);
		expect(result.cost.completionTokens).toBe(0);
	});

	it("should return empty content when the model returns null content", async () => {
		const result = await callSucceeding({
			choices: [{ index: 0, message: { role: "assistant", content: null }, finish_reason: "stop" }],
		});

		expect(result.content).toBe("");
	});

	it("should name the model and stage when the provider returns no choices", async () => {
		mockReplyReturning({ choices: [] });

		const error = await captureError(call());

		expect(error).toBeInstanceOf(NoReplyChoicesError);
		expect(error.message).toMatch(new RegExp(openRouterModelId));
		expect(error.message).toMatch(/no choices/i);
	});

	// OpenRouter can answer with HTTP 200 and an `error` field in place of the
	// choices. The SDK accepts this reply. The provider error can be temporary, so
	// the call is sent again after two seconds and then four (technical-design.md §6).
	describe("when an accepted reply carries the provider's error", () => {
		beforeEach(() => {
			// Only the pauses use fake timers. The nock replies must come in real time.
			vi.useFakeTimers({ toFake: ["setTimeout"] });
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it("should resend a call that met a provider error and return the reply when a later send is accepted", async () => {
			mockProviderError();
			mockProviderError();
			mockReplyReturning();

			const result = await settleThroughPauses(call());

			expect(result.content).toBe(ANSWER);
		});

		it("should fail with the last provider error, naming the model and the stage, when every send meets one", async () => {
			mockProviderError();
			mockProviderError();
			mockProviderError({ message: "Upstream rate limit reached." });

			const error = await settleThroughPauses(captureError(call()));

			expect(error).toBeInstanceOf(ProviderError);
			expect(error.message).toContain("Upstream rate limit reached.");
			expect(error.message).toContain(openRouterModelId);
			expect(error.message).toContain("transcript-structuring");
		});

		// The user sees the error only when every send meets a provider error. The
		// debug log is the only record of a provider error that a later send overcame.
		it("should log each provider error as a warning with which send it was and the provider's sentence when a resend gets past it", async () => {
			mockProviderError();
			mockProviderError();
			mockReplyReturning();

			await settleThroughPauses(call());

			expect(warningsLogged()).toEqual([providerErrorWarning(1), providerErrorWarning(2)]);
		});

		it.each([
			{
				scenario: "reports its own usage, which is counted",
				erroredReply: { usage: stubbedReplyUsage },
				expected: stubbedCallsCost({ calls: 2 }),
			},
			{
				scenario: "reports no usage, and so costs nothing",
				erroredReply: {},
				expected: { ...stubbedCallCost, callCount: 2 },
			},
		])("should count the send that met a provider error as a call when the provider error $scenario", async ({
			erroredReply,
			expected,
		}) => {
			mockProviderError(erroredReply);
			mockReplyReturning();

			const result = await settleThroughPauses(call());

			expect(result.cost).toEqual(expected);
		});

		it.each([
			{
				reply: "carries an answer and the provider's error",
				overrides: BUSY_ERROR,
			},
			{ reply: "reports error as its finish reason", overrides: answerFinishing("error") },
		])("should return the answer without resending when a reply $reply", async ({ overrides }) => {
			mockReplyReturning(overrides);

			const result = await settleThroughPauses(call());

			expect(result.content).toBe(ANSWER);
			expect(result.cost.callCount).toBe(1);
		});

		it("should resend a reply carrying the provider's error when its answer is empty", async () => {
			mockReplyReturning({ ...BUSY_ERROR, ...openRouterReplyBody({ content: "" }) });
			mockReplyReturning();

			const result = await settleThroughPauses(call());

			expect(result.cost.callCount).toBe(2);
		});

		// The answer is kept, so the debug log is the only record of the provider's error.
		it("should log the provider's error as a warning with the finish reason and which send it was when a reply carries an answer as well", async () => {
			mockProviderError();
			mockReplyReturning({ ...BUSY_ERROR, ...answerFinishing("error") });

			await settleThroughPauses(call());

			expect(warningsLogged()).toEqual([
				providerErrorWarning(1),
				{ ...providerErrorWarning(2), finishReason: "error" },
			]);
		});
	});

	// The tests above have a provider error. A reply with no choices and no provider
	// error must also give an error that names the stage and the model. The call
	// must give this error for an object with no choices, and for a body that does not have the
	// SDK's form at all.
	it.each([
		{
			scenario: "carries neither choices nor an error",
			body: { id: "gen-1", object: "chat.completion" },
		},
		{ scenario: "is an array", body: [] },
		{ scenario: "is not an object at all", body: '"done"' },
	])("should report no choices when a 200 reply $scenario", async ({ body }) => {
		mockReply().reply(200, body);

		const error = await captureError(call());

		expect(error).toBeInstanceOf(NoReplyChoicesError);
		expect(error.message).toContain(openRouterModelId);
	});

	it("should retry the model call with backoff and succeed when the first response is a 429", async () => {
		mockReply().reply(429, {}, { "retry-after": "0" });

		const result = await callSucceeding();

		expect(result.content).toBe(ANSWER);
	});

	it("should throw a typed ContextLengthError when the model reports the context length is exceeded", async () => {
		mockReply().reply(400, {
			error: {
				message: "maximum context length exceeded",
				code: "context_length_exceeded",
				type: "invalid_request_error",
			},
		});

		const error = await captureError(call());

		expect(error).toBeInstanceOf(ContextLengthError);
		expect(error.message).toMatch(/context length/i);
		expect(error.message).toContain(CONFIG_FILENAME);
	});

	it.each([
		{
			scenario: "the configured model is unavailable",
			status: 404,
			body: { error: { message: "No endpoints found for this model.", code: 404 } },
		},
		{
			scenario: "the provider reports an error the pipeline does not special-case",
			status: 400,
			body: { error: { message: "Provider returned error", code: "invalid_request_error" } },
		},
	])("should name the model and the stage when $scenario", async ({ status, body }) => {
		mockReply().reply(status, body);

		const error = await captureError(call());

		expect(error).toBeInstanceOf(ProviderError);
		expect(error.message).toContain(openRouterModelId);
		expect(error.message).toContain("transcript-structuring");
	});

	it("should propagate the failure unchanged when it did not come from the API", async () => {
		const client = createOpenRouterClient({ openRouter: config.openRouter });
		vi.spyOn(client.chat.completions, "create").mockRejectedValue(new Error("socket exploded"));

		const error = await captureError(call({ client: () => client }));

		expect(error.message).toBe("socket exploded");
	});

	it("should keep the provider's own explanation when a provider error is reported", async () => {
		mockReply().reply(404, { error: { message: "No endpoints found for this model." } });

		const error = await captureError(call());

		expect(error.message).toContain("No endpoints found for this model.");
	});

	it("should throw when the model call times out before a response arrives", async () => {
		const client = new OpenAI({
			apiKey: stubbedApiKey,
			baseURL: exampleConfig.openRouter.baseUrl,
			timeout: 20,
			maxRetries: 0,
		});
		mockReply().delay(200).reply(200, replyBody());

		const error = await captureError(call({ client: () => client }));

		expect(error.message).toMatch(/timed out|timeout/i);
	});

	it("should throw when the requested stage is not present in the config", async () => {
		const error = await captureError(call({ stageId: "synthesis" }));

		expect(error).toBeInstanceOf(UnconfiguredStageError);
		expect(error.message).toMatch(/synthesis/);
		expect(error.message).toContain(CONFIG_FILENAME);
	});
});
