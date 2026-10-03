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
	openRouterCompletionBody,
	openRouterModelId,
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
	CompletionRejectedError,
	ContextLengthError,
	createOpenRouterClient,
	createOpenRouterClientProvider,
	makeCompletionCall,
	NoCompletionChoicesError,
	API_KEY_VARIABLE as OPENROUTER_KEY_VARIABLE,
	UnconfiguredStageError,
} from "./openrouter.js";

const config: PipelineConfig = configuringStage({ stageId: "transcript-structuring" });

/**
 * The sentence OpenRouter sent this account on 2026-08-31 when the upstream
 * provider was overloaded, quoted so the assertions are about a reply that
 * genuinely arrived rather than an invented one.
 */
const PROVIDER_BUSY_MESSAGE =
	"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.";

/** A second address, for the case where a run is configured to reach OpenRouter elsewhere. */
const GATEWAY_BASE_URL = "https://gateway.example.test/openrouter/v1";

const messages = [{ role: "user", content: "Structure this transcript." }] as const;

/** What the stubbed model answers. */
const ANSWER = "Structured notes.";

function completionBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return { ...openRouterCompletionBody({ content: ANSWER }), ...overrides };
}

/**
 * The stubbed answer's choices, reporting the given finish reason.
 *
 * @param finishReason - The finish reason reported, or `null` for none.
 * @returns The `choices` field to override a completion body with.
 */
function answerFinishing(finishReason: string | null): Record<string, unknown> {
	const { choices } = openRouterCompletionBody({ content: ANSWER, finishReason });
	return { choices };
}

function mockCompletion(): nock.Interceptor {
	return nock(openRouterUrls.origin).post(openRouterUrls.completions);
}

/**
 * Mocks one completion returning the well-formed body, with the fields a test
 * is about replaced.
 *
 * @param overrides - Fields to replace in the completion body; none by default.
 */
function mockCompletionReturning(overrides: Record<string, unknown> = {}): void {
	mockCompletion().reply(200, completionBody(overrides));
}

/**
 * The error field OpenRouter puts in an accepted reply, carrying the provider's sentence.
 *
 * @param message - The provider's sentence.
 * @returns The reply's `error` field.
 */
function providerError(message: string): Record<string, unknown> {
	return { message, code: 503 };
}

/** The busy provider's error field, to lay over a completion body. */
const BUSY_ERROR = { error: providerError(PROVIDER_BUSY_MESSAGE) };

/**
 * Mocks the reply a busy provider produces: accepted with HTTP 200, but
 * carrying its own explanation where the choices should be.
 *
 * @param args - What sets this refusal apart; the busy provider's sentence and no usage by default.
 * @param args.message - The provider's sentence.
 * @param args.usage - The usage the refusal reports, if any.
 */
function mockCompletionRejectedByProvider({
	message = PROVIDER_BUSY_MESSAGE,
	usage,
}: {
	readonly message?: string;
	readonly usage?: Readonly<Record<string, unknown>>;
} = {}): void {
	mockCompletion().reply(200, {
		...(usage === undefined ? {} : { usage }),
		error: providerError(message),
	});
}

const logged = useStubLogger();

/** What each warning the call logged carried, in order. */
function warningsLogged(): readonly unknown[] {
	return loggedAt({ entries: logged().entries, level: "warn" }).map((entry) => entry.payload);
}

/**
 * The warning a refusal of the busy provider's is logged with.
 *
 * @param send - Which send was refused, counting from 1.
 * @returns The warning's payload.
 */
function refusalWarning(send: number): Record<string, unknown> {
	return { model: openRouterModelId, send, providerMessage: PROVIDER_BUSY_MESSAGE };
}

function call(
	overrides: Record<string, unknown> = {},
): Promise<{ content: string; cost: import("../types/pipeline.js").StageCost }> {
	return makeCompletionCall({
		messages,
		stageId: "transcript-structuring",
		config,
		responseFormat: "text",
		logger: logged().logger,
		// The client is the caller's to provide — there is no shared one to fall
		// back on — so the default here is the one this suite's config describes,
		// and a test wanting a different client passes it in `overrides`.
		client: openRouterClientFor({ config }),
		sendGate: unspacedSends,
		...overrides,
	});
}

/** What one completion request carried, for tests asserting on what was sent. */
type CapturedRequest = {
	readonly body: Record<string, unknown>;
	readonly headers: Record<string, unknown>;
};

/**
 * Mocks a successful completion that records the request it was sent, then
 * makes the call — the arrange-and-act every test asserting on the outgoing
 * request shares.
 */
async function callCapturingRequest(
	overrides: Record<string, unknown> = {},
): Promise<CapturedRequest> {
	const captured: { body: Record<string, unknown>; headers: Record<string, unknown> } = {
		body: {},
		headers: {},
	};
	mockCompletion().reply(function reply(_uri, body) {
		captured.body = body as Record<string, unknown>;
		captured.headers = this.req.headers as Record<string, unknown>;
		return [200, completionBody()];
	});

	await call(overrides);

	return captured;
}

/**
 * Mocks a completion, then makes the call — the arrange-and-act every test
 * about a round trip that the SDK accepts shares.
 *
 * @param overrides - Fields to replace in the completion body; none by default.
 * @returns What the call resolved with.
 */
function callSucceeding(overrides: Record<string, unknown> = {}): ReturnType<typeof call> {
	mockCompletionReturning(overrides);
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
		// Deliberately unlike the shipped values, so the assertion cannot pass by
		// coincidence if the client ever went back to hard-coded defaults.
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
	// Building a client reads the API key and the SDK refuses to build without
	// one. The provider is therefore made at the composition root but must not
	// build anything there: `delete`, `rename`, `change-date` and `cost-report`
	// reach no model, and none of them should need a key to run.
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

describe("makeCompletionCall", () => {
	it("should send the correct baseURL, headers, and model ID when makeCompletionCall is invoked", async () => {
		const { body, headers } = await callCapturingRequest();

		expect(body.model).toBe(openRouterModelId);
		expect(headers["x-title"]).toBe("Lecture Notes Pipeline");
		expect(headers.authorization).toBe(`Bearer ${stubbedApiKey}`);
	});

	// The format asked for and the routing restriction are one decision: a JSON
	// reply is only obtainable from a provider that honours the parameter, so both
	// are read off the same request rather than by sending it twice.
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

	// Which parameters a request carries is a routing decision under
	// `require_parameters`, so tuning a stage leaves unset has to be genuinely
	// absent from the body rather than sent as a null the endpoint filter counts.
	it("should send no tuning parameters at all when the stage configures none", async () => {
		const untuned: PipelineConfig = {
			...config,
			stages: { "transcript-structuring": { modelId: openRouterModelId } },
		};

		const { body } = await callCapturingRequest({ config: untuned });

		expect(body).not.toHaveProperty("temperature");
		expect(body).not.toHaveProperty("max_tokens");
	});

	// A call reaches wherever its client points. There is no shared client to be
	// served by mistake, so this asserts the whole of the rule rather than the
	// cache-invalidation that used to stand in for it.
	it("should reach the new address when the client is built for a different address", async () => {
		await callSucceeding();
		const gateway = openRouterUrlsAt(GATEWAY_BASE_URL);
		const gatewayCompletion = nock(gateway.origin)
			.post(gateway.completions)
			.reply(200, completionBody());
		const openRouter = { ...config.openRouter, baseUrl: GATEWAY_BASE_URL };

		await call({
			config: { ...config, openRouter },
			client: () => createOpenRouterClient({ openRouter }),
		});

		expect(gatewayCompletion.isDone()).toBe(true);
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
		expect(entry?.message).toBe("Completion call");
		expect(entry?.payload).toEqual({
			model: openRouterModelId,
			promptTokens: stubbedTokenUsage.promptTokens,
			latencyMs: expect.any(Number),
			finishReason,
		});
	});

	// OpenRouter prices every reply in its own `usage`, so no second request is
	// made: its `/generation` record appears only 10–18 seconds after the reply.
	it("should record the cost and token counts the reply carries when a call completes", async () => {
		const result = await callSucceeding();

		expect(result.cost).toEqual(stubbedCallCost);
	});

	// A cost is telemetry: however it arrives, the call still hands back the
	// model's reply, and the cost is recorded as unknown rather than failing it
	// (technical-design.md §7).
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
			costResolutionError: expect.stringContaining("usage.cost"),
		});
	});

	it("should default token counts to zero when the completion response omits usage", async () => {
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
		mockCompletionReturning({ choices: [] });

		const error = await captureError(call());

		expect(error).toBeInstanceOf(NoCompletionChoicesError);
		expect(error.message).toMatch(new RegExp(openRouterModelId));
		expect(error.message).toMatch(/no choices/i);
	});

	// OpenRouter answers some upstream failures with HTTP 200 and an error object
	// where the choices should be, so the SDK sees a success and hands the body
	// back. Such a refusal can be transient, so it is sent again, pausing two
	// seconds and then four (technical-design.md §6).
	describe("when an accepted reply carries the provider's error", () => {
		beforeEach(() => {
			// Only the pauses are faked: nock's replies must still arrive on their own.
			vi.useFakeTimers({ toFake: ["setTimeout"] });
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it("should resend a refused call and return the reply when a later send is accepted", async () => {
			mockCompletionRejectedByProvider();
			mockCompletionRejectedByProvider();
			mockCompletionReturning();

			const result = await settleThroughPauses(call());

			expect(result.content).toBe(ANSWER);
		});

		it("should fail with the last refusal, naming the model and the stage, when every send is refused", async () => {
			mockCompletionRejectedByProvider();
			mockCompletionRejectedByProvider();
			mockCompletionRejectedByProvider({ message: "Upstream rate limit reached." });

			const error = await settleThroughPauses(captureError(call()));

			expect(error).toBeInstanceOf(CompletionRejectedError);
			expect(error.message).toContain("Upstream rate limit reached.");
			expect(error.message).toContain(openRouterModelId);
			expect(error.message).toContain("transcript-structuring");
		});

		// The error reaches the user only when every send is refused; the log is
		// where a refusal that a resend got past can still be seen.
		it("should log each refusal as a warning with which send it was and the provider's sentence when a resend gets past it", async () => {
			mockCompletionRejectedByProvider();
			mockCompletionRejectedByProvider();
			mockCompletionReturning();

			await settleThroughPauses(call());

			expect(warningsLogged()).toEqual([refusalWarning(1), refusalWarning(2)]);
		});

		it.each([
			{
				scenario: "reports its own usage, which is counted",
				refusal: { usage: stubbedReplyUsage },
				expected: stubbedCallsCost({ calls: 2 }),
			},
			{
				scenario: "reports no usage, and so costs nothing",
				refusal: {},
				expected: { ...stubbedCallCost, callCount: 2 },
			},
		])("should count the refused send as a call when the refusal $scenario", async ({
			refusal,
			expected,
		}) => {
			mockCompletionRejectedByProvider(refusal);
			mockCompletionReturning();

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
			mockCompletionReturning(overrides);

			const result = await settleThroughPauses(call());

			expect(result.content).toBe(ANSWER);
			expect(result.cost.callCount).toBe(1);
		});

		it("should resend a reply carrying the provider's error when its answer is empty", async () => {
			mockCompletionReturning({ ...BUSY_ERROR, ...openRouterCompletionBody({ content: "" }) });
			mockCompletionReturning();

			const result = await settleThroughPauses(call());

			expect(result.cost.callCount).toBe(2);
		});

		// The answer is kept, so the log is the only place the provider's error survives.
		it("should log the provider's error as a warning with the finish reason and which send it was when a reply carries an answer as well", async () => {
			mockCompletionRejectedByProvider();
			mockCompletionReturning({ ...BUSY_ERROR, ...answerFinishing("error") });

			await settleThroughPauses(call());

			expect(warningsLogged()).toEqual([
				refusalWarning(1),
				{ ...refusalWarning(2), finishReason: "error" },
			]);
		});
	});

	// The guard above only fires when there is an explanation to report. A reply
	// carrying no explanation still has to name the stage and the model rather
	// than fail while reaching for a key that is not there — whether it is an
	// object without choices, or not the object the SDK's type promises at all.
	it.each([
		{
			scenario: "carries neither choices nor an error",
			body: { id: "gen-1", object: "chat.completion" },
		},
		{ scenario: "is an array", body: [] },
		{ scenario: "is not an object at all", body: '"done"' },
	])("should report no choices when a 200 reply $scenario", async ({ body }) => {
		mockCompletion().reply(200, body);

		const error = await captureError(call());

		expect(error).toBeInstanceOf(NoCompletionChoicesError);
		expect(error.message).toContain(openRouterModelId);
	});

	it("should retry the completion call with backoff and succeed when the first response is a 429", async () => {
		mockCompletion().reply(429, {}, { "retry-after": "0" });

		const result = await callSucceeding();

		expect(result.content).toBe(ANSWER);
	});

	it("should throw a typed ContextLengthError when the model reports the context length is exceeded", async () => {
		mockCompletion().reply(400, {
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
			scenario: "the request is rejected for a reason the pipeline does not special-case",
			status: 400,
			body: { error: { message: "Provider returned error", code: "invalid_request_error" } },
		},
	])("should name the model and the stage when $scenario", async ({ status, body }) => {
		mockCompletion().reply(status, body);

		const error = await captureError(call());

		expect(error).toBeInstanceOf(CompletionRejectedError);
		expect(error.message).toContain(openRouterModelId);
		expect(error.message).toContain("transcript-structuring");
	});

	it("should propagate the failure unchanged when it did not come from the API", async () => {
		const client = createOpenRouterClient({ openRouter: config.openRouter });
		vi.spyOn(client.chat.completions, "create").mockRejectedValue(new Error("socket exploded"));

		const error = await captureError(call({ client: () => client }));

		expect(error.message).toBe("socket exploded");
	});

	it("should keep the provider's own explanation when a rejected request is reported", async () => {
		mockCompletion().reply(404, { error: { message: "No endpoints found for this model." } });

		const error = await captureError(call());

		expect(error.message).toContain("No endpoints found for this model.");
	});

	it("should throw when the completion request times out before a response arrives", async () => {
		const client = new OpenAI({
			apiKey: stubbedApiKey,
			baseURL: exampleConfig.openRouter.baseUrl,
			timeout: 20,
			maxRetries: 0,
		});
		mockCompletion().delay(200).reply(200, completionBody());

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
