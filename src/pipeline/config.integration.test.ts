import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import nock from "nock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONFIG_FILENAME, ConfigError, clearModelIdCache, loadConfig } from "./config.js";
import {
	captureError,
	corruptJson,
	exampleConfig,
	makeConfig,
	makeTempDir,
	openRouterModelId,
	openRouterStageConfig,
	openRouterUrls,
	transcriptionModelId,
} from "./fixtures.js";

// Two model IDs the mocked OpenRouter models response returns. The valid config
// below configures exactly these, so the check under test passes for reasons
// this suite controls; a second ID is needed so a test can fail one stage's
// model while leaving the other's resolvable.
const STRUCTURING_MODEL_ID = openRouterModelId;
const SLIDE_MODEL_ID = "google/gemini-2.5-flash";
const KNOWN_MODEL_IDS = [STRUCTURING_MODEL_ID, SLIDE_MODEL_ID] as const;

/**
 * A structurally valid config as a fresh mutable object each call, so a test can
 * mutate one field to exercise a single validation branch in isolation.
 *
 * Round-tripped from the typed fixture rather than restated, so "valid" means
 * one thing across the suite: a new required field cannot be added to the
 * fixture and forgotten here, which would leave these tests asserting against a
 * config the loader would reject for an unrelated reason.
 */
function makeValidConfig(): Record<string, unknown> {
	return JSON.parse(
		JSON.stringify(
			makeConfig({
				moduleRoots: exampleConfig.moduleRoots,
				stages: {
					// The example's own tuning for each, with only the placeholder models
					// replaced by the two the mocked model list knows.
					"transcript-structuring": openRouterStageConfig({
						stageId: "transcript-structuring",
					}),
					"slide-conversion": openRouterStageConfig({
						stageId: "slide-conversion",
						modelId: SLIDE_MODEL_ID,
					}),
				},
			}),
		),
	) as Record<string, unknown>;
}

const GATEWAY_ORIGIN = "https://gateway.example.test";
const GATEWAY_BASE_URL = `${GATEWAY_ORIGIN}/openrouter/v1`;

/**
 * Builds a corrupter for one config section: it returns that section as raw
 * JSON with the named fields replaced, so a validation case states only the
 * field it is corrupting. `undefined` drops the field, which is how the
 * "missing" cases are written.
 *
 * @param sectionName - The top-level config key the corrupter targets.
 * @returns A function taking the field overrides and returning the section.
 */
function sectionCorrupter(
	sectionName: string,
): (overrides: Record<string, unknown>) => Record<string, unknown> {
	return (overrides) => {
		const section: Record<string, unknown> = {
			...(makeValidConfig()[sectionName] as Record<string, unknown>),
			...overrides,
		};
		for (const [key, value] of Object.entries(overrides)) {
			if (value === undefined) {
				delete section[key];
			}
		}
		return section;
	};
}

const openRouterSection = sectionCorrupter("openRouter");
const elevenLabsSection = sectionCorrupter("elevenLabs");

function stageModelIds(config: Record<string, unknown>): Record<string, { modelId: string }> {
	return config.stages as Record<string, { modelId: string }>;
}

/**
 * Retunes the structuring stage's model ID in place, keeping the rest of its
 * tuning. The tests that do this exercise validation of the ID itself, so every
 * other field has to stay valid — replacing the whole entry would drop the
 * example's tuning and fail the loader for an unrelated reason.
 */
function setStructuringModelId({
	config,
	modelId,
}: {
	readonly config: Record<string, unknown>;
	readonly modelId: string;
}): void {
	const stage = stageModelIds(config)["transcript-structuring"];
	if (stage === undefined) {
		throw new Error('Fixture has no "transcript-structuring" stage to retune');
	}
	stage.modelId = modelId;
}

function mockModelsResponse(ids: readonly string[]): void {
	nock(openRouterUrls.origin)
		.get(openRouterUrls.models)
		.reply(200, { data: ids.map((id) => ({ id })) });
}

let projectRoot: string;

async function writeConfig(config: unknown): Promise<void> {
	await writeFile(join(projectRoot, CONFIG_FILENAME), JSON.stringify(config));
}

/**
 * Writes a valid config addressing OpenRouter somewhere other than the default,
 * which is how the derived-address tests prove the loader reads the config
 * rather than a constant.
 */
async function writeConfigAtGateway(): Promise<void> {
	const config = makeValidConfig();
	config.openRouter = openRouterSection({ baseUrl: GATEWAY_BASE_URL });
	await writeConfig(config);
}

beforeEach(async () => {
	clearModelIdCache();
	nock.disableNetConnect();
	projectRoot = await makeTempDir({ prefix: "config-test-" });
});

afterEach(async () => {
	nock.cleanAll();
	nock.enableNetConnect();
	await rm(projectRoot, { recursive: true, force: true });
});

describe("loadConfig model-ID resolution check", () => {
	it.each([
		{
			scenario: "a configured modelId is not in the OpenRouter models response",
			stageId: "transcript-structuring",
			modelId: "openai/nonexistent-model",
		},
		{
			scenario: "a modelId names a provider that is not exempt from the check",
			stageId: "transcription",
			modelId: "deepgram/nova-3",
		},
	])("should throw ConfigError naming the offending stage and model when $scenario", async ({
		stageId,
		modelId,
	}) => {
		const config = makeValidConfig();
		stageModelIds(config)[stageId] = { modelId };
		await writeConfig(config);
		mockModelsResponse(KNOWN_MODEL_IDS);

		const error = await captureError(loadConfig({ projectRoot }));

		expect(error).toBeInstanceOf(ConfigError);
		expect(error.message).toContain(stageId);
		expect(error.message).toContain(modelId);
		expect(error.message).toContain(openRouterUrls.modelsPage);
	});

	it("should fetch the model list from the configured base URL when the check runs", async () => {
		await writeConfigAtGateway();
		const scope = nock(GATEWAY_ORIGIN)
			.get("/openrouter/v1/models")
			.reply(200, { data: KNOWN_MODEL_IDS.map((id) => ({ id })) });

		await loadConfig({ projectRoot });

		expect(scope.isDone()).toBe(true);
	});

	it.each([
		{
			address: "the default address",
			write: async () => {
				await writeConfig(makeValidConfig());
			},
			origin: openRouterUrls.origin,
			path: openRouterUrls.models,
			page: openRouterUrls.modelsPage,
		},
		{
			address: "a configured gateway",
			write: writeConfigAtGateway,
			origin: GATEWAY_ORIGIN,
			path: `${new URL(GATEWAY_BASE_URL).pathname}/models`,
			page: `${GATEWAY_ORIGIN}/models`,
		},
	])("should fail naming that host's models page when the model list cannot be fetched from $address", async ({
		write,
		origin,
		path,
		page,
	}) => {
		await write();
		nock(origin).get(path).reply(500, {});

		const error = await captureError(loadConfig({ projectRoot }));

		expect(error).toBeInstanceOf(ConfigError);
		expect(error.message).toMatch(/model list/i);
		expect(error.message).toContain(page);
	});

	it("should throw ConfigError with a helpful hint when a placeholder like <REASONING_MODEL> is left un-substituted", async () => {
		const config = makeValidConfig();
		setStructuringModelId({ config, modelId: "<REASONING_MODEL>" });
		await writeConfig(config);
		mockModelsResponse([SLIDE_MODEL_ID]);

		const error = await captureError(loadConfig({ projectRoot }));

		expect(error).toBeInstanceOf(ConfigError);
		expect(error.message).toContain("<REASONING_MODEL>");
		expect(error.message).toContain("placeholder");
	});

	it("should skip the OpenRouter check when a model ID names an exempt provider", async () => {
		const config = makeValidConfig();
		stageModelIds(config).transcription = { modelId: transcriptionModelId };
		await writeConfig(config);
		mockModelsResponse(KNOWN_MODEL_IDS);

		const loaded = await loadConfig({ projectRoot });

		expect(loaded.stages.transcription?.modelId).toBe(transcriptionModelId);
	});

	it("should not fetch the OpenRouter model list when every configured provider is exempt", async () => {
		const config = makeValidConfig();
		config.modelIdCheck = { exemptProviders: ["openai", "google"] };
		await writeConfig(config);

		const loaded = await loadConfig({ projectRoot });

		expect(loaded.stages["transcript-structuring"]?.modelId).toBe(STRUCTURING_MODEL_ID);
	});

	it("should accept the config when every stage modelId appears in the OpenRouter response", async () => {
		await writeConfig(makeValidConfig());
		mockModelsResponse(KNOWN_MODEL_IDS);

		const config = await loadConfig({ projectRoot });

		expect(config.version).toBe("1");
		expect(config.stages["transcript-structuring"]?.modelId).toBe(STRUCTURING_MODEL_ID);
		expect(config.stages["slide-conversion"]?.concurrency).toBe(3);
	});

	it("should skip the model-ID check when skipModelCheck is set", async () => {
		const config = makeValidConfig();
		setStructuringModelId({ config, modelId: "totally/made-up-model" });
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
});

describe("loadConfig file handling", () => {
	it("should throw ConfigError when the config file is missing", async () => {
		const error = await captureError(loadConfig({ projectRoot, skipModelCheck: true }));

		expect(error).toBeInstanceOf(ConfigError);
		expect(error.message).toMatch(/read/i);
	});

	it("should throw ConfigError when the config file is not valid JSON", async () => {
		await writeFile(join(projectRoot, CONFIG_FILENAME), corruptJson);

		const error = await captureError(loadConfig({ projectRoot, skipModelCheck: true }));

		expect(error).toBeInstanceOf(ConfigError);
		expect(error.message).toMatch(/json/i);
	});
});

describe("loadConfig shape validation", () => {
	it.each([
		{
			name: "version is missing",
			mutate: (config: Record<string, unknown>) => delete config.version,
			match: /version/,
		},
		{
			name: "version is not a string",
			mutate: (config: Record<string, unknown>) => {
				config.version = 1;
			},
			match: /version/,
		},
		{
			name: "moduleRoots is missing",
			mutate: (config: Record<string, unknown>) => delete config.moduleRoots,
			match: /moduleRoots/,
		},
		{
			name: "moduleRoots is not an array",
			mutate: (config: Record<string, unknown>) => {
				config.moduleRoots = "not-an-array";
			},
			match: /moduleRoots/,
		},
		{
			name: "a moduleRoots entry is not a string",
			mutate: (config: Record<string, unknown>) => {
				config.moduleRoots = [42];
			},
			match: /moduleRoots/,
		},
		{
			name: "openRouter is missing",
			mutate: (config: Record<string, unknown>) => delete config.openRouter,
			match: /openRouter/,
		},
		{
			name: "openRouter is null",
			mutate: (config: Record<string, unknown>) => {
				config.openRouter = null;
			},
			match: /openRouter/,
		},
		{
			name: "baseUrl is missing",
			mutate: (config: Record<string, unknown>) => {
				config.openRouter = openRouterSection({ baseUrl: undefined });
			},
			match: /baseUrl/,
		},
		{
			name: "baseUrl is not a string",
			mutate: (config: Record<string, unknown>) => {
				config.openRouter = openRouterSection({ baseUrl: 443 });
			},
			match: /baseUrl/,
		},
		{
			name: "baseUrl is not an absolute URL",
			mutate: (config: Record<string, unknown>) => {
				config.openRouter = openRouterSection({ baseUrl: "/api/v1" });
			},
			match: /baseUrl/,
		},
		{
			// The typo class the check exists to reject: every scheme parses, so
			// `htp://` is accepted as a URL and only reveals itself later, as the
			// literal "null" origin printed into the error meant to help.
			name: "baseUrl's scheme is mistyped",
			mutate: (config: Record<string, unknown>) => {
				config.openRouter = openRouterSection({ baseUrl: "htp://openrouter.ai/api/v1" });
			},
			match: /baseUrl/,
		},
		{
			name: "completionTimeoutMs is missing",
			mutate: (config: Record<string, unknown>) => {
				config.openRouter = openRouterSection({ completionTimeoutMs: undefined });
			},
			match: /completionTimeoutMs/,
		},
		{
			name: "completionMaxRetries is not a number",
			mutate: (config: Record<string, unknown>) => {
				config.openRouter = openRouterSection({ completionMaxRetries: "lots" });
			},
			match: /completionMaxRetries/,
		},
		{
			name: "costLookupTimeoutMs is missing",
			mutate: (config: Record<string, unknown>) => {
				config.openRouter = openRouterSection({ costLookupTimeoutMs: undefined });
			},
			match: /costLookupTimeoutMs/,
		},
		{
			name: "costLookupMaxRetries is not a number",
			mutate: (config: Record<string, unknown>) => {
				config.openRouter = openRouterSection({ costLookupMaxRetries: null });
			},
			match: /costLookupMaxRetries/,
		},
		{
			name: "elevenLabs is missing",
			mutate: (config: Record<string, unknown>) => delete config.elevenLabs,
			match: /elevenLabs/,
		},
		{
			name: "elevenLabs.baseUrl is missing",
			mutate: (config: Record<string, unknown>) => {
				config.elevenLabs = elevenLabsSection({ baseUrl: undefined });
			},
			match: /elevenLabs\.baseUrl/,
		},
		{
			name: "elevenLabs.baseUrl is not an absolute URL",
			mutate: (config: Record<string, unknown>) => {
				config.elevenLabs = elevenLabsSection({ baseUrl: "/v1" });
			},
			match: /elevenLabs\.baseUrl/,
		},
		{
			name: "languageCode is missing",
			mutate: (config: Record<string, unknown>) => {
				config.elevenLabs = elevenLabsSection({ languageCode: undefined });
			},
			match: /languageCode/,
		},
		{
			name: "languageCode is not a string",
			mutate: (config: Record<string, unknown>) => {
				config.elevenLabs = elevenLabsSection({ languageCode: 3 });
			},
			match: /languageCode/,
		},
		{
			name: "costPerAudioHourUsd is not a number",
			mutate: (config: Record<string, unknown>) => {
				config.elevenLabs = elevenLabsSection({ costPerAudioHourUsd: "0.22" });
			},
			match: /costPerAudioHourUsd/,
		},
		{
			name: "currency is missing",
			mutate: (config: Record<string, unknown>) => delete config.currency,
			match: /currency/,
		},
		{
			name: "gbpPerUsd is not a number",
			mutate: (config: Record<string, unknown>) => {
				config.currency = { gbpPerUsd: "0.74" };
			},
			match: /gbpPerUsd/,
		},
		{
			name: "modelIdCheck is missing",
			mutate: (config: Record<string, unknown>) => delete config.modelIdCheck,
			match: /modelIdCheck/,
		},
		{
			name: "exemptProviders is not an array",
			mutate: (config: Record<string, unknown>) => {
				config.modelIdCheck = { exemptProviders: "elevenlabs" };
			},
			match: /exemptProviders/,
		},
		{
			name: "an exemptProviders entry is not a string",
			mutate: (config: Record<string, unknown>) => {
				config.modelIdCheck = { exemptProviders: [42] };
			},
			match: /exemptProviders/,
		},
		{
			name: "stages is missing",
			mutate: (config: Record<string, unknown>) => delete config.stages,
			match: /stages/,
		},
		{
			name: "stages is an array",
			mutate: (config: Record<string, unknown>) => {
				config.stages = [];
			},
			match: /stages/,
		},
		{
			// A mistyped key otherwise validates in full — model ID check included —
			// while the stage it was meant to configure silently has no config.
			name: "a stage key names no pipeline stage",
			mutate: (config: Record<string, unknown>) => {
				config.stages = { "transcript-strucuring": { modelId: openRouterModelId } };
			},
			match: /transcript-strucuring/,
		},
		{
			name: "a stage is not an object",
			mutate: (config: Record<string, unknown>) => {
				config.stages = { synthesis: "gpt" };
			},
			match: /synthesis/,
		},
		{
			name: "a stage modelId is missing",
			mutate: (config: Record<string, unknown>) => {
				config.stages = { synthesis: {} };
			},
			match: /modelId/,
		},
		{
			name: "a stage modelId is not a string",
			mutate: (config: Record<string, unknown>) => {
				config.stages = { synthesis: { modelId: 5 } };
			},
			match: /modelId/,
		},
		{
			name: "a stage param is not a number",
			mutate: (config: Record<string, unknown>) => {
				config.stages = { synthesis: { modelId: openRouterModelId, temperature: "hot" } };
			},
			match: /temperature/,
		},
		{
			name: "output is missing",
			mutate: (config: Record<string, unknown>) => delete config.output,
			match: /output/,
		},
		{
			name: "output.language is not a string",
			mutate: (config: Record<string, unknown>) => {
				config.output = { language: 1, pandocEngine: "xelatex" };
			},
			match: /language/,
		},
		{
			name: "output.pandocEngine is not a string",
			mutate: (config: Record<string, unknown>) => {
				config.output = { language: "en-GB", pandocEngine: 9 };
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
