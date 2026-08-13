import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PipelineConfig, StageConfig, StageId } from "../types/pipeline.js";
import { NamedError } from "../utils/errors.js";

const CONFIG_FILENAME = "pipeline-config.json";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const OPENROUTER_MODELS_PAGE = "https://openrouter.ai/models";

/**
 * Thrown when `pipeline-config.json` cannot be read, is malformed, or names a
 * model ID that OpenRouter does not recognise. Distinguishes user-config faults
 * from runtime failures so the CLI can surface a corrective message rather than a
 * stack trace (technical-design.md §6).
 */
export class ConfigError extends NamedError {}

// The OpenRouter model list is stable within a run; caching it means the check
// costs a single request no matter how many stages reference the same model.
let cachedModelIds: ReadonlySet<string> | null = null;

/**
 * Clears the in-process OpenRouter model-ID cache so the next {@link loadConfig}
 * with the model check enabled fetches a fresh list. Primarily a test seam for
 * isolating interceptor-backed cases.
 *
 * @returns Nothing.
 */
export function clearModelIdCache(): void {
	cachedModelIds = null;
}

function requireRecord(args: {
	readonly value: unknown;
	readonly label: string;
}): Record<string, unknown> {
	if (typeof args.value !== "object" || args.value === null || Array.isArray(args.value)) {
		throw new ConfigError(`${args.label} must be an object`);
	}
	return args.value as Record<string, unknown>;
}

function requireString(args: { readonly value: unknown; readonly label: string }): string {
	if (typeof args.value !== "string") {
		throw new ConfigError(`${args.label} must be a string`);
	}
	return args.value;
}

function requireNumber(args: { readonly value: unknown; readonly label: string }): number {
	if (typeof args.value !== "number") {
		throw new ConfigError(`${args.label} must be a number`);
	}
	return args.value;
}

function requireOptionalNumber(args: {
	readonly value: unknown;
	readonly label: string;
}): number | undefined {
	if (args.value === undefined) {
		return undefined;
	}
	return requireNumber(args);
}

function requireStringArray(args: {
	readonly value: unknown;
	readonly label: string;
}): readonly string[] {
	if (!Array.isArray(args.value)) {
		throw new ConfigError(`${args.label} must be an array of strings`);
	}
	return Array.from(args.value.entries(), ([index, entry]) =>
		requireString({ value: entry, label: `${args.label}[${index}]` }),
	);
}

/**
 * Reads a required number from a config section that must itself be an object,
 * so a missing section and a mistyped field within it each report against their
 * own label.
 *
 * @param args - The section to read from and the labels to report against.
 * @param args.value - The raw section value, expected to be an object.
 * @param args.sectionLabel - The section's config key, e.g. `currency`.
 * @param args.field - The field to read within the section.
 * @returns The field's value.
 * @throws {ConfigError} If the section is not an object or the field is not a number.
 */
function requireSectionNumber(args: {
	readonly value: unknown;
	readonly sectionLabel: string;
	readonly field: string;
}): number {
	const record = requireRecord({ value: args.value, label: args.sectionLabel });
	return requireNumber({
		value: record[args.field],
		label: `${args.sectionLabel}.${args.field}`,
	});
}

function requireModelIdCheck(value: unknown): PipelineConfig["modelIdCheck"] {
	const record = requireRecord({ value, label: "modelIdCheck" });
	return {
		exemptProviders: requireStringArray({
			value: record.exemptProviders,
			label: "modelIdCheck.exemptProviders",
		}),
	};
}

function requireStageConfig(args: {
	readonly value: unknown;
	readonly stageId: string;
}): StageConfig {
	const record = requireRecord({ value: args.value, label: `stages.${args.stageId}` });
	return {
		modelId: requireString({ value: record.modelId, label: `stages.${args.stageId}.modelId` }),
		temperature: requireOptionalNumber({
			value: record.temperature,
			label: `stages.${args.stageId}.temperature`,
		}),
		maxTokens: requireOptionalNumber({
			value: record.maxTokens,
			label: `stages.${args.stageId}.maxTokens`,
		}),
		concurrency: requireOptionalNumber({
			value: record.concurrency,
			label: `stages.${args.stageId}.concurrency`,
		}),
		maxIterations: requireOptionalNumber({
			value: record.maxIterations,
			label: `stages.${args.stageId}.maxIterations`,
		}),
	};
}

function requireStages(value: unknown): PipelineConfig["stages"] {
	const record = requireRecord({ value, label: "stages" });
	return Object.fromEntries(
		Object.entries(record).map(([stageId, stageConfig]) => [
			stageId,
			requireStageConfig({ value: stageConfig, stageId }),
		]),
	) as PipelineConfig["stages"];
}

function requireOutput(value: unknown): PipelineConfig["output"] {
	const record = requireRecord({ value, label: "output" });
	return {
		language: requireString({ value: record.language, label: "output.language" }),
		pandocEngine: requireString({ value: record.pandocEngine, label: "output.pandocEngine" }),
	};
}

function validateConfig(raw: unknown): PipelineConfig {
	const root = requireRecord({ value: raw, label: CONFIG_FILENAME });
	return {
		version: requireString({ value: root.version, label: "version" }),
		moduleRoots: requireStringArray({ value: root.moduleRoots, label: "moduleRoots" }),
		openRouter: {
			rateLimitRpm: requireSectionNumber({
				value: root.openRouter,
				sectionLabel: "openRouter",
				field: "rateLimitRpm",
			}),
		},
		elevenLabs: {
			costPerAudioHourUsd: requireSectionNumber({
				value: root.elevenLabs,
				sectionLabel: "elevenLabs",
				field: "costPerAudioHourUsd",
			}),
		},
		currency: {
			gbpPerUsd: requireSectionNumber({
				value: root.currency,
				sectionLabel: "currency",
				field: "gbpPerUsd",
			}),
		},
		modelIdCheck: requireModelIdCheck(root.modelIdCheck),
		stages: requireStages(root.stages),
		output: requireOutput(root.output),
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

async function fetchKnownModelIds(): Promise<ReadonlySet<string>> {
	if (cachedModelIds !== null) {
		return cachedModelIds;
	}
	const response = await fetch(OPENROUTER_MODELS_URL);
	if (!response.ok) {
		throw new ConfigError(
			`Could not fetch the OpenRouter model list (HTTP ${response.status}); see ${OPENROUTER_MODELS_PAGE}.`,
		);
	}
	const body = (await response.json()) as { readonly data: readonly { readonly id: string }[] };
	const ids = new Set(body.data.map((model) => model.id));
	cachedModelIds = ids;
	return ids;
}

function describeModelIdMiss(args: { readonly stageId: string; readonly modelId: string }): string {
	if (args.modelId.startsWith("<")) {
		return `stage "${args.stageId}" has an un-substituted placeholder "${args.modelId}"`;
	}
	return `stage "${args.stageId}" names unrecognised model ID "${args.modelId}"`;
}

function formatModelIdError(misses: ReadonlyArray<readonly [string, StageConfig]>): string {
	const details = misses
		.map(([stageId, stageConfig]) => describeModelIdMiss({ stageId, modelId: stageConfig.modelId }))
		.join("; ");
	return `Model ID check failed in ${CONFIG_FILENAME}: ${details}. Verify each ID at ${OPENROUTER_MODELS_PAGE}.`;
}

/**
 * The provider segment of a model ID — the part before the first `/`. A bare ID
 * carrying no prefix yields the empty string, so it can never match an exempt
 * provider and is always checked (technical-design.md §6).
 *
 * @param modelId - The configured model ID.
 * @returns The provider prefix, or the empty string when the ID carries none.
 */
function providerPrefixOf(modelId: string): string {
	const separatorIndex = modelId.indexOf("/");
	if (separatorIndex === -1) {
		return "";
	}
	return modelId.slice(0, separatorIndex);
}

async function assertModelIdsResolvable(config: PipelineConfig): Promise<void> {
	const exemptProviders = new Set(config.modelIdCheck.exemptProviders);
	const entries = (
		Object.entries(config.stages) as ReadonlyArray<readonly [StageId, StageConfig]>
	).filter(([, stageConfig]) => !exemptProviders.has(providerPrefixOf(stageConfig.modelId)));
	if (entries.length === 0) {
		return;
	}
	const knownIds = await fetchKnownModelIds();
	const misses = entries.filter(([, stageConfig]) => !knownIds.has(stageConfig.modelId));
	if (misses.length === 0) {
		return;
	}
	throw new ConfigError(formatModelIdError(misses));
}

/**
 * Reads, validates, and returns the pipeline configuration from
 * `pipeline-config.json` in the given project root. Every configured
 * `stages[*].modelId` is checked against OpenRouter's live model list (fetched
 * once and cached in-process) so un-substituted placeholders, typos, and retired
 * IDs are caught before any billable call is made. Stages whose model ID names a
 * provider listed in `modelIdCheck.exemptProviders` are excluded from that check
 * — a stage on a non-OpenRouter provider would otherwise always fail it — and
 * the list is never fetched when every configured stage is exempt
 * (technical-design.md §6).
 *
 * @param options - Loader options.
 * @param options.projectRoot - Absolute path to the directory containing `pipeline-config.json`.
 * @param options.skipModelCheck - When `true`, skips the OpenRouter model-ID lookup for offline runs. Defaults to `false`.
 * @returns The validated pipeline configuration.
 * @throws {ConfigError} If the file is missing, malformed, fails shape validation, or names an unrecognised model ID.
 */
export async function loadConfig(options: {
	readonly projectRoot: string;
	readonly skipModelCheck?: boolean;
}): Promise<PipelineConfig> {
	const configPath = join(options.projectRoot, CONFIG_FILENAME);
	const config = validateConfig(await readConfigFile(configPath));
	if (options.skipModelCheck !== true) {
		await assertModelIdsResolvable(config);
	}
	return config;
}
