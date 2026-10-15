import { describe, expect, it } from "vitest";
import { PAGE_VIEW_IDS } from "../../../types/pipeline.js";
import {
	exampleConfig,
	rewrittenParagraphs,
	slideDeckReadings,
	testLecture,
} from "../../fixtures.js";
import type { RelocatedSlide } from "../slide-relocations.js";
import type { SlideReading } from "../slides.js";
import type { TopicWithSubtopics } from "../structured-transcript.js";
import type { NotesPageContent } from "./notes-page-html.js";
import { type NotesPdfContent, notesPdfHtml } from "./notes-pdf-html.js";

const topics: readonly TopicWithSubtopics[] = [
	{
		title: "Introduction",
		subtopics: [{ subtopicId: 1, title: "Opening", text: rewrittenParagraphs[0] }],
	},
	{
		title: "Cell injury",
		subtopics: [{ subtopicId: 2, title: "Reversible injury", text: rewrittenParagraphs[1] }],
	},
];

const firstSentence = "Cells meet many kinds of stress.";

const secondSentence = "Some injury is reversible.";

/** The notes paragraphs of subtopic 2. The first paragraph has two sentences, for a slide at the second. */
const subtopicTwoParagraphs = [
	`${firstSentence} ${secondSentence}`,
	"A second paragraph follows.",
] as const;

const sentenceTwoOffset = subtopicTwoParagraphs[0].indexOf(secondSentence);

const content: NotesPdfContent = {
	lectureTitle: testLecture.title,
	lectureDate: testLecture.date,
	topics,
	slideRelocations: [
		{ subtopicId: 1, paragraphs: [rewrittenParagraphs[0]], slides: [] },
		{ subtopicId: 2, paragraphs: subtopicTwoParagraphs, slides: [] },
	],
	slideReadings: slideDeckReadings as readonly SlideReading[],
};

/**
 * Gives the content with one paragraph as the notes text of subtopic 1.
 *
 * @param paragraph - The paragraph.
 * @returns The content.
 */
function withSubtopicOneParagraph(paragraph: string): NotesPdfContent {
	return {
		...content,
		slideRelocations: content.slideRelocations.map((entry) =>
			entry.subtopicId === 1 ? { ...entry, paragraphs: [paragraph] } : entry,
		),
	};
}

/**
 * Gives a slide at a point in the first paragraph of subtopic 2.
 *
 * @param args - The slide, its point and its figure number.
 * @param args.slideNumber - The number of the slide in the deck.
 * @param args.offset - The point of the slide, in characters.
 * @param args.figureNumber - The figure number, or `null` for the references slide.
 * @returns The slide.
 */
function slideAt({
	slideNumber,
	offset,
	figureNumber,
}: {
	readonly slideNumber: number;
	readonly offset: number;
	readonly figureNumber: number | null;
}): RelocatedSlide {
	return {
		slideNumber,
		paragraphIndex: 0,
		characterOffset: offset,
		figureNumber,
	} as RelocatedSlide;
}

/**
 * Gives the content with slides in subtopic 2.
 *
 * @param slides - The slides, in deck order.
 * @returns The content.
 */
function withSlides(slides: readonly RelocatedSlide[]): NotesPdfContent {
	return {
		...content,
		slideRelocations: content.slideRelocations.map((entry) =>
			entry.subtopicId === 2 ? { ...entry, slides } : entry,
		),
	};
}

/**
 * Gives a stand-in for the data of a slide image, which names the slide.
 *
 * @param slideNumber - The number of the slide in the deck.
 * @returns The stand-in.
 */
const stubSlideImageUrl = (slideNumber: number): string => `stub-slide-${slideNumber}.png`;

/**
 * Builds the PDF HTML of some content with the settings of the example config.
 *
 * @param pdfContent - The content of the PDF.
 * @returns The HTML.
 */
function buildPdfHtml(pdfContent: NotesPdfContent = content): string {
	return notesPdfHtml({
		content: pdfContent,
		settings: exampleConfig.finalOutput.pdf,
		slideImageUrl: stubSlideImageUrl,
	});
}

/**
 * Gives the text of the body of the HTML as a reader sees it: no tags, and one
 * space between words.
 *
 * @param html - The HTML.
 * @returns The text.
 */
function bodyText(html: string): string {
	const body = /<body>(?<body>[\s\S]*)<\/body>/u.exec(html)?.groups?.body ?? "";
	return body
		.replace(/<[^>]*>/gu, " ")
		.replace(/\s+/gu, " ")
		.trim();
}

/**
 * Gives the inner HTML of each paragraph of the notes text, in order. The header
 * paragraph of the date has a class, so it is not one of them.
 *
 * @param html - The HTML.
 * @returns The inner HTML of each paragraph.
 */
function textParagraphs(html: string): readonly string[] {
	return [...html.matchAll(/<p>(?<inner>[\s\S]*?)<\/p>/gu)].map(
		({ groups }) => groups?.inner ?? "",
	);
}

/**
 * Gives each block of the text of subtopic 2, in order: the text of a paragraph
 * block, or "slide N" for the figure of slide N.
 *
 * @param html - The HTML.
 * @returns The blocks.
 */
function subtopicTwoBlocks(html: string): readonly string[] {
	const subtopic = html.slice(html.lastIndexOf('<section class="subtopic">'));
	return [
		...subtopic.matchAll(
			/<p>(?<text>[\s\S]*?)<\/p>|<figure[\s\S]*?src="stub-slide-(?<slideNumber>\d+)\.png"[\s\S]*?<\/figure>/gu,
		),
	].map(({ groups }) =>
		groups?.slideNumber === undefined ? (groups?.text ?? "").trim() : `slide ${groups.slideNumber}`,
	);
}

describe("notesPdfHtml", () => {
	it("should show the lecture date and then the lecture title when the PDF HTML is built", () => {
		const html = buildPdfHtml();

		expect(bodyText(html).startsWith(`${testLecture.date} ${testLecture.title}`)).toBe(true);
	});

	it("should show each topic title and each subtopic title in lecture order when the lecture has two topics", () => {
		const html = buildPdfHtml();

		const titles = [...html.matchAll(/<h[23]>(?<title>[^<]*)<\/h[23]>/gu)].map(
			({ groups }) => groups?.title,
		);
		expect(titles).toStrictEqual(["Introduction", "Opening", "Cell injury", "Reversible injury"]);
	});

	it("should show each paragraph of each subtopic as its own paragraph when the subtopics have notes text", () => {
		const html = buildPdfHtml();

		expect(textParagraphs(html)).toStrictEqual([rewrittenParagraphs[0], ...subtopicTwoParagraphs]);
	});

	it("should show maths as MathML and a lone Greek letter as a plain letter when the text holds LaTeX", () => {
		const html = buildPdfHtml(
			withSubtopicOneParagraph(String.raw`The area is $x^2$ and $\beta$-catenin binds.`),
		);

		const [paragraph] = textParagraphs(html);
		expect(paragraph).toContain("<math");
		expect(paragraph).toContain('<span class="nowrap">β-catenin</span>');
		expect(paragraph).not.toContain("$");
	});

	it.each([
		{ part: "view switch", markup: "<input" },
		{ part: "list of topic links", markup: "<nav" },
		{ part: "other page views", markup: '-view"' },
		{ part: "sentence highlight", markup: "<mark" },
	])("should leave out the $part when the content lists four page views and the highlight is on", ({
		markup,
	}) => {
		const pageContent: NotesPdfContent &
			Pick<NotesPageContent, "pageViews" | "highlightSlideSentences"> = {
			...withSlides([slideAt({ slideNumber: 2, offset: sentenceTwoOffset, figureNumber: 1 })]),
			pageViews: PAGE_VIEW_IDS,
			highlightSlideSentences: true,
		};

		const html = buildPdfHtml(pageContent);

		expect(html).not.toContain(markup);
	});

	it("should stop the paragraph at the slide's point and continue it under the slide when a slide is at the start of a sentence", () => {
		const html = buildPdfHtml(
			withSlides([slideAt({ slideNumber: 2, offset: sentenceTwoOffset, figureNumber: 1 })]),
		);

		expect(subtopicTwoBlocks(html)).toStrictEqual([
			firstSentence,
			"slide 2",
			secondSentence,
			subtopicTwoParagraphs[1],
		]);
	});

	it("should put the slide after the paragraph's text when the slide's point is at the end of the paragraph", () => {
		const html = buildPdfHtml(
			withSlides([
				slideAt({ slideNumber: 4, offset: subtopicTwoParagraphs[0].length, figureNumber: null }),
			]),
		);

		expect(subtopicTwoBlocks(html)).toStrictEqual([
			subtopicTwoParagraphs[0],
			"slide 4",
			subtopicTwoParagraphs[1],
		]);
	});

	it.each([
		{
			slide: "a slide with a figure number",
			figure: slideAt({ slideNumber: 2, offset: sentenceTwoOffset, figureNumber: 1 }),
			label: "Figure 1.",
		},
		{
			slide: "the references slide",
			figure: slideAt({
				slideNumber: 4,
				offset: subtopicTwoParagraphs[0].length,
				figureNumber: null,
			}),
			label: "References.",
		},
	])("should show the slide image, then the label and the caption under it, when the slide is $slide", ({
		figure,
		label,
	}) => {
		const html = buildPdfHtml(withSlides([figure]));

		const inner = /<figure[^>]*>(?<inner>[\s\S]*?)<\/figure>/u.exec(html)?.groups?.inner ?? "";
		const caption = /<figcaption[^>]*>(?<caption>[\s\S]*?)<\/figcaption>/u.exec(inner)?.groups
			?.caption;
		expect(inner.indexOf("<img")).toBeLessThan(inner.indexOf("<figcaption"));
		expect(caption?.replace(/<[^>]*>/gu, "")).toBe(
			`${label} ${(slideDeckReadings[figure.slideNumber - 1] as SlideReading).caption}`,
		);
	});
});
