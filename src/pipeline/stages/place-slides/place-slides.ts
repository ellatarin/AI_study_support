/**
 * The `place-slides` stage. It puts each subject-matter slide at the point in the
 * transcript where the lecturer starts to discuss it (technical-design.md §5,
 * `place-slides`).
 */

/* jscpd:ignore-start -- the model-calling stages import the same pipeline types,
   division helpers and model-stage helpers. So their import blocks are the
   same line for line. Imports cannot be shared, and CLAUDE.md (File
   Organisation) forbids barrel files. Only the imports are exempt. jscpd
   checks the code below. */
import type { StageContext, StageResult } from "../../../types/pipeline.js";
import { NamedError } from "../../../utils/errors.js";
import { isRecord } from "../../../utils/record.js";
import { placeCuts, type Subtopic, subtopicsWithText, subtopicText } from "../division.js";
import {
	defineModelStage,
	type ModelStageFactory,
	type ModelStageRunArgs,
} from "../model-stage.js";
import { writeJsonStageOutput } from "../pipeline-stage.js";
/* jscpd:ignore-end */
import {
	findSlideImages,
	isSlideReading,
	type SlideKind,
	type SlideReading,
	slideReadingPath,
} from "../slides.js";
import {
	readInputJson,
	readTranscriptAndDivision,
	type TranscriptAndDivision,
} from "../stage-input.js";
import { buildPlacementMessages, PROMPT_VERSION } from "./place-slides.prompt.js";

/**
 * The error when the transcript, the retitled subtopics or a slide reading is
 * missing or unreadable. A call whose third send is still unusable fails the
 * stage with `ResendsExhaustedError`.
 */
export class PlaceSlidesError extends NamedError {}

const STAGE_ID = "place-slides";

/** The transcript, its retitled subtopics, and the reading of each slide in deck order. */
type PlacementInput = TranscriptAndDivision & { readonly slides: readonly SlideReading[] };

/** One entry of the reply: a slide, its subtopic, its start words, and why the slide goes there. */
type ReplyPlacement = {
	readonly slideNumber: number;
	readonly subtopicId: number;
	readonly startsWith: string;
	readonly placedBecause: string;
};

/** The reply that the prompt asks for. */
type PlacementReply = { readonly placements: readonly ReplyPlacement[] };

/** One placed slide, as the stage writes it (technical-design.md §5, `place-slides`). */
type SlidePlacement = {
	readonly slideNumber: number;
	readonly subtopicId: number;
	/** The start words from the reply. `null` for a references slide, which the code places. */
	readonly startWords: string | null;
	/** The position in the transcript where the slide goes. */
	readonly textPosition: number;
	readonly placedBecause: string;
};

/** What the stage writes: the placements, and the version of the prompt that made them. */
type SlidePlacements = {
	readonly promptVersion: string;
	readonly placements: readonly SlidePlacement[];
};

/** The text that ends the failure "The model's reply is not the documented …". */
const DOCUMENTED_REPLY_SHAPE = "{ placements } object";

const SUBJECT_MATTER: SlideKind = "subject-matter";

const REFERENCES: SlideKind = "references";

/** The reason that the stage writes for each references slide, which the code places. */
const REFERENCES_REASON = "A references slide goes at the end of the last subtopic.";

/**
 * Tells if a slide is a subject-matter slide.
 *
 * @param slide - The slide reading.
 * @returns `true` when the slide's kind is subject matter.
 */
function isSubjectMatter(slide: SlideReading): boolean {
	return slide.kind === SUBJECT_MATTER;
}

/**
 * Tells if a value is a reply entry: a `slideNumber` and a `subtopicId`, both
 * numbers, and a `startsWith` and a `placedBecause`, both strings.
 *
 * @param value - The value to test.
 * @returns `true` when the value is a {@link ReplyPlacement}.
 */
function isReplyPlacement(value: unknown): value is ReplyPlacement {
	return (
		isRecord(value) &&
		typeof value.slideNumber === "number" &&
		typeof value.subtopicId === "number" &&
		typeof value.startsWith === "string" &&
		typeof value.placedBecause === "string"
	);
}

/**
 * Checks that a parsed reply has a list `placements`, and that each entry is a reply entry.
 *
 * @param value - The parsed reply.
 * @returns `true` when the value is a {@link PlacementReply}.
 */
function isPlacementReply(value: unknown): value is PlacementReply {
	return (
		isRecord(value) && Array.isArray(value.placements) && value.placements.every(isReplyPlacement)
	);
}

/**
 * Gives the entries of a reply for one slide.
 *
 * @param args - The reply, and the slide.
 * @param args.reply - The parsed reply.
 * @param args.slideNumber - The number of the slide in the deck, from 1.
 * @returns The entries that name the slide, in the order of the reply.
 */
function placesOf({
	reply,
	slideNumber,
}: {
	readonly reply: PlacementReply;
	readonly slideNumber: number;
}): readonly ReplyPlacement[] {
	return reply.placements.filter((placement) => placement.slideNumber === slideNumber);
}

/**
 * Finds start words in the text of one subtopic, as the division stages find
 * the start words of a cut.
 *
 * @param args - The transcript, the subtopic, and the start words.
 * @param args.transcript - The transcript that the span of the subtopic indexes into.
 * @param args.subtopic - The subtopic that the reply names.
 * @param args.startWords - The start words from the reply.
 * @returns The position in the transcript, or `null` when the subtopic does not hold the words.
 */
function positionInSubtopic({
	transcript,
	subtopic,
	startWords,
}: {
	readonly transcript: string;
	readonly subtopic: Subtopic;
	readonly startWords: string;
}): number | null {
	// The empty first start words stand for the start of the subtopic. placeCuts never searches for them.
	const placed = placeCuts({
		text: subtopicText({ text: transcript, subtopic }),
		startWords: ["", startWords],
	});
	const [, position] = "cuts" in placed ? placed.cuts : [];
	return position === undefined ? null : subtopic.start + position;
}

/**
 * Gives the placement of each subject-matter slide in deck order, or the reason
 * that the reply is unusable (technical-design.md §5, `place-slides`).
 *
 * @param args - The reply, the transcript, the subtopics and the slide readings.
 * @param args.reply - The parsed reply, with the documented shape.
 * @param args.transcript - The transcript that the spans of the subtopics index into.
 * @param args.subtopics - Every subtopic, in lecture order.
 * @param args.slides - Every slide reading, in deck order.
 * @returns The placements, or the reason that the reply is unusable.
 */
function usablePlacements({
	reply,
	transcript,
	subtopics,
	slides,
}: PlacementInput & { readonly reply: PlacementReply }):
	| { readonly reply: readonly SlidePlacement[] }
	| { readonly failure: string } {
	const unknownSlide = reply.placements.find(
		(placement) => !slides.some((slide) => slide.slideNumber === placement.slideNumber),
	);
	if (unknownSlide !== undefined) {
		return {
			failure: `The model's reply names slide ${unknownSlide.slideNumber}, which does not exist`,
		};
	}
	const subjectMatterSlides = slides.filter(isSubjectMatter);
	const placesOfSlide = ({ slideNumber }: SlideReading): readonly ReplyPlacement[] =>
		placesOf({ reply, slideNumber });
	// The stage ignores the entries for the other slides. The kept entries are in deck order.
	const kept = subjectMatterSlides.flatMap(placesOfSlide);
	// A subtopic id counts from 1, so subtopic id N is at index N - 1.
	const subtopicOf = ({ subtopicId }: ReplyPlacement): Subtopic | undefined =>
		subtopics[subtopicId - 1];
	const unknownSubtopic = kept.find((placement) => subtopicOf(placement) === undefined);
	if (unknownSubtopic !== undefined) {
		return {
			failure: `The model's reply names subtopic ${unknownSubtopic.subtopicId}, which does not exist`,
		};
	}
	const unexplained = kept.find((placement) => placement.placedBecause.trim() === "");
	if (unexplained !== undefined) {
		return {
			failure: `The model's reply gives slide ${unexplained.slideNumber} a blank placedBecause`,
		};
	}
	const misplaced = subjectMatterSlides.find((slide) => placesOfSlide(slide).length !== 1);
	if (misplaced !== undefined) {
		return {
			failure: `The model's reply gives slide ${misplaced.slideNumber} ${placesOfSlide(misplaced).length} places, not one`,
		};
	}
	const placed: SlidePlacement[] = [];
	for (const placement of kept) {
		const subtopic = subtopicOf(placement);
		const textPosition =
			subtopic === undefined
				? null
				: positionInSubtopic({ transcript, subtopic, startWords: placement.startsWith });
		if (textPosition === null) {
			return {
				failure: `The model's start words "${placement.startsWith}" for slide ${placement.slideNumber} are not in subtopic ${placement.subtopicId}`,
			};
		}
		if (textPosition < (placed.at(-1)?.textPosition ?? 0)) {
			return {
				failure: `The model's reply puts slide ${placement.slideNumber} earlier in the transcript than the subject-matter slide before it`,
			};
		}
		placed.push({
			slideNumber: placement.slideNumber,
			subtopicId: placement.subtopicId,
			startWords: placement.startsWith,
			textPosition,
			placedBecause: placement.placedBecause,
		});
	}
	return { reply: placed };
}

/**
 * Reads the reading of one slide.
 *
 * @param args - The stage context, the slide, and the error to raise.
 * @param args.context - The stage context.
 * @param args.slideNumber - The number of the slide in the deck, from 1.
 * @param args.fail - Builds the stage's error from a message.
 * @returns The slide reading.
 * @throws The error that `fail` builds, if the file is missing, not JSON or not a slide reading.
 */
function readSlideReading({
	context,
	slideNumber,
	fail,
}: {
	readonly context: StageContext;
	readonly slideNumber: number;
	readonly fail: (message: string) => Error;
}): Promise<SlideReading> {
	return readInputJson({
		path: slideReadingPath({ workspaceRoot: context.workspaceRoot, slideNumber }),
		stageId: "read-slides",
		fail,
		read: (value) => (isSlideReading(value) ? value : null),
		shape: "a slide reading",
	});
}

/**
 * Reads the transcript, the retitled subtopics and the reading of each slide
 * image.
 *
 * @param context - The stage context.
 * @returns The transcript, its subtopics, and each slide reading in deck order.
 * @throws {PlaceSlidesError} If an input file is missing, unreadable or the wrong shape, or if no slide image exists.
 */
async function readPlacementInput(context: StageContext): Promise<PlacementInput> {
	const fail = (message: string): Error => new PlaceSlidesError(message);
	const division = await readTranscriptAndDivision({
		context,
		stageId: "retitle-subtopics",
		purpose: "place the slides in",
		fail,
	});
	const images = await findSlideImages({ context, fail });
	return {
		...division,
		slides: await Promise.all(
			[...images.keys()].map((index) =>
				readSlideReading({ context, slideNumber: index + 1, fail }),
			),
		),
	};
}

/**
 * Asks the model where each subject-matter slide goes, and puts each references
 * slide at the end of the last subtopic. It writes the placements in deck order.
 *
 * @param args - The input, the stage context and the model calls of the stage run.
 * @param args.input - The transcript, its subtopics and the slide readings.
 * @param args.context - The stage context.
 * @param args.calls - The model calls of this stage run.
 * @returns The placements, the cost of the call and the file written.
 * @throws {ResendsExhaustedError} If the third send is still unusable.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger has mutable properties that the rule cannot ignore. CLAUDE.md permits a mutable type that a library requires.
async function placeSlides({
	input,
	context,
	calls,
}: ModelStageRunArgs<PlacementInput>): Promise<StageResult<SlidePlacements>> {
	const sent = await calls.sendJsonWithResends({
		what: "Slide placements",
		messages: buildPlacementMessages({
			subtopics: [
				...subtopicsWithText({ text: input.transcript, subtopics: input.subtopics }).entries(),
			].map(([index, subtopic]) => ({ subtopicId: index + 1, ...subtopic })),
			slides: input.slides.filter(isSubjectMatter),
		}),
		isReply: isPlacementReply,
		documentedShape: DOCUMENTED_REPLY_SHAPE,
		use: (reply) => usablePlacements({ reply, ...input }),
	});
	const lastSubtopic = input.subtopics.at(-1);
	const placements = input.slides.flatMap((slide): readonly SlidePlacement[] =>
		slide.kind === REFERENCES && lastSubtopic !== undefined
			? [
					{
						slideNumber: slide.slideNumber,
						// A subtopic id counts from 1, so the last subtopic's id is the number of subtopics.
						subtopicId: input.subtopics.length,
						startWords: null,
						textPosition: lastSubtopic.end,
						placedBecause: REFERENCES_REASON,
					},
				]
			: sent.reply.filter((placement) => placement.slideNumber === slide.slideNumber),
	);
	const output = { promptVersion: PROMPT_VERSION, placements };
	const { filesWritten } = await writeJsonStageOutput({
		stageId: STAGE_ID,
		context,
		value: output,
	});
	return { output, cost: sent.cost, filesWritten };
}

/** Builds the `place-slides` stage from the logger and the OpenAI client of the invocation. */
export const createPlaceSlidesStage: ModelStageFactory<PlacementInput, SlidePlacements> =
	defineModelStage({ stageId: STAGE_ID, getInput: readPlacementInput, run: placeSlides });
