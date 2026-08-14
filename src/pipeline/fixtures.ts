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
	StageContext,
	StageId,
} from "../types/pipeline.js";
import { STAGE_IDS } from "../types/pipeline.js";
import { type ModuleDirs, moduleDirs } from "./layout.js";
import { assembleContext } from "./runner.js";

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

/** One `error` call made against {@link makeStubLogger}, with the bindings in force. */
export type LoggedError = {
	readonly bindings: Record<string, unknown>;
	readonly payload: Record<string, unknown>;
	readonly message: string;
};

/**
 * A pino stand-in that records what was logged at `error` and swallows the rest.
 *
 * The runner logs a stage failure through a child logger bound to the stage, so
 * a stub has to support `child()` and carry its bindings down — which is exactly
 * what a test asserting "the failure was logged, with its stack, against the
 * right stage" needs to see.
 *
 * @returns The logger to inject, and the errors it has recorded so far.
 */
export function makeStubLogger(): {
	readonly logger: Logger;
	readonly errors: readonly LoggedError[];
} {
	const errors: LoggedError[] = [];
	const makeChild = (bindings: Readonly<Record<string, unknown>>): Logger =>
		({
			child: (childBindings: Readonly<Record<string, unknown>>) =>
				makeChild({ ...bindings, ...childBindings }),
			// eslint-disable-next-line max-params -- mirrors pino's own (payload, message) signature
			error: (payload: Readonly<Record<string, unknown>>, message: string) => {
				errors.push({ bindings, payload, message });
			},
			info: () => undefined,
			warn: () => undefined,
			debug: () => undefined,
		}) as unknown as Logger;
	return { logger: makeChild({}), errors };
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
 * The OpenRouter address the test configs point at.
 *
 * OpenRouter's address is configuration, not a literal in code
 * (technical-design.md §6), so a suite that needs the host — to intercept it, or
 * to assert what was sent — derives it from here rather than restating the URL.
 * It lives in the fixtures because a test must not depend on the real
 * `pipeline-config.json`, which the user edits.
 */
export const TEST_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * Builds a structurally valid {@link PipelineConfig} with no stages configured,
 * so a test declares only the stages it exercises.
 *
 * @param overrides - Top-level fields to replace on the base config.
 * @returns The config.
 */
export function makeConfig(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
	return {
		version: "1",
		moduleRoots: [],
		openRouter: { baseUrl: TEST_OPENROUTER_BASE_URL, rateLimitRpm: 60 },
		elevenLabs: { costPerAudioHourUsd: 0.22 },
		currency: { gbpPerUsd: 0.74 },
		modelIdCheck: { exemptProviders: ["elevenlabs"] },
		stages: {},
		output: { language: "en-GB", pandocEngine: "xelatex" },
		...overrides,
	};
}

/**
 * Builds a structurally valid {@link RunManifest} for a single lecture with
 * every stage pending and no cost recorded.
 *
 * @param overrides - Top-level fields to replace on the base manifest.
 * @returns The manifest.
 */
export function makeManifest(overrides: Partial<RunManifest> = {}): RunManifest {
	return {
		version: "1",
		lectureNumber: 1,
		lectureDate: "2025-10-10",
		provisionalTitle: "Immune System",
		lectureTitle: "Immune System",
		userTitle: null,
		aiDerivedTitle: null,
		workspaceFolderName: "L1",
		createdAt: "2025-10-10T00:00:00Z",
		updatedAt: "2025-10-10T00:00:00Z",
		stages: pendingStages(),
		currentPipelineCost: { totalCostUsd: 0, byStage: {} },
		...overrides,
	};
}

/**
 * Arms a test to exercise the transcription stage without reaching ElevenLabs:
 * clears any leftover interceptors, blocks all outbound connections so a request
 * the test forgot to intercept fails loudly instead of hitting the real
 * (billable) API, and supplies a dummy `ELEVENLABS_API_KEY`.
 *
 * @returns Nothing.
 */
export function stubElevenLabsApi(): void {
	nock.cleanAll();
	nock.disableNetConnect();
	vi.stubEnv("ELEVENLABS_API_KEY", "test-api-key");
}

/**
 * Undoes {@link stubElevenLabsApi}, restoring real network access and the real
 * environment for any suite that follows.
 *
 * @returns Nothing.
 */
export function resetElevenLabsApi(): void {
	nock.cleanAll();
	nock.enableNetConnect();
	vi.unstubAllEnvs();
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
 * @param args.folderName - The workspace folder name; defaults to a bare lecture name.
 * @returns The module root and the workspace root inside it.
 */
export async function makeWorkspaceTree({
	prefix,
	folderName = "Lecture 1 - 2025-10-10",
}: {
	readonly prefix: string;
	readonly folderName?: string;
}): Promise<{ readonly moduleRoot: string; readonly workspaceRoot: string }> {
	const moduleRoot = await makeTempDir({ prefix });
	const workspaceRoot = join(moduleRoot, "Pipeline processing", folderName);
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
 * @param args - The layout inputs.
 * @param args.prefix - Prefix for the temporary directory name, identifying the suite.
 * @param args.folderName - The base name the workspace and the three files share.
 * @returns The temp directory to clean up, the module's directories, and the workspace.
 */
export async function makeLectureTree({
	prefix,
	folderName,
}: {
	readonly prefix: string;
	readonly folderName: string;
}): Promise<{
	readonly tempDir: string;
	readonly dirs: ModuleDirs;
	readonly workspaceRoot: string;
}> {
	const tempDir = await makeTempDir({ prefix });
	const dirs = moduleDirs({ moduleRoot: join(tempDir, "Biology of Disease") });
	const workspaceRoot = join(dirs.processing, folderName);

	for (const dir of [dirs.video, dirs.slide, dirs.finalOutput, workspaceRoot]) {
		await mkdir(dir, { recursive: true });
	}
	await writeFile(join(dirs.video, `${folderName}.mp4`), "video");
	await writeFile(join(dirs.slide, `${folderName}.pdf`), "slides");
	await writeFile(join(dirs.finalOutput, `${folderName}.pdf`), "notes");

	return { tempDir, dirs, workspaceRoot };
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
