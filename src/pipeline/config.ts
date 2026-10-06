import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	CONFIG_FILENAME,
	type PanelSettings,
	type PipelineConfig,
	type StageConfig,
	type StageId,
} from "../types/pipeline.js";
import { NamedError } from "../utils/errors.js";
import { isOutputLanguage, unknownLanguageMessage } from "../utils/language.js";
import { splitModelId } from "../utils/model-id.js";
import { isRecord } from "../utils/record.js";
import { isStageId, unknownStageMessage } from "../utils/stage-id.js";
import { OPENROUTER_PATHS } from "./openrouter.js";

/**
 * The error for a `pipeline-config.json` that cannot be read, is not valid, or
 * fails the model-ID check. The CLI prints the message of this error, not a stack trace
 * (technical-design.md §6, §8).
 */
export class ConfigError extends NamedError {}

/** A raw config value and the config key that an error names. */
type LabelledValue = { readonly value: unknown; readonly label: string };

/**
 * Makes the error for a config key that holds the wrong type of value. Each
 * function in this file that reads a config value calls this function. So each
 * type error has the same words.
 *
 * @param args - The key and the value it must hold.
 * @param args.label - The config key.
 * @param args.expected - The value that the key must hold, as it reads after "must be".
 * @returns The error to throw.
 */
function configFault(args: { readonly label: string; readonly expected: string }): ConfigError {
	return new ConfigError(`${args.label} must be ${args.expected}`);
}

function requireRecord(args: LabelledValue): Record<string, unknown> {
	if (!isRecord(args.value)) {
		throw configFault({ ...args, expected: "an object" });
	}
	return args.value;
}

function requireString(args: LabelledValue): string {
	if (typeof args.value !== "string") {
		throw configFault({ ...args, expected: "a string" });
	}
	return args.value;
}

function requireNumber(args: LabelledValue): number {
	if (typeof args.value !== "number") {
		throw configFault({ ...args, expected: "a number" });
	}
	return args.value;
}

/**
 * Reads a count: a whole number of at least 1, such as a panel size.
 *
 * @param args - The raw value and its config key.
 * @param args.value - The raw value.
 * @param args.label - The config key.
 * @returns The count.
 * @throws {ConfigError} If the value is not a whole number of at least 1.
 */
function requireCount(args: LabelledValue): number {
	const value = requireNumber(args);
	if (!Number.isInteger(value) || value < 1) {
		throw configFault({ ...args, expected: "a whole number of at least 1" });
	}
	return value;
}

/**
 * Reads a number that can be unset. A missing key and `null` both mean that the
 * setting is unset (technical-design.md §6, "A tuning parameter can be
 * left unset out loud"). An unset `temperature` or `maxTokens` is not sent in
 * the model call.
 *
 * @param args - The raw value and its config key.
 * @param args.value - The raw value.
 * @param args.label - The config key.
 * @returns The number, or `undefined` when the value is unset.
 * @throws {ConfigError} If the value is not a number, `null` or missing.
 */
function requireOptionalNumber(args: LabelledValue): number | undefined {
	if (args.value === undefined || args.value === null) {
		return undefined;
	}
	return requireNumber(args);
}

/**
 * The schemes that a configured address can use. The URL parser accepts any
 * scheme, so a typo such as `htp://openrouter.ai` parses. The `origin` of the
 * parsed URL is then the string `"null"`. {@link modelsPageFor} would then print a
 * models page address that starts with `null` (technical-design.md §6).
 */
const ADDRESSABLE_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:"]);

/**
 * Reads an absolute URL. The check is at load, so a typo stops the invocation
 * before the first billable call (technical-design.md §6).
 *
 * @param args - The raw value and its config key.
 * @param args.value - The raw value.
 * @param args.label - The config key.
 * @returns The URL with no slash at the end, so that a path can follow it.
 * @throws {ConfigError} If the value is not an absolute `http` or `https` URL.
 */
function requireUrl(args: LabelledValue): string {
	const url = requireString(args);
	const parsed = URL.parse(url);
	if (parsed === null || !ADDRESSABLE_SCHEMES.has(parsed.protocol)) {
		throw configFault({
			...args,
			expected: "an absolute http:// or https:// URL, e.g. https://example.com/api/v1",
		});
	}
	return url.replace(/\/+$/, "");
}

function requireStringArray(args: LabelledValue): readonly string[] {
	if (!Array.isArray(args.value)) {
		throw configFault({ ...args, expected: "an array of strings" });
	}
	return Array.from(args.value.entries(), ([index, entry]) =>
		requireString({ value: entry, label: `${args.label}[${index}]` }),
	);
}

/**
 * The readers for the fields of one config section. A reader names a field in an
 * error as `section.field`, built from the section label. So the code spells each
 * config key only once, in the call that reads the field. A field that the section does not have is a missing field, so the
 * error names that field and not the section.
 */
type ConfigSection = {
	readonly string: (field: string) => string;
	readonly number: (field: string) => number;
	readonly count: (field: string) => number;
	readonly optionalNumber: (field: string) => number | undefined;
	readonly url: (field: string) => string;
	readonly stringArray: (field: string) => readonly string[];
};

/**
 * Checks that a config section is an object, and gives the readers for its fields.
 *
 * @param args - The raw section and its config key.
 * @param args.value - The raw section.
 * @param args.label - The config key of the section, such as `openRouter`.
 * @returns The readers for the fields of the section.
 * @throws {ConfigError} If the section is not an object.
 */
function requireSection(args: LabelledValue): ConfigSection {
	const record = requireRecord(args);
	/**
	 * Reads one field with the reader for its type.
	 *
	 * @param readArgs - The field and its reader.
	 * @param readArgs.field - The name of the field in the section.
	 * @param readArgs.require - The reader for the type that the field must hold.
	 * @returns The value of the field.
	 */
	const read = <TValue>(readArgs: {
		readonly field: string;
		readonly require: (labelled: LabelledValue) => TValue;
	}): TValue =>
		readArgs.require({
			value: record[readArgs.field],
			label: `${args.label}.${readArgs.field}`,
		});
	return {
		string: (field) => read({ field, require: requireString }),
		number: (field) => read({ field, require: requireNumber }),
		count: (field) => read({ field, require: requireCount }),
		optionalNumber: (field) => read({ field, require: requireOptionalNumber }),
		url: (field) => read({ field, require: requireUrl }),
		stringArray: (field) => read({ field, require: requireStringArray }),
	};
}

/**
 * Reads the `openRouter` section: the address of the service, the timeout and the
 * retries (technical-design.md §6, "OpenRouter Integration").
 *
 * @param value - The raw `openRouter` section.
 * @returns The checked section.
 * @throws {ConfigError} If the section is not an object, or a field is missing or has the wrong type.
 */
function requireOpenRouter(value: unknown): PipelineConfig["openRouter"] {
	const openRouter = requireSection({ value, label: "openRouter" });
	return {
		baseUrl: openRouter.url("baseUrl"),
		completionTimeoutMs: openRouter.number("completionTimeoutMs"),
		completionMaxRetries: openRouter.number("completionMaxRetries"),
	};
}

/**
 * Reads the `elevenLabs` section: the address of the service, the language spoken
 * in the lectures, and the price of one hour of audio (technical-design.md §6).
 *
 * @param value - The raw `elevenLabs` section.
 * @returns The checked section.
 * @throws {ConfigError} If the section is not an object, or a field is missing or has the wrong type.
 */
function requireElevenLabs(value: unknown): PipelineConfig["elevenLabs"] {
	const elevenLabs = requireSection({ value, label: "elevenLabs" });
	return {
		baseUrl: elevenLabs.url("baseUrl"),
		languageCode: elevenLabs.string("languageCode"),
		costPerAudioHourUsd: elevenLabs.number("costPerAudioHourUsd"),
	};
}

function requireModelIdCheck(value: unknown): PipelineConfig["modelIdCheck"] {
	const modelIdCheck = requireSection({ value, label: "modelIdCheck" });
	return { exemptProviders: modelIdCheck.stringArray("exemptProviders") };
}

/**
 * Reads the `naming` section: the module prefixes that are removed from a
 * provisional title. A blank module prefix is refused, because it would match
 * each run of underscores or spaces in each title (technical-design.md §3.2, §6).
 *
 * @param value - The raw `naming` section.
 * @returns The checked section.
 * @throws {ConfigError} If the section is not an object, `modulePrefixes` is not an array of strings, or a prefix is blank.
 */
function requireNaming(value: unknown): PipelineConfig["naming"] {
	const naming = requireSection({ value, label: "naming" });
	const modulePrefixes = naming.stringArray("modulePrefixes");
	if (modulePrefixes.some((prefix) => prefix.trim() === "")) {
		throw new ConfigError("naming.modulePrefixes must not contain a blank module prefix");
	}
	return { modulePrefixes };
}

/**
 * Reads the size and the bar of a panel.
 *
 * @param args - The section and its config key.
 * @param args.section - The readers for the section.
 * @param args.label - The config key of the section.
 * @returns The size and the bar of the panel.
 * @throws {ConfigError} If either is not a whole number of at least 1, or the bar
 *   is more than the panel size. With that bar, the vote could keep nothing.
 */
function requirePanel({
	section,
	label,
}: {
	readonly section: ReturnType<typeof requireSection>;
	readonly label: string;
}): PanelSettings {
	const panelSize = section.count("panelSize");
	const bar = section.count("bar");
	if (bar > panelSize) {
		throw new ConfigError(
			`${label}.bar (${bar}) must not exceed ${label}.panelSize (${panelSize}): the vote could keep nothing`,
		);
	}
	return { panelSize, bar };
}

/**
 * Reads the `subtopicSplitting` section: the size and the bar of the splitting
 * panel, and the size gate (technical-design.md §6).
 *
 * @param value - The raw `subtopicSplitting` section.
 * @returns The checked section.
 * @throws {ConfigError} If the section or a field is not valid.
 */
function requireSubtopicSplitting(value: unknown): PipelineConfig["subtopicSplitting"] {
	const label = "subtopicSplitting";
	const subtopicSplitting = requireSection({ value, label });
	return {
		...requirePanel({ section: subtopicSplitting, label }),
		sizeGateWords: subtopicSplitting.count("sizeGateWords"),
	};
}

/**
 * Reads the `grouping` section: the size and the bar of the grouping panel
 * (technical-design.md §5, `group-into-topics`, and §6).
 *
 * @param value - The raw `grouping` section.
 * @returns The checked section.
 * @throws {ConfigError} If the section or a field is not valid.
 */
function requireGrouping(value: unknown): PipelineConfig["grouping"] {
	const label = "grouping";
	return requirePanel({ section: requireSection({ value, label }), label });
}

/**
 * Reads the `batch` section: the number of lectures that a batch runs at one time
 * (technical-design.md §4.7, §6).
 *
 * @param value - The raw `batch` section.
 * @returns The checked section.
 * @throws {ConfigError} If the section is not an object, or `concurrency` is not a whole number of at least 1.
 */
function requireBatch(value: unknown): PipelineConfig["batch"] {
	return { concurrency: requireSection({ value, label: "batch" }).count("concurrency") };
}

/**
 * The settings that only one stage reads, with that stage and the reason. On a
 * different stage, such a setting would do nothing, so the loader refuses it
 * (technical-design.md §6).
 */
const SINGLE_STAGE_SETTINGS = {
	callConcurrency: {
		readBy: "deepen-subtopic-splitting",
		because: "the one stage whose run makes more than one call",
	},
	sendGapSeconds: {
		readBy: "group-into-topics",
		because: "the one stage that spaces its sends",
	},
} as const satisfies Readonly<
	Partial<Record<keyof StageConfig, { readonly readBy: StageId; readonly because: string }>>
>;

/**
 * Reads a setting that only one stage reads.
 *
 * @param args - The stage's config, the setting and the stage.
 * @param args.stage - The readers for the stage's config.
 * @param args.field - The setting.
 * @param args.stageId - The stage that the config is for.
 * @param args.label - The config key of the stage's config.
 * @returns The setting, or `undefined` when it is unset.
 * @throws {ConfigError} If the setting is not a number, or is set on a stage that does not read it.
 */
function requireSingleStageSetting({
	stage,
	field,
	stageId,
	label,
}: {
	readonly stage: ReturnType<typeof requireSection>;
	readonly field: keyof typeof SINGLE_STAGE_SETTINGS;
	readonly stageId: StageId;
	readonly label: string;
}): number | undefined {
	const value = stage.optionalNumber(field);
	const { readBy, because } = SINGLE_STAGE_SETTINGS[field];
	if (value !== undefined && stageId !== readBy) {
		throw new ConfigError(`${label}.${field} is read only by ${readBy}, ${because}; remove it`);
	}
	return value;
}

/**
 * Reads the config of one stage.
 *
 * @param args - The raw config and the stage.
 * @param args.value - The raw config of the stage.
 * @param args.stageId - The stage that the config is for.
 * @returns The checked config.
 * @throws {ConfigError} If the config or a field is not valid. A setting in
 *   {@link SINGLE_STAGE_SETTINGS} on a different stage is not valid.
 */
function requireStageConfig(args: {
	readonly value: unknown;
	readonly stageId: StageId;
}): StageConfig {
	const label = `stages.${args.stageId}`;
	const stage = requireSection({ value: args.value, label });
	const singleStage = { stage, stageId: args.stageId, label };
	return {
		modelId: stage.string("modelId"),
		temperature: stage.optionalNumber("temperature"),
		maxTokens: stage.optionalNumber("maxTokens"),
		concurrency: stage.optionalNumber("concurrency"),
		callConcurrency: requireSingleStageSetting({ ...singleStage, field: "callConcurrency" }),
		sendGapSeconds: requireSingleStageSetting({ ...singleStage, field: "sendGapSeconds" }),
		maxIterations: stage.optionalNumber("maxIterations"),
	};
}

/**
 * Reads the `stages` section. A key that names no stage is refused. A typo in a
 * key would leave the intended stage with no config (technical-design.md §6,
 * "A stage key names a stage").
 *
 * @param value - The raw `stages` section.
 * @returns The checked section.
 * @throws {ConfigError} If the section is not an object, a key names no stage, or a stage's config is not valid.
 */
function requireStages(value: unknown): PipelineConfig["stages"] {
	const record = requireRecord({ value, label: "stages" });
	return Object.fromEntries(
		Object.entries(record).map(([stageId, stageConfig]) => {
			if (!isStageId(stageId)) {
				throw new ConfigError(unknownStageMessage({ subject: `stages."${stageId}"` }));
			}
			return [stageId, requireStageConfig({ value: stageConfig, stageId })];
		}),
	);
}

/**
 * Reads the `finalOutput` section: the language of the notes, and the engine that
 * makes the PDF. A language that has no name for the prompts is refused
 * (technical-design.md §6, "`finalOutput.language` is a closed set").
 *
 * @param value - The raw `finalOutput` section.
 * @returns The checked section.
 * @throws {ConfigError} If the section is not an object, a field is missing or has the wrong type, or the language is not in `OUTPUT_LANGUAGES`.
 */
function requireFinalOutput(value: unknown): PipelineConfig["finalOutput"] {
	const finalOutput = requireSection({ value, label: "finalOutput" });
	const language = finalOutput.string("language");
	if (!isOutputLanguage(language)) {
		throw new ConfigError(
			unknownLanguageMessage({ subject: `finalOutput.language "${language}"` }),
		);
	}
	return {
		language,
		pandocEngine: finalOutput.string("pandocEngine"),
	};
}

/**
 * Checks parsed config JSON and gives a {@link PipelineConfig}. It does no model-ID
 * check. The test fixtures read `pipeline-config.example.json` with it, so each
 * suite also proves that the example is valid.
 *
 * @param raw - The parsed JSON.
 * @returns The checked config.
 * @throws {ConfigError} If a field is missing or has the wrong type or value.
 */
export function parseConfig(raw: unknown): PipelineConfig {
	const root = requireRecord({ value: raw, label: CONFIG_FILENAME });
	return {
		version: requireString({ value: root.version, label: "version" }),
		moduleRoots: requireStringArray({ value: root.moduleRoots, label: "moduleRoots" }),
		openRouter: requireOpenRouter(root.openRouter),
		elevenLabs: requireElevenLabs(root.elevenLabs),
		currency: {
			gbpPerUsd: requireSection({ value: root.currency, label: "currency" }).number("gbpPerUsd"),
		},
		modelIdCheck: requireModelIdCheck(root.modelIdCheck),
		naming: requireNaming(root.naming),
		subtopicSplitting: requireSubtopicSplitting(root.subtopicSplitting),
		grouping: requireGrouping(root.grouping),
		batch: requireBatch(root.batch),
		stages: requireStages(root.stages),
		finalOutput: requireFinalOutput(root.finalOutput),
	};
}

async function readConfigFile(configPath: string): Promise<unknown> {
	let raw: string;
	try {
		raw = await readFile(configPath, "utf8");
	} catch (error: unknown) {
		throw new ConfigError(`Could not read config file at ${configPath}: ${String(error)}`);
	}
	try {
		return JSON.parse(raw);
	} catch (error: unknown) {
		throw new ConfigError(`Config file at ${configPath} is not valid JSON: ${String(error)}`);
	}
}

/**
 * Gives the models page, which an error message names for the user. It is on the
 * origin of the API address. The function assumes that the host of the API also serves
 * the page (technical-design.md §6, "OpenRouter Integration").
 *
 * @param baseUrl - The configured OpenRouter base URL.
 * @returns The URL of the models page.
 */
function modelsPageFor(baseUrl: string): string {
	return `${new URL(baseUrl).origin}${OPENROUTER_PATHS.models}`;
}

async function fetchKnownModelIds(baseUrl: string): Promise<ReadonlySet<string>> {
	const response = await fetch(`${baseUrl}${OPENROUTER_PATHS.models}`);
	if (!response.ok) {
		throw new ConfigError(
			`Could not fetch the OpenRouter model list (HTTP ${response.status}); see ${modelsPageFor(baseUrl)}.`,
		);
	}
	const body = (await response.json()) as { readonly data: readonly { readonly id: string }[] };
	return new Set(body.data.map((model) => model.id));
}

function describeModelIdMiss(args: { readonly stageId: string; readonly modelId: string }): string {
	if (args.modelId.startsWith("<")) {
		return `stage "${args.stageId}" has an un-substituted placeholder "${args.modelId}"`;
	}
	return `stage "${args.stageId}" names unrecognised model ID "${args.modelId}"`;
}

function formatModelIdError(args: {
	readonly misses: ReadonlyArray<readonly [string, StageConfig]>;
	readonly baseUrl: string;
}): string {
	const details = args.misses
		.map(([stageId, stageConfig]) => describeModelIdMiss({ stageId, modelId: stageConfig.modelId }))
		.join("; ");
	return `Model ID check failed in ${CONFIG_FILENAME}: ${details}. Verify each ID at ${modelsPageFor(args.baseUrl)}.`;
}

/**
 * Tells if the model-ID check skips a model ID, because its provider is exempt. A
 * model ID with no provider is always checked (technical-design.md §6).
 *
 * @param args - The model ID and the exempt providers.
 * @param args.modelId - The configured model ID.
 * @param args.exemptProviders - The providers that the check skips.
 * @returns `true` when the provider of the model ID is exempt.
 */
function isExemptFromModelIdCheck({
	modelId,
	exemptProviders,
}: {
	readonly modelId: string;
	readonly exemptProviders: readonly string[];
}): boolean {
	const { provider } = splitModelId(modelId);
	return provider !== null && exemptProviders.includes(provider);
}

async function assertModelIdsResolvable(config: PipelineConfig): Promise<void> {
	const { exemptProviders } = config.modelIdCheck;
	// `stages` is a partial record, so the type of each value includes `undefined`.
	// JSON cannot hold an `undefined` value, so a check at run time could never
	// fail. The assertion removes only `undefined`. The keys stay `string`,
	// because the error message reads them only as text.
	const stageEntries = Object.entries(config.stages) as ReadonlyArray<
		readonly [string, StageConfig]
	>;
	const entries = stageEntries.filter(
		([, stageConfig]) =>
			!isExemptFromModelIdCheck({ modelId: stageConfig.modelId, exemptProviders }),
	);
	if (entries.length === 0) {
		return;
	}
	const { baseUrl } = config.openRouter;
	const knownIds = await fetchKnownModelIds(baseUrl);
	const misses = entries.filter(([, stageConfig]) => !knownIds.has(stageConfig.modelId));
	if (misses.length === 0) {
		return;
	}
	throw new ConfigError(formatModelIdError({ misses, baseUrl }));
}

/**
 * Reads and checks `pipeline-config.json` in the project root. Then it does the
 * model-ID check: it gets the OpenRouter model list and refuses each model ID that
 * the list does not hold. The check skips a model ID whose provider is exempt. When
 * each model ID is exempt, the loader does not get the list. No setting stops the
 * check (technical-design.md §6, "Model-ID resolution check").
 *
 * @param options - The loader options.
 * @param options.projectRoot - The absolute path to the folder that holds `pipeline-config.json`.
 * @returns The checked config.
 * @throws {ConfigError} If the file is missing or not valid, the model list request gets an HTTP error, or a model ID is not in the list.
 */
export async function loadConfig(options: {
	readonly projectRoot: string;
}): Promise<PipelineConfig> {
	const configPath = join(options.projectRoot, CONFIG_FILENAME);
	const config = parseConfig(await readConfigFile(configPath));
	await assertModelIdsResolvable(config);
	return config;
}
