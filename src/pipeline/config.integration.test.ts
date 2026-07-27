import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nock from "nock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigError, clearModelIdCache, loadConfig } from "./config.js";

const OPENROUTER_HOST = "https://openrouter.ai";
const MODELS_PATH = "/api/v1/models";
const CONFIG_FILENAME = "pipeline-config.json";

// Model IDs present in the mocked OpenRouter models response and used by the
// structurally valid config the tests build on.
const KNOWN_MODEL_IDS = ["openai/gpt-4o", "google/gemini-2.5-flash"] as const;

/**
 * A structurally valid config as a fresh mutable object each call, so a test can
 * mutate one field to exercise a single validation branch in isolation.
 */
function makeValidConfig(): Record<string, unknown> {
	return {
		version: "1",
		moduleRoots: ["/absolute/path/to/Biology of Disease"],
		openRouter: { rateLimitRpm: 60 },
		stages: {
			"transcript-structuring": { modelId: "openai/gpt-4o", temperature: 0.2, maxTokens: 8192 },
			"slide-conversion": {
				modelId: "google/gemini-2.5-flash",
				temperature: 0.1,
				maxTokens: 4096,
				concurrency: 3,
			},
		},
		output: { language: "en-GB", pandocEngine: "xelatex" },
	};
}

function stageModelIds(config: Record<string, unknown>): Record<string, { modelId: string }> {
	return config.stages as Record<string, { modelId: string }>;
}

function mockModelsResponse(ids: readonly string[]): void {
	nock(OPENROUTER_HOST)
		.get(MODELS_PATH)
		.reply(200, { data: ids.map((id) => ({ id })) });
}

let projectRoot: string;

async function writeConfig(config: unknown): Promise<void> {
	await writeFile(join(projectRoot, CONFIG_FILENAME), JSON.stringify(config));
}

async function captureError(promise: Promise<unknown>): Promise<Error> {
	try {
		await promise;
	} catch (error: unknown) {
		return error as Error;
	}
	throw new Error("Expected loadConfig to reject, but it resolved");
}

beforeEach(async () => {
	clearModelIdCache();
	nock.disableNetConnect();
	projectRoot = await mkdtemp(join(tmpdir(), "config-test-"));
});

afterEach(async () => {
	nock.cleanAll();
	nock.enableNetConnect();
	await rm(projectRoot, { recursive: true, force: true });
});

describe("loadConfig model-ID resolution check", () => {
	it("should throw ConfigError naming the offending stage when a configured modelId is not in the OpenRouter models response", async () => {
		const config = makeValidConfig();
		stageModelIds(config)["transcript-structuring"].modelId = "openai/nonexistent-model";
		await writeConfig(config);
		mockModelsResponse(KNOWN_MODEL_IDS);

		const error = await captureError(loadConfig({ projectRoot }));

		expect(error).toBeInstanceOf(ConfigError);
		expect(error.message).toContain("transcript-structuring");
		expect(error.message).toContain("openai/nonexistent-model");
		expect(error.message).toContain("https://openrouter.ai/models");
	});

	it("should throw ConfigError with a helpful hint when a placeholder like <REASONING_MODEL> is left un-substituted", async () => {
		const config = makeValidConfig();
		stageModelIds(config)["transcript-structuring"].modelId = "<REASONING_MODEL>";
		await writeConfig(config);
		mockModelsResponse(["google/gemini-2.5-flash"]);

		const error = await captureError(loadConfig({ projectRoot }));

		expect(error).toBeInstanceOf(ConfigError);
		expect(error.message).toContain("<REASONING_MODEL>");
		expect(error.message).toContain("placeholder");
	});

	it("should accept the config when every stage modelId appears in the OpenRouter response", async () => {
		await writeConfig(makeValidConfig());
		mockModelsResponse(KNOWN_MODEL_IDS);

		const config = await loadConfig({ projectRoot });

		expect(config.version).toBe("1");
		expect(config.stages["transcript-structuring"]?.modelId).toBe("openai/gpt-4o");
		expect(config.stages["slide-conversion"]?.concurrency).toBe(3);
	});

	it("should skip the model-ID check when --skip-model-check is set", async () => {
		const config = makeValidConfig();
		stageModelIds(config)["transcript-structuring"].modelId = "totally/made-up-model";
		await writeConfig(config);

		const result = await loadConfig({ projectRoot, skipModelCheck: true });

		expect(result.stages["transcript-structuring"]?.modelId).toBe("totally/made-up-model");
	});

	it("should fetch the OpenRouter model list only once when loadConfig is called repeatedly", async () => {
		await writeConfig(makeValidConfig());
		mockModelsResponse(KNOWN_MODEL_IDS);

		await loadConfig({ projectRoot });
		const second = await loadConfig({ projectRoot });

		expect(second.version).toBe("1");
		expect(nock.isDone()).toBe(true);
	});

	it("should skip the model list fetch when no stages are configured", async () => {
		const config = makeValidConfig();
		config.stages = {};
		await writeConfig(config);

		const result = await loadConfig({ projectRoot });

		expect(result.stages).toEqual({});
	});

	it("should throw ConfigError when the OpenRouter model list cannot be fetched", async () => {
		await writeConfig(makeValidConfig());
		nock(OPENROUTER_HOST).get(MODELS_PATH).reply(500, {});

		const error = await captureError(loadConfig({ projectRoot }));

		expect(error).toBeInstanceOf(ConfigError);
		expect(error.message).toMatch(/model list/i);
	});
});

describe("loadConfig file handling", () => {
	it("should throw ConfigError when the config file is missing", async () => {
		const error = await captureError(loadConfig({ projectRoot, skipModelCheck: true }));

		expect(error).toBeInstanceOf(ConfigError);
		expect(error.message).toMatch(/read/i);
	});

	it("should throw ConfigError when the config file is not valid JSON", async () => {
		await writeFile(join(projectRoot, CONFIG_FILENAME), "{ not valid json");

		const error = await captureError(loadConfig({ projectRoot, skipModelCheck: true }));

		expect(error).toBeInstanceOf(ConfigError);
		expect(error.message).toMatch(/json/i);
	});
});

describe("loadConfig shape validation", () => {
	it.each([
		{
			name: "version is missing",
			mutate: (c: Record<string, unknown>) => delete c.version,
			match: /version/,
		},
		{
			name: "version is not a string",
			mutate: (c: Record<string, unknown>) => {
				c.version = 1;
			},
			match: /version/,
		},
		{
			name: "moduleRoots is missing",
			mutate: (c: Record<string, unknown>) => delete c.moduleRoots,
			match: /moduleRoots/,
		},
		{
			name: "moduleRoots is not an array",
			mutate: (c: Record<string, unknown>) => {
				c.moduleRoots = "not-an-array";
			},
			match: /moduleRoots/,
		},
		{
			name: "a moduleRoots entry is not a string",
			mutate: (c: Record<string, unknown>) => {
				c.moduleRoots = [42];
			},
			match: /moduleRoots/,
		},
		{
			name: "openRouter is missing",
			mutate: (c: Record<string, unknown>) => delete c.openRouter,
			match: /openRouter/,
		},
		{
			name: "openRouter is null",
			mutate: (c: Record<string, unknown>) => {
				c.openRouter = null;
			},
			match: /openRouter/,
		},
		{
			name: "rateLimitRpm is not a number",
			mutate: (c: Record<string, unknown>) => {
				c.openRouter = { rateLimitRpm: "fast" };
			},
			match: /rateLimitRpm/,
		},
		{
			name: "stages is missing",
			mutate: (c: Record<string, unknown>) => delete c.stages,
			match: /stages/,
		},
		{
			name: "stages is an array",
			mutate: (c: Record<string, unknown>) => {
				c.stages = [];
			},
			match: /stages/,
		},
		{
			name: "a stage is not an object",
			mutate: (c: Record<string, unknown>) => {
				c.stages = { synthesis: "gpt" };
			},
			match: /synthesis/,
		},
		{
			name: "a stage modelId is missing",
			mutate: (c: Record<string, unknown>) => {
				c.stages = { synthesis: {} };
			},
			match: /modelId/,
		},
		{
			name: "a stage modelId is not a string",
			mutate: (c: Record<string, unknown>) => {
				c.stages = { synthesis: { modelId: 5 } };
			},
			match: /modelId/,
		},
		{
			name: "a stage param is not a number",
			mutate: (c: Record<string, unknown>) => {
				c.stages = { synthesis: { modelId: "openai/gpt-4o", temperature: "hot" } };
			},
			match: /temperature/,
		},
		{
			name: "output is missing",
			mutate: (c: Record<string, unknown>) => delete c.output,
			match: /output/,
		},
		{
			name: "output.language is not a string",
			mutate: (c: Record<string, unknown>) => {
				c.output = { language: 1, pandocEngine: "xelatex" };
			},
			match: /language/,
		},
		{
			name: "output.pandocEngine is not a string",
			mutate: (c: Record<string, unknown>) => {
				c.output = { language: "en-GB", pandocEngine: 9 };
			},
			match: /pandocEngine/,
		},
	])("should throw ConfigError when $name", async ({ mutate, match }) => {
		const config = makeValidConfig();
		mutate(config);
		await writeConfig(config);

		const error = await captureError(loadConfig({ projectRoot, skipModelCheck: true }));

		expect(error).toBeInstanceOf(ConfigError);
		expect(error.message).toMatch(match);
	});
});
