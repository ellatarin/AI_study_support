import { beforeEach, describe, expect, it } from "vitest";
import { makeManifest } from "../pipeline/fixtures.js";
import { createMoneyFormatter } from "../pipeline/reports.js";
import type { PipelineRunEvent } from "../types/pipeline.js";
import { createPipelineRunReporter } from "./pipeline-run-reporter.js";

/**
 * The exchange rate of this suite. It is not 1, so a converted figure differs
 * from its input. It is not the fixtures' rate, so the expected figures share no
 * constant with the code under test.
 */
const GBP_PER_USD = 0.8;

describe("createPipelineRunReporter", () => {
	let written: string[];
	let report: (event: PipelineRunEvent) => void;

	beforeEach(() => {
		written = [];
		report = createPipelineRunReporter({
			write: (text) => {
				written.push(text);
			},
			formatMoney: createMoneyFormatter({ gbpPerUsd: GBP_PER_USD }),
		});
	});

	/** Gives all the text that the reporter wrote, as one string. */
	function printed(): string {
		return written.join("");
	}

	it("should name the lecture when a pipeline run starts", () => {
		report({ event: "lecture-started", manifest: makeManifest() });

		expect(printed()).toContain("Lecture 1: Cell Injury (2025-10-10)");
	});

	it("should name the stage when it starts", () => {
		report({ event: "stage-started", stageId: "transcription" });

		expect(printed()).toContain("Transcription");
	});

	it("should say the output already stands when a stage is skipped", () => {
		report({ event: "stage-skipped", stageId: "transcription" });

		expect(printed()).toContain("Transcription");
		expect(printed()).toContain("already");
	});

	it("should give the calls and the converted cost when a stage completes", () => {
		report({
			event: "stage-completed",
			stageId: "transcription",
			cost: { promptTokens: 0, completionTokens: 0, callCount: 1, costUsd: 0.05 },
		});

		expect(printed()).toContain("1 call,");
		expect(printed()).toContain("£0.040");
	});

	it("should count several calls as calls when a stage completes", () => {
		report({
			event: "stage-completed",
			stageId: "read-slides",
			cost: { promptTokens: 0, completionTokens: 0, callCount: 24, costUsd: 0.05 },
		});

		expect(printed()).toContain("24 calls,");
	});

	it("should read n/a for the cost when a stage completes without one resolving", () => {
		report({
			event: "stage-completed",
			stageId: "transcription",
			cost: {
				promptTokens: 0,
				completionTokens: 0,
				callCount: 1,
				costUsd: null,
				unknownCostReason: "lookup timed out",
			},
		});

		expect(printed()).toContain("n/a");
	});

	it("should name the stage alone when it completes having spent nothing", () => {
		report({ event: "stage-completed", stageId: "audio-extraction", cost: null });

		expect(printed()).toContain("Audio extraction");
		expect(printed()).not.toContain("call");
	});

	// The error message comes after the run summary (technical-design.md §10), so
	// the notice does not give it.
	it("should mark the stage failed without repeating the message when it fails", () => {
		report({ event: "stage-failed", stageId: "transcription" });

		expect(printed()).toContain("Transcription");
		expect(printed()).toContain("failed");
	});

	it("should end each notice with a newline when several are written in turn", () => {
		report({ event: "stage-started", stageId: "transcription" });
		report({ event: "stage-completed", stageId: "transcription", cost: null });

		expect(written).toHaveLength(2);
		expect(written.every((line) => line.endsWith("\n"))).toBe(true);
	});
});
