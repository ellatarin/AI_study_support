/**
 * Shared test fixtures for the pipeline modules.
 *
 * `PipelineConfig` and `RunManifest` are wide, fully-required shapes, so a test
 * needing either would otherwise restate the whole thing — and adding a field to
 * either type would mean editing every copy. Building them here keeps that to a
 * single edit. Each builder takes an `overrides` object so a test states only the
 * fields its behaviour actually depends on.
 */

import type { PipelineConfig, RunManifest } from "../types/pipeline.js";
import { STAGE_IDS } from "../types/pipeline.js";

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
