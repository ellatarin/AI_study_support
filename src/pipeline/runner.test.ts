import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type {
	ManifestStageEntry,
	PipelineConfig,
	RunManifest,
	RunOptions,
	RunType,
	StageId,
} from "../types/pipeline.js";
import { assembleContext, classifyRunType, deriveRunId, PipelineRunner } from "./runner.js";

const ALL_STAGES: readonly StageId[] = [
	"source-normalisation",
	"audio-extraction",
	"transcription",
	"transcript-structuring",
	"slide-conversion",
	"image-extraction",
	"synthesis",
	"qa-loop",
	"pdf-generation",
];

function pendingStages(): RunManifest["stages"] {
	const entries = ALL_STAGES.map((id) => [id, { status: "pending" }] as const);
	return Object.fromEntries(entries) as RunManifest["stages"];
}

function makeConfig(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
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

function makeManifest(overrides: Partial<RunManifest> = {}): RunManifest {
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

function manifestWithStage(stageId: StageId, entry: ManifestStageEntry): RunManifest {
	return makeManifest({
		stages: { ...pendingStages(), [stageId]: entry } as RunManifest["stages"],
	});
}

describe("deriveRunId", () => {
	it("should strip milliseconds and replace colons with hyphens when given a date", () => {
		expect(deriveRunId({ instant: new Date("2025-10-10T09:00:00.123Z") })).toBe(
			"2025-10-10T09-00-00Z",
		);
	});

	it("should produce a filename-safe id when the date is midnight", () => {
		expect(deriveRunId({ instant: new Date("2025-01-02T00:00:00.000Z") })).toBe(
			"2025-01-02T00-00-00Z",
		);
	});
});

describe("classifyRunType", () => {
	const complete: ManifestStageEntry = {
		status: "complete",
		completedAt: "2025-10-10T09:02:00.000Z",
		configUsed: null,
		cost: null,
		filesWritten: [],
	};
	const skipped: ManifestStageEntry = {
		status: "skipped",
		completedAt: "2025-10-10T09:02:00.000Z",
		configUsed: null,
		cost: null,
		filesWritten: [],
	};
	const failed: ManifestStageEntry = {
		status: "failed",
		failedAt: "2025-10-10T09:02:00.000Z",
		error: "transcription request failed",
		configUsed: null,
		cost: null,
		filesWritten: [],
	};

	it("should classify as normal when no from-stage is given", () => {
		const result = classifyRunType({ options: {}, manifest: makeManifest() });
		expect(result).toBe<RunType>("normal");
	});

	it.each([
		{ scenario: "a complete stage", entry: complete, expected: "experiment" as const },
		{ scenario: "a skipped stage", entry: skipped, expected: "experiment" as const },
		{ scenario: "a failed stage", entry: failed, expected: "error-recovery" as const },
		{
			scenario: "a pending stage",
			entry: { status: "pending" } as ManifestStageEntry,
			expected: "error-recovery" as const,
		},
	])("should classify as $expected when from-stage targets $scenario", ({ entry, expected }) => {
		const manifest = manifestWithStage("transcription", entry);
		const options: RunOptions = { fromStage: "transcription" };

		expect(classifyRunType({ options, manifest })).toBe<RunType>(expected);
	});

	it("should classify as error-recovery when from-stage targets a stage absent from the manifest", () => {
		const manifest = makeManifest({ stages: {} as RunManifest["stages"] });
		const result = classifyRunType({ options: { fromStage: "transcription" }, manifest });

		expect(result).toBe<RunType>("error-recovery");
	});
});

describe("assembleContext", () => {
	const workspaceRoot = resolve("/base", "Module A", "Pipeline processing", "L1");

	it("should derive moduleRoot two levels up and attach config and manifest when assembling a context", () => {
		const manifest = makeManifest({ lectureNumber: 3, lectureTitle: "Cellular Respiration" });
		const config = makeConfig();

		const context = assembleContext({ workspaceRoot, manifest, config });

		expect(context.moduleRoot).toBe(resolve(workspaceRoot, "..", ".."));
		expect(context.workspaceRoot).toBe(workspaceRoot);
		expect(context.config).toBe(config);
		expect(context.manifest).toBe(manifest);
		expect(context.lectureNumber).toBe(3);
		expect(context.lectureTitle).toBe("Cellular Respiration");
	});

	it("should return a frozen context when assembling a context", () => {
		const context = assembleContext({
			workspaceRoot,
			manifest: makeManifest(),
			config: makeConfig(),
		});

		expect(Object.isFrozen(context)).toBe(true);
	});
});

describe("PipelineRunner.normaliseSources", () => {
	it("should invoke source normalisation once per module when normalising sources", async () => {
		const normaliseModule = vi.fn(async () => undefined);
		const runner = new PipelineRunner({
			config: makeConfig(),
			sourceNormalisation: { stageId: "source-normalisation", normaliseModule },
			lectureStages: [],
		});

		await runner.normaliseSources({
			moduleRoots: ["/modules/Biology of Disease", "/modules/Immunology"],
		});

		expect(normaliseModule).toHaveBeenCalledTimes(2);
		expect(normaliseModule).toHaveBeenCalledWith({ moduleRoot: "/modules/Biology of Disease" });
		expect(normaliseModule).toHaveBeenCalledWith({ moduleRoot: "/modules/Immunology" });
	});
});
