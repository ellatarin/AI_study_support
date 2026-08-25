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
	stubbedApiKey,
	stubbedTokenUsage,
	stubOpenRouterApi,
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

/** What the stubbed `/generation` lookup reports this call cost. */
const RESOLVED_COST_USD = 0.0042;

/** A second address, for the case where a run is configured to reach OpenRouter elsewhere. */
const GATEWAY_BASE_URL = "https://gateway.example.test/openrouter/v1";

const messages = [{ role: "user", content: "Structure this transcript." }] as const;

function completionBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return { ...openRouterCompletionBody({ content: "Structured notes." }), ...overrides };
}

function generationBody(totalCost: number): Record<string, unknown> {
	return {
		data: {
			total_cost: totalCost,
			tokens_prompt: stubbedTokenUsage.promptTokens,
			tokens_completion: stubbedTokenUsage.completionTokens,
		},
	};
}

function mockCompletion(): nock.Interceptor {
	return nock(openRouterUrls.origin).post(openRouterUrls.completions);
}

function mockGeneration(): nock.Interceptor {
	return nock(openRouterUrls.origin).get(openRouterUrls.generation).query(true);
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

/** Mocks the cost lookup resolving, to the figure the suite prices everything at. */
function mockCostResolving(): void {
	mockGeneration().reply(200, generationBody(RESOLVED_COST_USD));
}

const logged = useStubLogger();

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
		...overrides,
	});
}

/** What one completion request carried, for tests asserting on what was sent. */
type CapturedRequest = {
	readonly body: Record<string, unknown>;
	readonly headers: Record<string, unknown>;
};

/**
 * Mocks a successful completion that records the request it was sent, plus its
 * cost lookup, then makes the call — the arrange-and-act every test asserting on
 * the outgoing request shares.
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
	mockCostResolving();

	await call(overrides);

	return captured;
}

/**
 * Mocks a completion plus a cost lookup that resolves, then makes the call —
 * the arrange-and-act every test about a successful round trip shares.
 *
 * @param overrides - Fields to replace in the completion body; none by default.
 * @returns What the call resolved with.
 */
function callSucceeding(overrides: Record<string, unknown> = {}): ReturnType<typeof call> {
	mockCompletionReturning(overrides);
	mockCostResolving();
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

	// A call reaches wherever its client points. There is no shared client to be
	// served by mistake, so this asserts the whole of the rule rather than the
	// cache-invalidation that used to stand in for it.
	it("should reach the new address when the client is built for a different address", async () => {
		await callSucceeding();
		const gateway = openRouterUrlsAt(GATEWAY_BASE_URL);
		const gatewayCompletion = nock(gateway.origin)
			.post(gateway.completions)
			.reply(200, completionBody());
		nock(gateway.origin).get(gateway.generation).query(true).reply(200, generationBody(0));
		const openRouter = { ...config.openRouter, baseUrl: GATEWAY_BASE_URL };

		await call({
			config: { ...config, openRouter },
			client: () => createOpenRouterClient({ openRouter }),
		});

		expect(gatewayCompletion.isDone()).toBe(true);
	});

	it("should record the model, prompt tokens and latency when a call completes", async () => {
		await callSucceeding();

		const [entry] = loggedAt({ entries: logged().entries, level: "debug" });
		expect(entry?.message).toBe("Completion call");
		expect(entry?.payload).toEqual({
			model: openRouterModelId,
			promptTokens: stubbedTokenUsage.promptTokens,
			latencyMs: expect.any(Number),
		});
	});

	it("should populate costUsd and token counts when the generation endpoint returns cost", async () => {
		const result = await callSucceeding();

		expect(result.cost).toEqual({
			...stubbedTokenUsage,
			callCount: 1,
			costUsd: RESOLVED_COST_USD,
		});
	});

	it("should resolve with a fully-resolved cost when the promise settles after the cost lookup", async () => {
		const result = await callSucceeding();

		expect(typeof result.cost.costUsd).toBe("number");
		expect(nock.isDone()).toBe(true);
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

	it("should resolve with costUsd null and costResolutionError set when the cost lookup fails after all retries", async () => {
		mockCompletionReturning();
		mockGeneration().times(4).reply(500, {}, { "retry-after": "0" });

		const result = await call();

		expect(result.cost.costUsd).toBeNull();
		expect(result.cost).toMatchObject({ ...stubbedTokenUsage, callCount: 1 });
		if (result.cost.costUsd === null) {
			expect(result.cost.costResolutionError).toMatch(/./);
		}
	});

	it.each([
		{ scenario: "the reply carries no cost", body: { data: { tokens_prompt: 12 } } },
		{ scenario: "the cost is not a number", body: { data: { total_cost: "0.004" } } },
		{ scenario: "the reply carries no data", body: {} },
		{ scenario: "the reply is an array", body: [] },
		{ scenario: "the reply is not an object at all", body: "0.004" },
	])("should report the cost as unresolved when $scenario", async ({ body }) => {
		mockCompletionReturning();
		mockGeneration().reply(200, body);

		const result = await call();

		expect(result.cost.costUsd).toBeNull();
		if (result.cost.costUsd === null) {
			expect(result.cost.costResolutionError).toMatch(/./);
		}
	});

	it("should retry the cost lookup with backoff and resolve the cost when a transient failure recovers", async () => {
		mockCompletionReturning();
		mockGeneration().reply(500, {}, { "retry-after": "0" });
		mockGeneration().reply(200, generationBody(0.01));

		const result = await call();

		expect(result.cost.costUsd).toBe(0.01);
	});

	it("should retry the completion call with backoff and succeed when the first response is a 429", async () => {
		mockCompletion().reply(429, {}, { "retry-after": "0" });

		const result = await callSucceeding();

		expect(result.content).toBe("Structured notes.");
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

	it("should apply the configured per-attempt timeout and retries when the cost lookup runs", async () => {
		const client = createOpenRouterClient({ openRouter: config.openRouter });
		const getSpy = vi.spyOn(client, "get");
		mockCompletionReturning();
		mockGeneration().reply(200, generationBody(RESOLVED_COST_USD));

		await call({ client: () => client });

		expect(getSpy).toHaveBeenCalledWith(
			"/generation",
			expect.objectContaining({
				timeout: config.openRouter.costLookupTimeoutMs,
				maxRetries: config.openRouter.costLookupMaxRetries,
			}),
		);
	});

	it("should throw when the requested stage is not present in the config", async () => {
		const error = await captureError(call({ stageId: "synthesis" }));

		expect(error).toBeInstanceOf(UnconfiguredStageError);
		expect(error.message).toMatch(/synthesis/);
		expect(error.message).toContain(CONFIG_FILENAME);
	});
});
