import { describe, expect, it } from "vitest";
import type { OverallStatus, RunLogStageEntry } from "../types/pipeline.js";
import { stageOutcomeStatus, summariseLectures, summariseOverallStatus } from "./run-status.js";

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
			scenario: "the stage was skipped because its output already stood",
			entry: { action: "skipped" } as RunLogStageEntry,
			expected: "success" as const,
		},
		{
			scenario: "the stage was never reached because the run had already halted",
			entry: { action: "not-reached" } as RunLogStageEntry,
			expected: "success" as const,
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
			scenario: "one part failed",
			statuses: ["success", "failed"] as const,
			expected: "failed" as const,
		},
		{
			scenario: "several parts failed among ones that did not",
			statuses: ["success", "failed", "failed"] as const,
			expected: "failed" as const,
		},
	])("should report $expected when $scenario", ({ statuses, expected }) => {
		expect(summariseOverallStatus({ statuses })).toBe<OverallStatus>(expected);
	});
});

describe("summariseLectures", () => {
	it("should apply the same rule when lectures carry their own status", () => {
		const lectures = [{ overallStatus: "success" }, { overallStatus: "failed" }] as const;

		expect(summariseLectures({ lectures })).toBe<OverallStatus>("failed");
	});
});
