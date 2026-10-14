import { describe, expect, it } from "vitest";
import { compareWords } from "./word-comparison.js";

describe("compareWords", () => {
	it("should mark each word unchanged when both texts have the same words", () => {
		const text = "Cells meet stress.";

		expect(compareWords({ before: text, after: text })).toStrictEqual([
			{ word: "Cells", change: "unchanged" },
			{ word: "meet", change: "unchanged" },
			{ word: "stress.", change: "unchanged" },
		]);
	});

	it("should mark a word removed when only the earlier text has it, and a word added when only the later text has it", () => {
		expect(
			compareWords({ before: "Some injury is reversible.", after: "Some damage is reversible." }),
		).toStrictEqual([
			{ word: "Some", change: "unchanged" },
			{ word: "injury", change: "removed" },
			{ word: "damage", change: "added" },
			{ word: "is", change: "unchanged" },
			{ word: "reversible.", change: "unchanged" },
		]);
	});

	it("should mark a word unchanged when the two texts write it with a different case or different punctuation", () => {
		const changes = compareWords({ before: "so, Cells meet", after: "So cells meet." }).map(
			({ change }) => change,
		);

		expect(changes).toStrictEqual(["unchanged", "unchanged", "unchanged"]);
	});

	it("should mark a moved phrase removed where it was and added where it is now when the later text moves it", () => {
		expect(
			compareWords({ before: "first the cell swells", after: "the cell swells first" }),
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
			compareWords({ before: "The cell swells [FIGURE].", after: "The cell swells (Figure 3)." }),
		).toStrictEqual([
			{ word: "The", change: "unchanged" },
			{ word: "cell", change: "unchanged" },
			{ word: "swells", change: "unchanged" },
			{ word: "(Figure 3).", change: "unchanged" },
		]);
	});

	it("should mark every word of the earlier text removed when the later text is empty", () => {
		expect(compareWords({ before: "Thank you all.", after: "" })).toStrictEqual([
			{ word: "Thank", change: "removed" },
			{ word: "you", change: "removed" },
			{ word: "all.", change: "removed" },
		]);
	});
});
