import { describe, expect, it } from "vitest";
import type { RunLog, RunManifest, StageCost } from "../types/pipeline.js";
import { accumulateCost, formatCostReport } from "./cost.js";

describe("accumulateCost", () => {
	it.each([
		{
			name: "two resolved costs",
			current: { promptTokens: 100, completionTokens: 50, callCount: 1, totalCostUsd: 0.02 },
			incoming: { promptTokens: 200, completionTokens: 80, callCount: 2, totalCostUsd: 0.03 },
			expectedTokens: { promptTokens: 300, completionTokens: 130, callCount: 3 },
			expectedCost: 0.05,
		},
		{
			name: "a zero accumulator and a resolved cost",
			current: { promptTokens: 0, completionTokens: 0, callCount: 0, totalCostUsd: 0 },
			incoming: { promptTokens: 200, completionTokens: 80, callCount: 2, totalCostUsd: 0.03 },
			expectedTokens: { promptTokens: 200, completionTokens: 80, callCount: 2 },
			expectedCost: 0.03,
		},
	])("should sum tokens, calls, and cost when merging $name", ({
		current,
		incoming,
		expectedTokens,
		expectedCost,
	}) => {
		const result = accumulateCost({ current, incoming });

		expect(result.promptTokens).toBe(expectedTokens.promptTokens);
		expect(result.completionTokens).toBe(expectedTokens.completionTokens);
		expect(result.callCount).toBe(expectedTokens.callCount);
		expect(result.totalCostUsd).toBeCloseTo(expectedCost);
	});

	it("should carry the error and null the cost when the incoming cost is unresolved", () => {
		const result = accumulateCost({
			current: { promptTokens: 100, completionTokens: 50, callCount: 1, totalCostUsd: 0.02 },
			incoming: {
				promptTokens: 200,
				completionTokens: 80,
				callCount: 2,
				totalCostUsd: null,
				costResolutionError: "timeout",
			},
		});

		expect(result).toEqual({
			promptTokens: 300,
			completionTokens: 130,
			callCount: 3,
			totalCostUsd: null,
			costResolutionError: "timeout",
		});
	});

	it("should join both errors when current and incoming are both unresolved", () => {
		const result = accumulateCost({
			current: {
				promptTokens: 100,
				completionTokens: 50,
				callCount: 1,
				totalCostUsd: null,
				costResolutionError: "err-a",
			},
			incoming: {
				promptTokens: 200,
				completionTokens: 80,
				callCount: 2,
				totalCostUsd: null,
				costResolutionError: "err-b",
			},
		});

		expect(result).toEqual({
			promptTokens: 300,
			completionTokens: 130,
			callCount: 3,
			totalCostUsd: null,
			costResolutionError: "err-a; err-b",
		});
	});
});

const resolved = ({
	callCount,
	totalCostUsd,
}: {
	readonly callCount: number;
	readonly totalCostUsd: number;
}): StageCost => ({
	promptTokens: 0,
	completionTokens: 0,
	callCount,
	totalCostUsd,
});

const manifest: RunManifest = {
	version: "1",
	lectureNumber: 1,
	lectureDate: "2025-10-10",
	provisionalTitle: "Cell Injury",
	lectureTitle: "Cell Injury",
	aiDerivedTitle: null,
	workspaceFolderName: "Lecture 1 - Cell Injury - 2025-10-10",
	createdAt: "2025-10-10T09:00:00.000Z",
	updatedAt: "2025-10-10T10:15:00.000Z",
	stages: {
		transcription: {
			status: "complete",
			completedAt: "2025-10-10T09:05:00.000Z",
			configUsed: { modelId: "elevenlabs/scribe_v2" },
			cost: resolved({ callCount: 1, totalCostUsd: 0.042 }),
			filesWritten: ["Transcript/transcript.txt"],
		},
		"slide-conversion": {
			status: "complete",
			completedAt: "2025-10-10T09:20:00.000Z",
			configUsed: { modelId: "google/gemini-2.5-flash", concurrency: 3 },
			cost: resolved({ callCount: 24, totalCostUsd: 0.034 }),
			filesWritten: ["Slide content/slides.md"],
		},
		synthesis: {
			status: "complete",
			completedAt: "2025-10-10T09:40:00.000Z",
			configUsed: { modelId: "anthropic/claude-sonnet-4.6", maxTokens: 8192 },
			cost: resolved({ callCount: 1, totalCostUsd: 0.312 }),
			filesWritten: ["Notes/notes.md"],
		},
	},
	currentPipelineCost: {
		totalCostUsd: 0.388,
		byStage: { transcription: 0.042, "slide-conversion": 0.034, synthesis: 0.312 },
	},
};

const runLogs: readonly RunLog[] = [
	{
		runId: "2025-10-10T09:00:00Z-1",
		startedAt: "2025-10-10T09:00:00.000Z",
		endedAt: "2025-10-10T09:02:00.000Z",
		triggeredBy: "from-stage",
		runType: "error-recovery",
		fromStage: "slide-conversion",
		stages: {
			"slide-conversion": {
				action: "ran",
				status: "failed",
				configUsed: { modelId: "google/gemini-2.5-flash", concurrency: 3 },
				cost: { totalCostUsd: 0.021, callCount: 5 },
				error: "Slide 17 conversion failed: 429 rate limit",
			},
		},
		totalCostThisRun: 0.021,
	},
	{
		runId: "2025-10-10T10:30:00Z-1",
		startedAt: "2025-10-10T10:30:00.000Z",
		endedAt: "2025-10-10T10:33:00.000Z",
		triggeredBy: "from-stage",
		runType: "error-recovery",
		fromStage: "slide-conversion",
		stages: {
			"slide-conversion": {
				action: "ran",
				status: "complete",
				configUsed: { modelId: "google/gemini-2.5-flash", concurrency: 3 },
				cost: { totalCostUsd: 0.034, callCount: 24 },
			},
		},
		totalCostThisRun: 0.034,
	},
	{
		runId: "2025-10-11T14:00:00Z-1",
		startedAt: "2025-10-11T14:00:00.000Z",
		endedAt: "2025-10-11T14:05:00.000Z",
		triggeredBy: "from-stage",
		runType: "experiment",
		fromStage: "synthesis",
		stages: {
			synthesis: {
				action: "ran",
				status: "complete",
				configUsed: { modelId: "anthropic/claude-opus-4.1" },
				cost: { totalCostUsd: 0.89, callCount: 1 },
			},
		},
		totalCostThisRun: 0.89,
	},
];

describe("formatCostReport", () => {
	it("should render the three-section report when given a manifest and run logs", () => {
		expect(formatCostReport({ runLogs, manifest })).toMatchSnapshot();
	});
});
