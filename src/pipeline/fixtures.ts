/**
 * Shared test fixtures and helpers for the pipeline modules.
 *
 * `PipelineConfig` and `RunManifest` are wide, fully-required shapes, so a test
 * needing either would otherwise restate the whole thing — and adding a field to
 * either type would mean editing every copy. Building them here keeps that to a
 * single edit. Each builder takes an `overrides` object so a test states only the
 * fields its behaviour actually depends on.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nock from "nock";
import type { Logger } from "pino";
import { vi } from "vitest";
import type {
	ManifestStageEntry,
	PipelineConfig,
	RunManifest,
	StageConfig,
	StageContext,
	StageCost,
	StageId,
	StageRunConfig,
} from "../types/pipeline.js";
import { STAGE_IDS } from "../types/pipeline.js";
import { parseConfig } from "./config.js";
import { datedFileDirs, type ModuleDirs, moduleDirs, workspaceRootFor } from "./layout.js";
import { baseNameForLecture } from "./lecture-files.js";
import { MANIFEST_VERSION } from "./manifest.js";
import { API_KEY_VARIABLE as OPENROUTER_KEY_VARIABLE, OPENROUTER_PATHS } from "./openrouter.js";
import { assembleContext } from "./stage-context.js";
import {
	API_KEY_VARIABLE as ELEVENLABS_KEY_VARIABLE,
	ELEVENLABS_PATHS,
} from "./stages/transcription.js";

/**
 * Awaits a promise that a test expects to reject and returns the rejection, so
 * the test can make several assertions about one error. `rejects.toThrow` only
 * matches a single condition, and a bare try/catch silently passes when the
 * promise unexpectedly resolves — hence the explicit throw here.
 *
 * @param promise - The promise under test, expected to reject.
 * @returns The error the promise rejected with.
 * @throws {Error} If the promise resolves instead of rejecting.
 */
// prefer-readonly-parameter-types cannot see a Promise as read-only (it is a
// built-in carrying methods). Awaiting one cannot mutate it, so the rule has
// nothing to protect here — same rationale as the file-wide disable in
// source-normalisation.ts, narrowed to the one parameter that needs it.
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
export async function captureError(promise: Promise<unknown>): Promise<Error> {
	try {
		await promise;
	} catch (error: unknown) {
		return error as Error;
	}
	throw new Error("Expected the promise to reject, but it resolved");
}

/** The pino levels {@link makeStubLogger} records. */
const LOGGED_LEVELS = ["debug", "info", "warn", "error"] as const;

/** One level a stub logger records against. */
export type LoggedLevel = (typeof LOGGED_LEVELS)[number];

/** One call made against {@link makeStubLogger}, with the bindings in force. */
export type LoggedEntry = {
	readonly level: LoggedLevel;
	readonly bindings: Readonly<Record<string, unknown>>;
	readonly payload: Readonly<Record<string, unknown>>;
	readonly message: string;
};

/**
 * A pino stand-in that records every call made against it.
 *
 * Callers log through a child logger bound to the stage, so a stub has to
 * support `child()` and carry its bindings down — which is exactly what a test
 * asserting "this was logged against the right stage" needs to see. Every level
 * is recorded rather than only `error`, because the same three facts are asked
 * of a `debug` line as of a failure: what was logged, with what payload, under
 * which bindings.
 *
 * @returns The logger to inject, and the entries it has recorded so far.
 */
export function makeStubLogger(): {
	readonly logger: Logger;
	readonly entries: readonly LoggedEntry[];
} {
	const entries: LoggedEntry[] = [];
	const makeChild = (bindings: Readonly<Record<string, unknown>>): Logger => {
		const record =
			(level: LoggedLevel) =>
			// eslint-disable-next-line max-params -- mirrors pino's own (payload, message) signature
			(payload: Readonly<Record<string, unknown>>, message: string) => {
				entries.push({ level, bindings, payload, message });
			};
		const levels = Object.fromEntries(LOGGED_LEVELS.map((level) => [level, record(level)]));
		return {
			...levels,
			child: (childBindings: Readonly<Record<string, unknown>>) =>
				makeChild({ ...bindings, ...childBindings }),
		} as unknown as Logger;
	};
	return { logger: makeChild({}), entries };
}

/**
 * The entries a stub logger recorded at one level, in the order they were
 * logged.
 *
 * @param args - The recording to filter.
 * @param args.entries - Everything the stub logger recorded.
 * @param args.level - The level to keep.
 * @returns The matching entries.
 */
export function loggedAt({
	entries,
	level,
}: {
	readonly entries: readonly LoggedEntry[];
	readonly level: LoggedLevel;
}): readonly LoggedEntry[] {
	return entries.filter((entry) => entry.level === level);
}

/**
 * A manifest stage map with every stage `pending`, as Stage 0 writes it for a
 * newly created lecture workspace.
 *
 * @returns A fresh stage map, safe for a test to spread over.
 */
export function pendingStages(): RunManifest["stages"] {
	const entries = STAGE_IDS.map((stageId) => [stageId, { status: "pending" }] as const);
	return Object.fromEntries(entries) as RunManifest["stages"];
}

/**
 * The shipped example configuration, validated.
 *
 * Configuration lives in the config file, so tests read it rather than restating
 * it: a suite needing OpenRouter's address or a timeout takes it from here, and
 * adding a required field means editing one file. The *example* rather than
 * `pipeline-config.json`, because that one is gitignored and edited per machine
 * — tests must not behave differently on the author's laptop than anywhere else.
 *
 * Parsing it through the real validator also makes every suite a check that the
 * shipped example is loadable, which nothing else verifies.
 */
export const exampleConfig: PipelineConfig = parseConfig(
	JSON.parse(
		readFileSync(join(import.meta.dirname, "..", "..", "pipeline-config.example.json"), "utf8"),
	),
);

/**
 * The rate the suites present money at, fixed here and deliberately **not**
 * taken from `currency.gbpPerUsd`.
 *
 * Every expected pounds figure in a suite is worked out by hand at this rate, so
 * reading it from the config would make an unrelated config edit fail those
 * assertions with "expected £0.148, got £0.170" — blaming the formatter for a
 * change in the rate. Deriving the expectations instead would multiply by the
 * same rate the code under test does, and prove nothing.
 */
export const GBP_PER_USD = 0.74;

/** A configured service address, split into the two halves nock asks for. */
type ServiceAddress = {
	/** The scheme and host, as nock's scope. */
	readonly origin: string;
	/**
	 * The full path to one of the service's endpoints: its route beneath the
	 * configured base path, which is what an interceptor matches on.
	 *
	 * @param endpoint - The service's own route, as the production code names it.
	 * @returns The path to intercept.
	 */
	readonly pathTo: (endpoint: string) => string;
};

/**
 * Reads a configured base URL the way a suite intercepting that service needs
 * it.
 *
 * Parsed once here rather than at each field below, so every address a suite
 * mocks comes from one reading of the configuration: a base URL that moves takes
 * the interceptors with it, and the origin a scope is opened on cannot come to
 * disagree with the path it then matches.
 *
 * @param baseUrl - The service's configured address.
 * @returns Its origin, and how its endpoints hang off it.
 */
function configuredAddress(baseUrl: string): ServiceAddress {
	const address = new URL(baseUrl);
	// A base URL that is a bare host parses to a "/" path, which would double the
	// separator the endpoint already carries.
	const basePath = address.pathname.replace(/\/$/, "");
	return { origin: address.origin, pathTo: (endpoint) => `${basePath}${endpoint}` };
}

/** The configured OpenRouter address, which {@link openRouterUrls} is built from. */
const openRouterAddress = configuredAddress(exampleConfig.openRouter.baseUrl);

/**
 * Where a suite intercepting OpenRouter should point nock: the configured
 * address split into the origin and full paths nock wants.
 *
 * Assembled once, from the configured base URL and the endpoint paths the
 * production code calls, so a suite mocking OpenRouter neither restates the URL
 * nor knows an endpoint independently of the code under test — if either moves,
 * the mocks move with it.
 */
export const openRouterUrls = {
	/** The scheme and host, as nock's scope. */
	origin: openRouterAddress.origin,
	/** Full path to the chat completions endpoint. */
	completions: openRouterAddress.pathTo(OPENROUTER_PATHS.completions),
	/** Full path to the generation (cost lookup) endpoint. */
	generation: openRouterAddress.pathTo(OPENROUTER_PATHS.generation),
	/** Full path to the model-list endpoint. */
	models: openRouterAddress.pathTo(OPENROUTER_PATHS.models),
	/**
	 * The human-facing models page a failed model-ID check links to. Off the
	 * origin rather than the API's base path, as the production code derives it.
	 */
	modelsPage: `${openRouterAddress.origin}${OPENROUTER_PATHS.models}`,
} as const;

/** The ElevenLabs counterpart to {@link openRouterAddress}. */
const elevenLabsAddress = configuredAddress(exampleConfig.elevenLabs.baseUrl);

/**
 * Where a suite intercepting ElevenLabs should point nock: the configured
 * address and the route the SDK appends to it.
 *
 * Assembled the same way {@link openRouterUrls} is, so a suite mocking Scribe
 * neither restates the host nor knows the endpoint independently of the code
 * under test.
 */
export const elevenLabsUrls = {
	/** The scheme and host, as nock's scope. */
	origin: elevenLabsAddress.origin,
	/** Path to the speech-to-text endpoint the transcription stage posts to. */
	speechToText: elevenLabsAddress.pathTo(ELEVENLABS_PATHS.speechToText),
} as const;

/**
 * A stage's configuration, as the shipped example holds it.
 *
 * Read from the example rather than restated, so a suite exercising a stage
 * takes the same model and tuning its configuration does, and fails loudly if
 * the example stops configuring it.
 *
 * @param stageId - The stage whose configuration to read.
 * @returns The configured stage.
 * @throws {Error} If the example configures no such stage.
 */
function exampleStageConfig(stageId: StageId): StageConfig {
	const configured = exampleConfig.stages[stageId];
	if (configured === undefined) {
		throw new Error(`pipeline-config.example.json configures no stage "${stageId}"`);
	}
	return configured;
}

/** The Scribe model the example configures, provider-qualified as Stage 2 expects. */
export const transcriptionModelId = exampleStageConfig("transcription").modelId;

/**
 * A concrete OpenRouter model for the suites that need one.
 *
 * Not taken from the example config: every OpenRouter stage there holds a
 * capability-based placeholder (`<REASONING_MODEL>`) that would fail the
 * model-ID check, so the suites must name a real routing string themselves.
 */
export const openRouterModelId = "openai/gpt-4o";

/**
 * The token counts the stubbed OpenRouter call reports.
 *
 * One value because two responses have to agree about it: the completion's
 * `usage` and the `/generation` lookup's `tokens_prompt`/`tokens_completion`
 * describe the same call, and a suite asserting the resolved `StageCost` is
 * checking that the pipeline carried these counts through unchanged.
 */
export const stubbedTokenUsage = { promptTokens: 120, completionTokens: 45 } as const;

/** What the stubbed LLM call is billed at, where a suite needs a settled figure. */
export const stubbedCostUsd = 0.004;

/**
 * How long a test that renders real media with ffmpeg may take. Well beyond the
 * default: these encode and probe an actual file rather than stub one.
 */
export const mediaTestTimeoutMs = 30_000;

/**
 * A whole stage configuration as the example ships it — temperature, token
 * budget and any other tuning — with only the placeholder model swapped for
 * {@link openRouterModelId}.
 *
 * A stage's parameters belong with its model rather than beside it: a suite
 * that stated `temperature` and `maxTokens` itself was restating the example's
 * tuning, and would keep passing after that tuning changed.
 *
 * @param args - Which stage, and which model to put in its place.
 * @param args.stageId - The stage whose configuration to take.
 * @param args.modelId - The model to substitute; defaults to {@link openRouterModelId}.
 * @returns The stage config, ready to hand to {@link makeConfig}.
 * @throws {Error} If the example configures no such stage.
 */
export function openRouterStageConfig({
	stageId,
	modelId = openRouterModelId,
}: {
	readonly stageId: StageId;
	readonly modelId?: string;
}): StageConfig {
	return { ...exampleStageConfig(stageId), modelId };
}

/** Text that is not valid JSON, for the suites checking a corrupt file is reported. */
export const corruptJson = "{ not json";

/**
 * A well-formed Scribe single-channel response body, as the SDK deserialises it.
 *
 * Both suites that intercept a transcription need one, and its shape — down to
 * the language fields the stage never reads — is ElevenLabs' contract rather
 * than either suite's business.
 *
 * @param args - What Scribe should appear to have heard.
 * @param args.text - The transcript text to return.
 * @returns The response body to reply with.
 */
export function scribeResponseBody({ text }: { readonly text: string }): Record<string, unknown> {
	return { language_code: "eng", language_probability: 0.99, text, words: [] };
}

/**
 * A well-formed OpenRouter chat-completion response body.
 *
 * Two suites need one, and its shape is the SDK's contract rather than either
 * suite's business.
 *
 * @param args - What the model should appear to have said.
 * @param args.content - The assistant message content.
 * @returns The response body to reply with.
 */
export function openRouterCompletionBody({
	content,
}: {
	readonly content: string;
}): Record<string, unknown> {
	return {
		// eslint-disable-next-line id-length -- OpenRouter's field name, not ours to choose
		id: "gen-abc",
		choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
		usage: {
			prompt_tokens: stubbedTokenUsage.promptTokens,
			completion_tokens: stubbedTokenUsage.completionTokens,
		},
	};
}

/**
 * The example configuration with its module and stage lists emptied.
 *
 * The emptying is the only fixture decision left here — everything else is real
 * configuration. A suite states the stages it exercises rather than inheriting
 * all nine, so a test that forgets to configure a stage fails loudly instead of
 * quietly using a placeholder model.
 *
 * @param overrides - Top-level fields to replace.
 * @returns The config.
 */
export function makeConfig(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
	return { ...exampleConfig, moduleRoots: [], stages: {}, ...overrides };
}

/** The imaginary directory {@link testModuleRoot} and its sibling sit under. */
const SYNTHETIC_MODULES_DIR = "/modules";

/** One lecture's identity, as the suites refer to it. */
type TestLecture = {
	readonly number: number;
	readonly date: string;
	readonly title: string;
	readonly folderName: string;
	/** The source video {@link makeLectureTree} writes for this lecture. */
	readonly videoFile: string;
	/** The source slide deck it writes alongside. */
	readonly slideFile: string;
	/** The finished PDF it leaves in `Final output`. */
	readonly outputFile: string;
};

/**
 * Names a lecture the way Stage 0 would, so a fixture can never describe a
 * lecture the pipeline would not produce — a folder name that disagreed with its
 * own date would fail suites for a reason unrelated to what they test.
 *
 * The source video, slide deck and finished PDF all share that folder name, as
 * Stage 0 leaves them, so they are derived here too rather than reassembled from
 * `${folderName}.mp4` wherever a suite happens to need one.
 *
 * @param lecture - The lecture's number, date, and title.
 * @returns The lecture with its canonical folder and file names filled in.
 */
function describeLecture(lecture: Pick<TestLecture, "number" | "date" | "title">): TestLecture {
	const folderName = baseNameForLecture({
		lectureNumber: lecture.number,
		title: lecture.title,
		lectureDate: lecture.date,
	});
	return {
		...lecture,
		folderName,
		videoFile: `${folderName}.mp4`,
		slideFile: `${folderName}.pdf`,
		outputFile: `${folderName}.pdf`,
	};
}

/**
 * The lecture the suites use when they need a concrete one.
 *
 * Its identity was restated across a dozen files — the date in eleven, the
 * folder name in ten, the title in nine — so changing the example meant a sweep,
 * and any suite that updated one part but not another broke confusingly.
 *
 * Suites that *test* the naming keep their own literals: asserting a derived
 * value against itself would prove nothing.
 */
export const testLecture = describeLecture({
	number: 1,
	date: "2025-10-10",
	title: "Cell Injury",
});

/** The module {@link testLecture} belongs to. */
export const testModuleName = "Biology of Disease";

/**
 * The markdown Stage 3's model returns, shared by the two suites that stub the
 * call — they assert the same body reaches disk, so it is one value.
 */
export const structuredMarkdown = "## The Innate Immune Response\n\nBarrier defences come first.";

/** The title Stage 3's model proposes when it judges the lecturer's inadequate. */
export const aiDerivedLecture = describeLecture({
	number: testLecture.number,
	date: testLecture.date,
	title: "Innate Immune Response",
});

/** The title a user sets through the CLI's `rename` command. */
export const userChosenTitle = "Cell Injury and Death";

/** The date the CLI's `change-date` command moves {@link testLecture} to. */
export const changedDate = "2025-10-24";

/**
 * When a completed stage records that it finished. Any instant would do — no
 * assertion depends on the value — so the suites share one rather than each
 * inventing a timestamp that reads as though it mattered.
 */
export const stageCompletedAt = `${testLecture.date}T10:00:00.000Z`;

/**
 * A run identifier in the form `deriveRunId` produces. Arbitrary like
 * {@link stageCompletedAt}; the suite that checks the *form* derives its own.
 */
export const testRunId = `${testLecture.date}T09-00-00Z`;

/**
 * A finished stage's manifest entry, in either of the two ways a stage finishes.
 * `complete` and `skipped` carry the same fields and mean the same thing about
 * the disk — the stage's output is there — which is what the suites asserting on
 * either of them need to say.
 *
 * Every field defaults, because most suites care about one of them and had been
 * restating the other four to reach it: a stage suite wants the output it
 * recorded, the cost report wants the model and the money, and the runner's
 * skip cases want an instant earlier than the run under way. The default
 * instant is arbitrary and comes from {@link stageCompletedAt}, so a suite that
 * states one is saying the value matters.
 *
 * @param args - What the stage did; every field optional.
 * @param args.status - Whether the stage ran to completion or was skipped; complete by default.
 * @param args.completedAt - When it finished; {@link stageCompletedAt} by default.
 * @param args.configUsed - The model and tuning it resolved; none by default.
 * @param args.cost - What the stage cost; none by default.
 * @param args.filesWritten - The workspace-relative outputs it recorded; none by default.
 * @returns The manifest entry.
 */
export function finishedEntry({
	status = "complete",
	completedAt = stageCompletedAt,
	configUsed = null,
	cost = null,
	filesWritten = [],
}: {
	readonly status?: "complete" | "skipped";
	readonly completedAt?: string;
	readonly configUsed?: StageRunConfig | null;
	readonly cost?: StageCost | null;
	readonly filesWritten?: readonly string[];
} = {}): ManifestStageEntry {
	return { status, completedAt, configUsed, cost, filesWritten };
}

/**
 * A failed stage's manifest entry. Structurally complete, so a suite asserting
 * how a failed stage is treated does so against data a real run could produce
 * rather than a cast-away partial object.
 *
 * @param args - What the stage recorded before it failed.
 * @param args.filesWritten - Any workspace-relative outputs it left behind; none by default.
 * @returns The manifest entry.
 */
export function failedEntry({
	filesWritten = [],
}: {
	readonly filesWritten?: readonly string[];
} = {}): ManifestStageEntry {
	return {
		status: "failed",
		failedAt: stageCompletedAt,
		error: "the stage threw",
		configUsed: null,
		cost: null,
		filesWritten,
	};
}

/** A second lecture in the same module, for "left untouched" assertions. */
export const otherLecture = describeLecture({
	number: 2,
	date: "2025-10-17",
	title: "Inflammation",
});

/** A second module, for the cases where a date matches across modules. */
export const otherModuleName = "Immunology";

/**
 * Absolute module roots for the suites that never touch the disk — argument
 * parsing, prompt rendering, and the runner's own unit tests all need a path
 * that looks real without one existing. Suites that do write to disk build
 * theirs under a temporary directory instead ({@link makeLectureTree}).
 */
export const testModuleRoot = join(SYNTHETIC_MODULES_DIR, testModuleName);

/** The {@link otherModuleName} counterpart to {@link testModuleRoot}. */
export const otherModuleRoot = join(SYNTHETIC_MODULES_DIR, otherModuleName);

/**
 * Builds a structurally valid {@link RunManifest} for {@link testLecture}, with
 * every stage pending and no cost recorded.
 *
 * @param overrides - Top-level fields to replace on the base manifest.
 * @returns The manifest.
 */
export function makeManifest(overrides: Partial<RunManifest> = {}): RunManifest {
	return {
		version: MANIFEST_VERSION,
		lectureNumber: testLecture.number,
		lectureDate: testLecture.date,
		provisionalTitle: testLecture.title,
		lectureTitle: testLecture.title,
		userTitle: null,
		aiDerivedTitle: null,
		workspaceFolderName: testLecture.folderName,
		createdAt: `${testLecture.date}T00:00:00.000Z`,
		updatedAt: `${testLecture.date}T00:00:00.000Z`,
		stages: pendingStages(),
		...overrides,
	};
}

/**
 * The key a stubbed service is armed with. One value, because a suite asserting
 * the key reached the wire is checking for the same key the fixture put in the
 * environment — two spellings would let that assertion pass against nothing.
 */
export const stubbedApiKey = "test-key";

/**
 * Arms a test to exercise a billable API without reaching it: clears any
 * leftover interceptors, blocks all outbound connections so a request the test
 * forgot to intercept fails loudly instead of reaching the real service, and
 * supplies a dummy key.
 *
 * @param apiKeyVariable - The environment variable that service reads its key from.
 * @returns Nothing.
 */
function stubApi(apiKeyVariable: string): void {
	nock.cleanAll();
	nock.disableNetConnect();
	vi.stubEnv(apiKeyVariable, stubbedApiKey);
}

/**
 * Arms a test to exercise an OpenRouter call without reaching OpenRouter.
 *
 * @returns Nothing.
 */
export function stubOpenRouterApi(): void {
	stubApi(OPENROUTER_KEY_VARIABLE);
}

/**
 * Undoes {@link stubOpenRouterApi} or {@link stubElevenLabsApi}, restoring real
 * network access and the real environment for any suite that follows.
 *
 * One function rather than one per service: nothing it does is particular to
 * either, and `vi.unstubAllEnvs` was already clearing both suites' keys whichever
 * of the two a suite called.
 *
 * @returns Nothing.
 */
export function resetStubbedApi(): void {
	nock.cleanAll();
	nock.enableNetConnect();
	vi.unstubAllEnvs();
}

/**
 * Arms a test to exercise the transcription stage without reaching ElevenLabs.
 *
 * @returns Nothing.
 */
export function stubElevenLabsApi(): void {
	stubApi(ELEVENLABS_KEY_VARIABLE);
}

/**
 * Creates a temporary module tree laid out the way the pipeline expects —
 * `<moduleRoot>/Pipeline processing/<folderName>` — and returns both roots.
 *
 * Stage tests need this exact nesting rather than any two directories, because
 * {@link makeStageContext} derives `moduleRoot` two levels above the workspace
 * just as a real run does. The caller is responsible for removing `moduleRoot`.
 *
 * @param args - The layout inputs.
 * @param args.prefix - Prefix for the temporary directory name, identifying the suite.
 * @param args.folderName - The workspace folder name; defaults to {@link testLecture}'s.
 * @returns The module root and the workspace root inside it.
 */
export async function makeWorkspaceTree({
	prefix,
	folderName = testLecture.folderName,
}: {
	readonly prefix: string;
	readonly folderName?: string;
}): Promise<{ readonly moduleRoot: string; readonly workspaceRoot: string }> {
	const moduleRoot = await makeTempDir({ prefix });
	const workspaceRoot = workspaceRootFor({ moduleRoot, folderName });
	await mkdir(workspaceRoot, { recursive: true });
	return { moduleRoot, workspaceRoot };
}

/**
 * Lays a whole lecture out on disk as Stage 0 leaves it: the module's four
 * directories, a source video and slide deck sharing the workspace's base name,
 * a finished PDF, and the empty workspace itself.
 *
 * Anything that moves a lecture needs all of this — the `change-date` command
 * and Stage 3 both rename the four together — so the layout is built here rather
 * than restated by each suite that exercises a rename. The caller writes
 * whatever else its stage reads (a transcript, a manifest) and removes
 * `tempDir` afterwards.
 *
 * The lecture it lays out is {@link testLecture}, and each of the three files is
 * named from that lecture rather than reassembled here: `describeLecture` is
 * where a lecture's file names are derived, and deriving them twice is how the
 * two spellings drift apart.
 *
 * @param args - The layout inputs.
 * @param args.prefix - Prefix for the temporary directory name, identifying the suite.
 * @returns The temp directory to clean up, the module root and its directories, and the workspace.
 */
export async function makeLectureTree({ prefix }: { readonly prefix: string }): Promise<{
	readonly tempDir: string;
	readonly moduleRoot: string;
	readonly dirs: ModuleDirs;
	readonly workspaceRoot: string;
}> {
	const tempDir = await makeTempDir({ prefix });
	const moduleRoot = join(tempDir, testModuleName);
	const dirs = moduleDirs({ moduleRoot });
	const workspaceRoot = workspaceRootFor({ moduleRoot, folderName: testLecture.folderName });

	for (const dir of [...datedFileDirs({ dirs }), workspaceRoot]) {
		await mkdir(dir, { recursive: true });
	}
	await writeFile(join(dirs.video, testLecture.videoFile), "video");
	await writeFile(join(dirs.slide, testLecture.slideFile), "slides");
	await writeFile(join(dirs.finalOutput, testLecture.outputFile), "notes");

	return { tempDir, moduleRoot, dirs, workspaceRoot };
}

/**
 * Creates an empty temporary directory for a suite to build its own tree in, and
 * to remove afterwards.
 *
 * Every integration test that touches the filesystem starts this way; stating it
 * once keeps the temp-directory dance — and the platform imports it needs — out
 * of each suite. Where the tree is a lecture workspace, {@link makeWorkspaceTree}
 * lays out the nesting too.
 *
 * @param args - The directory inputs.
 * @param args.prefix - Prefix for the directory name, identifying the suite in `/tmp`.
 * @returns The absolute path of the new directory.
 */
export function makeTempDir({ prefix }: { readonly prefix: string }): Promise<string> {
	return mkdtemp(join(tmpdir(), prefix));
}

/**
 * Renders a media fixture by invoking the `ffmpeg` binary directly, so an
 * integration test can generate its own audio or video rather than commit a
 * binary file. Invoked directly rather than through fluent-ffmpeg because
 * fluent-ffmpeg validates input formats against `ffmpeg -formats`, which omits
 * the `lavfi` synthetic-source device these fixtures are built from.
 *
 * @param args - The invocation inputs.
 * @param args.ffmpegArgs - The ffmpeg argv, excluding the leading `-y`.
 * @returns A promise that resolves once ffmpeg exits successfully.
 * @throws {Error} If ffmpeg cannot be spawned or exits non-zero.
 */
export function renderFixtureMedia({
	ffmpegArgs,
}: {
	readonly ffmpegArgs: readonly string[];
}): Promise<void> {
	// eslint-disable-next-line max-params -- Promise executor signature is spec-defined
	return new Promise((resolve, reject) => {
		const child = spawn("ffmpeg", ["-y", ...ffmpegArgs], { stdio: "ignore" });
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`ffmpeg exited with code ${String(code)} rendering a fixture`));
		});
	});
}

/**
 * Builds a manifest stage map with every stage pending except one, so a test can
 * state just the entry whose status its behaviour depends on.
 *
 * @param args - The single stage entry to set.
 * @param args.stageId - The stage whose entry replaces the pending default.
 * @param args.entry - The entry to record for that stage.
 * @returns The stage map.
 */
export function stagesWith({
	stageId,
	entry,
}: {
	readonly stageId: StageId;
	readonly entry: ManifestStageEntry;
}): RunManifest["stages"] {
	return { ...pendingStages(), [stageId]: entry } as RunManifest["stages"];
}

/**
 * Builds a {@link StageContext} for a stage under test through the runner's own
 * `assembleContext`, so the fixture cannot drift from how a real run assembles
 * the context — including deriving `moduleRoot` two levels above the workspace.
 * A test therefore has to lay its temp directories out the way the pipeline
 * really does (`moduleRoot/Pipeline processing/<folder>`).
 *
 * @param args - The context inputs.
 * @param args.workspaceRoot - Absolute path to the lecture workspace.
 * @param args.manifest - The lecture's manifest; defaults to {@link makeManifest}.
 * @param args.config - The pipeline config; defaults to {@link makeConfig}.
 * @returns The stage context.
 */
export function makeStageContext({
	workspaceRoot,
	manifest = makeManifest(),
	config = makeConfig(),
}: {
	readonly workspaceRoot: string;
	readonly manifest?: RunManifest;
	readonly config?: PipelineConfig;
}): StageContext {
	return assembleContext({ workspaceRoot, manifest, config });
}
