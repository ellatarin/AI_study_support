import { describe, expect, it } from "vitest";
import { slideDeckReadings, slidePlacementsIn } from "../../fixtures.js";
import { isSlideReading } from "../slides.js";
import { SLIDE_RELOCATION_PROMPT_VERSION } from "./relocate-slides.prompt.js";
import {
	type FigureNumbers,
	figureNumbersOf,
	type MarkSlides,
	type SlideRelocationReply,
	shownSlidesBySubtopic,
	usableSlidePoints,
	writeSlideRelocation,
} from "./slide-relocation.js";

const paragraphs = [
	"Cancer is a disease of cells. Cells divide without control.",
	"Tobacco smoke causes most lung cancers. [FIGURE 1] Snuff causes mouth cancer. [FIGURE 2]",
];

const readings = slideDeckReadings.filter(isSlideReading);

const slide2Answer = { slide: 2, startWords: "Cells divide without control" };

const slide3Answer = { slide: 3, startWords: "Snuff causes mouth cancer" };

/** The answers of a usable reply for slides 2 and 3, each at the start of a sentence. */
const slideAnswers: SlideRelocationReply["slides"] = [slide2Answer, slide3Answer];

/** The answers of a reply in which each figure mark of {@link paragraphs} points at no slide. */
const noMarkSlides: SlideRelocationReply["figureMarks"] = [
	{ mark: 1, slide: null },
	{ mark: 2, slide: null },
];

const slide2Point = { slideNumber: 2, paragraphIndex: 0, characterOffset: 30 };

const slide3Point = { slideNumber: 3, paragraphIndex: 1, characterOffset: 51 };

/**
 * Checks a reply for slides 2 and 3 against {@link paragraphs}.
 *
 * @param reply - The reply.
 * @returns What {@link usableSlidePoints} gives.
 */
function pointsOf(reply: SlideRelocationReply): ReturnType<typeof usableSlidePoints> {
	return usableSlidePoints({ paragraphs, slideNumbers: [2, 3], reply });
}

describe("usableSlidePoints", () => {
	it("should give each slide the paragraph index and character offset of its start words when the reply is usable", () => {
		const result = pointsOf({ slides: slideAnswers, figureMarks: noMarkSlides });

		expect(result).toEqual({
			reply: { points: [slide2Point, slide3Point], markSlides: [null, null] },
		});
	});

	it("should put a slide at its figure mark when exactly one mark points at the slide", () => {
		const result = pointsOf({
			slides: slideAnswers,
			figureMarks: [
				{ mark: 1, slide: 3 },
				{ mark: 2, slide: null },
			],
		});

		expect(result).toEqual({
			reply: {
				points: [slide2Point, { slideNumber: 3, paragraphIndex: 1, characterOffset: 40 }],
				markSlides: [3, null],
			},
		});
	});

	it("should keep a slide at its start words when two marks point at the slide", () => {
		const result = pointsOf({
			slides: slideAnswers,
			figureMarks: [
				{ mark: 1, slide: 3 },
				{ mark: 2, slide: 3 },
			],
		});

		expect(result).toEqual({
			reply: { points: [slide2Point, slide3Point], markSlides: [3, 3] },
		});
	});

	const unknownSlideFailure =
		"The model's reply names slide 9, which is not a slide of the subtopic";

	it.each([
		{
			problem: "the start words are not in the text",
			slides: [slide2Answer, { slide: 3, startWords: "Snuff is harmless" }],
			figureMarks: noMarkSlides,
			failure: `The model's start words "Snuff is harmless" for slide 3 are not in the subtopic`,
		},
		{
			problem: "a slide has no point",
			slides: [slide2Answer],
			figureMarks: noMarkSlides,
			failure: "The model's reply gives slide 3 0 points, not one",
		},
		{
			problem: "a slide has two points",
			slides: [...slideAnswers, slide3Answer],
			figureMarks: noMarkSlides,
			failure: "The model's reply gives slide 3 2 points, not one",
		},
		{
			problem: "the reply names an unknown slide",
			slides: [...slideAnswers, { slide: 9, startWords: "Cancer is a disease" }],
			figureMarks: noMarkSlides,
			failure: unknownSlideFailure,
		},
		{
			problem: "a figure mark names an unknown slide",
			slides: slideAnswers,
			figureMarks: [
				{ mark: 1, slide: 9 },
				{ mark: 2, slide: null },
			],
			failure: unknownSlideFailure,
		},
		{
			problem: "a figure mark has no answer",
			slides: slideAnswers,
			figureMarks: [{ mark: 1, slide: null }],
			failure: "The model's reply gives no slide or null for figure mark 2",
		},
		{
			problem: "a slide is earlier than the slide before it in deck order",
			slides: [
				{ slide: 2, startWords: "Snuff causes mouth cancer" },
				{ slide: 3, startWords: "Cells divide" },
			],
			figureMarks: noMarkSlides,
			failure: "The model's reply puts slide 3 earlier in the subtopic than the slide before it",
		},
	])("should find the reply unusable when $problem", ({ slides, figureMarks, failure }) => {
		const result = pointsOf({ slides, figureMarks });

		expect(result).toEqual({ failure });
	});
});

describe("figureNumbersOf", () => {
	it("should number the subject-matter slides from 1 in deck order, and give no number to the references slide, when the readings come in another order", () => {
		const numbers = figureNumbersOf([...readings].reverse());

		expect(numbers).toStrictEqual({ 1: 1, 2: 2 });
	});
});

describe("shownSlidesBySubtopic", () => {
	const noSlides = { slidesForModel: [], slidesAtStart: [], slidesAtEnd: [] };

	it.each([
		{
			subtopicsWithParagraphs: [true, false],
			subtopicIds: { 1: 2, 2: 2, 4: 2 },
			expected: [{ ...noSlides, slidesAtEnd: [1, 2, 4] }, noSlides],
		},
		{
			subtopicsWithParagraphs: [true, false, true],
			subtopicIds: { 1: 1, 2: 2, 4: 3 },
			expected: [
				{ ...noSlides, slidesForModel: [readings[0]], slidesAtEnd: [2] },
				noSlides,
				{ ...noSlides, slidesAtEnd: [4] },
			],
		},
		{
			subtopicsWithParagraphs: [false, true],
			subtopicIds: { 1: 1, 2: 2, 4: 2 },
			expected: [noSlides, { slidesForModel: [readings[1]], slidesAtStart: [1], slidesAtEnd: [4] }],
		},
	])("should show each slide of a subtopic with no paragraph in the nearest subtopic with a paragraph when the subtopics with a paragraph are $subtopicsWithParagraphs", ({
		subtopicsWithParagraphs,
		subtopicIds,
		expected,
	}) => {
		const shown = shownSlidesBySubtopic({
			subtopics: subtopicsWithParagraphs.map((hasParagraphs, index) => ({
				subtopicId: index + 1,
				paragraphs: hasParagraphs ? paragraphs : [],
			})),
			placements: slidePlacementsIn(subtopicIds),
			readings,
		});

		expect(shown).toEqual(new Map(expected.map((slides, index) => [index + 1, slides])));
	});
});

describe("writeSlideRelocation", () => {
	/**
	 * Writes the file of subtopic 4 from {@link paragraphs}, with slides 2 and 3 at their start words.
	 *
	 * @param args - What the reply and the lecture give.
	 * @param args.markSlides - The slide of each figure mark.
	 * @param args.slidesAtStart - The slides at the start of the first paragraph.
	 * @param args.slidesAtEnd - The slides at the end of the last paragraph.
	 * @param args.figureNumbers - The figure number of each slide, by slide number.
	 * @returns The file of the subtopic.
	 */
	function write({
		markSlides,
		slidesAtStart = [],
		slidesAtEnd = [],
		figureNumbers = { 2: 11, 3: 12 },
	}: {
		readonly markSlides: MarkSlides;
		readonly slidesAtStart?: readonly number[];
		readonly slidesAtEnd?: readonly number[];
		readonly figureNumbers?: FigureNumbers;
	}): ReturnType<typeof writeSlideRelocation> {
		return writeSlideRelocation({
			subtopicId: 4,
			paragraphs,
			points: [slide2Point, slide3Point],
			markSlides,
			figureNumbers,
			slidesAtStart,
			slidesAtEnd,
		});
	}

	it("should write the figure number in place of each mark that points at a slide, and move each later offset in that paragraph, when the number changes the length", () => {
		const relocation = write({ markSlides: [3, 3] });

		expect(relocation).toEqual({
			subtopicId: 4,
			slideRelocationPromptVersion: SLIDE_RELOCATION_PROMPT_VERSION,
			paragraphs: [
				paragraphs[0],
				"Tobacco smoke causes most lung cancers. (Figure 12) Snuff causes mouth cancer. (Figure 12)",
			],
			slides: [
				{ ...slide2Point, figureNumber: 11 },
				{ ...slide3Point, characterOffset: 52, figureNumber: 12 },
			],
			figureMarksWithNoSlide: [],
		});
	});

	it("should keep [FIGURE] and record its paragraph index and character offset when a mark points at no slide", () => {
		const relocation = write({ markSlides: [null, null] });

		expect(relocation).toMatchObject({
			paragraphs: [
				paragraphs[0],
				"Tobacco smoke causes most lung cancers. [FIGURE] Snuff causes mouth cancer. [FIGURE]",
			],
			slides: [
				{ ...slide2Point, figureNumber: 11 },
				{ ...slide3Point, characterOffset: 49, figureNumber: 12 },
			],
			figureMarksWithNoSlide: [
				{ paragraphIndex: 1, characterOffset: 40 },
				{ paragraphIndex: 1, characterOffset: 76 },
			],
		});
	});

	it("should give a slide figureNumber null when the slide has no figure number", () => {
		const relocation = write({ markSlides: [null, null], figureNumbers: { 3: 12 } });

		expect(relocation.slides[0]).toEqual({ ...slide2Point, figureNumber: null });
	});

	const atEndOfLastParagraph = { paragraphIndex: 1, characterOffset: 90 };

	it.each([
		{
			slide: "the references slide",
			edges: { slidesAtEnd: [20] },
			expected: { slideNumber: 20, ...atEndOfLastParagraph, figureNumber: null },
			position: -1,
		},
		{
			slide: "a slide of a later subtopic with no paragraph",
			edges: { slidesAtEnd: [5] },
			expected: { slideNumber: 5, ...atEndOfLastParagraph, figureNumber: 13 },
			position: -1,
		},
		{
			slide: "a slide of an earlier subtopic with no paragraph",
			edges: { slidesAtStart: [1] },
			expected: { slideNumber: 1, paragraphIndex: 0, characterOffset: 0, figureNumber: 10 },
			position: 0,
		},
	])("should put the slide at the start of the first paragraph or the end of the last paragraph, with its figure number, when it is $slide", ({
		edges,
		expected,
		position,
	}) => {
		const relocation = write({
			markSlides: [3, 3],
			figureNumbers: { 1: 10, 2: 11, 3: 12, 5: 13 },
			...edges,
		});

		expect(relocation.slides).toHaveLength(3);
		expect(relocation.slides.at(position)).toEqual(expected);
	});
});
