import { describe, expect, it } from "vitest";
import { joinedSubtopics } from "../fixtures.js";
import {
	assertLossless,
	DivisionNotLosslessError,
	isReplySubtopic,
	placeCuts,
	readDivision,
	replyTitleAndReason,
	type Subtopic,
	sliceSubtopics,
} from "./division.js";

// A short transcript with each case the cutting has to handle: plain start words,
// start words after a dropped "So" and a dropped "Right so", a connective that does
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
	it("should start the first subtopic at the start of the text when its start words name somewhere else", () => {
		expect(placeCuts({ text: TEXT, startWords: ["anything at all"] })).toEqual({ cuts: [0] });
	});

	it("should cut at the start words when they match the text exactly", () => {
		expect(placeCuts({ text: TEXT, startWords: ["Welcome", "Today we cover cells"] })).toEqual({
			cuts: [0, at("Today")],
		});
	});

	it("should find start words when their case and spacing differ from the text", () => {
		expect(placeCuts({ text: TEXT, startWords: ["Welcome", "today   WE cover\ncells"] })).toEqual({
			cuts: [0, at("Today")],
		});
	});

	it.each([
		{ dropped: "So", words: "the first thing is the membrane", sentenceStart: "So the first" },
		{ dropped: "Right so", words: "we move on to transport", sentenceStart: "Right so we" },
	])("should move the cut back to the sentence start when the start words drop a leading $dropped", ({
		words,
		sentenceStart,
	}) => {
		expect(placeCuts({ text: TEXT, startWords: ["Welcome", words] })).toEqual({
			cuts: [0, at(sentenceStart)],
		});
	});

	it("should leave the cut where it is when the word before it does not open its sentence", () => {
		expect(placeCuts({ text: TEXT, startWords: ["Welcome", "proteins sit in it"] })).toEqual({
			cuts: [0, at("proteins sit")],
		});
	});

	it("should search forward from the previous cut when the start words also appear earlier", () => {
		const secondMention = TEXT.indexOf("the membrane", at("the membrane") + 1);
		expect(
			placeCuts({ text: TEXT, startWords: ["Welcome", "Right so we move on", "the membrane"] }),
		).toEqual({ cuts: [0, at("Right so"), secondMention] });
	});

	it("should report the start words rather than guess when they are not in the text", () => {
		expect(
			placeCuts({ text: TEXT, startWords: ["Welcome", "mitochondria are the powerhouse"] }),
		).toEqual({
			unplaced: "mitochondria are the powerhouse",
		});
	});
});

describe("sliceSubtopics", () => {
	const titled = [
		{ title: "Opening", reason: "Framing." },
		{ title: "The membrane", reason: "One structure." },
	];

	it("should reproduce the text exactly when the subtopics are joined", () => {
		const subtopics = sliceSubtopics({ text: TEXT, cuts: [0, at("So the first")], titled });
		expect(joinedSubtopics({ text: TEXT, subtopics })).toBe(TEXT);
	});

	it("should give each subtopic its span, title and reason when the text is cut", () => {
		expect(sliceSubtopics({ text: TEXT, cuts: [0, at("So the first")], titled })).toStrictEqual([
			{ start: 0, end: at("So the first"), title: "Opening", reason: "Framing." },
			{
				start: at("So the first"),
				end: TEXT.length,
				title: "The membrane",
				reason: "One structure.",
			},
		]);
	});
});

describe("assertLossless", () => {
	/** A first subtopic ending at character 10, which the second must start from. */
	const FIRST: Subtopic = { start: 0, end: 10, title: "a", reason: "" };

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

describe("readDivision", () => {
	const { title, reason, ...span } = { start: 0, end: 5, title: "a", reason: "b" };
	const subtopic = { ...span, title, reason };

	it.each([
		{ held: "a list of subtopics", value: [subtopic], division: [subtopic] },
		{ held: "not a list", value: { start: 0 }, division: null },
		{ held: "a subtopic without its reason", value: [{ ...span, title }], division: null },
		{ held: "a subtopic without its span", value: [{ title, reason }], division: null },
		{
			held: "a subtopic named by a label, as saved before titles",
			value: [{ ...span, label: title, reason }],
			division: null,
		},
	])("should read a saved value as a division only when it holds $held", ({ value, division }) => {
		expect(readDivision(value)).toStrictEqual(division);
	});

	// Deepening once marked every subtopic whose title was inherited. Nothing
	// reads the mark now, and runs saved with it are still read rather than remade.
	it("should read a saved run as a division without its mark when the run carries one", () => {
		expect(readDivision([{ ...subtopic, titleInherited: true }])).toStrictEqual([subtopic]);
	});
});

describe("isReplySubtopic", () => {
	it.each([
		{
			held: "a label, a reason and start words",
			value: { label: "a", groupedBecause: "b", startsWith: "c" },
			is: true,
		},
		{ held: "no start words", value: { label: "a", groupedBecause: "b" }, is: false },
		{ held: "a string", value: "a", is: false },
	])("should recognise a reply entry as a subtopic only when it holds $held", ({ value, is }) => {
		expect(isReplySubtopic(value)).toBe(is);
	});
});

describe("replyTitleAndReason", () => {
	it("should take the reply's label as the title and its groupedBecause as the reason when a reply subtopic is read", () => {
		expect(
			replyTitleAndReason({ label: "Opening", groupedBecause: "Framing.", startsWith: "Welcome" }),
		).toEqual({
			title: "Opening",
			reason: "Framing.",
		});
	});
});
