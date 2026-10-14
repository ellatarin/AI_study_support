/**
 * The `relocate-slides` stage. It moves each placed slide to the start of a
 * sentence in its fact-corrected subtopic. It also writes the figure number of
 * each slide in the text (technical-design.md §5, "After the fact correction").
 * The stage is unlisted (`UnlistedStageRun` in `model-stage.ts`).
 */

/* jscpd:ignore-start -- the modules of the unlisted stages import the same
   pipeline types and shared helpers. So their import blocks are the same line
   for line. Imports cannot be shared, and CLAUDE.md (File Organisation) forbids
   barrel files. Only the imports are exempt. jscpd checks the code below. */
import { NamedError } from "../../../utils/errors.js";
import { isNumberOrNull, isRecord } from "../../../utils/record.js";
import { sendToStageModelWithResends, type UnlistedStageRun } from "../model-stage.js";
import {
	isSlideRelocation,
	type SlideRelocation,
	type SlideRelocations,
	slideRelocationsDirectory,
	slideRelocationsPath,
} from "../slide-relocations.js";
import { runUnlistedSubtopicFileStage } from "../subtopic-files.js";
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

/** The error of the stage when no subtopic has a paragraph, or when a saved file of a subtopic holds nothing readable. */
export class RelocateSlidesError extends NamedError {}

/** The slide relocation of one lecture: its input, and what the stage run uses. */
type SlideRelocationRun = UnlistedStageRun & SlideRelocationInput;

const DOCUMENTED_REPLY_SHAPE =
	"{ slides: [{ slide, startWords }], figureMarks: [{ mark, slide }] } object";

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
 * Relocates the slides of one subtopic. A subtopic with no slide for the model
 * gets no call.
 *
 * @param args - The slide relocation, and the subtopic.
 * @param args.subtopic - The subtopic and its paragraphs.
 * @param args.figureNumbers - The figure number of each slide of the lecture.
 * @param args.shownSlides - The slides that the subtopic shows.
 * @param args.sendToModel - Sends the messages to the model.
 * @param args.logger - The logger of the stage.
 * @param args.costTally - The cost tally of the stage run.
 * @returns The file of the subtopic.
 * @throws {ResendsExhaustedError} If the third send is still unusable.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger type has mutable properties that the rule sees. This code only logs to it. CLAUDE.md allows a mutable type where a library requires one.
async function relocateSubtopicSlides({
	subtopic,
	figureNumbers,
	shownSlides,
	sendToModel,
	logger,
	costTally,
}: SlideRelocationRun & {
	readonly subtopic: FactCorrectedParagraphs;
	readonly figureNumbers: FigureNumbers;
	readonly shownSlides: ShownSlides;
}): Promise<SlideRelocation> {
	const paragraphs = numberFigureMarks(subtopic.paragraphs);
	const slides = shownSlides.slidesForModel;
	// A mark with no entry in `markSlides` points at no slide.
	const slidePoints =
		slides.length === 0
			? { points: [], markSlides: [] }
			: (
					await sendToStageModelWithResends({
						what: `Slide relocation of subtopic ${subtopic.subtopicId}`,
						messages: buildSlideRelocationMessages({ paragraphs, slides }),
						sendToModel,
						logger,
						costTally,
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
		figureNumbers,
		slidesAtStart: shownSlides.slidesAtStart,
		slidesAtEnd: shownSlides.slidesAtEnd,
	});
}

/**
 * Relocates the slides of each subtopic, and writes the file of each subtopic and
 * `slide-relocations.json`. A saved file of a subtopic is read back, and its
 * subtopic gets no call.
 *
 * @param run - The slide relocation of the lecture.
 * @returns The content of `slide-relocations.json`, and the `filesWritten` entry of each file.
 * @throws {RelocateSlidesError} If no subtopic has a paragraph, or if a saved file holds nothing readable.
 * @throws {ResendsExhaustedError} If the third send of a call is still unusable.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger type has mutable properties that the rule sees. This code only passes it on. CLAUDE.md allows a mutable type where a library requires one.
export async function relocateSlides(run: SlideRelocationRun): Promise<{
	readonly output: SlideRelocations;
	readonly filesWritten: readonly string[];
}> {
	if (run.subtopics.every(({ paragraphs }) => paragraphs.length === 0)) {
		throw new RelocateSlidesError(
			"No subtopic of the lecture has a paragraph, so the notes have no place for the slides",
		);
	}
	const figureNumbers = figureNumbersOf(run.readings);
	const shown = shownSlidesBySubtopic(run);
	const relocated = await runUnlistedSubtopicFileStage({
		workspaceRoot: run.workspaceRoot,
		directory: slideRelocationsDirectory(run.workspaceRoot),
		subtopics: run.subtopics,
		isSaved: isSlideRelocation,
		saved: { content: "slide relocation", remake: "relocate the slides of the subtopic" },
		fail: (message) => new RelocateSlidesError(message),
		make: (subtopic) =>
			relocateSubtopicSlides({
				...run,
				subtopic,
				figureNumbers,
				// `shown` has an entry for each subtopic of `run.subtopics`.
				shownSlides: shown.get(subtopic.subtopicId) as ShownSlides,
			}),
		concurrency: run.concurrency,
		entriesPath: slideRelocationsPath(run.workspaceRoot),
		key: "slideRelocations",
	});
	return relocated;
}
