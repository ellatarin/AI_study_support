import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_FILENAME, type PipelineConfig, type StageConfig } from "../types/pipeline.js";
import { NamedError } from "../utils/errors.js";
import { isOutputLanguage, unknownLanguageMessage } from "../utils/language.js";
import { splitModelId } from "../utils/model-id.js";
import { isRecord } from "../utils/record.js";
import { isStageId, unknownStageMessage } from "../utils/stage-id.js";
import { OPENROUTER_PATHS } from "./openrouter.js";

/**
 * Thrown when `pipeline-config.json` cannot be read, is malformed, or names a
 * model ID that OpenRouter does not recognise. Distinguishes user-config faults
 * from runtime failures so the CLI can surface a corrective message rather than a
 * stack trace (technical-design.md §6).
 */
export class ConfigError extends NamedError {}

/**
 * A raw config value together with the key it reports against, which is what
 * every reader below needs and all a reader needs: the value to check, and the
 * name to blame when it is wrong.
 */
type LabelledValue = { readonly value: unknown; readonly label: string };

/**
 * The fault every reader raises: a config key holding something other than what
 * it must hold. One sentence, so the five readers below differ only in what they
 * were looking for rather than in how they say so.
 *
 * @param args - What was wanted, and where.
 * @param args.label - The config key at fault.
 * @param args.expected - What the key must hold, as it should read after "must be".
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
 * Reads a field that may be left unset, which the file may say in either of two
 * ways: leave the key out, or write it as `null`.
 *
 * Both mean the same thing — the pipeline sends no such parameter — but a
 * `null` says it in the file, beside the stage it applies to and next to the
 * tuning that is set. Which parameters a call carries decides which providers
 * can serve it (§6, "JSON mode is routed for as well as asked for"), so leaving
 * one off is a decision worth being able to write down rather than one that can
 * only be expressed by an absence.
 *
 * @param args - The value to read and the label to report against.
 * @param args.value - The raw config value.
 * @param args.label - The config key, for the error message.
 * @returns The number, or `undefined` where the field is unset.
 * @throws {ConfigError} If the value is neither a number nor an explicit `null`.
 */
function requireOptionalNumber(args: LabelledValue): number | undefined {
	if (args.value === undefined || args.value === null) {
		return undefined;
	}
	return requireNumber(args);
}

/**
 * The schemes a configured address may use. Parsing alone does not narrow this:
 * the URL standard accepts any scheme, so a mistyped `htp://openrouter.ai` is a
 * perfectly valid URL — one whose `origin` is the string `"null"`, because only
 * these schemes have an origin at all. Restricting to them is what makes
 * {@link modelsPageFor} able to derive an address worth printing.
 */
const ADDRESSABLE_SCHEMES: ReadonlySet<string> = new Set(["http:", "https:"]);

/**
 * Reads a required absolute URL. Checked at load rather than at first use, so a
 * mistyped address fails at startup instead of at the first billable call
 * (technical-design.md §6).
 *
 * @param args - The value to read and the label to report against.
 * @param args.value - The raw config value.
 * @param args.label - The config key, for the error message.
 * @returns The URL, with any trailing slash removed so paths append cleanly.
 * @throws {ConfigError} If the value is not a string, or is not an absolute `http`/`https` URL.
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
 * A config section's fields, read by name.
 *
 * A field reports against `section.field`, derived from the section it was read
 * from rather than written out beside the read — so every key in the file has
 * one place it is spelt, and a section gains a field without anything else
 * having to know. A field the section does not carry is a missing field, so a
 * section and a mistyped field within it each blame their own key.
 */
type ConfigSection = {
	readonly string: (field: string) => string;
	readonly number: (field: string) => number;
	readonly optionalNumber: (field: string) => number | undefined;
	readonly url: (field: string) => string;
	readonly stringArray: (field: string) => readonly string[];
};

/**
 * Opens a config section for reading, having checked it is an object at all.
 *
 * @param args - The raw section and the key it reports against.
 * @param args.value - The raw section value, expected to be an object.
 * @param args.label - The section's config key, e.g. `openRouter`.
 * @returns The section's fields, each reader labelling what it reads.
 * @throws {ConfigError} If the section is not an object.
 */
function requireSection(args: LabelledValue): ConfigSection {
	const record = requireRecord(args);
	/**
	 * Reads one field through the reader that knows the type it must hold.
	 *
	 * @param readArgs - The field to read and how.
	 * @param readArgs.field - The field's name within the section.
	 * @param readArgs.require - The reader for the type the field must hold.
	 * @returns The field's value.
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
		optionalNumber: (field) => read({ field, require: requireOptionalNumber }),
		url: (field) => read({ field, require: requireUrl }),
		stringArray: (field) => read({ field, require: requireStringArray }),
	};
}

/**
 * Validates the `openRouter` section: where the service is, and how patiently to
 * wait on it. All of it is configuration because none of it describes this
 * codebase — a slow gateway wants a longer timeout and a flaky one wants more
 * retries, neither of which should need a release (technical-design.md §6).
 *
 * @param value - The raw `openRouter` section.
 * @returns The validated section.
 * @throws {ConfigError} If the section is not an object, or any field is missing or mistyped.
 */
function requireOpenRouter(value: unknown): PipelineConfig["openRouter"] {
	const openRouter = requireSection({ value, label: "openRouter" });
	return {
		baseUrl: openRouter.url("baseUrl"),
		completionTimeoutMs: openRouter.number("completionTimeoutMs"),
		completionMaxRetries: openRouter.number("completionMaxRetries"),
		costLookupTimeoutMs: openRouter.number("costLookupTimeoutMs"),
		costLookupMaxRetries: openRouter.number("costLookupMaxRetries"),
	};
}

/**
 * Validates the `elevenLabs` section: where the service is, what language it
 * should expect to hear, and what it charges. All three are facts about the
 * account, the recordings, and the plan in force rather than about this
 * codebase, so all three are configuration (technical-design.md §6).
 *
 * @param value - The raw `elevenLabs` section.
 * @returns The validated section.
 * @throws {ConfigError} If the section is not an object, or any field is missing or mistyped.
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
 * Validates the `naming` section: the module prefixes stripped from a derived
 * lecture title.
 *
 * A prefix that is empty or only whitespace is refused. It would otherwise build
 * a pattern matching any run of underscores or spaces, which would take apart
 * every title the run produces rather than merely failing to strip a prefix
 * (technical-design.md §3.2).
 *
 * @param value - The raw `naming` section.
 * @returns The validated section.
 * @throws {ConfigError} If the section is not an object, `modulePrefixes` is not an array of strings, or any prefix is blank.
 */
function requireNaming(value: unknown): PipelineConfig["naming"] {
	const naming = requireSection({ value, label: "naming" });
	const modulePrefixes = naming.stringArray("modulePrefixes");
	if (modulePrefixes.some((prefix) => prefix.trim() === "")) {
		throw new ConfigError("naming.modulePrefixes must not contain a blank module prefix");
	}
	return { modulePrefixes };
}

function requireStageConfig(args: {
	readonly value: unknown;
	readonly stageId: string;
}): StageConfig {
	const stage = requireSection({ value: args.value, label: `stages.${args.stageId}` });
	return {
		modelId: stage.string("modelId"),
		temperature: stage.optionalNumber("temperature"),
		maxTokens: stage.optionalNumber("maxTokens"),
		concurrency: stage.optionalNumber("concurrency"),
		maxIterations: stage.optionalNumber("maxIterations"),
	};
}

/**
 * Validates the `stages` section, keys included. A key that names no stage is
 * rejected here: it would otherwise be validated in full and have its model ID
 * checked, while the stage it was meant to configure silently had none — which
 * is the typo case the startup check exists for (technical-design.md §6).
 *
 * @param value - The raw `stages` section.
 * @returns The validated section.
 * @throws {ConfigError} If the section is not an object, a key names no stage, or any stage's config is invalid.
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
 * Validates the `output` section: which language the prose stages write, and
 * which engine renders the PDF.
 *
 * The language is checked against the set the pipeline has prompt wording for,
 * rather than merely being required to be a string. A tag with no wording would
 * otherwise reach a prompt as an instruction no model can follow, and the first
 * sign of it would be notes in the wrong language — so it is refused at startup,
 * naming the languages it could have been (technical-design.md §6).
 *
 * @param value - The raw `output` section.
 * @returns The validated section.
 * @throws {ConfigError} If the section is not an object, either field is missing or mistyped, or the language is one the pipeline cannot write.
 */
function requireOutput(value: unknown): PipelineConfig["output"] {
	const output = requireSection({ value, label: "output" });
	const language = output.string("language");
	if (!isOutputLanguage(language)) {
		throw new ConfigError(unknownLanguageMessage({ subject: `output.language "${language}"` }));
	}
	return {
		language,
		pandocEngine: output.string("pandocEngine"),
	};
}

/**
 * Validates parsed config JSON into a {@link PipelineConfig}.
 *
 * Exported separately from {@link loadConfig} so config already in memory can be
 * checked without a file read — which is how the test fixtures take their
 * defaults from `pipeline-config.example.json` rather than restating them, and
 * how that example is proved to be valid.
 *
 * @param raw - The parsed JSON to validate.
 * @returns The validated configuration.
 * @throws {ConfigError} If any required field is missing or mistyped.
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

/**
 * The human-facing models page, for an error message to point at. Taken from the
 * configured API address's origin, so the two cannot name different hosts — which
 * assumes whatever serves the API also serves that page (technical-design.md §6).
 *
 * @param baseUrl - The configured OpenRouter base URL.
 * @returns The models page URL.
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
 * Whether a model ID is excused the OpenRouter check because the provider it
 * names is one of the exempt ones. An ID naming no provider is never excused —
 * it has no prefix to opt out with (technical-design.md §6).
 *
 * @param args - The check inputs.
 * @param args.modelId - The configured model ID.
 * @param args.exemptProviders - The providers the check skips, as configured.
 * @returns `true` when the ID's provider is exempt.
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
	// `stages` is a partial record — not every stage need be configured — so its
	// entries type as possibly absent. A key is only ever present with a value,
	// and the config is parsed from JSON, which has no way to express an undefined
	// one, so a runtime check here would be a branch nothing could ever take. The
	// assertion says that and nothing else: the keys stay `string`, which is all
	// the error message reads them as.
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
 * The check is not optional. It costs one request per invocation, before any
 * billable call, and a way of turning it off would be a way of discovering a
 * typo'd model id at the first paid call instead of at startup.
 *
 * @param options - Loader options.
 * @param options.projectRoot - Absolute path to the directory containing `pipeline-config.json`.
 * @returns The validated pipeline configuration.
 * @throws {ConfigError} If the file is missing, malformed, fails shape validation, or names an unrecognised model ID.
 */
export async function loadConfig(options: {
	readonly projectRoot: string;
}): Promise<PipelineConfig> {
	const configPath = join(options.projectRoot, CONFIG_FILENAME);
	const config = parseConfig(await readConfigFile(configPath));
	await assertModelIdsResolvable(config);
	return config;
}
