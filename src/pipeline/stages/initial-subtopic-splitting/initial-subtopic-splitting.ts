/**
 * The `initial-subtopic-splitting` stage, the first division stage. It makes a
 * panel of splitting runs. Each run sends the whole transcript with the `s6`
 * prompt. Then the stage cuts the transcript at the start words of each subtopic
 * (technical-design.md §5, "Dividing the transcript").
 */

/* jscpd:ignore-start -- the division stages import the same pipeline types,
   division helpers and model-stage helpers. So their import blocks are the
   same line for line. Imports cannot be shared, and CLAUDE.md (File
   Organisation) forbids barrel files. Only the imports are exempt. jscpd
   checks the code below. */
import type { StageContext, StageResult } from "../../../types/pipeline.js";
import { NamedError } from "../../../utils/errors.js";
import { isRecord } from "../../../utils/record.js";
import {
	assertLossless,
	isReplySubtopic,
	placeCuts,
	type ReplySubtopic,
	replyTitleAndReason,
	type Subtopic,
	sliceSubtopics,
	splittingPanel,
} from "../division.js";
import {
	defineModelStage,
	type ModelStageFactory,
	type ModelStageRunArgs,
} from "../model-stage.js";
import { runOneCallPanel } from "../panel-runs.js";
import { readTranscript } from "../stage-input.js";
import { buildSplittingMessages } from "./initial-subtopic-splitting.prompt.js";
/* jscpd:ignore-end */

/**
 * The error when the transcript is missing or holds no text. A run whose third
 * send is still unusable fails the stage with `ResendsExhaustedError`.
 */
export class InitialSubtopicSplittingError extends NamedError {}

const STAGE_ID = "initial-subtopic-splitting";

/** The transcript that this stage divides, with the whitespace at its ends removed. */
export type InitialSubtopicSplittingInput = { readonly transcript: string };

/** Every splitting run of the panel, in run order. */
export type InitialSubtopicSplittingOutput = { readonly runs: readonly (readonly Subtopic[])[] };

/** The reply that the `s6` prompt asks for. */
type SplitReply = { readonly subtopics: readonly ReplySubtopic[] };

/** The text that ends the failure "The model's reply is not the documented …". */
const DOCUMENTED_REPLY_SHAPE = "{ subtopics: [{ label, groupedBecause, startsWith }] } object";

/**
 * Checks that a parsed reply is a list of one or more reply subtopics.
 *
 * @param value - The parsed reply.
 * @returns `true` when the list is not empty and each subtopic has its three strings.
 */
function isSplitReply(value: unknown): value is SplitReply {
	if (!isRecord(value) || !Array.isArray(value.subtopics) || value.subtopics.length === 0) {
		return false;
	}
	return value.subtopics.every(isReplySubtopic);
}

/**
 * Cuts the transcript at the start words of each subtopic in a reply. A reply
 * with start words that the transcript does not contain is an unusable reply.
 * So the function returns a failure, and the panel resends the run.
 *
 * @param args - The transcript, and the subtopics of the reply.
 * @param args.transcript - The transcript to divide.
 * @param args.subtopics - The subtopics of the reply, in order.
 * @returns The division, or the reason that the reply is unusable.
 * @throws {DivisionNotLosslessError} If the division does not reproduce the transcript. A division that does not reproduce the transcript is always a bug.
 */
function divideAsReplied({
	transcript,
	subtopics,
}: {
	readonly transcript: string;
	readonly subtopics: readonly ReplySubtopic[];
}): { readonly reply: readonly Subtopic[] } | { readonly failure: string } {
	const placed = placeCuts({
		text: transcript,
		startWords: subtopics.map((subtopic) => subtopic.startsWith),
	});
	if ("unplaced" in placed) {
		return {
			failure: `The model's start words "${placed.unplaced}" are not in the transcript after the previous cut`,
		};
	}
	const division = sliceSubtopics({
		text: transcript,
		cuts: placed.cuts,
		titled: subtopics.map(replyTitleAndReason),
	});
	assertLossless({ text: transcript, subtopics: division });
	return { reply: division };
}

/**
 * Makes the panel of splitting runs. The stage reads a saved run that an earlier
 * invocation made, and does not make that run again.
 *
 * @param args - The input, the stage context and the dependencies of the stage.
 * @param args.input - The transcript to divide.
 * @param args.context - The stage context.
 * @param args.logger - The logger that records each model call.
 * @param args.client - The OpenAI client that sends the calls.
 * @param args.sendGate - The send gate of this stage run. Every send waits on it.
 * @returns Every splitting run, the cost of the calls of this invocation, and the saved runs.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger and the OpenAI client have mutable properties that the rule cannot ignore. This function only reads them. CLAUDE.md permits a mutable type that a library requires.
function splitTranscript({
	input,
	context,
	logger,
	client,
	sendGate,
}: ModelStageRunArgs<InitialSubtopicSplittingInput>): Promise<
	StageResult<InitialSubtopicSplittingOutput>
> {
	return runOneCallPanel({
		stageId: STAGE_ID,
		context,
		...splittingPanel(context),
		runName: "Splitting run",
		request: {
			messages: buildSplittingMessages({ transcript: input.transcript }),
			isReply: isSplitReply,
			documentedShape: DOCUMENTED_REPLY_SHAPE,
			logger,
			client,
			sendGate,
			use: ({ subtopics }) => divideAsReplied({ transcript: input.transcript, subtopics }),
		},
	});
}

/**
 * Reads the transcript that this stage divides.
 *
 * @param context - The stage context.
 * @returns The transcript, with the whitespace at its ends removed.
 * @throws {InitialSubtopicSplittingError} If the transcript is missing or holds no text.
 */
async function readInput(context: StageContext): Promise<InitialSubtopicSplittingInput> {
	return {
		transcript: await readTranscript({
			context,
			fail: (message) => new InitialSubtopicSplittingError(message),
		}),
	};
}

/** Builds the `initial-subtopic-splitting` stage from the logger and the OpenAI client of the invocation. */
export const createInitialSubtopicSplittingStage: ModelStageFactory<
	InitialSubtopicSplittingInput,
	InitialSubtopicSplittingOutput
> = defineModelStage({ stageId: STAGE_ID, getInput: readInput, run: splitTranscript });
