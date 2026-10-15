import { describe, expect, it } from "vitest";
import {
	factCorrectedSubtopicsOf,
	seededFactCheckLine,
	seededFactualErrors,
} from "../../fixtures.js";
import { factCheckLine } from "./fact-check-line.js";

/** The fact correction of one subtopic, by the seeded model on the seeded date. */
const factCorrections = factCorrectedSubtopicsOf([{ subtopicId: 1, paragraphs: ["Text."] }]);

describe("factCheckLine", () => {
	it("should name each fact-check model, the correction model, both prompt versions and the date when both stages ran", () => {
		const line = factCheckLine({ factualErrors: seededFactualErrors, factCorrections });

		expect(line).toBe(seededFactCheckLine);
	});

	it("should name each correction prompt version once, in lecture order, when saved subtopic files come from an earlier prompt", () => {
		const threeSubtopics = factCorrectedSubtopicsOf(
			[1, 2, 3].map((subtopicId) => ({ subtopicId, paragraphs: ["Text."] })),
		);
		// Subtopics 1 and 3 come from prompt k2, and subtopic 2 from the current prompt k3.
		const mixed = {
			...threeSubtopics,
			factCorrectedSubtopics: threeSubtopics.factCorrectedSubtopics.map((entry) =>
				entry.subtopicId === 2 ? entry : { ...entry, factCorrectionPromptVersion: "k2" },
			),
		};

		const line = factCheckLine({ factualErrors: seededFactualErrors, factCorrections: mixed });

		expect(line).toContain("Corrected by: gpt-4o (prompt k2, k3)");
	});

	it.each([
		{
			condition: "the fact check was bypassed",
			files: {
				factualErrors: { ...seededFactualErrors, bypassed: true, checkedBy: [], factualErrors: [] },
				factCorrections,
			},
		},
		{
			condition: "the fact correction was bypassed",
			files: {
				factualErrors: seededFactualErrors,
				factCorrections: { ...factCorrections, correctedBy: null, correctedOn: null },
			},
		},
	])("should give Uncorrected when $condition", ({ files }) => {
		expect(factCheckLine(files)).toBe("Uncorrected");
	});
});
