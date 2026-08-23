import { describe, expect, it } from "vitest";
import type { OverallStatus, RunLogStageEntry } from "../types/pipeline.js";
import { stageOutcomeStatus, summariseOverallStatus } from "./run-status.js";

describe("stageOutcomeStatus", () => {
	it.each([
		{
			scenario: "the stage ran to completion",
			entry: {
				action: "ran",
				status: "complete",
				configUsed: null,
				cost: { costUsd: 0.1, callCount: 1 },
			} as RunLogStageEntry,
			expected: "success" as const,
		},
		{
			scenario: "the stage ran and failed",
			entry: {
				action: "ran",
				status: "failed",
				error: "ffmpeg exited 1",
				configUsed: null,
				cost: { costUsd: null, callCount: 0 },
			} as RunLogStageEntry,
			expected: "failed" as const,
		},
		{
			scenario: "the stage was skipped",
			entry: { action: "skipped" } as RunLogStageEntry,
			expected: "partial" as const,
		},
		{
			scenario: "the stage was not reached",
			entry: { action: "not-reached" } as RunLogStageEntry,
			expected: "partial" as const,
		},
	])("should report $expected when $scenario", ({ entry, expected }) => {
		expect(stageOutcomeStatus(entry)).toBe<OverallStatus>(expected);
	});
});

describe("summariseOverallStatus", () => {
	it.each([
		{ scenario: "nothing was attempted", statuses: [], expected: "success" as const },
		{
			scenario: "every part succeeded",
			statuses: ["success", "success"] as const,
			expected: "success" as const,
		},
		{
			scenario: "one part was partial",
			statuses: ["success", "partial"] as const,
			expected: "partial" as const,
		},
		{
			scenario: "one part failed",
			statuses: ["success", "failed"] as const,
			expected: "failed" as const,
		},
		{
			scenario: "parts both failed and were partial",
			statuses: ["partial", "failed", "success"] as const,
			expected: "failed" as const,
		},
	])("should report $expected when $scenario", ({ statuses, expected }) => {
		expect(summariseOverallStatus({ statuses })).toBe<OverallStatus>(expected);
	});
});
