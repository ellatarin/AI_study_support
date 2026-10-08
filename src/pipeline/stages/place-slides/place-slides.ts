/**
 * The `place-slides` stage. It puts each subject-matter slide with the subtopic
 * where the lecturer discusses it (technical-design.md §5, `place-slides`).
 */

/* jscpd:ignore-start -- the model-calling stages import the same pipeline types,
   division helpers and model-stage helpers. So their import blocks are the
   same line for line. Imports cannot be shared, and CLAUDE.md (File
   Organisation) forbids barrel files. Only the imports are exempt. jscpd
   checks the code below. */
import type { StageContext, StageResult } from "../../../types/pipeline.js";
import { NamedError } from "../../../utils/errors.js";
import { isRecord } from "../../../utils/record.js";
import { subtopicsWithText } from "../division.js";
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
import { readInputJson, readTranscriptAndDivision } from "../stage-input.js";
import {
	buildPlacementMessages,
	PROMPT_VERSION,
	type SentSubtopic,
} from "./place-slides.prompt.js";

/**
 * The error when the transcript, the retitled subtopics or a slide reading is
 * missing or unreadable. A call whose third send is still unusable fails the
 * stage with `ResendsExhaustedError`.
 */
export class PlaceSlidesError extends NamedError {}

const STAGE_ID = "place-slides";

/** The lecture as the model reads it: the subtopics and the slide readings. */
type PlacementInput = {
	readonly subtopics: readonly SentSubtopic[];
	readonly slides: readonly SlideReading[];
};

/** One entry of the reply: a slide, its subtopic, and why the slide goes there. */
type Placement = {
	readonly slideNumber: number;
	readonly subtopicId: number;
	readonly placedBecause: string;
};

/** The reply that the prompt asks for. */
type PlacementReply = { readonly placements: readonly Placement[] };

/** What the stage writes: the placements, and the version of the prompt that made them. */
type SlidePlacements = PlacementReply & { readonly promptVersion: string };

/** The text that ends the failure "The model's reply is not the documented …". */
const DOCUMENTED_REPLY_SHAPE = "{ placements } object";

const SUBJECT_MATTER: SlideKind = "subject-matter";

const REFERENCES: SlideKind = "references";

/** The reason that the stage writes for each references slide, which the code places. */
const REFERENCES_REASON = "A references slide goes with the last subtopic.";

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
 * Tells if a value is a placement: a `slideNumber` and a `subtopicId`, both
 * numbers, and a `placedBecause` string.
 *
 * @param value - The value to test.
 * @returns `true` when the value is a {@link Placement}.
 */
function isPlacement(value: unknown): value is Placement {
	return (
		isRecord(value) &&
		typeof value.slideNumber === "number" &&
		typeof value.subtopicId === "number" &&
		typeof value.placedBecause === "string"
	);
}

/**
 * Checks that a parsed reply has a list `placements`, and that each entry is a placement.
 *
 * @param value - The parsed reply.
 * @returns `true` when the value is a {@link PlacementReply}.
 */
function isPlacementReply(value: unknown): value is PlacementReply {
	return isRecord(value) && Array.isArray(value.placements) && value.placements.every(isPlacement);
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
}): readonly Placement[] {
	return reply.placements.filter((placement) => placement.slideNumber === slideNumber);
}

/**
 * Gives the placements of a reply, or the reason that the reply is unusable
 * (technical-design.md §5, `place-slides`).
 *
 * @param args - The reply, the subtopics and the slide readings.
 * @param args.reply - The parsed reply, with the documented shape.
 * @param args.subtopics - Every subtopic, in lecture order.
 * @param args.slides - Every slide reading, in deck order.
 * @returns The placements, or the reason that the reply is unusable.
 */
function usablePlacements({
	reply,
	subtopics,
	slides,
}: PlacementInput & { readonly reply: PlacementReply }):
	| { readonly reply: PlacementReply }
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
	const placesOfSlide = ({ slideNumber }: SlideReading): readonly Placement[] =>
		placesOf({ reply, slideNumber });
	// The stage ignores the entries for the other slides. The kept entries are in deck order.
	const kept = subjectMatterSlides.flatMap(placesOfSlide);
	const unknownSubtopic = kept.find(
		(placement) => !subtopics.some((subtopic) => subtopic.subtopicId === placement.subtopicId),
	);
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
	const [, outOfOrder] =
		[...kept.entries()].find(
			([index, placement]) => placement.subtopicId < (kept[index - 1]?.subtopicId ?? 0),
		) ?? [];
	if (outOfOrder !== undefined) {
		return {
			failure: `The model's reply puts slide ${outOfOrder.slideNumber} in subtopic ${outOfOrder.subtopicId}, earlier than the subject-matter slide before it`,
		};
	}
	return { reply: { placements: kept } };
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
 * @returns Each subtopic with its subtopic id and trimmed text, and each slide reading in deck order.
 * @throws {PlaceSlidesError} If an input file is missing, unreadable or the wrong shape, or if no slide image exists.
 */
async function readPlacementInput(context: StageContext): Promise<PlacementInput> {
	const fail = (message: string): Error => new PlaceSlidesError(message);
	const { transcript, subtopics } = await readTranscriptAndDivision({
		context,
		stageId: "retitle-subtopics",
		purpose: "place the slides in",
		fail,
	});
	const images = await findSlideImages({ context, fail });
	return {
		subtopics: [...subtopicsWithText({ text: transcript, subtopics }).entries()].map(
			([index, subtopic]) => ({ subtopicId: index + 1, ...subtopic }),
		),
		slides: await Promise.all(
			[...images.keys()].map((index) =>
				readSlideReading({ context, slideNumber: index + 1, fail }),
			),
		),
	};
}

/**
 * Asks the model where each subject-matter slide goes, and puts each references
 * slide with the last subtopic. It writes the placements in deck order.
 *
 * @param args - The input, the stage context and the model calls of the stage run.
 * @param args.input - The subtopics and the slide readings.
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
			subtopics: input.subtopics,
			slides: input.slides.filter(isSubjectMatter),
		}),
		isReply: isPlacementReply,
		documentedShape: DOCUMENTED_REPLY_SHAPE,
		use: (reply) => usablePlacements({ reply, ...input }),
	});
	// A subtopic id counts from 1, so the last subtopic's id is the number of subtopics.
	const lastSubtopicId = input.subtopics.length;
	const placements = input.slides.flatMap((slide): readonly Placement[] =>
		slide.kind === REFERENCES
			? [
					{
						slideNumber: slide.slideNumber,
						subtopicId: lastSubtopicId,
						placedBecause: REFERENCES_REASON,
					},
				]
			: placesOf({ reply: sent.reply, slideNumber: slide.slideNumber }).map(
					({ slideNumber, subtopicId, placedBecause }) => ({
						slideNumber,
						subtopicId,
						placedBecause,
					}),
				),
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
