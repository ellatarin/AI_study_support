import { describe, expect, it } from "vitest";
import { STAGE_IDS } from "../types/pipeline.js";
import { isStageId, unknownStageMessage } from "./stage-id.js";

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
