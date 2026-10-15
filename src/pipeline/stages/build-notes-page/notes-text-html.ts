/**
 * The HTML parts that the notes page and the Notes PDF both build: the text with
 * its maths, the topic sections, the slide labels and the split of a paragraph
 * at its slides (technical-design.md §5, `build-notes-page`).
 */

import katex from "katex";
import {
	figureLabel,
	isRelocatedReferencesSlide,
	type RelocatedSlide,
} from "../slide-relocations.js";
import { findSlideReading, type SlideReading } from "../slides.js";
import type { TopicWithSubtopics } from "../structured-transcript.js";

/**
 * Escapes the characters that HTML reads as markup.
 *
 * @param text - Plain text.
 * @returns The text, safe in an element and in a quoted attribute.
 */
export function escapeHtml(text: string): string {
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
export function textHtml(text: string): string {
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
 * Finds the entry of a subtopic in a list of entries of the lecture.
 *
 * @param args - The entries, and the subtopic.
 * @param args.entries - The entries, each with its subtopic id.
 * @param args.subtopicId - The subtopic.
 * @returns The entry, or `undefined` when the list has none.
 * @typeParam TEntry - The entry.
 */
export function entryOf<TEntry extends { readonly subtopicId: number }>({
	entries,
	subtopicId,
}: {
	readonly entries: readonly TEntry[];
	readonly subtopicId: number;
}): TEntry | undefined {
	return entries.find((entry) => entry.subtopicId === subtopicId);
}

/**
 * Gives the lecture date, then the lecture title as the main heading.
 *
 * @param lecture - The lecture date and the lecture title.
 * @param lecture.lectureDate - The `YYYY-MM-DD` lecture date.
 * @param lecture.lectureTitle - The lecture title.
 * @returns The HTML of the date and the heading.
 */
export function lectureHeadingHtml({
	lectureDate,
	lectureTitle,
}: {
	readonly lectureDate: string;
	readonly lectureTitle: string;
}): string {
	return `<p class="eyebrow">${escapeHtml(lectureDate)}</p>
<h1>${escapeHtml(lectureTitle)}</h1>`;
}

/** One subtopic of the structured transcript. */
export type Subtopic = TopicWithSubtopics["subtopics"][number];

/**
 * Gives the section of one topic, with the section of each of its subtopics.
 *
 * @param args - The topic, its section id, and the text of each subtopic.
 * @param args.topic - The topic.
 * @param args.anchor - The id of the topic's section.
 * @param args.subtopicBody - Gives the HTML of the text of a subtopic.
 * @returns The HTML of the topic.
 */
export function topicHtml({
	topic,
	anchor,
	subtopicBody,
}: {
	readonly topic: TopicWithSubtopics;
	readonly anchor: string;
	readonly subtopicBody: (subtopic: Subtopic) => string;
}): string {
	const subtopics = topic.subtopics.map(
		(subtopic) => `<section class="subtopic">
<h3>${escapeHtml(subtopic.title)}</h3>
${subtopicBody(subtopic)}
</section>`,
	);
	return `<section class="topic" id="${anchor}">
<h2>${escapeHtml(topic.title)}</h2>
${subtopics.join("\n")}
</section>`;
}

/**
 * Gives the label of a slide: "References" for the references slide, else its
 * figure label.
 *
 * @param slide - The slide.
 * @returns The label, with no full stop.
 */
export function slideLabel(slide: RelocatedSlide): string {
	return isRelocatedReferencesSlide(slide) ? "References" : figureLabel(slide.figureNumber);
}

/** The parts of the figure of one slide. */
export type SlideFigureParts = {
	/** The label, such as "Figure 3" or "References", with no full stop. */
	readonly label: string;
	/** The label with its full stop, then the caption from the slide reading. */
	readonly captionHtml: string;
	/** The slide image, with the title of the slide reading as its text alternative. */
	readonly imageHtml: string;
};

/**
 * Gives the parts of the figure of one slide. A slide with no reading gets a
 * blank caption and a blank text alternative.
 *
 * @param args - The slide, the slide readings, and the URL of the slide image.
 * @param args.slide - The slide.
 * @param args.readings - The slide readings of the notes.
 * @param args.imageUrl - The URL of the slide image.
 * @returns The label, the caption and the image.
 */
export function slideFigureParts({
	slide,
	readings,
	imageUrl,
}: {
	readonly slide: RelocatedSlide;
	readonly readings: readonly SlideReading[];
	readonly imageUrl: string;
}): SlideFigureParts {
	const reading = findSlideReading({ slideReadings: readings, slideNumber: slide.slideNumber });
	const label = slideLabel(slide);
	return {
		label,
		captionHtml: `<span class="figure-label">${label}.</span> ${textHtml(reading?.caption ?? "")}`,
		imageHtml: `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(reading?.title ?? "")}">`,
	};
}

/**
 * Gives each paragraph with the slides whose point is in it.
 *
 * @param args - The paragraphs, and the slides.
 * @param args.paragraphs - The paragraphs of a subtopic.
 * @param args.slides - The slides of the subtopic, in deck order.
 * @returns Each paragraph, with its slides in deck order.
 */
export function paragraphsWithSlides({
	paragraphs,
	slides,
}: {
	readonly paragraphs: readonly string[];
	readonly slides: readonly RelocatedSlide[];
}): readonly { readonly paragraph: string; readonly slides: readonly RelocatedSlide[] }[] {
	return [...paragraphs.entries()].map(([index, paragraph]) => ({
		paragraph,
		slides: slides.filter(({ paragraphIndex }) => paragraphIndex === index),
	}));
}

/**
 * One paragraph, divided at the point of each of its slides. A slide at the end
 * of the paragraph has no text after it, so it is apart from the others.
 */
export type ParagraphAtSlides = {
	/** The text before the first slide that is not at the end. */
	readonly opening: string;
	/** Each slide that is not at the end, with the text from its point up to the next slide's point. */
	readonly parts: readonly { readonly slide: RelocatedSlide; readonly text: string }[];
	/** The slides at the end of the paragraph, such as the references slide. */
	readonly slidesAtEnd: readonly RelocatedSlide[];
};

/**
 * Divides a paragraph at the point of each of its slides.
 *
 * @param args - The paragraph, and its slides.
 * @param args.paragraph - The text of the paragraph.
 * @param args.slides - The slides of the paragraph, in deck order.
 * @returns The text before the first slide, each slide with its text, and the slides at the end.
 */
export function splitParagraphAtSlides({
	paragraph,
	slides,
}: {
	readonly paragraph: string;
	readonly slides: readonly RelocatedSlide[];
}): ParagraphAtSlides {
	const isAtEnd = (slide: RelocatedSlide): boolean =>
		paragraph.slice(slide.characterOffset).trim() === "";
	const inText = slides.filter((slide) => !isAtEnd(slide));
	return {
		opening: paragraph.slice(0, inText[0]?.characterOffset ?? paragraph.length),
		parts: [...inText.entries()].map(([index, slide]) => ({
			slide,
			text: paragraph.slice(slide.characterOffset, inText[index + 1]?.characterOffset),
		})),
		slidesAtEnd: slides.filter(isAtEnd),
	};
}
