import nock from "nock";
import OpenAI from "openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIG_FILENAME, type PipelineConfig } from "../types/pipeline.js";
import {
	captureError,
	exampleConfig,
	loggedAt,
	makeConfig,
	makeStubLogger,
	openRouterCompletionBody,
	openRouterModelId,
	openRouterStageConfig,
	openRouterUrls,
	resetStubbedApi,
	stubbedApiKey,
	stubbedTokenUsage,
	stubOpenRouterApi,
} from "./fixtures.js";
import { ContextLengthError, createOpenRouterClient, makeCompletionCall } from "./openrouter.js";

const config: PipelineConfig = makeConfig({
	stages: {
		"transcript-structuring": openRouterStageConfig({ stageId: "transcript-structuring" }),
	},
});

/** What the stubbed `/generation` lookup reports this call cost. */
const RESOLVED_COST_USD = 0.0042;

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

/** Recorded afresh per test, so a test can assert on what the call logged. */
let logged: ReturnType<typeof makeStubLogger>;

function call(
	overrides: Record<string, unknown> = {},
): Promise<{ content: string; cost: import("../types/pipeline.js").StageCost }> {
	return makeCompletionCall({
		messages,
		stageId: "transcript-structuring",
		config,
		responseFormat: "text",
		logger: logged.logger,
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
	mockGeneration().reply(200, generationBody(RESOLVED_COST_USD));

	await call(overrides);

	return captured;
}

/**
 * Mocks a successful completion plus its cost lookup, then makes the call —
 * the arrange-and-act every resolved-cost test shares.
 */
function callWithResolvedCost(totalCost: number): ReturnType<typeof call> {
	mockCompletion().reply(200, completionBody());
	mockGeneration().reply(200, generationBody(totalCost));
	return call();
}

beforeEach(() => {
	stubOpenRouterApi();
	logged = makeStubLogger();
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

describe("makeCompletionCall", () => {
	it("should send the correct baseURL, headers, and model ID when makeCompletionCall is invoked", async () => {
		const { body, headers } = await callCapturingRequest();

		expect(body.model).toBe(openRouterModelId);
		expect(headers["x-title"]).toBe("Lecture Notes Pipeline");
		expect(headers.authorization).toBe(`Bearer ${stubbedApiKey}`);
	});

	it("should request the json_object response format when responseFormat is json", async () => {
		const { body } = await callCapturingRequest({ responseFormat: "json" });

		expect(body.response_format).toEqual({ type: "json_object" });
	});

	it("should restrict routing to providers supporting the request when responseFormat is json", async () => {
		const { body } = await callCapturingRequest({ responseFormat: "json" });

		expect(body.provider).toEqual({ require_parameters: true });
	});

	it("should send no response format when responseFormat is text", async () => {
		const { body } = await callCapturingRequest({ responseFormat: "text" });

		expect(body.response_format).toBeUndefined();
	});

	it("should leave routing unrestricted when responseFormat is text", async () => {
		const { body } = await callCapturingRequest({ responseFormat: "text" });

		expect(body.provider).toBeUndefined();
	});

	it("should record the model, prompt tokens and latency when a call completes", async () => {
		await callWithResolvedCost(RESOLVED_COST_USD);

		const [entry] = loggedAt({ entries: logged.entries, level: "debug" });
		expect(entry?.message).toBe("Completion call");
		expect(entry?.payload).toEqual({
			model: openRouterModelId,
			promptTokens: stubbedTokenUsage.promptTokens,
			latencyMs: expect.any(Number),
		});
	});

	it("should populate costUsd and token counts when the generation endpoint returns cost", async () => {
		const result = await callWithResolvedCost(RESOLVED_COST_USD);

		expect(result.cost).toEqual({
			...stubbedTokenUsage,
			callCount: 1,
			costUsd: RESOLVED_COST_USD,
		});
	});

	it("should resolve with a fully-resolved cost when the promise settles after the cost lookup", async () => {
		const result = await callWithResolvedCost(RESOLVED_COST_USD);

		expect(typeof result.cost.costUsd).toBe("number");
		expect(nock.isDone()).toBe(true);
	});

	it("should default token counts to zero when the completion response omits usage", async () => {
		mockCompletion().reply(200, completionBody({ usage: undefined }));
		mockGeneration().reply(200, generationBody(RESOLVED_COST_USD));

		const result = await call();

		expect(result.cost.promptTokens).toBe(0);
		expect(result.cost.completionTokens).toBe(0);
	});

	it("should return empty content when the model returns null content", async () => {
		mockCompletion().reply(
			200,
			completionBody({
				choices: [
					{ index: 0, message: { role: "assistant", content: null }, finish_reason: "stop" },
				],
			}),
		);
		mockGeneration().reply(200, generationBody(RESOLVED_COST_USD));

		const result = await call();

		expect(result.content).toBe("");
	});

	it("should name the model and stage when the provider returns no choices", async () => {
		mockCompletion().reply(200, completionBody({ choices: [] }));

		const error = await captureError(call());

		expect(error.message).toMatch(new RegExp(openRouterModelId));
		expect(error.message).toMatch(/no choices/i);
	});

	it("should resolve with costUsd null and costResolutionError set when the cost lookup fails after all retries", async () => {
		mockCompletion().reply(200, completionBody());
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
		mockCompletion().reply(200, completionBody());
		mockGeneration().reply(200, body);

		const result = await call();

		expect(result.cost.costUsd).toBeNull();
		if (result.cost.costUsd === null) {
			expect(result.cost.costResolutionError).toMatch(/./);
		}
	});

	it("should retry the cost lookup with backoff and resolve the cost when a transient failure recovers", async () => {
		mockCompletion().reply(200, completionBody());
		mockGeneration().reply(500, {}, { "retry-after": "0" });
		mockGeneration().reply(200, generationBody(0.01));

		const result = await call();

		expect(result.cost.costUsd).toBe(0.01);
	});

	it("should retry the completion call with backoff and succeed when the first response is a 429", async () => {
		mockCompletion().reply(429, {}, { "retry-after": "0" });
		mockCompletion().reply(200, completionBody());
		mockGeneration().reply(200, generationBody(RESOLVED_COST_USD));

		const result = await call();

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

		expect(error.message).toContain(openRouterModelId);
		expect(error.message).toContain("transcript-structuring");
	});

	it("should propagate the failure unchanged when it did not come from the API", async () => {
		const client = createOpenRouterClient({ openRouter: config.openRouter });
		vi.spyOn(client.chat.completions, "create").mockRejectedValue(new Error("socket exploded"));

		const error = await captureError(call({ client }));

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

		const error = await captureError(call({ client }));

		expect(error.message).toMatch(/timed out|timeout/i);
	});

	it("should apply the configured per-attempt timeout and retries when the cost lookup runs", async () => {
		const client = createOpenRouterClient({ openRouter: config.openRouter });
		const getSpy = vi.spyOn(client, "get");
		mockCompletion().reply(200, completionBody());
		mockGeneration().reply(200, generationBody(RESOLVED_COST_USD));

		await call({ client });

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

		expect(error.message).toMatch(/synthesis/);
		expect(error.message).toContain(CONFIG_FILENAME);
	});
});
