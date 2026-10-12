import { describe, expect, it } from "vitest";
import { cutIntoParts } from "./paragraph-parts.mts";

const text = "Okay. Cells divide. Right. Tumours grow here. Right. They spread.";
const rewrite = ["Cells divide.", "Tumours grow.", "They spread."];

describe("cutIntoParts", () => {
	it("should give each part the text from its start words to the next part's start words when each part has one paragraph", () => {
		const parts = cutIntoParts({
			text,
			rewrite,
			parts: [
				{ paragraphs: [1], startWords: null },
				{ paragraphs: [2], startWords: "Right. Tumours" },
				{ paragraphs: [3], startWords: "Right. They" },
			],
		});

		expect(parts).toStrictEqual([
			{ paragraphs: [1], text: "Okay. Cells divide.", rewrite: ["Cells divide."] },
			{ paragraphs: [2], text: "Right. Tumours grow here.", rewrite: ["Tumours grow."] },
			{ paragraphs: [3], text: "Right. They spread.", rewrite: ["They spread."] },
		]);
	});

	it("should give a joined part each of its paragraphs when a part has two paragraphs", () => {
		const parts = cutIntoParts({
			text,
			rewrite,
			parts: [
				{ paragraphs: [1, 2], startWords: null },
				{ paragraphs: [3], startWords: "Right. They" },
			],
		});

		expect(parts[0]).toStrictEqual({
			paragraphs: [1, 2],
			text: "Okay. Cells divide. Right. Tumours grow here.",
			rewrite: ["Cells divide.", "Tumours grow."],
		});
	});

	it.each([
		{
			condition: "the start words are not in the text",
			parts: [
				{ paragraphs: [1, 2], startWords: null },
				{ paragraphs: [3], startWords: "Metastases form" },
			],
		},
		{
			condition: "the start words occur more than once",
			parts: [
				{ paragraphs: [1, 2], startWords: null },
				{ paragraphs: [3], startWords: "Right." },
			],
		},
		{
			condition: "the start words come before the start of the part before",
			parts: [
				{ paragraphs: [1], startWords: null },
				{ paragraphs: [2], startWords: "Right. They" },
				{ paragraphs: [3], startWords: "Right. Tumours" },
			],
		},
		{
			condition: "a later part has no start words",
			parts: [
				{ paragraphs: [1, 2], startWords: null },
				{ paragraphs: [3], startWords: null },
			],
		},
		{
			condition: "the parts do not hold each paragraph once, in order",
			parts: [
				{ paragraphs: [1], startWords: null },
				{ paragraphs: [3], startWords: "Right. They" },
			],
		},
	])("should throw when $condition", ({ parts }) => {
		expect(() => cutIntoParts({ text, rewrite, parts })).toThrow();
	});
});
