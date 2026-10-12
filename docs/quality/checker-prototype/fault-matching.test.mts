import { describe, expect, it } from "vitest";
import { matchesKeyFault } from "./fault-matching.mts";

const keyFault = {
	subtopicId: 7,
	sourcePassage: "You can see that the tumor is here. This is the outer surface of the uterus.",
	rewritePassage: "The tumour lies next to the outer surface of the uterus",
};

describe("matchesKeyFault", () => {
	it.each([
		{
			condition: "the rewrite passages share four words in a row",
			fault: {
				subtopicId: 7,
				sourcePassage: null,
				rewritePassage: "The tumour lies next to the outer surface, which is thin.",
			},
			matches: true,
		},
		{
			condition: "a source passage holds the other, with other case and punctuation",
			fault: {
				subtopicId: 7,
				sourcePassage: "this is the OUTER surface of the uterus",
				rewritePassage: null,
			},
			matches: true,
		},
		{
			condition: "the passages share fewer than four words in a row",
			fault: { subtopicId: 7, sourcePassage: "the tumor is benign", rewritePassage: null },
			matches: false,
		},
		{
			condition: "the faults are in different subtopics",
			fault: { ...keyFault, subtopicId: 8 },
			matches: false,
		},
	])("should give $matches when $condition", ({ fault, matches }) => {
		expect(matchesKeyFault({ fault, keyFault })).toBe(matches);
	});
});
