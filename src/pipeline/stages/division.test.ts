import { describe, expect, it } from "vitest";
import { joinedSubtopics } from "../fixtures.js";
import {
	assertLossless,
	DivisionNotLosslessError,
	isDivision,
	isReplySubtopic,
	placeCuts,
	replyNaming,
	type Subtopic,
	sliceSubtopics,
} from "./division.js";

// A short transcript with each case the cutting has to handle: a plain opening,
// openings after a dropped "So" and a dropped "Right so", a connective that does
// not open its sentence, and a phrase ("the membrane") said twice.
const TEXT =
	"Welcome to the lecture. Today we cover cells. " +
	"So the first thing is the membrane. It is made of lipids and proteins sit in it. " +
	"Right so we move on to transport across the membrane. That is all for today.";

/** Where `phrase` begins in TEXT, found independently of the code under test. */
function at(phrase: string): number {
	return TEXT.indexOf(phrase);
}

describe("placeCuts", () => {
	it("should start the first subtopic at the start of the text when its quote names somewhere else", () => {
		expect(placeCuts({ text: TEXT, quotes: ["anything at all"] })).toEqual({ cuts: [0] });
	});

	it("should cut at the quote when it matches the text exactly", () => {
		expect(placeCuts({ text: TEXT, quotes: ["Welcome", "Today we cover cells"] })).toEqual({
			cuts: [0, at("Today")],
		});
	});

	it("should find a quote when its case and spacing differ from the text", () => {
		expect(placeCuts({ text: TEXT, quotes: ["Welcome", "today   WE cover\ncells"] })).toEqual({
			cuts: [0, at("Today")],
		});
	});

	it.each([
		{ dropped: "So", quote: "the first thing is the membrane", opening: "So the first" },
		{ dropped: "Right so", quote: "we move on to transport", opening: "Right so we" },
	])("should move the cut back to the sentence start when the quote drops a leading $dropped", ({
		quote,
		opening,
	}) => {
		expect(placeCuts({ text: TEXT, quotes: ["Welcome", quote] })).toEqual({
			cuts: [0, at(opening)],
		});
	});

	it("should leave the cut where it is when the word before it does not open its sentence", () => {
		expect(placeCuts({ text: TEXT, quotes: ["Welcome", "proteins sit in it"] })).toEqual({
			cuts: [0, at("proteins sit")],
		});
	});

	it("should search forward from the previous cut when the quote also appears earlier", () => {
		const secondMention = TEXT.indexOf("the membrane", at("the membrane") + 1);
		expect(
			placeCuts({ text: TEXT, quotes: ["Welcome", "Right so we move on", "the membrane"] }),
		).toEqual({ cuts: [0, at("Right so"), secondMention] });
	});

	it("should report the quote rather than guess when it is not in the text", () => {
		expect(
			placeCuts({ text: TEXT, quotes: ["Welcome", "mitochondria are the powerhouse"] }),
		).toEqual({
			unplaced: "mitochondria are the powerhouse",
		});
	});
});

describe("sliceSubtopics", () => {
	const named = [
		{ title: "Opening", why: "Framing." },
		{ title: "The membrane", why: "One structure." },
	];

	it("should reproduce the text exactly when the subtopics are joined", () => {
		const subtopics = sliceSubtopics({ text: TEXT, cuts: [0, at("So the first")], named });
		expect(joinedSubtopics({ text: TEXT, subtopics })).toBe(TEXT);
	});

	it("should give each subtopic its span, title and reason, unmarked, when the text is cut", () => {
		expect(sliceSubtopics({ text: TEXT, cuts: [0, at("So the first")], named })).toEqual([
			{
				start: 0,
				end: at("So the first"),
				title: "Opening",
				why: "Framing.",
				titleInherited: false,
			},
			{
				start: at("So the first"),
				end: TEXT.length,
				title: "The membrane",
				why: "One structure.",
				titleInherited: false,
			},
		]);
	});
});

describe("assertLossless", () => {
	/** A first subtopic ending at character 10, which the second must start from. */
	const FIRST: Subtopic = { start: 0, end: 10, title: "a", why: "", titleInherited: false };

	it.each([
		{ fault: "no gap", second: { start: 10, end: TEXT.length }, lossless: true },
		{ fault: "a gap", second: { start: 11, end: TEXT.length }, lossless: false },
		{ fault: "an overlap", second: { start: 9, end: TEXT.length }, lossless: false },
		{ fault: "a short ending", second: { start: 10, end: TEXT.length - 1 }, lossless: false },
	])("should accept the division only when its subtopics leave $fault", ({ second, lossless }) => {
		const subtopics: readonly Subtopic[] = [FIRST, { ...FIRST, ...second, title: "b" }];
		const check = (): void => assertLossless({ text: TEXT, subtopics });
		if (lossless) {
			expect(check).not.toThrow();
		} else {
			expect(check).toThrow(DivisionNotLosslessError);
		}
	});
});

describe("isDivision", () => {
	const { title, why, titleInherited, ...span } = {
		start: 0,
		end: 5,
		title: "a",
		why: "b",
		titleInherited: false,
	};
	it.each([
		{ held: "a list of subtopics", value: [{ ...span, title, why, titleInherited }], is: true },
		{ held: "not a list", value: { start: 0 }, is: false },
		{
			held: "a subtopic without its reason",
			value: [{ ...span, title, titleInherited }],
			is: false,
		},
		{ held: "a subtopic without its span", value: [{ title, why, titleInherited }], is: false },
		{ held: "a subtopic without its mark", value: [{ ...span, title, why }], is: false },
		{
			held: "a subtopic named by a label, as saved before titles",
			value: [{ ...span, label: title, why, titleInherited }],
			is: false,
		},
	])("should recognise a saved value as a division only when it holds $held", ({ value, is }) => {
		expect(isDivision(value)).toBe(is);
	});
});

describe("isReplySubtopic", () => {
	it.each([
		{
			held: "a label, a reason and opening words",
			value: { label: "a", groupedBecause: "b", startsWith: "c" },
			is: true,
		},
		{ held: "no opening words", value: { label: "a", groupedBecause: "b" }, is: false },
		{ held: "a string", value: "a", is: false },
	])("should recognise a reply entry as a subtopic only when it holds $held", ({ value, is }) => {
		expect(isReplySubtopic(value)).toBe(is);
	});
});

describe("replyNaming", () => {
	it("should take the reply's label as the title and its groupedBecause as the reason when a reply subtopic is read", () => {
		expect(
			replyNaming({ label: "Opening", groupedBecause: "Framing.", startsWith: "Welcome" }),
		).toEqual({
			title: "Opening",
			why: "Framing.",
		});
	});
});
