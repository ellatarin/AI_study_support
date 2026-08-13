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
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nock from "nock";
import { vi } from "vitest";
import type {
	ManifestStageEntry,
	PipelineConfig,
	RunManifest,
	StageContext,
	StageId,
} from "../types/pipeline.js";
import { STAGE_IDS } from "../types/pipeline.js";
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
		openRouter: { rateLimitRpm: 60 },
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
	const moduleRoot = await mkdtemp(join(tmpdir(), prefix));
	const workspaceRoot = join(moduleRoot, "Pipeline processing", folderName);
	await mkdir(workspaceRoot, { recursive: true });
	return { moduleRoot, workspaceRoot };
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
