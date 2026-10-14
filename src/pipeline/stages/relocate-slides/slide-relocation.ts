/**
 * The checks and the text changes of `relocate-slides`. This module makes no
 * model call (technical-design.md §5, "After the fact correction").
 */

import { inAscendingOrder } from "../../../utils/sort.js";
import { findStartWords } from "../division.js";
import type { SlidePlacement } from "../slide-placements.js";
import {
	figureLabel,
	type RelocatedSlide,
	type SlideRelocation,
	type TextPoint,
} from "../slide-relocations.js";
import { findSlideReading, isReferences, isSubjectMatter, type SlideReading } from "../slides.js";
import { SLIDE_RELOCATION_PROMPT_VERSION } from "./relocate-slides.prompt.js";

/** The point of one slide in the paragraphs of its subtopic. */
export type SlidePoint = TextPoint & { readonly slideNumber: number };

/** One slide of a reply, in the words of the reply. */
type ReplySlide = { readonly slide: number; readonly startWords: string };

/** One figure mark of a reply, in the words of the reply. `slide` is null when the mark points at no slide. */
type ReplyMark = { readonly mark: number; readonly slide: number | null };

/** The reply that the slide relocation prompt asks for. */
export type SlideRelocationReply = {
	readonly slides: readonly ReplySlide[];
	readonly figureMarks: readonly ReplyMark[];
};

/** The slide of each figure mark of a subtopic, in mark order, or null when the mark points at no slide. */
export type MarkSlides = readonly (number | null)[];

/** The point of each slide, and the slide of each figure mark. */
export type SlidePoints = {
	readonly points: readonly SlidePoint[];
	readonly markSlides: MarkSlides;
};

/**
 * Finds start words in the paragraphs, from the first paragraph.
 *
 * @param args - The paragraphs, and the start words.
 * @param args.paragraphs - The paragraphs of the subtopic.
 * @param args.startWords - The start words from the reply.
 * @returns The first point that holds the words, or `null` when no paragraph holds them.
 */
function findInParagraphs({
	paragraphs,
	startWords,
}: {
	readonly paragraphs: readonly string[];
	readonly startWords: string;
}): TextPoint | null {
	for (const [paragraphIndex, text] of paragraphs.entries()) {
		const characterOffset = findStartWords({ text, startWords });
		if (characterOffset !== null) {
			return { paragraphIndex, characterOffset };
		}
	}
	return null;
}

/**
 * Gives the point of each slide and the slide of each figure mark, or the reason
 * that the reply is unusable.
 *
 * @param args - The paragraphs and the slides that the model got, and its reply.
 * @param args.paragraphs - The paragraphs of the subtopic, with numbered figure marks.
 * @param args.slideNumbers - The slides that the model got, in deck order.
 * @param args.reply - The parsed reply, with the documented shape.
 * @returns The points in deck order and the slide of each mark, or the reason that the reply is unusable.
 */
export function usableSlidePoints({
	paragraphs,
	slideNumbers,
	reply,
}: {
	readonly paragraphs: readonly string[];
	readonly slideNumbers: readonly number[];
	readonly reply: SlideRelocationReply;
}): { readonly reply: SlidePoints } | { readonly failure: string } {
	const markPoints = numberedMarkPoints(paragraphs);
	const markAnswers = [...markPoints.keys()].map((index) =>
		reply.figureMarks.find(({ mark }) => mark === index + 1),
	);
	const unanswered = markAnswers.indexOf(undefined);
	if (unanswered !== -1) {
		return {
			failure: `The model's reply gives no slide or null for figure mark ${unanswered + 1}`,
		};
	}
	const markSlides = markAnswers.map((answer) => answer?.slide ?? null);
	const unknown = [...reply.slides.map(({ slide }) => slide), ...markSlides].find(
		(slide) => slide !== null && !slideNumbers.includes(slide),
	);
	if (unknown !== undefined) {
		return {
			failure: `The model's reply names slide ${unknown}, which is not a slide of the subtopic`,
		};
	}
	const points: SlidePoint[] = [];
	for (const slideNumber of slideNumbers) {
		const answers = reply.slides.filter(({ slide }) => slide === slideNumber);
		const [answer] = answers;
		if (answers.length !== 1 || answer === undefined) {
			return {
				failure: `The model's reply gives slide ${slideNumber} ${answers.length} points, not one`,
			};
		}
		const found = findInParagraphs({ paragraphs, startWords: answer.startWords });
		if (found === null) {
			return {
				failure: `The model's start words "${answer.startWords}" for slide ${slideNumber} are not in the subtopic`,
			};
		}
		const onlyMark = onlyMarkOf({ markSlides, slideNumber });
		const point = { slideNumber, ...(markPoints[onlyMark ?? -1] ?? found) };
		const previous = points.at(-1);
		if (previous !== undefined && isEarlier({ point, than: previous })) {
			return {
				failure: `The model's reply puts slide ${slideNumber} earlier in the subtopic than the slide before it`,
			};
		}
		points.push(point);
	}
	return { reply: { points, markSlides } };
}

/**
 * Checks that a point is earlier in the subtopic than another: in an earlier
 * paragraph, or in the same paragraph at a smaller offset. The `isEarlier` of
 * `place-slides` compares a subtopic and a position in the transcript. A shared
 * helper would need an adapter on each side, so the two functions stay apart.
 *
 * @param args - The two points.
 * @param args.point - The point to test.
 * @param args.than - The point to compare it with.
 * @returns `true` when `point` is earlier than `than`.
 */
function isEarlier({
	point,
	than,
}: {
	readonly point: TextPoint;
	readonly than: TextPoint;
}): boolean {
	return (
		point.paragraphIndex < than.paragraphIndex ||
		(point.paragraphIndex === than.paragraphIndex && point.characterOffset < than.characterOffset)
	);
}

/** A numbered figure mark, as the model gets it, such as "[FIGURE 2]". */
const NUMBERED_MARK = /\[FIGURE (\d+)\]/gu;

/**
 * Gives the point of each numbered figure mark, in mark order.
 *
 * @param paragraphs - The paragraphs of the subtopic, with numbered figure marks.
 * @returns The point of each mark.
 */
function numberedMarkPoints(paragraphs: readonly string[]): readonly TextPoint[] {
	return [...paragraphs.entries()].flatMap(([paragraphIndex, text]) =>
		[...text.matchAll(NUMBERED_MARK)].map((match) => ({
			paragraphIndex,
			characterOffset: match.index,
		})),
	);
}

/**
 * Gives the index of the one figure mark that points at a slide.
 *
 * @param args - The slide of each mark, and the slide.
 * @param args.markSlides - The slide of each figure mark.
 * @param args.slideNumber - The slide.
 * @returns The index of the mark, or `null` when no mark or two or more marks point at the slide.
 */
function onlyMarkOf({
	markSlides,
	slideNumber,
}: {
	readonly markSlides: MarkSlides;
	readonly slideNumber: number;
}): number | null {
	const first = markSlides.indexOf(slideNumber);
	return first !== -1 && markSlides.lastIndexOf(slideNumber) === first ? first : null;
}

/** One fact-corrected subtopic: its id and its paragraphs. */
export type FactCorrectedParagraphs = {
	readonly subtopicId: number;
	readonly paragraphs: readonly string[];
};

/** The input of `relocate-slides`. */
export type SlideRelocationInput = {
	/** The paragraphs of each fact-corrected subtopic, in lecture order. */
	readonly subtopics: readonly FactCorrectedParagraphs[];
	/** The placements that `place-slides` wrote, in deck order. */
	readonly placements: readonly SlidePlacement[];
	/** The reading of each placed slide. */
	readonly readings: readonly SlideReading[];
};

/** The slides that one subtopic shows. Each list is in deck order, with the references slide last. */
export type ShownSlides = {
	/** The slides of the subtopic that its call relocates. The references slide is not one of them. */
	readonly slidesForModel: readonly SlideReading[];
	/** The slides at the start of the first paragraph: the slides of earlier subtopics with no paragraph. */
	readonly slidesAtStart: readonly number[];
	/** The slides at the end of the last paragraph: the references slide, and the slides of later subtopics with no paragraph. */
	readonly slidesAtEnd: readonly number[];
};

/**
 * Gives the slides that each subtopic shows. A subtopic with no paragraph shows
 * no slide. Its slides go to the end of the nearest earlier subtopic with a
 * paragraph. If no earlier subtopic has a paragraph, they go to the start of the
 * nearest later one (technical-design.md §5, `relocate-slides`).
 *
 * @param args - The input of the stage.
 * @param args.subtopics - The fact-corrected subtopics, in lecture order.
 * @param args.placements - The placements that `place-slides` wrote, in deck order.
 * @param args.readings - The reading of each placed slide.
 * @returns The slides of each subtopic, by subtopic id.
 */
export function shownSlidesBySubtopic({
	subtopics,
	placements,
	readings,
}: SlideRelocationInput): ReadonlyMap<number, ShownSlides> {
	const shown = new Map<number, ShownSlides>();
	let lastWithParagraph: (ShownSlides & { readonly slidesAtEnd: number[] }) | undefined;
	// The slides of the subtopics with no paragraph before the first subtopic with one.
	const beforeFirstParagraph: number[] = [];
	for (const { subtopicId, paragraphs } of subtopics) {
		const placed = placements.flatMap((placement) => {
			const reading = findSlideReading({
				slideReadings: readings,
				slideNumber: placement.slideNumber,
			});
			return placement.subtopicId === subtopicId && reading !== undefined ? [reading] : [];
		});
		const slides = placed.filter((reading) => !isReferences(reading));
		const references = placed.filter(isReferences).map(({ slideNumber }) => slideNumber);
		if (paragraphs.length === 0) {
			shown.set(subtopicId, { slidesForModel: [], slidesAtStart: [], slidesAtEnd: [] });
			(lastWithParagraph?.slidesAtEnd ?? beforeFirstParagraph).push(
				...slides.map(({ slideNumber }) => slideNumber),
				...references,
			);
			continue;
		}
		lastWithParagraph = {
			slidesForModel: slides,
			slidesAtStart: lastWithParagraph === undefined ? beforeFirstParagraph : [],
			slidesAtEnd: references,
		};
		shown.set(subtopicId, lastWithParagraph);
	}
	return shown;
}

/**
 * Gives each subject-matter slide its figure number, from 1, in deck order
 * (CONTEXT.md, "Figure number"). A references slide or a content-free slide gets no number.
 *
 * @param readings - The reading of each placed slide, in any order.
 * @returns The figure number of each subject-matter slide, by slide number.
 */
export function figureNumbersOf(readings: readonly SlideReading[]): FigureNumbers {
	const numbered = readings
		.filter(isSubjectMatter)
		.map(({ slideNumber }) => slideNumber)
		.sort(inAscendingOrder);
	return Object.fromEntries(
		[...numbered.entries()].map(([index, slideNumber]) => [slideNumber, index + 1]),
	);
}

/** The figure number of each slide, by slide number. A slide with no figure number is not a key. */
export type FigureNumbers = Readonly<Record<number, number>>;

/** The figure mark that the writer puts in the notes (CONTEXT.md, "Figure mark"). */
const FIGURE_MARK = "[FIGURE]";

/**
 * Gives each figure mark of a subtopic its number, from 1, in text order, such as
 * "[FIGURE 2]". The model names each mark by its number.
 *
 * @param paragraphs - The fact-corrected paragraphs of the subtopic.
 * @returns The paragraphs with numbered figure marks.
 */
export function numberFigureMarks(paragraphs: readonly string[]): readonly string[] {
	let count = 0;
	return paragraphs.map((text) =>
		text.replaceAll(FIGURE_MARK, () => {
			count += 1;
			return `[FIGURE ${count}]`;
		}),
	);
}

/** The change in length that one replaced mark makes to the text after it. */
type LengthChange = {
	/** The offset of the mark before the change. */
	readonly markOffset: number;
	/** The total change in length of the paragraph up to the end of this mark. */
	readonly totalChange: number;
};

/**
 * Writes one paragraph with the figure number of its slide in place of each
 * numbered mark, or "[FIGURE]" when the mark points at no slide.
 *
 * @param args - The paragraph, and the slide and figure number of each mark.
 * @param args.text - The paragraph, with numbered figure marks.
 * @param args.markSlides - The slide of each figure mark of the subtopic.
 * @param args.figureNumbers - The figure number of each slide, by slide number.
 * @returns The written paragraph, the length change of each mark, and the offset of each mark that points at no slide.
 */
function writeParagraph({
	text,
	markSlides,
	figureNumbers,
}: {
	readonly text: string;
	readonly markSlides: MarkSlides;
	readonly figureNumbers: FigureNumbers;
}): {
	readonly written: string;
	readonly changes: readonly LengthChange[];
	readonly marksWithNoSlide: readonly number[];
} {
	const changes: LengthChange[] = [];
	const marksWithNoSlide: number[] = [];
	let totalChange = 0;
	const written = text.replace(
		NUMBERED_MARK,
		// eslint-disable-next-line max-params -- the specification sets the parameters of the replacer of String.prototype.replace.
		(mark: string, markNumber: string, markOffset: number) => {
			const slide = markSlides[Number(markNumber) - 1] ?? null;
			const figureNumber = slide === null ? undefined : figureNumbers[slide];
			const replacement =
				figureNumber === undefined ? FIGURE_MARK : `(${figureLabel(figureNumber)})`;
			if (figureNumber === undefined) {
				marksWithNoSlide.push(markOffset + totalChange);
			}
			totalChange += replacement.length - mark.length;
			changes.push({ markOffset, totalChange });
			return replacement;
		},
	);
	return { written, changes, marksWithNoSlide };
}

/**
 * Writes the file of one subtopic. Each figure mark that points at a slide gets the
 * slide's figure number, as "(Figure N)". A mark that points at no slide becomes
 * "[FIGURE]" again. Each point moves with the text. The slides at the start go
 * before the first sentence, and the slides at the end go after the last sentence.
 *
 * @param args - The subtopic, the paragraphs, and what the reply and the lecture give.
 * @param args.subtopicId - The subtopic.
 * @param args.paragraphs - The paragraphs of the subtopic, with numbered figure marks.
 * @param args.points - The point of each slide in `paragraphs`, in deck order, from {@link usableSlidePoints}.
 * @param args.markSlides - The slide of each figure mark.
 * @param args.figureNumbers - The figure number of each slide, by slide number.
 * @param args.slidesAtStart - The slides at the start of the first paragraph, from {@link shownSlidesBySubtopic}.
 * @param args.slidesAtEnd - The slides at the end of the last paragraph, from {@link shownSlidesBySubtopic}.
 * @returns The file of the subtopic.
 */
export function writeSlideRelocation({
	subtopicId,
	paragraphs,
	points,
	markSlides,
	figureNumbers,
	slidesAtStart,
	slidesAtEnd,
}: SlidePoints &
	Pick<ShownSlides, "slidesAtStart" | "slidesAtEnd"> & {
		readonly subtopicId: number;
		readonly paragraphs: readonly string[];
		readonly figureNumbers: FigureNumbers;
	}): SlideRelocation {
	const written = paragraphs.map((text) => writeParagraph({ text, markSlides, figureNumbers }));
	// Each point is in `paragraphs`, so its paragraph index is the index of a written paragraph.
	const moved = ({ paragraphIndex, characterOffset }: TextPoint): number =>
		characterOffset +
		((written[paragraphIndex] as (typeof written)[number]).changes
			.filter(({ markOffset }) => markOffset < characterOffset)
			.at(-1)?.totalChange ?? 0);
	const lastIndex = written.length - 1;
	const atPoint =
		(point: TextPoint) =>
		(slideNumber: number): RelocatedSlide => ({
			slideNumber,
			...point,
			figureNumber: figureNumbers[slideNumber] ?? null,
		});
	return {
		subtopicId,
		slideRelocationPromptVersion: SLIDE_RELOCATION_PROMPT_VERSION,
		paragraphs: written.map((paragraph) => paragraph.written),
		slides: [
			...slidesAtStart.map(atPoint({ paragraphIndex: 0, characterOffset: 0 })),
			...points.map((point) =>
				atPoint({ ...point, characterOffset: moved(point) })(point.slideNumber),
			),
			...slidesAtEnd.map(
				atPoint({
					paragraphIndex: lastIndex,
					characterOffset: written[lastIndex]?.written.length ?? 0,
				}),
			),
		],
		figureMarksWithNoSlide: [...written.entries()].flatMap(([paragraphIndex, paragraph]) =>
			paragraph.marksWithNoSlide.map((characterOffset) => ({ paragraphIndex, characterOffset })),
		),
	};
}
