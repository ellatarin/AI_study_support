import { describe, expect, it } from "vitest";
import { PAGE_VIEW_IDS } from "../../../types/pipeline.js";
import {
	pageViewsIn,
	rewrittenParagraphs,
	seededFactualError,
	slideDeckReadings,
	testLecture,
} from "../../fixtures.js";
import { notesSlideImageEntry } from "../../layout.js";
import { figureLabel } from "../slide-relocations.js";
import type { SlideReading } from "../slides.js";
import type { TopicWithSubtopics } from "../structured-transcript.js";
import { type NotesPageContent, notesPageHtml } from "./notes-page-html.js";

type SubtopicOnPage = NotesPageContent["slideRelocations"][number];

/** Slides 1 and 2 are subject-matter slides, and slide 4 is the references slide. */
const [slideOneReading, slideTwoReading, , referencesReading] =
	slideDeckReadings as readonly SlideReading[];

const openingSubtopicTitle = "Opening";

const openingParagraph = rewrittenParagraphs[0];

/** The sentence before the sentence of slide 2. */
const sentenceBeforeSlideTwo = "Cells meet many kinds of stress.";

/** The second sentence of the first paragraph of subtopic 2: the sentence of slide 2. */
const slideTwoSentence = "Some injury is reversible.";

/** The paragraphs of subtopic 2. Slide 2 is placed at the second sentence. */
const subtopicTwoParagraphs = [
	`${sentenceBeforeSlideTwo} ${slideTwoSentence} The cell then recovers.`,
	"Other injury kills the cell. The [FIGURE] mark here points at no slide.",
] as const;

/** The spoken words of subtopic 2 that are not in its notes. */
const unwrittenWords = "Right, so";

/** The spoken text of subtopic 2. Term correction changed none of its words. */
const spokenSubtopicTwo = `${unwrittenWords} ${subtopicTwoParagraphs[0]}`;

/** Two topics, each title used once, so a test can find each title by its words. */
const topics: readonly TopicWithSubtopics[] = [
	{
		title: "Introduction",
		subtopics: [{ subtopicId: 1, title: openingSubtopicTitle, text: openingParagraph }],
	},
	{
		title: "Cell injury",
		subtopics: [{ subtopicId: 2, title: "Reversible and lethal injury", text: spokenSubtopicTwo }],
	},
];

const slideRelocations: readonly SubtopicOnPage[] = [
	{ subtopicId: 1, paragraphs: [openingParagraph], slides: [] },
	{
		subtopicId: 2,
		paragraphs: subtopicTwoParagraphs,
		slides: [
			{
				slideNumber: 2,
				paragraphIndex: 0,
				characterOffset: subtopicTwoParagraphs[0].indexOf(slideTwoSentence),
				figureNumber: 1,
			},
		],
	},
];

const slideReadings: readonly SlideReading[] = [slideTwoReading as SlideReading];

/** The sentence of slide 2 in the rewrite. The fact correction changed it to {@link slideTwoSentence}. */
const rewriteSlideTwoSentence = "Some injury can be reversed.";

const subtopicRewrites: NotesPageContent["subtopicRewrites"] = [
	{ subtopicId: 1, rewrittenSubtopic: [openingParagraph] },
	{
		subtopicId: 2,
		rewrittenSubtopic: [
			`${sentenceBeforeSlideTwo} ${rewriteSlideTwoSentence} The cell then recovers.`,
			subtopicTwoParagraphs[1],
		],
	},
];

const termCorrections: NotesPageContent["termCorrections"] = [
	{ subtopicId: 1, correctedText: openingParagraph },
	{ subtopicId: 2, correctedText: spokenSubtopicTwo },
];

/** The change of the fact correction in subtopic 2, which the model reported for the seeded factual error. */
const reportedChange = {
	factualError: 1,
	before: rewriteSlideTwoSentence,
	after: slideTwoSentence,
	note: "",
};

/** Slide 2 is placed at the spoken words of its sentence. */
const slidePlacements: NotesPageContent["slidePlacements"] = [
	{
		slideNumber: 2,
		subtopicId: 2,
		positionInSubtopic: spokenSubtopicTwo.indexOf(slideTwoSentence),
	},
];

const content: NotesPageContent = {
	lectureTitle: testLecture.title,
	lectureDate: testLecture.date,
	factCheckLine: "Uncorrected",
	topics,
	slideRelocations,
	slideReadings,
	subtopicRewrites,
	termCorrections,
	slidePlacements,
	factCorrections: [],
	pageViews: PAGE_VIEW_IDS,
	highlightSlideSentences: true,
};

/**
 * Gives each choice of the switch of the page views, with " checked" after the chosen one.
 *
 * @param html - The page.
 * @returns The value of each choice, in the order of the switch.
 */
function switchChoices(html: string): readonly string[] {
	return [
		...html.matchAll(
			/<input type="radio" name="view" value="(?<view>\w+)"(?<checked> checked)?>/gu,
		),
	].map(({ groups }) => `${groups?.view}${groups?.checked ?? ""}`);
}

/**
 * Gives the inner HTML of one page view.
 *
 * @param args - The page, and the view.
 * @param args.html - The page.
 * @param args.view - The value of the view on the switch, such as `rewrite`.
 * @returns The inner HTML of the view.
 */
function viewHtml({ html, view }: { readonly html: string; readonly view: string }): string {
	return new RegExp(`<div class="view" id="${view}-view">(.*?)</div>`, "su").exec(html)?.[1] ?? "";
}

/**
 * Gives the content with a new text for the paragraph of subtopic 1, which has no slide.
 *
 * @param paragraph - The text of the paragraph.
 * @returns The content of the page.
 */
function withOpeningParagraph(paragraph: string): NotesPageContent {
	return {
		...content,
		slideRelocations: [
			{ subtopicId: 1, paragraphs: [paragraph], slides: [] },
			...slideRelocations.slice(1),
		],
	};
}

/**
 * Gives the content with a new caption for slide 2.
 *
 * @param caption - The caption.
 * @returns The content of the page.
 */
function withSlideTwoCaption(caption: string): NotesPageContent {
	return {
		...content,
		slideReadings: [{ ...(slideTwoReading as SlideReading), caption }],
	};
}

/**
 * Gives the text of a page with its tags removed, so a test can find words in order.
 *
 * @param html - The page.
 * @returns The text of the page.
 */
function pageText(html: string): string {
	return html.replace(/<[^>]*>/gu, "");
}

/**
 * Gives the inner HTML of each element with a tag that has no attributes. No
 * element in these searches holds an element with the same tag.
 *
 * @param args - The HTML, and the tag.
 * @param args.html - The HTML to search.
 * @param args.tag - The tag, such as `p` or `main`.
 * @returns The inner HTML of each element, in page order.
 */
function innerHtmlOf({
	html,
	tag,
}: {
	readonly html: string;
	readonly tag: string;
}): readonly string[] {
	return [...html.matchAll(new RegExp(`<${tag}>(.*?)</${tag}>`, "gsu"))].map(
		([, inner]) => inner ?? "",
	);
}

/**
 * Checks that each part is in a text after the part before it.
 *
 * @param args - The text and the parts.
 * @param args.text - The text to search.
 * @param args.parts - The parts, in the order that they must have.
 * @returns `true` when each part follows the part before it.
 */
function inOrder({
	text,
	parts,
}: {
	readonly text: string;
	readonly parts: readonly string[];
}): boolean {
	let from = 0;
	for (const part of parts) {
		const at = text.indexOf(part, from);
		if (at < 0) {
			return false;
		}
		from = at + part.length;
	}
	return true;
}

/**
 * Gives the text of each run of spoken words with the red highlight of the Transcript view.
 *
 * @param html - The HTML of the Transcript view.
 * @returns The text of each run, in page order.
 */
function redWords(html: string): readonly string[] {
	return [...html.matchAll(/<span class="not-in-notes">(.*?)<\/span>/gu)].map(([, inner]) =>
		pageText(inner ?? ""),
	);
}

/**
 * Gives the inner HTML of the Notes view of a page.
 *
 * @param html - The page.
 * @returns The inner HTML of the Notes view.
 */
function notesView(html: string): string {
	return viewHtml({ html, view: "notes" });
}

/**
 * Gives the highlighted sentences of the Notes view. The header also has a
 * highlight, which explains the highlight, so the search covers only the view.
 *
 * @param html - The page.
 * @returns The text of each highlight in the Notes view, trimmed.
 */
function highlightedSentences(html: string): readonly string[] {
	return innerHtmlOf({ html: notesView(html), tag: "mark" }).map((inner) => pageText(inner).trim());
}

describe("notesPageHtml", () => {
	it("should show each topic title and each subtopic title in lecture order when the lecture has two topics", () => {
		const text = pageText(notesPageHtml(content));

		expect(
			inOrder({
				text,
				parts: topics.flatMap((topic) => [
					topic.title,
					...topic.subtopics.map((subtopic) => subtopic.title),
				]),
			}),
		).toBe(true);
	});

	it("should show each paragraph of a subtopic as its own paragraph, with a figure mark that points at no slide kept as [FIGURE], when the subtopic has paragraphs", () => {
		const paragraphs = innerHtmlOf({ html: notesPageHtml(content), tag: "p" }).map(pageText);

		expect(paragraphs).toContain(openingParagraph);
		expect(paragraphs).toContain(subtopicTwoParagraphs[1]);
	});

	it("should put a slide at the start of its sentence when the slide has a paragraph index and a character offset", () => {
		const html = notesPageHtml(content);

		expect(
			inOrder({
				text: html,
				parts: [sentenceBeforeSlideTwo, notesSlideImageEntry(2), slideTwoSentence],
			}),
		).toBe(true);
	});

	it("should show the figure number and the caption beside the slide when the slide has a figure number", () => {
		const text = pageText(notesPageHtml(content));

		expect(
			inOrder({
				text,
				parts: [
					sentenceBeforeSlideTwo,
					`${figureLabel(1)}.`,
					slideTwoReading?.caption ?? "",
					slideTwoSentence,
				],
			}),
		).toBe(true);
	});

	it("should show the slide as a slide with a blank caption and a blank title when the slide has no reading", () => {
		const blankReading = { ...(slideTwoReading as SlideReading), caption: "", title: "" };

		const html = notesPageHtml({ ...content, slideReadings: [] });

		expect(html).toBe(notesPageHtml({ ...content, slideReadings: [blankReading] }));
	});

	it("should show the subtopic title with no paragraph when the subtopic has no entry in the slide relocations", () => {
		const html = notesPageHtml({ ...content, slideRelocations: slideRelocations.slice(1) });

		expect(pageText(html)).toContain(openingSubtopicTitle);
		expect(innerHtmlOf({ html: notesView(html), tag: "p" })).toHaveLength(
			subtopicTwoParagraphs.length,
		);
	});

	it("should highlight the slide's sentence up to its end when the paragraph has more than one sentence", () => {
		expect(highlightedSentences(notesPageHtml(content))).toStrictEqual([slideTwoSentence]);
	});

	it("should highlight no sentence, and leave the highlight out of the Notes legend, when the highlight switch is off", () => {
		const html = notesPageHtml({ ...content, highlightSlideSentences: false });

		const [header = ""] = innerHtmlOf({ html, tag: "header" });
		expect(highlightedSentences(html)).toStrictEqual([]);
		expect(header).not.toContain("<mark>");
		expect(header).toContain("Click a slide to show it larger.");
	});

	it("should show the references slide next to the last paragraph, labelled References and with no highlight, when the lecture has a references slide", () => {
		const referencesCaption = "The sources of the lecture.";
		const [opening, lastSubtopic] = slideRelocations;
		const withReferences: NotesPageContent = {
			...content,
			slideRelocations: [
				opening as SubtopicOnPage,
				{
					...(lastSubtopic as SubtopicOnPage),
					slides: [
						...(lastSubtopic?.slides ?? []),
						{
							slideNumber: 4,
							paragraphIndex: 1,
							characterOffset: subtopicTwoParagraphs[1].length,
							figureNumber: null,
						},
					],
				},
			],
			slideReadings: [
				...slideReadings,
				{ ...(referencesReading as SlideReading), caption: referencesCaption },
			],
		};

		const html = notesPageHtml(withReferences);

		expect(
			inOrder({
				text: notesView(html),
				parts: [slideTwoSentence, "<p>", notesSlideImageEntry(4), subtopicTwoParagraphs[1]],
			}),
		).toBe(true);
		expect(pageText(html)).toContain(`References. ${referencesCaption}`);
		expect(highlightedSentences(html)).toStrictEqual([slideTwoSentence]);
	});

	it("should show a slide with no highlight and no empty mark when its point is at the end of a paragraph", () => {
		const atParagraphEnd: NotesPageContent = {
			...content,
			slideRelocations: [
				{
					subtopicId: 1,
					paragraphs: [openingParagraph],
					slides: [
						{
							slideNumber: 1,
							paragraphIndex: 0,
							characterOffset: openingParagraph.length,
							figureNumber: 1,
						},
					],
				},
				...slideRelocations.slice(1),
			],
			slideReadings: [slideOneReading as SlideReading, ...slideReadings],
		};

		const html = notesPageHtml(atParagraphEnd);

		expect(innerHtmlOf({ html, tag: "mark" })).not.toContain("");
		expect(highlightedSentences(html)).toStrictEqual([slideTwoSentence]);
		const [opening = ""] = innerHtmlOf({ html, tag: "p" });
		expect(opening).toContain(notesSlideImageEntry(1));
		expect(pageText(opening)).toContain(`${figureLabel(1)}. ${slideOneReading?.caption}`);
	});

	it.each([
		{ where: "text", withMaths: withOpeningParagraph },
		{ where: "caption", withMaths: withSlideTwoCaption },
	])("should turn LaTeX into MathML when the $where holds $…$", ({ withMaths }) => {
		const latex = "$x^2$";

		const html = notesPageHtml(withMaths(`The area grows as ${latex} here.`));

		expect(html).toContain("<math");
		expect(html).toContain("<msup>");
		expect(html).not.toContain(latex);
	});

	it("should keep a dollar amount as text when the text holds a price such as $5 and $10", () => {
		const price = "The test costs $5 and $10 with the scan.";

		const html = notesPageHtml(withOpeningParagraph(price));

		expect(innerHtmlOf({ html, tag: "p" })).toContain(price);
	});

	it.each([
		{ latex: String.raw`$\beta$ chains`, shown: "β chains" },
		{ latex: String.raw`$\Delta$ chains`, shown: "Δ chains" },
		{ latex: String.raw`$\beta$-cells`, shown: '<span class="nowrap">β-cells</span>' },
	])("should show a lone Greek letter as a plain letter in the text font when the text holds $latex", ({
		latex,
		shown,
	}) => {
		const html = notesPageHtml(withOpeningParagraph(`The ${latex} matter.`));

		expect(innerHtmlOf({ html, tag: "p" })).toContain(`The ${shown} matter.`);
	});

	it.each([
		{ where: "text", withMarkup: withOpeningParagraph },
		{ where: "caption", withMarkup: withSlideTwoCaption },
	])('should escape <, & and " when the $where holds them', ({ withMarkup }) => {
		const html = notesPageHtml(withMarkup('IL-1 <b>rises</b> & "TNF" falls.'));

		expect(html).toContain("IL-1 &lt;b&gt;rises&lt;/b&gt; &amp; &quot;TNF&quot; falls.");
		expect(html).not.toContain("<b>");
	});

	it("should show the lecture title, the date, a link to each topic and the meaning of the highlight in the header when the page is built", () => {
		const [header = ""] = innerHtmlOf({ html: notesPageHtml(content), tag: "header" });

		expect(pageText(header)).toContain(testLecture.title);
		expect(pageText(header)).toContain(testLecture.date);
		for (const [index, topic] of topics.entries()) {
			expect(header).toContain(`<a href="#topic-${index + 1}">${topic.title}</a>`);
		}
		expect(header).toContain("<mark>");
	});

	it("should show the fact-check line right under the lecture title, in the small grey type, when the page is built", () => {
		const [header = ""] = innerHtmlOf({ html: notesPageHtml(content), tag: "header" });

		expect(header).toContain(`</h1>\n<p class="fact-check">${content.factCheckLine}</p>`);
	});

	it("should load nothing from the internet when the page is built", () => {
		const html = notesPageHtml(content);

		expect(html).not.toMatch(/(?:src|href)="[^"]*:\/\//u);
		expect(html).not.toMatch(/@import|url\(/u);
	});

	it("should point each slide image at its copy beside the page when the page is built", () => {
		expect(notesPageHtml(content)).toContain(`src="${notesSlideImageEntry(2)}"`);
	});

	it("should show a switch with the four page views, and choose the Notes view, when the page is built", () => {
		expect(switchChoices(notesPageHtml(content))).toStrictEqual([
			"notes checked",
			"rewrite",
			"corrections",
			"transcript",
		]);
	});

	it("should show only the listed page views, in the order of the page, with their switch choices and legend lines, when the content lists two views", () => {
		const html = notesPageHtml({ ...content, pageViews: ["transcript", "notes"] });

		expect(switchChoices(html)).toStrictEqual(["notes checked", "transcript"]);
		expect(pageViewsIn(html)).toStrictEqual(["notes", "transcript"]);
		expect(
			[...html.matchAll(/<p class="legend" id="(\w+)-legend">/gu)].map(([, view]) => view),
		).toStrictEqual(["notes", "transcript"]);
	});

	it.each([
		{ view: "notes", explains: "<mark>" },
		{ view: "rewrite", explains: "before the fact correction" },
		{ view: "corrections", explains: "<del>" },
		{ view: "transcript", explains: '<span class="not-in-notes">' },
	])("should explain the $view view in a line of the header that shows with the view when the page is built", ({
		view,
		explains,
	}) => {
		const [header = ""] = innerHtmlOf({ html: notesPageHtml(content), tag: "header" });

		const legend = new RegExp(`<p class="legend" id="${view}-legend">(.*?)</p>`, "u").exec(header);

		expect(legend?.[1]).toContain(explains);
	});

	it("should show the rewrite of each subtopic under its title, with no highlight and no colour, when the Rewrite view is built", () => {
		const withNoSlides: NotesPageContent = {
			...content,
			slideRelocations: slideRelocations.map((entry) => ({ ...entry, slides: [] })),
		};

		const rewrite = viewHtml({ html: notesPageHtml(withNoSlides), view: "rewrite" });

		expect(
			inOrder({
				text: pageText(rewrite),
				parts: topics.flatMap((topic) => [
					topic.title,
					...topic.subtopics.flatMap((subtopic) => [
						subtopic.title,
						...(subtopicRewrites.find(({ subtopicId }) => subtopicId === subtopic.subtopicId)
							?.rewrittenSubtopic ?? []),
					]),
				]),
			}),
		).toBe(true);
		expect(rewrite).not.toMatch(/<(?:mark|del|ins)\b|not-in-notes/u);
	});

	it("should put a slide in front of the rewrite word that matches the slide's word in the notes when the Rewrite view is built", () => {
		const rewrite = viewHtml({ html: notesPageHtml(content), view: "rewrite" });

		expect(
			inOrder({
				text: rewrite,
				parts: [sentenceBeforeSlideTwo, notesSlideImageEntry(2), rewriteSlideTwoSentence],
			}),
		).toBe(true);
		expect(rewrite).not.toContain("<mark>");
	});

	it("should show the term-corrected text of each subtopic under its title when the Transcript view is built", () => {
		const html = notesPageHtml({ ...content, slidePlacements: [] });

		const transcript = pageText(viewHtml({ html, view: "transcript" }));

		expect(
			inOrder({
				text: transcript,
				parts: topics.flatMap((topic) => [
					topic.title,
					...topic.subtopics.flatMap((subtopic) => [
						subtopic.title,
						termCorrections.find(({ subtopicId }) => subtopicId === subtopic.subtopicId)
							?.correctedText ?? "",
					]),
				]),
			}),
		).toBe(true);
	});

	it("should give a red highlight with no line to each spoken word that the notes do not have at its place when the Transcript view is built", () => {
		const transcript = viewHtml({ html: notesPageHtml(content), view: "transcript" });

		expect(redWords(transcript)).toStrictEqual([unwrittenWords]);
		expect(transcript).not.toContain("<del>");
	});

	it("should put each spoken word in the paragraph of its notes word, and an unwritten word in the paragraph of the word before it, when the Transcript view is built", () => {
		const filler = "um";
		const [firstParagraph, secondParagraph] = subtopicTwoParagraphs;

		const html = notesPageHtml({
			...content,
			termCorrections: [
				{ subtopicId: 2, correctedText: `${firstParagraph} ${filler} ${secondParagraph}` },
			],
			slidePlacements: [],
		});

		expect(
			innerHtmlOf({ html: viewHtml({ html, view: "transcript" }), tag: "p" }).map(pageText),
		).toStrictEqual([`${firstParagraph} ${filler}`, secondParagraph]);
	});

	it("should put a slide in its subtopic in front of the spoken word where the lecturer starts to discuss it when the Transcript view is built", () => {
		const transcript = viewHtml({ html: notesPageHtml(content), view: "transcript" });

		expect(
			inOrder({
				text: transcript,
				parts: [sentenceBeforeSlideTwo, notesSlideImageEntry(2), slideTwoSentence],
			}),
		).toBe(true);
		expect(pageText(transcript)).toContain(`${figureLabel(1)}.`);
	});

	it("should show the whole spoken text of a subtopic in red when its notes have no paragraph", () => {
		const html = notesPageHtml({
			...content,
			slideRelocations: [
				{ subtopicId: 1, paragraphs: [], slides: [] },
				...slideRelocations.slice(1),
			],
		});

		expect(redWords(viewHtml({ html, view: "transcript" }))).toStrictEqual([
			openingParagraph,
			unwrittenWords,
		]);
	});

	it("should show a word that is only in the rewrite in red with a line, and a word that is only in the notes in green, when the Corrections view is built", () => {
		const corrections = viewHtml({ html: notesPageHtml(content), view: "corrections" });

		expect(innerHtmlOf({ html: corrections, tag: "del" }).map(pageText)).toStrictEqual([
			"can be reversed.",
		]);
		expect(innerHtmlOf({ html: corrections, tag: "ins" }).map(pageText)).toStrictEqual([
			"is reversible.",
		]);
	});

	it("should show the text with no colour when the fact correction changed nothing but the figure mark that slide relocation numbered", () => {
		const html = notesPageHtml({
			...content,
			slideRelocations: [
				{ subtopicId: 1, paragraphs: [`${openingParagraph} (${figureLabel(1)})`], slides: [] },
				...slideRelocations.slice(1),
			],
			subtopicRewrites: [
				{ subtopicId: 1, rewrittenSubtopic: [`${openingParagraph} [FIGURE]`] },
				{ subtopicId: 2, rewrittenSubtopic: subtopicTwoParagraphs },
			],
		});

		expect(viewHtml({ html, view: "corrections" })).not.toMatch(/<(?:del|ins)>/u);
	});

	it("should put each slide at the start of its sentence in the notes, with no highlight, when the Corrections view is built", () => {
		const corrections = viewHtml({ html: notesPageHtml(content), view: "corrections" });

		expect(
			inOrder({
				text: pageText(corrections),
				parts: [sentenceBeforeSlideTwo, `${figureLabel(1)}.`, "Some injury", "is reversible."],
			}),
		).toBe(true);
		expect(corrections).not.toContain("<mark>");
	});

	it.each([
		{
			reported: "reported",
			changes: [reportedChange],
			note: ` data-note="${seededFactualError.problem}" tabindex="0"`,
		},
		{ reported: "did not report", changes: [], note: "" },
	])("should give each red and green word of a change the problem of its factual error as a note, or no note, when the model $reported the change", ({
		changes,
		note,
	}) => {
		const html = notesPageHtml({
			...content,
			factCorrections: [{ subtopicId: 2, factualErrors: [seededFactualError], changes }],
		});

		const corrections = viewHtml({ html, view: "corrections" });

		expect(corrections).toContain(`<del${note}>`);
		expect(corrections).toContain(`<ins${note}>`);
	});
});
