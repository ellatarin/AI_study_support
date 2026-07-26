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

function requireModuleRoots(value: unknown): readonly string[] {
	if (!Array.isArray(value)) {
		throw new ConfigError("moduleRoots must be an array of strings");
	}
	return Array.from(value.entries(), ([index, entry]) =>
		requireString({ value: entry, label: `moduleRoots[${index}]` }),
	);
}

function requireOpenRouter(value: unknown): PipelineConfig["openRouter"] {
	const record = requireRecord({ value, label: "openRouter" });
	return {
		rateLimitRpm: requireNumber({ value: record.rateLimitRpm, label: "openRouter.rateLimitRpm" }),
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
		moduleRoots: requireModuleRoots(root.moduleRoots),
		openRouter: requireOpenRouter(root.openRouter),
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

async function assertModelIdsResolvable(config: PipelineConfig): Promise<void> {
	const entries = Object.entries(config.stages) as ReadonlyArray<readonly [StageId, StageConfig]>;
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
 * IDs are caught before any billable call is made (technical-design.md §6).
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
