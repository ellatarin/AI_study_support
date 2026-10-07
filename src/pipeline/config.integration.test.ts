import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import nock from "nock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONFIG_FILENAME, type StageConfig } from "../types/pipeline.js";
import { ConfigError, loadConfig } from "./config.js";
import {
	blockNetwork,
	captureError,
	corruptJson,
	exampleConfig,
	makeConfig,
	makeTempDir,
	openRouterModelId,
	openRouterStageConfig,
	openRouterUrls,
	openRouterUrlsAt,
	resetStubbedApi,
	transcriptionModelId,
} from "./fixtures.js";

// The two model IDs in the mocked model list. The valid config uses only these.
// A test can then fail the model of one stage and keep the other valid.
const STRUCTURING_MODEL_ID = openRouterModelId;
const SLIDE_MODEL_ID = "google/gemini-2.5-flash";
const KNOWN_MODEL_IDS = [STRUCTURING_MODEL_ID, SLIDE_MODEL_ID] as const;

// Each tuning field of a stage's config. `satisfies` makes a renamed field fail to
// compile here, so no case tests a key that nothing reads.
const TUNING_FIELDS = [
	"temperature",
	"maxTokens",
	"concurrency",
	"callConcurrency",
	"sendGapSeconds",
	"maxIterations",
] as const satisfies readonly (keyof StageConfig)[];

/**
 * Makes a new valid config that a test can change. It is copied from the typed
 * fixture, so a new required field in the fixture is also here.
 */
function makeValidConfig(): Record<string, unknown> {
	return JSON.parse(
		JSON.stringify(
			makeConfig({
				moduleRoots: exampleConfig.moduleRoots,
				stages: {
					// The tuning of the example, with the two model IDs of the mocked list.
					"transcript-structuring": openRouterStageConfig({
						stageId: "transcript-structuring",
					}),
					"read-slides": openRouterStageConfig({
						stageId: "read-slides",
						modelId: SLIDE_MODEL_ID,
					}),
				},
			}),
		),
	) as Record<string, unknown>;
}

// A base URL that is not the default and has a path of its own. The tests that use
// it prove that the loader builds each address from the configured base URL.
const GATEWAY_BASE_URL = "https://gateway.example.test/openrouter/v1";
const gatewayUrls = openRouterUrlsAt(GATEWAY_BASE_URL);

/**
 * Makes a function that gives one section of the valid config with some fields
 * replaced. A value of `undefined` removes the field.
 *
 * @param sectionName - The top-level config key of the section.
 * @returns A function that takes the new field values and gives the section.
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
const finalOutputSection = sectionCorrupter("finalOutput");
const namingSection = sectionCorrupter("naming");

/**
 * Gives the `stages` section of a raw config.
 *
 * @param config - The raw config.
 * @returns The config of each stage, by stage id.
 */
function configuredStages(
	config: Record<string, unknown>,
): Record<string, Record<string, unknown>> {
	return config.stages as Record<string, Record<string, unknown>>;
}

/**
 * Gives the raw config of `transcript-structuring`, for a test to change one field
 * in place. The other fields keep the tuning of the example.
 *
 * @param config - The raw config.
 * @returns The raw config of the stage.
 * @throws {Error} If the fixture has no config for `transcript-structuring`.
 */
function structuringStage(config: Record<string, unknown>): Record<string, unknown> {
	const stage = configuredStages(config)["transcript-structuring"];
	if (stage === undefined) {
		throw new Error('Fixture has no "transcript-structuring" stage to retune');
	}
	return stage;
}

/** Changes the model ID of `transcript-structuring` and keeps its tuning. */
function setStructuringModelId({
	config,
	modelId,
}: {
	readonly config: Record<string, unknown>;
	readonly modelId: string;
}): void {
	structuringStage(config).modelId = modelId;
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
 * Loads the config and gives the error that the loader throws.
 *
 * @returns The error.
 */
function configRejection(): Promise<Error> {
	return captureError(loadConfig({ projectRoot }));
}

/**
 * Writes the valid config to the config file, after one change.
 *
 * @param adjust - The change to the config. By default, it changes nothing.
 */
async function writeValidConfig(
	adjust: (config: Record<string, unknown>) => void = () => undefined,
): Promise<void> {
	const config = makeValidConfig();
	adjust(config);
	await writeConfig(config);
}

/** Writes the valid config with {@link GATEWAY_BASE_URL} as the OpenRouter base URL. */
function writeConfigAtGateway(): Promise<void> {
	return writeValidConfig((config) => {
		config.openRouter = openRouterSection({ baseUrl: GATEWAY_BASE_URL });
	});
}

beforeEach(async () => {
	// The suite stubs no API key, because the model list request sends none.
	blockNetwork();
	projectRoot = await makeTempDir({ prefix: "config-test-" });
});

afterEach(async () => {
	resetStubbedApi();
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
		await writeValidConfig((config) => {
			configuredStages(config)[stageId] = { modelId };
		});
		mockModelsResponse(KNOWN_MODEL_IDS);

		const error = await configRejection();

		expect(error).toBeInstanceOf(ConfigError);
		expect(error.message).toContain(stageId);
		expect(error.message).toContain(modelId);
		expect(error.message).toContain(openRouterUrls.modelsPage);
	});

	it("should fetch the model list from the configured base URL when the check runs", async () => {
		await writeConfigAtGateway();
		const scope = nock(gatewayUrls.origin)
			.get(gatewayUrls.models)
			.reply(200, { data: KNOWN_MODEL_IDS.map((id) => ({ id })) });

		await loadConfig({ projectRoot });

		expect(scope.isDone()).toBe(true);
	});

	it.each([
		{
			address: "the default address",
			write: writeValidConfig,
			origin: openRouterUrls.origin,
			path: openRouterUrls.models,
			page: openRouterUrls.modelsPage,
		},
		{
			address: "a configured gateway",
			write: writeConfigAtGateway,
			origin: gatewayUrls.origin,
			path: gatewayUrls.models,
			page: gatewayUrls.modelsPage,
		},
	])("should fail naming that host's models page when the model list cannot be fetched from $address", async ({
		write,
		origin,
		path,
		page,
	}) => {
		await write();
		nock(origin).get(path).reply(500, {});

		const error = await configRejection();

		expect(error).toBeInstanceOf(ConfigError);
		expect(error.message).toMatch(/model list/i);
		expect(error.message).toContain(page);
	});

	it("should throw ConfigError with a helpful hint when a placeholder like <REASONING_MODEL> is left un-substituted", async () => {
		await writeValidConfig((config) => {
			setStructuringModelId({ config, modelId: "<REASONING_MODEL>" });
		});
		mockModelsResponse([SLIDE_MODEL_ID]);

		const error = await configRejection();

		expect(error).toBeInstanceOf(ConfigError);
		expect(error.message).toContain("<REASONING_MODEL>");
		expect(error.message).toContain("placeholder");
	});

	it("should skip the OpenRouter check when a model ID names an exempt provider", async () => {
		await writeValidConfig((config) => {
			configuredStages(config).transcription = { modelId: transcriptionModelId };
		});
		mockModelsResponse(KNOWN_MODEL_IDS);

		const loaded = await loadConfig({ projectRoot });

		expect(loaded.stages.transcription?.modelId).toBe(transcriptionModelId);
	});

	it("should not fetch the OpenRouter model list when every configured provider is exempt", async () => {
		// The model list is not mocked and the network is blocked. So a request for
		// the list makes the test fail.
		await writeValidConfig((config) => {
			config.modelIdCheck = { exemptProviders: ["openai", "google"] };
		});

		const loaded = await loadConfig({ projectRoot });

		expect(loaded.stages["transcript-structuring"]?.modelId).toBe(STRUCTURING_MODEL_ID);
	});

	it("should accept the config when every stage modelId appears in the OpenRouter response", async () => {
		await writeValidConfig();
		mockModelsResponse(KNOWN_MODEL_IDS);

		const config = await loadConfig({ projectRoot });

		expect(config.version).toBe("1");
		expect(config.stages["transcript-structuring"]?.modelId).toBe(STRUCTURING_MODEL_ID);
		expect(config.stages["read-slides"]?.concurrency).toBe(3);
	});

	it("should skip the model list fetch when no stages are configured", async () => {
		const config = makeValidConfig();
		config.stages = {};
		await writeConfig(config);

		const result = await loadConfig({ projectRoot });

		expect(result.stages).toEqual({});
	});
});

describe("loadConfig stage tuning", () => {
	it.each(
		TUNING_FIELDS,
	)("should leave %s unset, and the rest of the stage alone, when it is written as null", async (field) => {
		await writeValidConfig((config) => {
			structuringStage(config)[field] = null;
		});
		mockModelsResponse(KNOWN_MODEL_IDS);

		const loaded = await loadConfig({ projectRoot });

		const stage = loaded.stages["transcript-structuring"];
		expect(stage?.[field]).toBeUndefined();
		expect(stage?.modelId).toBe(STRUCTURING_MODEL_ID);
	});

	it("should keep a fractional sendGapSeconds when group-into-topics sets it", async () => {
		await writeValidConfig((config) => {
			configuredStages(config)["group-into-topics"] = {
				modelId: STRUCTURING_MODEL_ID,
				sendGapSeconds: 0.5,
			};
		});
		mockModelsResponse(KNOWN_MODEL_IDS);

		const loaded = await loadConfig({ projectRoot });

		expect(loaded.stages["group-into-topics"]?.sendGapSeconds).toBe(0.5);
	});
});

/**
 * The cases where the file is missing or is not valid JSON. The missing file
 * case writes nothing.
 */
const fileCases: readonly {
	readonly name: string;
	readonly seed: () => Promise<unknown>;
	readonly match: RegExp;
}[] = [
	{ name: "the config file is missing", seed: () => Promise.resolve(), match: /read/i },
	{
		name: "the config file is not valid JSON",
		seed: () => writeFile(join(projectRoot, CONFIG_FILENAME), corruptJson),
		match: /json/i,
	},
];

/** One change that makes the valid config not valid, and the text that the error must hold. */
type ShapeCase = {
	readonly name: string;
	readonly mutate: (config: Record<string, unknown>) => void;
	readonly match: RegExp;
};

/**
 * Makes the case for a missing top-level key.
 *
 * @param key - The key to remove.
 * @returns The case. Its error must name the key.
 */
function missingKeyCase(key: string): ShapeCase {
	return {
		name: `${key} is missing`,
		mutate: (config) => delete config[key],
		match: new RegExp(key),
	};
}

/**
 * Makes the case for a panel section whose bar is more than its panel size.
 *
 * @param sectionName - The top-level key of the panel section.
 * @returns The case. Its error must name the bar of the section.
 */
function barExceedsPanelCase(sectionName: string): ShapeCase {
	return {
		name: `${sectionName}.bar exceeds the panel size, so the vote could keep nothing`,
		mutate: (config) => {
			config[sectionName] = sectionCorrupter(sectionName)({ panelSize: 5, bar: 6 });
		},
		match: new RegExp(`${sectionName}\\.bar`),
	};
}

/**
 * Makes the cases for the count fields of a section. A count is a whole number of
 * at least 1. Each error must name the field by its full key.
 *
 * @param args - The section and the bad values.
 * @param args.sectionName - The top-level key of the section.
 * @param args.cases - Each field, its bad value and the problem in words. A value
 *   of `undefined` removes the field.
 * @returns One case for each bad value.
 */
function countFieldCases({
	sectionName,
	cases,
}: {
	readonly sectionName: string;
	readonly cases: readonly {
		readonly field: string;
		readonly value: unknown;
		readonly problem: string;
	}[];
}): readonly ShapeCase[] {
	const corruptSection = sectionCorrupter(sectionName);
	return cases.map(({ field, value, problem }) => ({
		name: `${sectionName}.${field} is ${problem}`,
		mutate: (config) => {
			config[sectionName] = corruptSection({ [field]: value });
		},
		match: new RegExp(`${sectionName}\\.${field}`),
	}));
}

/** The cases that change one field of the valid config to make it not valid. */
const shapeCases: readonly ShapeCase[] = [
	missingKeyCase("version"),
	{
		name: "version is not a string",
		mutate: (config: Record<string, unknown>) => {
			config.version = 1;
		},
		match: /version/,
	},
	missingKeyCase("moduleRoots"),
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
	missingKeyCase("openRouter"),
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
		// Each scheme parses, so `htp://` is a valid URL. Its origin is "null", so
		// the models page that a model-ID error names would be wrong. The loader
		// refuses the scheme for this reason.
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
	missingKeyCase("elevenLabs"),
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
	missingKeyCase("currency"),
	{
		name: "gbpPerUsd is not a number",
		mutate: (config: Record<string, unknown>) => {
			config.currency = { gbpPerUsd: "0.74" };
		},
		match: /gbpPerUsd/,
	},
	missingKeyCase("modelIdCheck"),
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
	missingKeyCase("stages"),
	{
		name: "stages is an array",
		mutate: (config: Record<string, unknown>) => {
			config.stages = [];
		},
		match: /stages/,
	},
	{
		// Without the check that each stage key names a stage, the key with a typo
		// would pass. The intended stage would then have no config.
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
	missingKeyCase("naming"),
	{
		name: "naming.modulePrefixes is not an array of strings",
		mutate: (config: Record<string, unknown>) => {
			config.naming = namingSection({ modulePrefixes: ["BOD", 7] });
		},
		match: /modulePrefixes/,
	},
	{
		// A blank module prefix would match each run of underscores or spaces in a
		// title, so the loader refuses it.
		name: "naming.modulePrefixes holds a code that is nothing but whitespace",
		mutate: (config: Record<string, unknown>) => {
			config.naming = namingSection({ modulePrefixes: ["BOD", "  "] });
		},
		match: /modulePrefixes/,
	},
	missingKeyCase("finalOutput"),
	{
		name: "finalOutput.language is not a string",
		mutate: (config: Record<string, unknown>) => {
			config.finalOutput = finalOutputSection({ language: 1 });
		},
		match: /language/,
	},
	{
		name: "finalOutput.language names no language the pipeline can write",
		mutate: (config: Record<string, unknown>) => {
			config.finalOutput = finalOutputSection({ language: "en-AU" });
		},
		match: /en-AU/,
	},
	{
		name: "finalOutput.pandocEngine is not a string",
		mutate: (config: Record<string, unknown>) => {
			config.finalOutput = finalOutputSection({ pandocEngine: 9 });
		},
		match: /pandocEngine/,
	},
	missingKeyCase("subtopicSplitting"),
	...countFieldCases({
		sectionName: "subtopicSplitting",
		cases: [
			{ field: "panelSize", value: "9", problem: "not a number" },
			{ field: "panelSize", value: 2.5, problem: "not a whole number" },
			{ field: "bar", value: 0, problem: "below 1" },
			{ field: "sizeGateWords", value: undefined, problem: "missing" },
		],
	}),
	missingKeyCase("batch"),
	...countFieldCases({
		sectionName: "batch",
		cases: [
			{ field: "concurrency", value: undefined, problem: "missing" },
			{ field: "concurrency", value: 2.5, problem: "not a whole number" },
			{ field: "concurrency", value: 0, problem: "below 1" },
		],
	}),
	{
		// Only deepen-subtopic-splitting reads callConcurrency. On a different stage,
		// callConcurrency would do nothing.
		name: "callConcurrency is set on a stage other than deepen-subtopic-splitting",
		mutate: (config: Record<string, unknown>) => {
			structuringStage(config).callConcurrency = 4;
		},
		match: /stages\.transcript-structuring\.callConcurrency/,
	},
	{
		// Only group-into-topics spaces its sends. On a different stage,
		// sendGapSeconds would do nothing.
		name: "sendGapSeconds is set on a stage other than group-into-topics",
		mutate: (config: Record<string, unknown>) => {
			structuringStage(config).sendGapSeconds = 0.5;
		},
		match: /stages\.transcript-structuring\.sendGapSeconds/,
	},
	barExceedsPanelCase("subtopicSplitting"),
	missingKeyCase("grouping"),
	...countFieldCases({
		sectionName: "grouping",
		cases: [
			{ field: "panelSize", value: undefined, problem: "missing" },
			{ field: "bar", value: 0, problem: "below 1" },
		],
	}),
	barExceedsPanelCase("grouping"),
];

describe("loadConfig rejections", () => {
	// One table for the file cases and the field cases. The loader throws a
	// ConfigError for both. Only the written file is different.
	it.each([
		...fileCases,
		...shapeCases.map(({ name, mutate, match }) => ({
			name,
			seed: async (): Promise<void> => {
				const config = makeValidConfig();
				mutate(config);
				await writeConfig(config);
			},
			match,
		})),
	])("should throw ConfigError when $name", async ({ seed, match }) => {
		await seed();

		const error = await configRejection();

		expect(error).toBeInstanceOf(ConfigError);
		expect(error.message).toMatch(match);
	});
});
