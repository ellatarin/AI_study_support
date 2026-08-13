import nock from "nock";
import OpenAI from "openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineConfig } from "../types/pipeline.js";
import { makeConfig } from "./fixtures.js";
import { ContextLengthError, createOpenRouterClient, makeCompletionCall } from "./openrouter.js";

const OPENROUTER_HOST = "https://openrouter.ai";
const COMPLETIONS_PATH = "/api/v1/chat/completions";
const GENERATION_PATH = "/api/v1/generation";

const config: PipelineConfig = makeConfig({
	moduleRoots: ["/absolute/path/to/Biology of Disease"],
	stages: {
		"transcript-structuring": { modelId: "openai/gpt-4o", temperature: 0.2, maxTokens: 8192 },
	},
});

const messages = [{ role: "user", content: "Structure this transcript." }] as const;

function completionBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: "gen-abc",
		choices: [
			{
				index: 0,
				message: { role: "assistant", content: "Structured notes." },
				finish_reason: "stop",
			},
		],
		usage: { prompt_tokens: 120, completion_tokens: 45 },
		...overrides,
	};
}

function generationBody(totalCost: number): Record<string, unknown> {
	return { data: { total_cost: totalCost, tokens_prompt: 120, tokens_completion: 45 } };
}

function mockCompletion(): nock.Interceptor {
	return nock(OPENROUTER_HOST).post(COMPLETIONS_PATH);
}

function mockGeneration(): nock.Interceptor {
	return nock(OPENROUTER_HOST).get(GENERATION_PATH).query(true);
}

function call(
	overrides: Record<string, unknown> = {},
): Promise<{ content: string; cost: import("../types/pipeline.js").StageCost }> {
	return makeCompletionCall({ messages, stageId: "transcript-structuring", config, ...overrides });
}

async function captureError(promise: Promise<unknown>): Promise<Error> {
	try {
		await promise;
	} catch (error: unknown) {
		return error as Error;
	}
	throw new Error("Expected the call to reject, but it resolved");
}

beforeEach(() => {
	process.env.OPENROUTER_API_KEY = "test-key";
	nock.disableNetConnect();
});

afterEach(() => {
	nock.cleanAll();
	nock.enableNetConnect();
	vi.restoreAllMocks();
});

describe("createOpenRouterClient", () => {
	it("should configure the OpenRouter baseURL, timeout, and retries when a client is created", () => {
		const client = createOpenRouterClient();

		expect(client.baseURL).toBe("https://openrouter.ai/api/v1");
		expect(client.timeout).toBe(120_000);
		expect(client.maxRetries).toBe(5);
	});
});

describe("makeCompletionCall", () => {
	it("should send the correct baseURL, headers, and model ID when makeCompletionCall is invoked", async () => {
		let capturedBody: Record<string, unknown> = {};
		let capturedHeaders: Record<string, unknown> = {};
		nock(OPENROUTER_HOST)
			.post(COMPLETIONS_PATH)
			.reply(function reply(_uri, body) {
				capturedBody = body as Record<string, unknown>;
				capturedHeaders = this.req.headers as Record<string, unknown>;
				return [200, completionBody()];
			});
		mockGeneration().reply(200, generationBody(0.0042));

		const result = await call();

		expect(capturedBody.model).toBe("openai/gpt-4o");
		expect(capturedHeaders["x-title"]).toBe("Lecture Notes Pipeline");
		expect(capturedHeaders.authorization).toBe("Bearer test-key");
		expect(result.content).toBe("Structured notes.");
	});

	it("should populate totalCostUsd and token counts when the generation endpoint returns cost", async () => {
		mockCompletion().reply(200, completionBody());
		mockGeneration().reply(200, generationBody(0.0042));

		const result = await call();

		expect(result.cost).toEqual({
			promptTokens: 120,
			completionTokens: 45,
			callCount: 1,
			totalCostUsd: 0.0042,
		});
	});

	it("should resolve with a fully-resolved cost when the promise settles after the cost lookup", async () => {
		mockCompletion().reply(200, completionBody());
		mockGeneration().reply(200, generationBody(0.0042));

		const result = await call();

		expect(typeof result.cost.totalCostUsd).toBe("number");
		expect(nock.isDone()).toBe(true);
	});

	it("should default token counts to zero when the completion response omits usage", async () => {
		mockCompletion().reply(200, completionBody({ usage: undefined }));
		mockGeneration().reply(200, generationBody(0.0042));

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
		mockGeneration().reply(200, generationBody(0.0042));

		const result = await call();

		expect(result.content).toBe("");
	});

	it("should resolve with totalCostUsd null and costResolutionError set when the cost lookup fails after all retries", async () => {
		mockCompletion().reply(200, completionBody());
		nock(OPENROUTER_HOST)
			.get(GENERATION_PATH)
			.query(true)
			.times(4)
			.reply(500, {}, { "retry-after": "0" });

		const result = await call();

		expect(result.cost.totalCostUsd).toBeNull();
		expect(result.cost).toMatchObject({ promptTokens: 120, completionTokens: 45, callCount: 1 });
		if (result.cost.totalCostUsd === null) {
			expect(result.cost.costResolutionError).toMatch(/./);
		}
	});

	it("should retry the cost lookup with backoff and resolve the cost when a transient failure recovers", async () => {
		mockCompletion().reply(200, completionBody());
		nock(OPENROUTER_HOST).get(GENERATION_PATH).query(true).reply(500, {}, { "retry-after": "0" });
		nock(OPENROUTER_HOST).get(GENERATION_PATH).query(true).reply(200, generationBody(0.01));

		const result = await call();

		expect(result.cost.totalCostUsd).toBe(0.01);
	});

	it("should retry the completion call with backoff and succeed when the first response is a 429", async () => {
		nock(OPENROUTER_HOST).post(COMPLETIONS_PATH).reply(429, {}, { "retry-after": "0" });
		nock(OPENROUTER_HOST).post(COMPLETIONS_PATH).reply(200, completionBody());
		mockGeneration().reply(200, generationBody(0.0042));

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
	});

	it("should throw when the completion request times out before a response arrives", async () => {
		const client = new OpenAI({
			apiKey: "test-key",
			baseURL: "https://openrouter.ai/api/v1",
			timeout: 20,
			maxRetries: 0,
		});
		nock(OPENROUTER_HOST).post(COMPLETIONS_PATH).delay(200).reply(200, completionBody());

		const error = await captureError(call({ client }));

		expect(error.message).toMatch(/timed out|timeout/i);
	});

	it("should apply a 30s per-attempt timeout and bounded retries when the cost lookup runs", async () => {
		const client = createOpenRouterClient();
		const getSpy = vi.spyOn(client, "get");
		mockCompletion().reply(200, completionBody());
		mockGeneration().reply(200, generationBody(0.0042));

		await call({ client });

		expect(getSpy).toHaveBeenCalledWith(
			"/generation",
			expect.objectContaining({ timeout: 30_000, maxRetries: 3 }),
		);
	});

	it("should throw when the requested stage is not present in the config", async () => {
		const error = await captureError(call({ stageId: "synthesis" }));

		expect(error.message).toMatch(/synthesis/);
	});
});
