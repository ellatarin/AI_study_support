/**
 * The HTML of the notes page of one lecture (technical-design.md §5,
 * `build-notes-page`). The test page of slide-placement ticket 05 is the
 * prototype of its layout.
 */

import katex from "katex";
import { SENTENCE_END_MARK, splitWords } from "../../../utils/text.js";
import { notesSlideImageEntry } from "../../layout.js";
import type { FactCorrectionFile } from "../fact-corrections.js";
import type { SlidePlacement } from "../slide-placements.js";
import {
	figureLabel,
	isRelocatedReferencesSlide,
	type RelocatedSlide,
	type SlideRelocation,
	type TextPoint,
} from "../slide-relocations.js";
import { findSlideReading, type SlideReading } from "../slides.js";
import type { TopicWithSubtopics } from "../structured-transcript.js";
import type { SubtopicRewrite } from "../subtopic-rewrites.js";
import type { TermCorrectionResult } from "../term-corrections.js";
import { NOTES_PAGE_SCRIPT, NOTES_PAGE_STYLE } from "./notes-page-style.js";
import {
	type ComparedWord,
	compareWords,
	holdsWordRun,
	type WordChange,
} from "./word-comparison.js";

/** The paragraphs and the slides of one subtopic. The page reads no other field of the entry. */
type SubtopicSlideRelocation = Pick<SlideRelocation, "subtopicId" | "paragraphs" | "slides">;

/** The factual errors and the reported changes of one subtopic. The page reads no other field of the file. */
type SubtopicFactCorrection = Pick<FactCorrectionFile, "subtopicId" | "factualErrors" | "changes">;

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
	/** The rewrite of each subtopic, for the Rewrite view. */
	readonly subtopicRewrites: readonly Pick<SubtopicRewrite, "subtopicId" | "rewrittenSubtopic">[];
	/** The term-corrected text of each subtopic, for the Transcript view. */
	readonly termCorrections: readonly Pick<TermCorrectionResult, "subtopicId" | "correctedText">[];
	/** The point of each placed slide in the text of its subtopic, for the Transcript view. */
	readonly slidePlacements: readonly Pick<
		SlidePlacement,
		"slideNumber" | "subtopicId" | "positionInSubtopic"
	>[];
	/** The factual errors and the reported changes of each subtopic, for the notes of the Corrections view. */
	readonly factCorrections: readonly SubtopicFactCorrection[];
};

/** The page views in the order of the switch, each with its name on the switch (CONTEXT.md, "Page view"). */
const PAGE_VIEWS = [
	{
		view: "notes",
		name: "Notes",
		legend:
			"Each slide sits at the sentence where its discussion starts. That sentence is <mark>highlighted</mark>. Click a slide to show it larger.",
	},
	{
		view: "rewrite",
		name: "Rewrite",
		legend: "This view shows the rewrite of each subtopic before the fact correction.",
	},
	{
		view: "corrections",
		name: "Corrections",
		legend:
			"This view shows the changes that the fact correction made. <del>Red words</del> are only in the rewrite. <ins>Green words</ins> are only in the notes. Rest the mouse on a coloured word to see the problem that caused the change.",
	},
	{
		view: "transcript",
		name: "Transcript",
		legend:
			'This view shows the spoken text after the term correction. <span class="not-in-notes">Red words</span> are not in the notes.',
	},
] as const;

/** One page view of the notes page. */
type PageView = (typeof PAGE_VIEWS)[number]["view"];

/** The page view that shows when the page opens. Its topic sections have the ids that the header links point at. */
const FIRST_VIEW: PageView = "notes";

/**
 * Gives the switch of the page views. The first view is chosen.
 *
 * @returns The HTML of the switch.
 */
function viewSwitchHtml(): string {
	const choices = PAGE_VIEWS.map(
		({ view, name }) =>
			`<label><input type="radio" name="view" value="${view}"${view === FIRST_VIEW ? " checked" : ""}> ${name}</label>`,
	);
	return `<fieldset class="view-switch"><legend>Page view</legend>${choices.join("")}</fieldset>`;
}

/**
 * Gives the style rule of each page view, which shows the view and its line in
 * the header when the switch chooses it.
 *
 * @returns The CSS of the rules.
 */
function viewStyle(): string {
	return PAGE_VIEWS.map(
		({ view }) =>
			`body:has(input[name="view"][value="${view}"]:checked) :is(#${view}-view, #${view}-legend) { display: block; }`,
	).join("\n");
}

/**
 * Gives the id of a topic's section in a page view. A link to the topic in the
 * header points at the id in the first view.
 *
 * @param args - The page view, and the place of the topic.
 * @param args.view - The page view.
 * @param args.topicIndex - The place of the topic in the lecture, from 0.
 * @returns The id, such as `topic-1` in the first view and `rewrite-topic-1` in the Rewrite view.
 */
function topicAnchor({
	view,
	topicIndex,
}: {
	readonly view: PageView;
	readonly topicIndex: number;
}): string {
	const anchor = `topic-${topicIndex + 1}`;
	return view === FIRST_VIEW ? anchor : `${view}-${anchor}`;
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
 * Gives several slides, each as a small figure.
 *
 * @param args - The slides, and the slide readings.
 * @param args.slides - The slides, in deck order.
 * @param args.readings - The slide readings of the notes.
 * @returns The HTML of the figures.
 */
function figuresHtml({
	slides,
	readings,
}: {
	readonly slides: readonly RelocatedSlide[];
	readonly readings: readonly SlideReading[];
}): string {
	return slides.map((slide) => figureHtml({ slide, readings })).join("");
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

/** The text of one paragraph, its slides, and whether the sentence of each slide has a highlight. */
type SlidesInParagraph = {
	readonly paragraph: string;
	/** The slides of the paragraph, in deck order. */
	readonly slides: readonly RelocatedSlide[];
	readonly readings: readonly SlideReading[];
	readonly highlight: boolean;
};

/**
 * Gives one paragraph, with each of its slides at its point. The Notes view
 * highlights the sentence of each slide. A slide at the end of the paragraph has
 * no sentence, so it gets no highlight.
 *
 * @param args - The paragraph, its slides, the slide readings, and the highlight.
 * @param args.paragraph - The text of the paragraph.
 * @param args.slides - The slides of the paragraph, in deck order.
 * @param args.readings - The slide readings of the notes.
 * @param args.highlight - `true` when the sentence of each slide has a highlight.
 * @returns The HTML of the paragraph.
 */
function paragraphHtml({ paragraph, slides, readings, highlight }: SlidesInParagraph): string {
	// A slide at the end of the paragraph has no sentence to highlight. The
	// references slide is one such slide. It floats from the paragraph's start, so
	// it shows next to the paragraph and not below it.
	const isAtEnd = (slide: RelocatedSlide): boolean =>
		paragraph.slice(slide.characterOffset).trim() === "";
	let html = figuresHtml({ slides: slides.filter(isAtEnd), readings });
	let cursor = 0;
	const figures = slides.filter((slide) => !isAtEnd(slide));
	for (const [index, slide] of figures.entries()) {
		html += `${textHtml(paragraph.slice(cursor, slide.characterOffset))}${figureHtml({ slide, readings })}`;
		cursor = slide.characterOffset;
		if (!highlight) {
			continue;
		}
		const sentenceEnd = Math.min(
			sentenceEndAfter({ paragraph, offset: slide.characterOffset }),
			figures[index + 1]?.characterOffset ?? paragraph.length,
		);
		html += `<mark>${textHtml(paragraph.slice(cursor, sentenceEnd))}</mark>`;
		cursor = sentenceEnd;
	}
	return `<p>${html}${textHtml(paragraph.slice(cursor))}</p>`;
}

/**
 * Gives the paragraphs of one subtopic, each with its slides.
 *
 * @param args - The paragraphs, their slides, the slide readings, and the highlight.
 * @param args.paragraphs - The paragraphs of the subtopic.
 * @param args.slides - The slides of the subtopic, in deck order, at their points in the paragraphs.
 * @param args.readings - The slide readings of the notes.
 * @param args.highlight - `true` when the sentence of each slide has a highlight.
 * @returns The HTML of the paragraphs.
 */
function paragraphsHtml({
	paragraphs,
	slides,
	readings,
	highlight,
}: Omit<SlidesInParagraph, "paragraph"> & { readonly paragraphs: readonly string[] }): string {
	return [...paragraphs.entries()]
		.map(([index, paragraph]) =>
			paragraphHtml({
				paragraph,
				slides: slides.filter(({ paragraphIndex }) => paragraphIndex === index),
				readings,
				highlight,
			}),
		)
		.join("\n");
}

/**
 * Checks that a compared word is a word of the notes at or after a point in the
 * notes, such as the point of a slide.
 *
 * @param args - The compared word, and the point.
 * @param args.word - The compared word.
 * @param args.from - The point in the paragraphs of the notes.
 * @returns `true` when the notes have the word, and the word is not before `from`.
 */
function isNotesWordAtOrAfter({
	word,
	from,
}: {
	readonly word: ComparedWord;
	readonly from: TextPoint;
}): boolean {
	if (word.change === "removed") {
		return false;
	}
	const { paragraphIndex, characterOffset } = word.after;
	return (
		paragraphIndex > from.paragraphIndex ||
		(paragraphIndex === from.paragraphIndex && characterOffset >= from.characterOffset)
	);
}

/**
 * Gives the point of each slide of the notes in the rewrite of its subtopic. A
 * slide goes in front of the first rewrite word that the word comparison links
 * to a notes word at or after the slide. A slide with no such word goes at the
 * end of the rewrite.
 *
 * @param args - The rewrite, and the entry of the subtopic in the slide relocations.
 * @param args.rewrite - The paragraphs of the rewrite.
 * @param args.relocation - The paragraphs and the slides of the notes.
 * @returns The slides at their points in the rewrite, in deck order.
 */
function slidesInRewrite({
	rewrite,
	relocation,
}: {
	readonly rewrite: readonly string[];
	readonly relocation: SubtopicSlideRelocation;
}): readonly RelocatedSlide[] {
	const lastIndex = rewrite.length - 1;
	const end: TextPoint = {
		paragraphIndex: lastIndex,
		characterOffset: rewrite[lastIndex]?.length ?? 0,
	};
	const linked = compareWords({ before: rewrite, after: relocation.paragraphs }).flatMap((word) =>
		word.change === "unchanged" ? [word] : [],
	);
	return relocation.slides.map((slide) => ({
		...slide,
		...(linked.find((word) => isNotesWordAtOrAfter({ word, from: slide }))?.before ?? end),
	}));
}

/** One word that a page view shows from a word comparison, with its paragraph and the slides in front of it. */
type ShownWord = {
	readonly word: string;
	readonly change: WordChange;
	readonly paragraphIndex: number;
	readonly slides: readonly RelocatedSlide[];
	/** The text that shows when the mouse rests on the word, or null when the word has none. */
	readonly note: string | null;
};

/**
 * Gives the words that a page view shows from a word comparison. A word that the
 * comparison links to a notes word shows in the paragraph of that notes word. A
 * removed word shows in the paragraph of the word before it.
 *
 * @param args - The compared words, the marks that the view shows, the slides, and the notes.
 * @param args.compared - The words of the comparison, in reading order.
 * @param args.shown - The marks of the words that the view shows.
 * @param args.slidesInFront - Gives the slides in front of a compared word, from its place in `compared`.
 * @param args.noteOf - Gives the note of a compared word, from its place in `compared`, or null when it has none.
 * @returns The shown words, in reading order, each with its paragraph, its slides and its note.
 */
function shownWords({
	compared,
	shown,
	slidesInFront,
	noteOf,
}: {
	readonly compared: readonly ComparedWord[];
	readonly shown: readonly WordChange[];
	readonly slidesInFront: (comparedIndex: number) => readonly RelocatedSlide[];
	readonly noteOf: (comparedIndex: number) => string | null;
}): readonly ShownWord[] {
	const words: ShownWord[] = [];
	let paragraphIndex = 0;
	for (const [comparedIndex, word] of compared.entries()) {
		if (word.change !== "removed") {
			paragraphIndex = word.after.paragraphIndex;
		}
		if (shown.includes(word.change)) {
			words.push({
				word: word.word,
				change: word.change,
				paragraphIndex,
				slides: slidesInFront(comparedIndex),
				note: noteOf(comparedIndex),
			});
		}
	}
	return words;
}

/** A run of shown words with one mark and one note, as HTML, and the note. */
type MarkedRun = { readonly html: string; readonly note: string | null };

/** The HTML that wraps a run of shown words with one mark, in one page view. */
type MarkHtml = Readonly<Record<WordChange, (run: MarkedRun) => string>>;

/** The words that one page view shows of one subtopic, and how the view shows them. */
type ShownText = {
	readonly words: readonly ShownWord[];
	readonly markHtml: MarkHtml;
	readonly readings: readonly SlideReading[];
	/** The slides after the last word. They float from the start of the last paragraph. */
	readonly slidesAtEnd: readonly RelocatedSlide[];
};

/**
 * Gives one paragraph of shown words. Each run of words with the same mark is
 * wrapped once. A slide breaks the run of the word that it stands in front of.
 *
 * @param args - The shown words of the paragraph, the HTML of each mark, and the slides.
 * @param args.words - The shown words of the paragraph, in reading order.
 * @param args.markHtml - Wraps a run of words with one mark.
 * @param args.readings - The slide readings of the notes.
 * @param args.slidesAtStart - The slides that float from the start of the paragraph, such as a slide after the last word.
 * @returns The HTML of the paragraph.
 */
function shownParagraphHtml({
	words,
	markHtml,
	readings,
	slidesAtStart,
}: Omit<ShownText, "slidesAtEnd"> & { readonly slidesAtStart: readonly RelocatedSlide[] }): string {
	let html = figuresHtml({ slides: slidesAtStart, readings });
	let run: string[] = [];
	let runWord: ShownWord | undefined;
	const closeRun = (): void => {
		if (runWord !== undefined && run.length > 0) {
			const runHtml = textHtml(run.join(" "));
			html += `${markHtml[runWord.change]({ html: runHtml, note: runWord.note })} `;
		}
		run = [];
	};
	for (const shownWord of words) {
		if (
			shownWord.change !== runWord?.change ||
			shownWord.note !== runWord.note ||
			shownWord.slides.length > 0
		) {
			closeRun();
			runWord = shownWord;
		}
		html += figuresHtml({ slides: shownWord.slides, readings });
		run.push(shownWord.word);
	}
	closeRun();
	return `<p>${html.trimEnd()}</p>`;
}

/**
 * Gives the paragraphs of the shown words of one subtopic.
 *
 * @param text - The shown words, the HTML of each mark, the slide readings, and the slides at the end.
 * @param text.words - The shown words, in reading order.
 * @param text.markHtml - Wraps a run of words with one mark.
 * @param text.readings - The slide readings of the notes.
 * @param text.slidesAtEnd - The slides after the last word.
 * @returns The HTML of the paragraphs.
 */
function shownParagraphsHtml({ words, markHtml, readings, slidesAtEnd }: ShownText): string {
	const paragraphIndexes = [...new Set(words.map(({ paragraphIndex }) => paragraphIndex))];
	const lastIndex = paragraphIndexes.at(-1);
	return paragraphIndexes
		.map((index) =>
			shownParagraphHtml({
				words: words.filter(({ paragraphIndex }) => paragraphIndex === index),
				markHtml,
				readings,
				slidesAtStart: index === lastIndex ? slidesAtEnd : [],
			}),
		)
		.join("\n");
}

/**
 * The marks of the Transcript view. A spoken word that the notes do not have
 * gets a red highlight with no line. The view does not show an added word.
 */
const TRANSCRIPT_MARKS: MarkHtml = {
	unchanged: ({ html }) => html,
	removed: ({ html }) => `<span class="not-in-notes">${html}</span>`,
	added: ({ html }) => html,
};

/** The texts and the slides of one subtopic, from each input of the page. */
type SubtopicSources = {
	/** The entry of the subtopic in `slide-relocations.json`: the notes and their slides. */
	readonly relocation: SubtopicSlideRelocation | undefined;
	readonly rewrite: readonly string[];
	/** The term-corrected text. */
	readonly correctedText: string;
	/** The text of the subtopic in the structured transcript. */
	readonly structuredText: string;
	readonly factCorrection: SubtopicFactCorrection | undefined;
	/** The placements of `place-slides` in the subtopic, each with its slide as the notes show it. */
	readonly placedSlides: readonly {
		readonly slide: RelocatedSlide;
		readonly positionInSubtopic: number;
	}[];
	readonly readings: readonly SlideReading[];
};

/**
 * Finds the entry of a subtopic in a list of entries of the lecture.
 *
 * @param args - The entries, and the subtopic.
 * @param args.entries - The entries, each with its subtopic id.
 * @param args.subtopicId - The subtopic.
 * @returns The entry, or `undefined` when the list has none.
 * @typeParam TEntry - The entry.
 */
function entryOf<TEntry extends { readonly subtopicId: number }>({
	entries,
	subtopicId,
}: {
	readonly entries: readonly TEntry[];
	readonly subtopicId: number;
}): TEntry | undefined {
	return entries.find((entry) => entry.subtopicId === subtopicId);
}

/**
 * Gives the texts and the slides of one subtopic from the content of the page.
 *
 * @param args - The content of the page, and the subtopic.
 * @param args.content - The content of the page.
 * @param args.subtopic - The subtopic of the structured transcript.
 * @returns The texts and the slides of the subtopic.
 */
function subtopicSources({
	content,
	subtopic,
}: {
	readonly content: NotesPageContent;
	readonly subtopic: TopicWithSubtopics["subtopics"][number];
}): SubtopicSources {
	const { subtopicId } = subtopic;
	const relocated = content.slideRelocations.flatMap(({ slides }) => slides);
	return {
		relocation: entryOf({ entries: content.slideRelocations, subtopicId }),
		rewrite: entryOf({ entries: content.subtopicRewrites, subtopicId })?.rewrittenSubtopic ?? [],
		correctedText: entryOf({ entries: content.termCorrections, subtopicId })?.correctedText ?? "",
		structuredText: subtopic.text,
		factCorrection: entryOf({ entries: content.factCorrections, subtopicId }),
		placedSlides: content.slidePlacements
			.filter((placement) => placement.subtopicId === subtopicId)
			.flatMap(({ slideNumber, positionInSubtopic }) => {
				const slide = relocated.find((entry) => entry.slideNumber === slideNumber);
				return slide === undefined ? [] : [{ slide, positionInSubtopic }];
			}),
		readings: content.slideReadings,
	};
}

/** Gives the HTML of the text of one subtopic in one page view. */
type SubtopicBody = (sources: SubtopicSources) => string;

/**
 * Gives the section of one topic, with the section of each of its subtopics.
 *
 * @param args - The topic, its section id, and the text of each subtopic.
 * @param args.topic - The topic.
 * @param args.anchor - The id of the topic's section.
 * @param args.subtopicBody - Gives the HTML of the text of a subtopic.
 * @param args.content - The content of the page.
 * @returns The HTML of the topic.
 */
function topicHtml({
	topic,
	anchor,
	subtopicBody,
	content,
}: {
	readonly topic: TopicWithSubtopics;
	readonly anchor: string;
	readonly subtopicBody: SubtopicBody;
	readonly content: NotesPageContent;
}): string {
	const subtopics = topic.subtopics.map(
		(subtopic) => `<section class="subtopic">
<h3>${escapeHtml(subtopic.title)}</h3>
${subtopicBody(subtopicSources({ content, subtopic }))}
</section>`,
	);
	return `<section class="topic" id="${anchor}">
<h2>${escapeHtml(topic.title)}</h2>
${subtopics.join("\n")}
</section>`;
}

/** The text of a subtopic in each page view. */
const SUBTOPIC_BODIES: Readonly<Record<PageView, SubtopicBody>> = {
	notes: ({ relocation, readings }) =>
		relocation === undefined ? "" : paragraphsHtml({ ...relocation, readings, highlight: true }),
	rewrite: ({ rewrite, relocation, readings }) => {
		const slides =
			relocation === undefined || rewrite.length === 0
				? []
				: slidesInRewrite({ rewrite, relocation });
		return paragraphsHtml({ paragraphs: rewrite, slides, readings, highlight: false });
	},
	corrections: (sources) => shownParagraphsHtml(correctionsText(sources)),
	transcript: (sources) => shownParagraphsHtml(transcriptText(sources)),
};

/**
 * The marks of the Corrections view. A word that is only in the rewrite is red,
 * with a line through it. A word that is only in the notes is green.
 */
const CORRECTIONS_MARKS: MarkHtml = {
	unchanged: ({ html }) => html,
	removed: ({ html, note }) => `<del${noteAttribute(note)}>${html}</del>`,
	added: ({ html, note }) => `<ins${noteAttribute(note)}>${html}</ins>`,
};

/**
 * Gives the attribute that shows a note when the mouse rests on an element.
 *
 * @param note - The note, or null when the element has none.
 * @returns The `title` attribute with a space in front, or an empty text.
 */
function noteAttribute(note: string | null): string {
	return note === null ? "" : ` title="${escapeHtml(note)}"`;
}

/**
 * Gives the note of each word of a word comparison of the Corrections view. A
 * run of removed and added words between two unchanged words takes the note of
 * the first reported change whose `before` holds the removed words and whose
 * `after` holds the added words. The note is the problem of the change's factual
 * error.
 *
 * @param args - The compared words, and the fact correction of the subtopic.
 * @param args.compared - The words of the comparison, in reading order.
 * @param args.factCorrection - The factual errors and the reported changes of the subtopic, or `undefined` when it has none.
 * @returns The note of each compared word, by its place in `compared`, or null.
 */
function changeNotes({
	compared,
	factCorrection,
}: {
	readonly compared: readonly ComparedWord[];
	readonly factCorrection: SubtopicFactCorrection | undefined;
}): readonly (string | null)[] {
	const notes: (string | null)[] = [];
	let start = 0;
	while (start < compared.length) {
		let end = start;
		while (compared[end] !== undefined && compared[end]?.change !== "unchanged") {
			end += 1;
		}
		const run = compared.slice(start, end);
		const wordsOf = (change: WordChange): readonly string[] =>
			run.filter((word) => word.change === change).map(({ word }) => word);
		const change = factCorrection?.changes.find(
			({ before, after }) =>
				holdsWordRun({ text: before, words: wordsOf("removed") }) &&
				holdsWordRun({ text: after, words: wordsOf("added") }),
		);
		const note =
			change === undefined
				? null
				: (factCorrection?.factualErrors[change.factualError - 1]?.problem ?? null);
		notes.push(...run.map(() => note), null);
		start = end + 1;
	}
	return notes;
}

/**
 * Gives the words that the Corrections view shows of one subtopic, with its
 * slides. The view compares the rewrite with the notes. Each slide goes in front
 * of the first notes word at or after its point in the notes.
 *
 * @param sources - The texts and the slides of the subtopic.
 * @param sources.relocation - The notes and their slides.
 * @param sources.rewrite - The paragraphs of the rewrite.
 * @param sources.factCorrection - The factual errors and the reported changes.
 * @param sources.readings - The slide readings of the notes.
 * @returns The shown words and how the view shows them.
 */
function correctionsText({
	relocation,
	rewrite,
	factCorrection,
	readings,
}: SubtopicSources): ShownText {
	const compared = compareWords({ before: rewrite, after: relocation?.paragraphs ?? [] });
	const placed = (relocation?.slides ?? []).map((slide) => ({
		slide,
		comparedIndex: compared.findIndex((word) => isNotesWordAtOrAfter({ word, from: slide })),
	}));
	const notes = changeNotes({ compared, factCorrection });
	return {
		words: shownWords({
			compared,
			shown: ["unchanged", "removed", "added"],
			slidesInFront: (index) =>
				placed.filter(({ comparedIndex }) => comparedIndex === index).map(({ slide }) => slide),
			noteOf: (index) => notes[index] ?? null,
		}),
		markHtml: CORRECTIONS_MARKS,
		readings,
		slidesAtEnd: placed.filter(({ comparedIndex }) => comparedIndex < 0).map(({ slide }) => slide),
	};
}

/**
 * Gives the words that the Transcript view shows of one subtopic, with its
 * slides. The view compares the term-corrected text with the notes. Each slide
 * goes in front of the spoken word whose number is the number of words in front
 * of the slide's point in the text of the structured transcript.
 *
 * @param sources - The texts and the slides of the subtopic.
 * @param sources.relocation - The notes and their slides.
 * @param sources.correctedText - The term-corrected text.
 * @param sources.structuredText - The text of the subtopic in the structured transcript.
 * @param sources.placedSlides - The placed slides of the subtopic.
 * @param sources.readings - The slide readings of the notes.
 * @returns The shown words and how the view shows them.
 */
function transcriptText({
	relocation,
	correctedText,
	structuredText,
	placedSlides,
	readings,
}: SubtopicSources): ShownText {
	const compared = compareWords({
		before: [correctedText],
		after: relocation?.paragraphs ?? [],
	});
	const placed = placedSlides.map(({ slide, positionInSubtopic }) => ({
		slide,
		wordNumber: splitWords(structuredText.slice(0, positionInSubtopic)).length,
	}));
	// The place in `compared` of each spoken word, by its number in the spoken text.
	const spokenIndexes = [...compared.entries()]
		.filter(([, word]) => word.change !== "added")
		.map(([comparedIndex]) => comparedIndex);
	return {
		words: shownWords({
			compared,
			shown: ["unchanged", "removed"],
			slidesInFront: (comparedIndex) =>
				placed
					.filter(({ wordNumber }) => spokenIndexes[wordNumber] === comparedIndex)
					.map(({ slide }) => slide),
			noteOf: () => null,
		}),
		markHtml: TRANSCRIPT_MARKS,
		readings,
		slidesAtEnd: placed
			.filter(({ wordNumber }) => wordNumber >= spokenIndexes.length)
			.map(({ slide }) => slide),
	};
}

/**
 * Gives one page view: the section of each topic, with the text of the view.
 *
 * @param args - The content of the page, and the view.
 * @param args.content - The content of the page.
 * @param args.view - The page view.
 * @returns The HTML of the view.
 */
function pageViewHtml({
	content,
	view,
}: {
	readonly content: NotesPageContent;
	readonly view: PageView;
}): string {
	const sections = [...content.topics.entries()].map(([topicIndex, topic]) =>
		topicHtml({
			topic,
			anchor: topicAnchor({ view, topicIndex }),
			subtopicBody: SUBTOPIC_BODIES[view],
			content,
		}),
	);
	return `<div class="view" id="${view}-view">
${sections.join("\n")}
</div>`;
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
		([topicIndex, topic]) =>
			`<li><a href="#${topicAnchor({ view: FIRST_VIEW, topicIndex })}">${escapeHtml(topic.title)}</a></li>`,
	);
	return `<header>
<p class="eyebrow">${escapeHtml(content.lectureDate)}</p>
<h1>${escapeHtml(content.lectureTitle)}</h1>
${viewSwitchHtml()}
${PAGE_VIEWS.map(({ view, legend }) => `<p class="legend" id="${view}-legend">${legend}</p>`).join("\n")}
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
	const views = PAGE_VIEWS.map(({ view }) => pageViewHtml({ content, view }));
	return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(content.lectureTitle)}</title>
<style>${NOTES_PAGE_STYLE}${viewStyle()}</style>
</head>
<body>
<div class="page">
${headerHtml(content)}
<main>
${views.join("\n")}
</main>
</div>
<dialog id="enlarged" aria-label="Enlarged slide"><button class="close" type="button">Close</button><img alt=""><span class="figure-text"></span></dialog>
<script>${NOTES_PAGE_SCRIPT}</script>
</body>
</html>
`;
}
