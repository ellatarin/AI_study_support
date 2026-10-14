import { describe, expect, it } from "vitest";
import { compareWords } from "./word-comparison.js";

/**
 * Compares two texts of one paragraph each, and gives each word with its mark only.
 *
 * @param texts - The two texts.
 * @param texts.before - The earlier text.
 * @param texts.after - The later text.
 * @returns Each compared word and its mark, in reading order.
 */
function wordChanges({
	before,
	after,
}: {
	readonly before: string;
	readonly after: string;
}): readonly { readonly word: string; readonly change: string }[] {
	return compareWords({ before: [before], after: [after] }).map(({ word, change }) => ({
		word,
		change,
	}));
}

describe("compareWords", () => {
	it("should mark each word unchanged when both texts have the same words", () => {
		const text = "Cells meet stress.";

		expect(wordChanges({ before: text, after: text })).toStrictEqual([
			{ word: "Cells", change: "unchanged" },
			{ word: "meet", change: "unchanged" },
			{ word: "stress.", change: "unchanged" },
		]);
	});

	it("should mark a word removed when only the earlier text has it, and a word added when only the later text has it", () => {
		expect(
			wordChanges({ before: "Some injury is reversible.", after: "Some damage is reversible." }),
		).toStrictEqual([
			{ word: "Some", change: "unchanged" },
			{ word: "injury", change: "removed" },
			{ word: "damage", change: "added" },
			{ word: "is", change: "unchanged" },
			{ word: "reversible.", change: "unchanged" },
		]);
	});

	it("should mark a word unchanged when the two texts write it with a different case or different punctuation", () => {
		const changes = wordChanges({ before: "so, Cells meet", after: "So cells meet." }).map(
			({ change }) => change,
		);

		expect(changes).toStrictEqual(["unchanged", "unchanged", "unchanged"]);
	});

	it("should mark a moved phrase removed where it was and added where it is now when the later text moves it", () => {
		expect(
			wordChanges({ before: "first the cell swells", after: "the cell swells first" }),
		).toStrictEqual([
			{ word: "first", change: "removed" },
			{ word: "the", change: "unchanged" },
			{ word: "cell", change: "unchanged" },
			{ word: "swells", change: "unchanged" },
			{ word: "first", change: "added" },
		]);
	});

	it("should mark a figure label unchanged, as one word, when the earlier text has a figure mark at its place", () => {
		expect(
			wordChanges({ before: "The cell swells [FIGURE].", after: "The cell swells (Figure 3)." }),
		).toStrictEqual([
			{ word: "The", change: "unchanged" },
			{ word: "cell", change: "unchanged" },
			{ word: "swells", change: "unchanged" },
			{ word: "(Figure 3).", change: "unchanged" },
		]);
	});

	it("should mark every word of the earlier text removed when the later text is empty", () => {
		expect(wordChanges({ before: "Thank you all.", after: "" })).toStrictEqual([
			{ word: "Thank", change: "removed" },
			{ word: "you", change: "removed" },
			{ word: "all.", change: "removed" },
		]);
	});

	it("should give each word its paragraph and its character offset in each text that has it when the texts have different paragraphs", () => {
		expect(
			compareWords({
				before: ["Cells swell.", "Injury follows."],
				after: ["Cells swell. Injury follows."],
			}),
		).toStrictEqual([
			{
				word: "Cells",
				change: "unchanged",
				before: { paragraphIndex: 0, characterOffset: 0 },
				after: { paragraphIndex: 0, characterOffset: 0 },
			},
			{
				word: "swell.",
				change: "unchanged",
				before: { paragraphIndex: 0, characterOffset: 6 },
				after: { paragraphIndex: 0, characterOffset: 6 },
			},
			{
				word: "Injury",
				change: "unchanged",
				before: { paragraphIndex: 1, characterOffset: 0 },
				after: { paragraphIndex: 0, characterOffset: 13 },
			},
			{
				word: "follows.",
				change: "unchanged",
				before: { paragraphIndex: 1, characterOffset: 7 },
				after: { paragraphIndex: 0, characterOffset: 20 },
			},
		]);
	});
});
