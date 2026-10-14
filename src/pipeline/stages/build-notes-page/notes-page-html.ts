/**
 * The HTML of the notes page of one lecture (technical-design.md §5,
 * `build-notes-page`). The test page of slide-placement ticket 05 is the
 * prototype of its layout.
 */

import katex from "katex";
import { SENTENCE_END_MARK } from "../../../utils/text.js";
import { notesSlideImageEntry } from "../../layout.js";
import {
	figureLabel,
	isRelocatedReferencesSlide,
	type RelocatedSlide,
	type SlideRelocation,
} from "../slide-relocations.js";
import { findSlideReading, type SlideReading } from "../slides.js";
import type { TopicWithSubtopics } from "../structured-transcript.js";
import { NOTES_PAGE_SCRIPT, NOTES_PAGE_STYLE } from "./notes-page-style.js";

/** The paragraphs and the slides of one subtopic. The page reads no other field of the entry. */
type SubtopicSlideRelocation = Pick<SlideRelocation, "subtopicId" | "paragraphs" | "slides">;

/** The content of the notes page: the titles, the text and the slides of one lecture. */
export type NotesPageContent = {
	readonly lectureTitle: string;
	/** The `YYYY-MM-DD` lecture date. */
	readonly lectureDate: string;
	/** The topics of the structured transcript, for the titles. */
	readonly topics: readonly TopicWithSubtopics[];
	/** The entry of each subtopic in `slide-relocations.json`, in lecture order. */
	readonly slideRelocations: readonly SubtopicSlideRelocation[];
	/** The reading of each slide in the notes, for its caption. */
	readonly slideReadings: readonly SlideReading[];
};

/**
 * Gives the id of a topic's section, which the link to the topic in the header
 * points at.
 *
 * @param topicIndex - The place of the topic in the lecture, from 0.
 * @returns The id, such as `topic-1`.
 */
function topicAnchor(topicIndex: number): string {
	return `topic-${topicIndex + 1}`;
}

/**
 * Escapes the characters that HTML reads as markup.
 *
 * @param text - Plain text.
 * @returns The text, safe in an element and in a quoted attribute.
 */
function escapeHtml(text: string): string {
	return text
		.replace(/&/gu, "&amp;")
		.replace(/</gu, "&lt;")
		.replace(/>/gu, "&gt;")
		.replace(/"/gu, "&quot;");
}

/**
 * A LaTeX part of a text, in dollar signs, and the word that a hyphen joins to
 * it. The opening dollar sign has no space after it. The closing dollar sign has
 * no space before it and no digit after it. So a price such as "$5 and $10" is
 * not maths.
 */
const LATEX_PART = /\$(?=\S)(?<latex>[^$]*?\S)\$(?!\d)(?<joined>-[^\s,.;:]+)?/gu;

/** The groups of a match of {@link LATEX_PART}. The pattern always fills `latex`. */
type LatexPart = { readonly latex: string; readonly joined: string | undefined };

/** The LaTeX of one Greek letter alone, such as `\beta`. */
const LONE_GREEK_LETTER = /^\\(?<name>[A-Za-z]+)$/u;

/** The Greek letters, by their LaTeX names, as text characters. */
const GREEK_LETTERS: Readonly<Record<string, string>> = Object.fromEntries(
	[
		..."alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega"
			.split(" ")
			.entries(),
	].flatMap(([index, name]) => {
		// Unicode puts the final sigma between rho and sigma. The list skips it.
		const lower = String.fromCodePoint(0x3b1 + index + (index >= 17 ? 1 : 0));
		const capital = `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
		return [
			[name, lower],
			[capital, lower.toUpperCase()],
		];
	}),
);

/**
 * Gives the HTML of one LaTeX part. A lone Greek letter shows as the plain letter
 * in the text font. A word that a hyphen joins to the letter stays on its line.
 * KaTeX turns every other part into MathML, which needs no stylesheet and no font.
 *
 * @param args - The LaTeX, and the joined word.
 * @param args.latex - The LaTeX, without its dollar signs.
 * @param args.joined - The hyphen and the word after the part, or `undefined`.
 * @returns The HTML of the part and of the joined word.
 */
function latexHtml({ latex, joined }: LatexPart): string {
	const name = LONE_GREEK_LETTER.exec(latex)?.groups?.name;
	const letter = name === undefined ? undefined : GREEK_LETTERS[name];
	if (letter === undefined) {
		return `${katex.renderToString(latex, { output: "mathml", throwOnError: false })}${escapeHtml(joined ?? "")}`;
	}
	return joined === undefined
		? letter
		: `<span class="nowrap">${letter}${escapeHtml(joined)}</span>`;
}

/**
 * Escapes a text for HTML, and shows each LaTeX part as maths.
 *
 * @param text - The text, which can hold LaTeX parts.
 * @returns The HTML of the text.
 */
function textHtml(text: string): string {
	let html = "";
	let cursor = 0;
	for (const match of text.matchAll(LATEX_PART)) {
		html += escapeHtml(text.slice(cursor, match.index));
		html += latexHtml(match.groups as LatexPart);
		cursor = match.index + match[0].length;
	}
	return html + escapeHtml(text.slice(cursor));
}

/**
 * Gives one slide as a small figure, with its figure number and its caption.
 * The figure is made of spans, so the paragraph that holds it stays valid HTML.
 *
 * @param args - The slide, and the slide readings.
 * @param args.slide - The slide.
 * @param args.readings - The slide readings of the notes.
 * @returns The HTML of the figure.
 */
function figureHtml({
	slide,
	readings,
}: {
	readonly slide: RelocatedSlide;
	readonly readings: readonly SlideReading[];
}): string {
	const reading = findSlideReading({ slideReadings: readings, slideNumber: slide.slideNumber });
	const image = notesSlideImageEntry(slide.slideNumber);
	const label = isRelocatedReferencesSlide(slide) ? "References" : figureLabel(slide.figureNumber);
	return `<span class="figure" role="figure" aria-label="${label}">
<span class="figure-text"><span class="caption"><span class="figure-label">${label}.</span> ${textHtml(reading?.caption ?? "")}</span></span>
<button class="figure-image" type="button" aria-label="Show ${label} larger"><img src="${escapeHtml(image)}" alt="${escapeHtml(reading?.title ?? "")}"></button>
</span>`;
}

/**
 * A sentence end that a new sentence follows: the end mark, then spaces, then an
 * optional opening quote or bracket and a capital letter or a digit.
 */
const SENTENCE_END = new RegExp(`${SENTENCE_END_MARK}(?=\\s+["'(]?[A-Z0-9])`, "gu");

/**
 * Finds the end of the sentence that starts at an offset.
 *
 * @param args - The paragraph, and the start of the sentence.
 * @param args.paragraph - The text of the paragraph.
 * @param args.offset - The start of the sentence, in characters.
 * @returns The position after the end mark. For the last sentence, the length of the paragraph.
 */
function sentenceEndAfter({
	paragraph,
	offset,
}: {
	readonly paragraph: string;
	readonly offset: number;
}): number {
	for (const match of paragraph.matchAll(SENTENCE_END)) {
		const end = match.index + match[0].length;
		if (end > offset) {
			return end;
		}
	}
	return paragraph.length;
}

/**
 * Gives one paragraph, with each of its slides at the start of the slide's sentence.
 * A slide at the end of the paragraph has no sentence, so it gets no highlight.
 *
 * @param args - The paragraph, its slides, and the slide readings.
 * @param args.paragraph - The text of the paragraph.
 * @param args.slides - The slides of the paragraph, in deck order.
 * @param args.readings - The slide readings of the notes.
 * @returns The HTML of the paragraph.
 */
function paragraphHtml({
	paragraph,
	slides,
	readings,
}: {
	readonly paragraph: string;
	readonly slides: readonly RelocatedSlide[];
	readonly readings: readonly SlideReading[];
}): string {
	// A slide at the end of the paragraph has no sentence to highlight. The
	// references slide is one such slide. It floats from the paragraph's start, so
	// it shows next to the paragraph and not below it.
	const isAtEnd = (slide: RelocatedSlide): boolean =>
		paragraph.slice(slide.characterOffset).trim() === "";
	let html = slides
		.filter(isAtEnd)
		.map((slide) => figureHtml({ slide, readings }))
		.join("");
	let cursor = 0;
	const figures = slides.filter((slide) => !isAtEnd(slide));
	for (const [index, slide] of figures.entries()) {
		const sentenceEnd = Math.min(
			sentenceEndAfter({ paragraph, offset: slide.characterOffset }),
			figures[index + 1]?.characterOffset ?? paragraph.length,
		);
		html += `${textHtml(paragraph.slice(cursor, slide.characterOffset))}${figureHtml({ slide, readings })}<mark>${textHtml(paragraph.slice(slide.characterOffset, sentenceEnd))}</mark>`;
		cursor = sentenceEnd;
	}
	return `<p>${html}${textHtml(paragraph.slice(cursor))}</p>`;
}

/**
 * Gives the paragraphs of one subtopic.
 *
 * @param args - The entry of the subtopic, and the slide readings.
 * @param args.relocation - The entry of the subtopic, or `undefined` when it has none.
 * @param args.readings - The slide readings of the notes.
 * @returns The HTML of the paragraphs.
 */
function paragraphsHtml({
	relocation,
	readings,
}: {
	readonly relocation: SubtopicSlideRelocation | undefined;
	readonly readings: readonly SlideReading[];
}): string {
	if (relocation === undefined) {
		return "";
	}
	return [...relocation.paragraphs.entries()]
		.map(([index, paragraph]) =>
			paragraphHtml({
				paragraph,
				slides: relocation.slides.filter(({ paragraphIndex }) => paragraphIndex === index),
				readings,
			}),
		)
		.join("\n");
}

/**
 * Gives the section of one topic, with the section of each of its subtopics.
 *
 * @param args - The topic, its section id, the entry of each subtopic, and the slide readings.
 * @param args.topic - The topic.
 * @param args.anchor - The id of the topic's section.
 * @param args.slideRelocations - The entry of each subtopic of the lecture.
 * @param args.readings - The slide readings of the notes.
 * @returns The HTML of the topic.
 */
function topicHtml({
	topic,
	anchor,
	slideRelocations,
	readings,
}: {
	readonly topic: TopicWithSubtopics;
	readonly anchor: string;
	readonly slideRelocations: readonly SubtopicSlideRelocation[];
	readonly readings: readonly SlideReading[];
}): string {
	const subtopics = topic.subtopics.map(
		(subtopic) => `<section class="subtopic">
<h3>${escapeHtml(subtopic.title)}</h3>
${paragraphsHtml({
	relocation: slideRelocations.find(({ subtopicId }) => subtopicId === subtopic.subtopicId),
	readings,
})}
</section>`,
	);
	return `<section class="topic" id="${anchor}">
<h2>${escapeHtml(topic.title)}</h2>
${subtopics.join("\n")}
</section>`;
}

/**
 * Gives the header of the page: the lecture date and title, the meaning of the
 * highlight, and a link to each topic.
 *
 * @param content - The content of the page.
 * @returns The HTML of the header.
 */
function headerHtml(content: NotesPageContent): string {
	const links = [...content.topics.entries()].map(
		([index, topic]) => `<li><a href="#${topicAnchor(index)}">${escapeHtml(topic.title)}</a></li>`,
	);
	return `<header>
<p class="eyebrow">${escapeHtml(content.lectureDate)}</p>
<h1>${escapeHtml(content.lectureTitle)}</h1>
<p class="legend">Each slide sits at the sentence where its discussion starts. That sentence is <mark>highlighted</mark>. Click a slide to show it larger.</p>
<nav aria-label="Topics"><ol>${links.join("")}</ol></nav>
</header>`;
}

/**
 * Gives the HTML page of the notes of one lecture.
 *
 * @param content - The content of the page.
 * @returns The whole page, as one HTML text.
 */
export function notesPageHtml(content: NotesPageContent): string {
	const sections = [...content.topics.entries()].map(([index, topic]) =>
		topicHtml({
			topic,
			anchor: topicAnchor(index),
			slideRelocations: content.slideRelocations,
			readings: content.slideReadings,
		}),
	);
	return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(content.lectureTitle)}</title>
<style>${NOTES_PAGE_STYLE}</style>
</head>
<body>
<div class="page">
${headerHtml(content)}
<main>
${sections.join("\n")}
</main>
</div>
<dialog id="enlarged" aria-label="Enlarged slide"><button class="close" type="button">Close</button><img alt=""><span class="figure-text"></span></dialog>
<script>${NOTES_PAGE_SCRIPT}</script>
</body>
</html>
`;
}
