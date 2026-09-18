import { describe, expect, it } from "vitest";
import { STAGE_IDS } from "../types/pipeline.js";
import { isStageAfter, isStageId, unknownStageMessage } from "./stage-id.js";

describe("isStageId", () => {
	it.each(STAGE_IDS)("should accept %s when it is a configured stage", (stageId) => {
		expect(isStageId(stageId)).toBe(true);
	});

	it.each([
		{ scenario: "a stage name is misspelt", value: "transcript-strucuring" },
		{ scenario: "a stage is named in a different style", value: "transcriptStructuring" },
		{ scenario: "the value names nothing at all", value: "" },
	])("should reject the value when $scenario", ({ value }) => {
		expect(isStageId(value)).toBe(false);
	});
});

describe("isStageAfter", () => {
	it.each([
		{
			scenario: "the stage runs later in the pipeline",
			stageId: "transcript-verification",
			other: "transcription",
			expected: true,
		},
		{
			scenario: "the stage runs earlier in the pipeline",
			stageId: "audio-extraction",
			other: "transcription",
			expected: false,
		},
		{
			scenario: "both name the same stage",
			stageId: "transcription",
			other: "transcription",
			expected: false,
		},
	] as const)("should answer $expected when $scenario", ({ stageId, other, expected }) => {
		expect(isStageAfter({ stageId, other })).toBe(expected);
	});
});

describe("unknownStageMessage", () => {
	it("should name the offending subject when the subject is reported", () => {
		expect(unknownStageMessage({ subject: '"strucuring"' })).toContain('"strucuring"');
	});

	it("should list every stage when the reader is shown what they could have named", () => {
		const message = unknownStageMessage({ subject: "anything" });

		for (const stageId of STAGE_IDS) {
			expect(message).toContain(stageId);
		}
	});
});
