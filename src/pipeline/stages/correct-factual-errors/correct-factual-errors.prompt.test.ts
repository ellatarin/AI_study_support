import { describe, expect, it } from "vitest";
import { buildFactCorrectionMessages } from "./correct-factual-errors.prompt.js";

describe("buildFactCorrectionMessages", () => {
	it("should send the subtopic id and title, the paragraphs as a JSON list with no labels, and a numbered list of each factual error's words, problem and correct statement, when the stage builds the user message", () => {
		const messages = buildFactCorrectionMessages({
			subtopicId: 2,
			title: "Tobacco",
			rewrittenSubtopic: ["Tobacco smoke causes most lung cancers.", "Snuff is harmless."],
			factualErrors: [
				{
					passage: "Snuff is harmless.",
					problem: "Snuff causes oral cancer.",
					correctStatement: "Snuff causes cancer of the mouth.",
				},
				{
					passage: "most lung cancers",
					problem: "Doubtful.",
					correctStatement: "most cases of lung cancer",
				},
			],
		});

		expect(messages[1]).toStrictEqual({
			role: "user",
			content: `Subtopic 2: Tobacco

[
 "Tobacco smoke causes most lung cancers.",
 "Snuff is harmless."
]

Errors:

1. Words of the notes: "Snuff is harmless."
Problem: Snuff causes oral cancer.
Correction: Snuff causes cancer of the mouth.

2. Words of the notes: "most lung cancers"
Problem: Doubtful.
Correction: most cases of lung cancer`,
		});
	});
});
