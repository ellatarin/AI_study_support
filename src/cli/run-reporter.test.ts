import { beforeEach, describe, expect, it } from "vitest";
import { makeManifest } from "../pipeline/fixtures.js";
import { createMoneyFormatter } from "../pipeline/reports.js";
import type { RunEvent } from "../types/pipeline.js";
import { createRunReporter } from "./run-reporter.js";

/**
 * The rate the suite reports at, chosen so a converted figure is not its own
 * input — and deliberately not the fixtures' rate, so this suite's expectations
 * cannot pass by sharing a constant with the code that produced them.
 */
const GBP_PER_USD = 0.8;

describe("createRunReporter", () => {
	let written: string[];
	let report: (event: RunEvent) => void;

	beforeEach(() => {
		written = [];
		report = createRunReporter({
			write: (text) => {
				written.push(text);
			},
			formatMoney: createMoneyFormatter({ gbpPerUsd: GBP_PER_USD }),
		});
	});

	/** Everything the reporter has written so far, as one block. */
	function printed(): string {
		return written.join("");
	}

	it("should name the lecture when a lecture run starts", () => {
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
			stageId: "slide-conversion",
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
				costResolutionError: "lookup timed out",
			},
		});

		expect(printed()).toContain("n/a");
	});

	it("should name the stage alone when it completes having spent nothing", () => {
		report({ event: "stage-completed", stageId: "audio-extraction", cost: null });

		expect(printed()).toContain("Audio extraction");
		expect(printed()).not.toContain("call");
	});

	// The message and the pointer to the debug log follow the run summary (§8);
	// this line exists so that a stage announced as started is not left hanging.
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
