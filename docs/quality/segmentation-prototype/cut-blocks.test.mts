import { describe, expect, test } from "vitest";
import { applyCuts, judgeFidelity } from "./cut-blocks.mts";

/**
 * The opening of the list `applyCuts` takes: the first entry names the block
 * that begins at the transcript's own start, and carries no quote to find.
 */
const OPENING = { id: 0, label: "opening", startsWith: "" };

describe("applyCuts", () => {
	test("should keep the lecturer's leading connective with the new block when the model's quote drops it", () => {
		const transcript =
			"We looked at the histology and saw no invasion past the muscularis mucosa. " +
			"So where do we come to now? Back to cigarette smoke.";

		const { blocks, misses } = applyCuts(transcript, [
			OPENING,
			{ id: 1, label: "cigarettes", startsWith: "where do we come to now" },
		]);

		expect(misses).toEqual([]);
		expect(blocks[1]?.content).toBe("So where do we come to now? Back to cigarette smoke.");
		expect(blocks[0]?.content.trimEnd().endsWith("muscularis mucosa.")).toBe(true);
	});

	test.each([
		["So", "So then where does that leave us?"],
		["And so", "And so where does that leave us?"],
		["Right. So", "Right. So where does that leave us?"],
		["Okay", "Okay, where does that leave us?"],
	])("should move the cut back over %s when the quote starts after it", (_name, tail) => {
		const transcript = `A first step that ends here. ${tail}`;

		const { blocks } = applyCuts(transcript, [
			OPENING,
			{ id: 1, label: "second", startsWith: "where does that leave us" },
		]);

		expect(transcript.endsWith(blocks[1]?.content ?? "")).toBe(true);
		expect(blocks[1]?.content.startsWith("where")).toBe(false);
	});

	test("should leave the cut where it is when the quote already starts at the connective", () => {
		const transcript = "A first step that ends here. So where does that leave us?";

		const { blocks } = applyCuts(transcript, [
			OPENING,
			{ id: 1, label: "second", startsWith: "So where does that leave us" },
		]);

		expect(blocks[1]?.content).toBe("So where does that leave us?");
	});

	test("should leave the cut where it is when the words before it are not a connective", () => {
		const transcript = "The adenoma has progressed into an adenocarcinoma. One grows out of the other.";

		const { blocks } = applyCuts(transcript, [
			OPENING,
			{ id: 1, label: "second", startsWith: "One grows out of the other" },
		]);

		expect(blocks[1]?.content).toBe("One grows out of the other.");
	});

	test("should not move a cut back past a sentence that merely ends in a connective word", () => {
		const transcript = "They can obstruct the organ, and so can the others. Nomenclature is next.";

		const { blocks } = applyCuts(transcript, [
			OPENING,
			{ id: 1, label: "second", startsWith: "Nomenclature is next" },
		]);

		expect(blocks[1]?.content).toBe("Nomenclature is next.");
	});

	test("should still reproduce the transcript exactly when a cut has been moved back", () => {
		const transcript = "A first step that ends here. So where does that leave us?";

		const { blocks } = applyCuts(transcript, [
			OPENING,
			{ id: 1, label: "second", startsWith: "where does that leave us" },
		]);

		expect(judgeFidelity(transcript, blocks)).toBe("EXACT");
	});

	test("should report the quote as a miss when it does not appear in the transcript", () => {
		const transcript = "A first step that ends here. So where does that leave us?";

		const { blocks, misses } = applyCuts(transcript, [
			OPENING,
			{ id: 1, label: "second", startsWith: "a phrase the lecturer never said" },
		]);

		expect(misses).toHaveLength(1);
		expect(blocks).toHaveLength(1);
	});
});
