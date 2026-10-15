import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import nock from "nock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONFIG_FILENAME, type NotesPdfSettings, type StageConfig } from "../types/pipeline.js";
import { ConfigError, loadConfig } from "./config.js";
import {
	blockNetwork,
	captureError,
	corruptJson,
	disabledFactCheckModel,
	exampleConfig,
	exampleStageConfig,
	makeConfig,
	makeTempDir,
	openRouterModelId,
	openRouterStageConfig,
	openRouterUrls,
	openRouterUrlsAt,
	primaryFactCheckModel,
	resetStubbedApi,
	stubModelList,
	transcriptionModelId,
} from "./fixtures.js";

// The two model IDs in the mocked model list. The valid config uses only these.
// A test can then fail the model of one stage and keep the other valid.
const JUDGE_MODEL_ID = openRouterModelId;
const SLIDE_MODEL_ID = "google/gemini-2.5-flash";
const KNOWN_MODEL_IDS = [JUDGE_MODEL_ID, SLIDE_MODEL_ID] as const;

/** Stubs the model list at the default address, with the {@link KNOWN_MODEL_IDS}. */
function stubKnownModelList(): void {
	stubModelList({ modelIds: KNOWN_MODEL_IDS });
}

// Each tuning field of a stage's config. `satisfies` makes a renamed field fail to
// compile here, so no case tests a key that nothing reads.
const TUNING_FIELDS = [
	"temperature",
	"maxTokens",
	"concurrency",
	"callConcurrency",
	"sendGapSeconds",
] as const satisfies readonly (keyof StageConfig)[];

// Each setting of `finalOutput.pdf`. `satisfies` makes a renamed setting fail to compile here.
const NOTES_PDF_SETTINGS = [
	"fontSizePt",
	"marginMm",
	"slideWidthPercent",
	"slideSpaceBeforeMm",
	"slideSpaceAfterMm",
] as const satisfies readonly (keyof NotesPdfSettings)[];

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
					"judge-lecture-title": openRouterStageConfig({
						stageId: "judge-lecture-title",
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
 * @param sectionPath - The config key of the section. A dot names a section inside a section, such as `finalOutput.pdf`.
 * @returns A function that takes the new field values and gives the section.
 */
function sectionCorrupter(
	sectionPath: string,
): (overrides: Record<string, unknown>) => Record<string, unknown> {
	return (overrides) => {
		const validSection = sectionPath
			.split(".")
			.reduce<unknown>(
				(parent, key) => (parent as Record<string, unknown>)[key],
				makeValidConfig(),
			) as Record<string, unknown>;
		const section: Record<string, unknown> = { ...validSection, ...overrides };
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
const notesPdfSection = sectionCorrupter("finalOutput.pdf");
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
 * Gives the raw config of `judge-lecture-title`, for a test to change one field
 * in place. The other fields keep the tuning of the example.
 *
 * @param config - The raw config.
 * @returns The raw config of the stage.
 * @throws {Error} If the fixture has no config for `judge-lecture-title`.
 */
function judgeStage(config: Record<string, unknown>): Record<string, unknown> {
	const stage = configuredStages(config)["judge-lecture-title"];
	if (stage === undefined) {
		throw new Error('Fixture has no "judge-lecture-title" stage to retune');
	}
	return stage;
}

/** Changes the model ID of `judge-lecture-title` and keeps its tuning. */
function setJudgeModelId({
	config,
	modelId,
}: {
	readonly config: Record<string, unknown>;
	readonly modelId: string;
}): void {
	judgeStage(config).modelId = modelId;
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
			stageId: "judge-lecture-title",
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
		stubKnownModelList();

		const error = await configRejection();

		expect(error).toBeInstanceOf(ConfigError);
		expect(error.message).toContain(stageId);
		expect(error.message).toContain(modelId);
		expect(error.message).toContain(openRouterUrls.modelsPage);
	});

	it("should fetch the model list from the configured base URL when the check runs", async () => {
		await writeConfigAtGateway();
		const scope = stubModelList({ modelIds: KNOWN_MODEL_IDS, urls: gatewayUrls });

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
			setJudgeModelId({ config, modelId: "<REASONING_MODEL>" });
		});
		stubModelList({ modelIds: [SLIDE_MODEL_ID] });

		const error = await configRejection();

		expect(error).toBeInstanceOf(ConfigError);
		expect(error.message).toContain("<REASONING_MODEL>");
		expect(error.message).toContain("placeholder");
	});

	it("should skip the OpenRouter check when a model ID names an exempt provider", async () => {
		await writeValidConfig((config) => {
			configuredStages(config).transcription = { modelId: transcriptionModelId };
		});
		stubKnownModelList();

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

		expect(loaded.stages["judge-lecture-title"]?.modelId).toBe(JUDGE_MODEL_ID);
	});

	it("should accept the config when every stage modelId appears in the OpenRouter response", async () => {
		await writeValidConfig();
		stubKnownModelList();

		const config = await loadConfig({ projectRoot });

		expect(config.version).toBe("1");
		expect(config.stages["judge-lecture-title"]?.modelId).toBe(JUDGE_MODEL_ID);
		expect(config.stages["read-slides"]?.concurrency).toBe(
			exampleStageConfig("read-slides").concurrency,
		);
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
			judgeStage(config)[field] = null;
		});
		stubKnownModelList();

		const loaded = await loadConfig({ projectRoot });

		const stage = loaded.stages["judge-lecture-title"];
		expect(stage?.[field]).toBeUndefined();
		expect(stage?.modelId).toBe(JUDGE_MODEL_ID);
	});

	it.each([
		{ stageId: "group-into-topics", sendGapSeconds: 0.5 },
		{ stageId: "read-slides", sendGapSeconds: 0.25 },
	] as const)("should keep a fractional sendGapSeconds when $stageId sets it with concurrency", async ({
		stageId,
		sendGapSeconds,
	}) => {
		await writeValidConfig((config) => {
			configuredStages(config)[stageId] = {
				modelId: JUDGE_MODEL_ID,
				concurrency: 9,
				sendGapSeconds,
			};
		});
		stubKnownModelList();

		const loaded = await loadConfig({ projectRoot });

		expect(loaded.stages[stageId]?.sendGapSeconds).toBe(sendGapSeconds);
	});
});

describe("loadConfig Notes PDF settings", () => {
	it("should give the five Notes PDF settings of the example config when the config holds the finalOutput.pdf section", async () => {
		await writeValidConfig();
		stubKnownModelList();

		const loaded = await loadConfig({ projectRoot });

		expect(loaded.finalOutput.pdf).toStrictEqual({
			fontSizePt: 11,
			marginMm: 18,
			slideWidthPercent: 60,
			slideSpaceBeforeMm: 5,
			slideSpaceAfterMm: 5,
		});
	});
});

describe("loadConfig check-facts models", () => {
	it("should give the models list of check-facts when its entry has a models list", async () => {
		const primary = { ...primaryFactCheckModel, modelId: JUDGE_MODEL_ID };
		await writeValidConfig((config) => {
			configuredStages(config)["check-facts"] = { models: [primary] };
		});
		stubKnownModelList();

		const loaded = await loadConfig({ projectRoot });

		expect(loaded.stages["check-facts"]).toStrictEqual({
			models: [{ ...primary, temperature: undefined, maxTokens: undefined }],
		});
	});

	it("should throw ConfigError naming check-facts and the model when a disabled model of its list is not in the OpenRouter response", async () => {
		const unknownModelId = "openai/nonexistent-model";
		await writeValidConfig((config) => {
			configuredStages(config)["check-facts"] = {
				models: [
					{ ...primaryFactCheckModel, modelId: JUDGE_MODEL_ID },
					{ ...disabledFactCheckModel, modelId: unknownModelId },
				],
			};
		});
		stubKnownModelList();

		const error = await configRejection();

		expect(error).toBeInstanceOf(ConfigError);
		expect(error.message).toContain(
			`stage "check-facts" names unrecognised model ID "${unknownModelId}"`,
		);
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
			config.stages = { "judge-lecture-title": "gpt" };
		},
		match: /judge-lecture-title/,
	},
	{
		name: "a stage modelId is missing",
		mutate: (config: Record<string, unknown>) => {
			config.stages = { "judge-lecture-title": {} };
		},
		match: /modelId/,
	},
	{
		name: "a stage modelId is not a string",
		mutate: (config: Record<string, unknown>) => {
			config.stages = { "judge-lecture-title": { modelId: 5 } };
		},
		match: /modelId/,
	},
	{
		name: "a stage param is not a number",
		mutate: (config: Record<string, unknown>) => {
			config.stages = {
				"judge-lecture-title": { modelId: openRouterModelId, temperature: "hot" },
			};
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
	...[
		{ problem: "is missing", highlightSlideSentences: undefined },
		{ problem: "is not true or false", highlightSlideSentences: "no" },
	].map(
		({ problem, highlightSlideSentences }): ShapeCase => ({
			name: `finalOutput.highlightSlideSentences ${problem}`,
			mutate: (config: Record<string, unknown>) => {
				config.finalOutput = finalOutputSection({ highlightSlideSentences });
			},
			match: /finalOutput\.highlightSlideSentences/,
		}),
	),
	...[
		{ problem: "is missing", pageViews: undefined },
		{ problem: "names a view that the page does not have", pageViews: ["notes", "slides"] },
		{ problem: "names a view twice", pageViews: ["notes", "transcript", "notes"] },
		{ problem: "does not name the Notes view", pageViews: ["transcript"] },
	].map(
		({ problem, pageViews }): ShapeCase => ({
			name: `finalOutput.pageViews ${problem}`,
			mutate: (config: Record<string, unknown>) => {
				config.finalOutput = finalOutputSection({ pageViews });
			},
			match: /finalOutput\.pageViews/,
		}),
	),
	{
		name: "finalOutput.pdf is missing",
		mutate: (config: Record<string, unknown>) => {
			config.finalOutput = finalOutputSection({ pdf: undefined });
		},
		match: /finalOutput\.pdf/,
	},
	...[
		...NOTES_PDF_SETTINGS.flatMap((setting) =>
			[
				{ problem: "is missing", value: undefined },
				{ problem: "is not a number", value: "11" },
				{ problem: "is 0", value: 0 },
				{ problem: "is negative", value: -1 },
			].map((badValue) => ({ setting, ...badValue })),
		),
		{ setting: "slideWidthPercent", problem: "is above 100", value: 101 },
	].map(
		({ setting, problem, value }): ShapeCase => ({
			name: `finalOutput.pdf.${setting} ${problem}`,
			mutate: (config: Record<string, unknown>) => {
				config.finalOutput = finalOutputSection({
					pdf: notesPdfSection({ [setting]: value }),
				});
			},
			match: new RegExp(`finalOutput\\.pdf\\.${setting} must be`),
		}),
	),
	...[
		{ problem: "is missing", bypass: undefined },
		{ problem: "is not true or false", bypass: "yes" },
	].map(
		({ problem, bypass }): ShapeCase => ({
			name: `stages.correct-factual-errors.bypass ${problem}`,
			mutate: (config: Record<string, unknown>) => {
				configuredStages(config)["correct-factual-errors"] = { modelId: JUDGE_MODEL_ID, bypass };
			},
			match: /stages\.correct-factual-errors\.bypass/,
		}),
	),
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
			judgeStage(config).callConcurrency = 4;
		},
		match: /stages\.judge-lecture-title\.callConcurrency/,
	},
	{
		// Only check-facts has a list of models. Every other stage has one modelId.
		name: "a models list is set on a stage other than check-facts",
		mutate: (config: Record<string, unknown>) => {
			judgeStage(config).models = [primaryFactCheckModel];
		},
		match: /stages\.judge-lecture-title\.models is read only by check-facts/,
	},
	{
		// The gap spaces sends that run at the same time. On a stage with no
		// concurrency, sendGapSeconds would do nothing.
		name: "sendGapSeconds is set on a stage with no concurrency",
		mutate: (config: Record<string, unknown>) => {
			judgeStage(config).sendGapSeconds = 0.5;
		},
		match: /stages\.judge-lecture-title\.sendGapSeconds/,
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
