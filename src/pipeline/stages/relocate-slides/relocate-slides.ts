/**
 * The `relocate-slides` stage. It moves each placed slide to the start of a
 * sentence in its fact-corrected subtopic. It also writes the figure number of
 * each slide in the text (technical-design.md §5, "After the fact correction").
 */

/* jscpd:ignore-start -- the modules of the fact-check stages import the same
   pipeline types and shared helpers. So their import blocks are the same line
   for line. Imports cannot be shared, and CLAUDE.md (File Organisation) forbids
   barrel files. Only the imports are exempt. jscpd checks the code below. */
import type { StageContext } from "../../../types/pipeline.js";
import { NamedError } from "../../../utils/errors.js";
import { isNumberOrNull, isRecord } from "../../../utils/record.js";
import { readFactCorrections } from "../fact-corrections.js";
import { isSlideRelocation, type SlideRelocation } from "../slide-relocations.js";
import { readSlideReadings } from "../slides.js";
import { readStageSlidePlacements } from "../stage-input.js";
import { defineSubtopicAndLectureFileStage, type SubtopicWork } from "../subtopic-files.js";
/* jscpd:ignore-end */
import { buildSlideRelocationMessages } from "./relocate-slides.prompt.js";
import {
	type FactCorrectedParagraphs,
	type FigureNumbers,
	figureNumbersOf,
	numberFigureMarks,
	type ShownSlides,
	type SlideRelocationInput,
	type SlideRelocationReply,
	shownSlidesBySubtopic,
	usableSlidePoints,
	writeSlideRelocation,
} from "./slide-relocation.js";

/**
 * The error of the stage in three cases:
 * - an input file is missing or unreadable
 * - no subtopic has a paragraph
 * - a saved file of a subtopic holds nothing readable.
 */
export class RelocateSlidesError extends NamedError {}

const STAGE_ID = "relocate-slides";

/** The work on one subtopic: its paragraphs, the figure number of each slide, and the slides that it shows. */
type SubtopicSlideRelocation = FactCorrectedParagraphs & {
	readonly figureNumbers: FigureNumbers;
	readonly shownSlides: ShownSlides;
};

const DOCUMENTED_REPLY_SHAPE =
	"{ slides: [{ slide, startWords }], figureMarks: [{ mark, slide }] } object";

/**
 * Builds the stage's own error from a message.
 *
 * @param message - The message.
 * @returns The error.
 */
function fail(message: string): Error {
	return new RelocateSlidesError(message);
}

/**
 * Checks that a parsed reply has the shape that prompt r4 asks for.
 *
 * @param value - The parsed reply.
 * @returns `true` when the value is a {@link SlideRelocationReply}.
 */
function isSlideRelocationReply(value: unknown): value is SlideRelocationReply {
	return (
		isRecord(value) &&
		Array.isArray(value.slides) &&
		value.slides.every(
			(entry) =>
				isRecord(entry) && typeof entry.slide === "number" && typeof entry.startWords === "string",
		) &&
		Array.isArray(value.figureMarks) &&
		value.figureMarks.every(
			(entry) => isRecord(entry) && typeof entry.mark === "number" && isNumberOrNull(entry.slide),
		)
	);
}

/**
 * Reads the fact-corrected paragraphs of each subtopic, the slide placements and
 * the reading of each placed slide.
 *
 * @param context - The stage context.
 * @returns The input of the stage.
 * @throws {RelocateSlidesError} If an input file is missing, unreadable or the wrong shape, or if no subtopic has a paragraph.
 */
async function readSlideRelocationInput(context: StageContext): Promise<SlideRelocationInput> {
	const [{ factCorrectedSubtopics }, { placements }] = await Promise.all([
		readFactCorrections({ context, fail }),
		readStageSlidePlacements({ context, purpose: "relocate the slides", fail }),
	]);
	const subtopics = factCorrectedSubtopics.map(({ subtopicId, factCorrectedSubtopic }) => ({
		subtopicId,
		paragraphs: factCorrectedSubtopic,
	}));
	if (subtopics.every(({ paragraphs }) => paragraphs.length === 0)) {
		throw fail(
			"No subtopic of the lecture has a paragraph, so the notes have no place for the slides",
		);
	}
	const readings = await readSlideReadings({
		context,
		slideNumbers: placements.map(({ slideNumber }) => slideNumber),
		fail,
	});
	return { subtopics, placements, readings };
}

/**
 * Gives the work on each subtopic: its paragraphs, with the figure numbers of the
 * lecture and the slides that the subtopic shows.
 *
 * @param input - The input of the stage.
 * @returns The work on each subtopic, in lecture order.
 */
function subtopicSlideRelocations(input: SlideRelocationInput): readonly SubtopicSlideRelocation[] {
	const figureNumbers = figureNumbersOf(input.readings);
	const shown = shownSlidesBySubtopic(input);
	return input.subtopics.map((subtopic) => ({
		...subtopic,
		figureNumbers,
		// `shown` has an entry for each subtopic of `input.subtopics`.
		shownSlides: shown.get(subtopic.subtopicId) as ShownSlides,
	}));
}

/**
 * Relocates the slides of one subtopic. A subtopic with no slide for the model
 * gets no call.
 *
 * @param args - The subtopic, and the model calls of the stage run.
 * @param args.subtopic - The subtopic, its slides and the figure numbers of the lecture.
 * @param args.calls - The model calls of the stage run.
 * @returns The file of the subtopic.
 * @throws {ResendsExhaustedError} If the third send is still unusable.
 */
async function relocateSubtopicSlides({
	subtopic,
	calls,
}: Pick<
	SubtopicWork<SlideRelocationInput, SubtopicSlideRelocation>,
	"subtopic" | "calls"
>): Promise<SlideRelocation> {
	const paragraphs = numberFigureMarks(subtopic.paragraphs);
	const slides = subtopic.shownSlides.slidesForModel;
	// A mark with no entry in `markSlides` points at no slide.
	const slidePoints =
		slides.length === 0
			? { points: [], markSlides: [] }
			: (
					await calls.sendJsonWithResends({
						what: `Slide relocation of subtopic ${subtopic.subtopicId}`,
						messages: buildSlideRelocationMessages({ paragraphs, slides }),
						isReply: isSlideRelocationReply,
						documentedShape: DOCUMENTED_REPLY_SHAPE,
						use: (relocation) =>
							usableSlidePoints({
								paragraphs,
								slideNumbers: slides.map(({ slideNumber }) => slideNumber),
								reply: relocation,
							}),
					})
				).reply;
	return writeSlideRelocation({
		subtopicId: subtopic.subtopicId,
		paragraphs,
		...slidePoints,
		figureNumbers: subtopic.figureNumbers,
		slidesAtStart: subtopic.shownSlides.slidesAtStart,
		slidesAtEnd: subtopic.shownSlides.slidesAtEnd,
	});
}

/** Builds the `relocate-slides` stage from the logger and the OpenAI client of the invocation. */
export const createRelocateSlidesStage = defineSubtopicAndLectureFileStage({
	stageId: STAGE_ID,
	getInput: readSlideRelocationInput,
	subtopicsOf: subtopicSlideRelocations,
	isSaved: isSlideRelocation,
	saved: { content: "slide relocation", remake: "relocate the slides of the subtopic" },
	fail,
	make: relocateSubtopicSlides,
	key: "slideRelocations",
});
