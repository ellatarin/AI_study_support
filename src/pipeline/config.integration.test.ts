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

// Two model IDs the mocked OpenRouter models response returns. The valid config
// below configures exactly these, so the check under test passes for reasons
// this suite controls; a second ID is needed so a test can fail one stage's
// model while leaving the other's resolvable.
const STRUCTURING_MODEL_ID = openRouterModelId;
const SLIDE_MODEL_ID = "google/gemini-2.5-flash";
const KNOWN_MODEL_IDS = [STRUCTURING_MODEL_ID, SLIDE_MODEL_ID] as const;

// Every optional field a stage entry may tune, checked against the stage config
// itself so a renamed field fails to compile here rather than leaving the case
// for it silently exercising a key nothing reads.
const TUNING_FIELDS = [
	"temperature",
	"maxTokens",
	"concurrency",
	"callConcurrency",
	"sendGapSeconds",
	"maxIterations",
] as const satisfies readonly (keyof StageConfig)[];

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

// An address that is not the default, and is not a bare host either: the
// derived-address tests prove the loader reads the configured base URL rather
// than a constant, which a gateway with a path of its own is what shows.
const GATEWAY_BASE_URL = "https://gateway.example.test/openrouter/v1";
const gatewayUrls = openRouterUrlsAt(GATEWAY_BASE_URL);

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
const outputSection = sectionCorrupter("output");
const namingSection = sectionCorrupter("naming");

/**
 * The config's stages record, as raw entries these tests read and retune field
 * by field.
 *
 * @param config - The raw config being corrupted or inspected.
 * @returns Its stages, keyed by stage id.
 */
function configuredStages(
	config: Record<string, unknown>,
): Record<string, Record<string, unknown>> {
	return config.stages as Record<string, Record<string, unknown>>;
}

/**
 * The structuring stage's own entry, to be retuned in place.
 *
 * The tests that reach for it change one field and leave the rest of the
 * example's tuning standing — replacing the whole entry would drop that tuning
 * and fail the loader for a reason the test is not about.
 *
 * @param config - The raw config being retuned.
 * @returns The stage's raw entry.
 * @throws {Error} If the fixture configures no structuring stage to retune.
 */
function structuringStage(config: Record<string, unknown>): Record<string, unknown> {
	const stage = configuredStages(config)["transcript-structuring"];
	if (stage === undefined) {
		throw new Error('Fixture has no "transcript-structuring" stage to retune');
	}
	return stage;
}

/**
 * Retunes the structuring stage's model ID in place, keeping the rest of its
 * tuning. The tests that do this exercise validation of the ID itself.
 */
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
 * Loads the config expecting it to be rejected, and hands back what it threw.
 * Every rejection case here differs in how the config was made bad, never in how
 * the failure is asked for, so only that difference is written out per test.
 *
 * @returns The error the load threw.
 */
function configRejection(): Promise<Error> {
	return captureError(loadConfig({ projectRoot }));
}

/**
 * Puts a config the loader will accept on disk, with one adjustment applied
 * first. Every test here starts from the same valid config and changes the one
 * thing its branch is about, so building it, changing it and writing it is one
 * step rather than three restated per test.
 *
 * @param adjust - Applied to the config before it is written; nothing by default.
 */
async function writeValidConfig(
	adjust: (config: Record<string, unknown>) => void = () => undefined,
): Promise<void> {
	const config = makeValidConfig();
	adjust(config);
	await writeConfig(config);
}

/** Writes a valid config addressing OpenRouter at {@link GATEWAY_BASE_URL}. */
function writeConfigAtGateway(): Promise<void> {
	return writeValidConfig((config) => {
		config.openRouter = openRouterSection({ baseUrl: GATEWAY_BASE_URL });
	});
}

beforeEach(async () => {
	// The network half only: nothing here sends a key, so there is none to stub.
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
		// No mocked model list on purpose: with the network blocked, a fetch the
		// exemptions should have prevented fails the test rather than passing it.
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
		expect(config.stages["slide-conversion"]?.concurrency).toBe(3);
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
 * The two ways the file itself is unusable, before its shape is ever in
 * question. The missing case seeds nothing, which is what makes it the missing
 * case.
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

/** One way of breaking a config the loader accepts, and what the error must name. */
type ShapeCase = {
	readonly name: string;
	readonly mutate: (config: Record<string, unknown>) => void;
	readonly match: RegExp;
};

/**
 * The case for a required top-level key left out of the file.
 *
 * @param key - The key to delete.
 * @returns The case, whose error must name the key.
 */
function missingKeyCase(key: string): ShapeCase {
	return {
		name: `${key} is missing`,
		mutate: (config) => delete config[key],
		match: new RegExp(key),
	};
}

/**
 * The case for a panel section whose bar is higher than its panel, so the vote
 * could keep nothing.
 *
 * @param sectionName - The panel section's top-level key.
 * @returns The case, whose error must name the section's bar.
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
 * The cases for a section's count fields — whole numbers of at least 1 — each
 * broken one way, and each error naming the field by its full key.
 *
 * @param args - The section, and how each field is broken.
 * @param args.sectionName - The top-level key of the section.
 * @param args.cases - The field, the value that breaks it, and the problem in words;
 *   `undefined` drops the field.
 * @returns One case per break.
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

/**
 * Every way a structurally invalid config is written: start from one the loader
 * accepts, break the single field the case is about, and put it on disk.
 */
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
	missingKeyCase("naming"),
	{
		name: "naming.modulePrefixes is not an array of strings",
		mutate: (config: Record<string, unknown>) => {
			config.naming = namingSection({ modulePrefixes: ["BOD", 7] });
		},
		match: /modulePrefixes/,
	},
	{
		// An empty code would build a pattern matching any run of underscores or
		// spaces, taking the whole title apart, so it is refused rather than
		// quietly dropped.
		name: "naming.modulePrefixes holds a code that is nothing but whitespace",
		mutate: (config: Record<string, unknown>) => {
			config.naming = namingSection({ modulePrefixes: ["BOD", "  "] });
		},
		match: /modulePrefixes/,
	},
	missingKeyCase("output"),
	{
		name: "output.language is not a string",
		mutate: (config: Record<string, unknown>) => {
			config.output = outputSection({ language: 1 });
		},
		match: /language/,
	},
	{
		name: "output.language names no language the pipeline can write",
		mutate: (config: Record<string, unknown>) => {
			config.output = outputSection({ language: "en-AU" });
		},
		match: /en-AU/,
	},
	{
		name: "output.pandocEngine is not a string",
		mutate: (config: Record<string, unknown>) => {
			config.output = outputSection({ pandocEngine: 9 });
		},
		match: /pandocEngine/,
	},
	missingKeyCase("division"),
	...countFieldCases({
		sectionName: "division",
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
		// Only deepening reads it, so on any other stage it would silently do nothing.
		name: "callConcurrency is set on a stage other than deepen-subtopic-splitting",
		mutate: (config: Record<string, unknown>) => {
			structuringStage(config).callConcurrency = 4;
		},
		match: /stages\.transcript-structuring\.callConcurrency/,
	},
	{
		// Only grouping spaces its sends, so on any other stage it would silently do nothing.
		name: "sendGapSeconds is set on a stage other than group-into-topics",
		mutate: (config: Record<string, unknown>) => {
			structuringStage(config).sendGapSeconds = 0.5;
		},
		match: /stages\.transcript-structuring\.sendGapSeconds/,
	},
	barExceedsPanelCase("division"),
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
	// One table, because an unusable file and an invalid shape are rejected the
	// same way and asserted the same way. Only the seeding differs, so only the
	// seeding is written per case.
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
