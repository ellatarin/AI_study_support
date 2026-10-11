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
import { placeCuts, type SubtopicWithIdAndText } from "../division.js";
import {
	defineModelStage,
	type ModelStageFactory,
	type ModelStageRunArgs,
} from "../model-stage.js";
import { writeJsonStageResult } from "../pipeline-stage.js";
/* jscpd:ignore-end */
import {
	hasPlacedSlideFields,
	type PlacedSlideFields,
	type SlidePlacement,
	type SlidePlacements,
} from "../slide-placements.js";
import {
	findSlideImages,
	isSubjectMatter,
	readSlideReading,
	type SlideKind,
	type SlideReading,
} from "../slides.js";
import { readStageStructuredTranscript } from "../stage-input.js";
import { buildPlacementMessages, PROMPT_VERSION } from "./place-slides.prompt.js";

/**
 * The error when the structured transcript or a slide reading is missing or
 * unreadable. A call whose third send is still unusable fails the stage with
 * `ResendsExhaustedError`.
 */
export class PlaceSlidesError extends NamedError {}

const STAGE_ID = "place-slides";

/** Every subtopic of the structured transcript in lecture order, and the reading of each slide in deck order. */
type PlacementInput = {
	readonly subtopics: readonly SubtopicWithIdAndText[];
	readonly slides: readonly SlideReading[];
};

/** One entry of the reply: a slide, its subtopic, its start words, and why the slide goes there. */
type ReplyPlacement = PlacedSlideFields & { readonly startsWith: string };

/** The reply that the prompt asks for. */
type PlacementReply = { readonly placements: readonly ReplyPlacement[] };

/** The text that ends the failure "The model's reply is not the documented …". */
const DOCUMENTED_REPLY_SHAPE = "{ placements } object";

const REFERENCES: SlideKind = "references";

/** The reason that the stage writes for each references slide, which the code places. */
const REFERENCES_REASON = "A references slide goes at the end of the last subtopic.";

/**
 * Checks that a value is a reply entry: a `slideNumber` and a `subtopicId`, both
 * numbers, and a `startsWith` and a `placedBecause`, both strings.
 *
 * @param value - The value to test.
 * @returns `true` when the value is a {@link ReplyPlacement}.
 */
function isReplyPlacement(value: unknown): value is ReplyPlacement {
	return hasPlacedSlideFields(value) && typeof value.startsWith === "string";
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
 * @param args - The subtopic, and the start words.
 * @param args.subtopic - The subtopic that the reply names.
 * @param args.startWords - The start words from the reply.
 * @returns The position in the subtopic's text, or `null` when the subtopic does not hold the words.
 */
function findStartWords({
	subtopic,
	startWords,
}: {
	readonly subtopic: SubtopicWithIdAndText;
	readonly startWords: string;
}): number | null {
	// The empty first start words stand for the start of the subtopic. placeCuts never searches for them.
	const placed = placeCuts({ text: subtopic.text, startWords: ["", startWords] });
	const [, position] = "cuts" in placed ? placed.cuts : [];
	return position ?? null;
}

/**
 * Checks that a placement is earlier in the lecture than another: in an earlier
 * subtopic, or in the same subtopic at a smaller position.
 *
 * @param args - The two placements.
 * @param args.placement - The placement to test.
 * @param args.than - The placement to compare it with.
 * @returns `true` when `placement` is earlier than `than`.
 */
function isEarlier({
	placement,
	than,
}: {
	readonly placement: SlidePlacement;
	readonly than: SlidePlacement;
}): boolean {
	return (
		placement.subtopicId < than.subtopicId ||
		(placement.subtopicId === than.subtopicId &&
			placement.positionInSubtopic < than.positionInSubtopic)
	);
}

/**
 * Gives the placement of each subject-matter slide in deck order, or the reason
 * that the reply is unusable (technical-design.md §5, `place-slides`).
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
	const subtopicOf = ({ subtopicId }: ReplyPlacement): SubtopicWithIdAndText | undefined =>
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
		const positionInSubtopic =
			subtopic === undefined
				? null
				: findStartWords({ subtopic, startWords: placement.startsWith });
		if (positionInSubtopic === null) {
			return {
				failure: `The model's start words "${placement.startsWith}" for slide ${placement.slideNumber} are not in subtopic ${placement.subtopicId}`,
			};
		}
		const slidePlacement: SlidePlacement = {
			slideNumber: placement.slideNumber,
			subtopicId: placement.subtopicId,
			startWords: placement.startsWith,
			positionInSubtopic,
			placedBecause: placement.placedBecause,
		};
		const previous = placed.at(-1);
		if (previous !== undefined && isEarlier({ placement: slidePlacement, than: previous })) {
			return {
				failure: `The model's reply puts slide ${placement.slideNumber} earlier in the lecture than the subject-matter slide before it`,
			};
		}
		placed.push(slidePlacement);
	}
	return { reply: placed };
}

/**
 * Reads the structured transcript and the reading of each slide image.
 *
 * @param context - The stage context.
 * @returns Every subtopic in lecture order, and each slide reading in deck order.
 * @throws {PlaceSlidesError} If an input file is missing, unreadable or the wrong shape, or if no slide image exists.
 */
async function readPlacementInput(context: StageContext): Promise<PlacementInput> {
	const fail = (message: string): Error => new PlaceSlidesError(message);
	const { topics } = await readStageStructuredTranscript({
		context,
		purpose: "place the slides in",
		fail,
	});
	const images = await findSlideImages({ context, fail });
	return {
		// The subtopics go without their topics (technical-design.md §5, `place-slides`).
		subtopics: topics.flatMap((topic) => topic.subtopics),
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
	const lastSubtopic = input.subtopics.at(-1);
	const placements = input.slides.flatMap((slide): readonly SlidePlacement[] =>
		slide.kind === REFERENCES && lastSubtopic !== undefined
			? [
					{
						slideNumber: slide.slideNumber,
						subtopicId: lastSubtopic.subtopicId,
						startWords: null,
						positionInSubtopic: lastSubtopic.text.length,
						placedBecause: REFERENCES_REASON,
					},
				]
			: sent.reply.filter((placement) => placement.slideNumber === slide.slideNumber),
	);
	return writeJsonStageResult({
		stageId: STAGE_ID,
		context,
		output: { promptVersion: PROMPT_VERSION, placements },
		cost: sent.cost,
	});
}

/** Builds the `place-slides` stage from the logger and the OpenAI client of the invocation. */
export const createPlaceSlidesStage: ModelStageFactory<PlacementInput, SlidePlacements> =
	defineModelStage({ stageId: STAGE_ID, getInput: readPlacementInput, run: placeSlides });
