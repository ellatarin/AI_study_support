/**
 * `initial-subtopic-splitting`: the first of the three division stages. Makes a
 * panel of splitting runs, each sending the whole transcript with the `s6`
 * prompt and cutting it where the model says each subtopic begins
 * (technical-design.md §5, "Dividing the transcript").
 */

/* jscpd:ignore-start -- the division stages pull in the same pipeline types,
   division helpers and model-stage helpers, so their import blocks match line
   for line. There is nothing to extract: imports cannot be shared, and barrel
   files are forbidden (CLAUDE.md, File Organisation). Only the imports are
   exempt; the code below is checked as normal. */
import type { StageContext, StageResult } from "../../../types/pipeline.js";
import { NamedError } from "../../../utils/errors.js";
import { isRecord } from "../../../utils/record.js";
import {
	assertLossless,
	isReplySubtopic,
	placeCuts,
	type ReplySubtopic,
	replyNaming,
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
 * Thrown when the transcript cannot be divided: it is missing or empty. A run
 * whose replies stay unusable fails the stage with the panel's own error.
 */
export class InitialSubtopicSplittingError extends NamedError {}

const STAGE_ID = "initial-subtopic-splitting";

/** The transcript this stage divides, with the whitespace at its ends removed. */
export type InitialSubtopicSplittingInput = { readonly transcript: string };

/** Every splitting run of the panel, in run order. */
export type InitialSubtopicSplittingOutput = { readonly runs: readonly (readonly Subtopic[])[] };

/** The object the `s6` prompt asks for. */
type SplitReply = { readonly subtopics: readonly ReplySubtopic[] };

/** The reply's shape in words, for the failure a user reads when a reply is not one. */
const DOCUMENTED_REPLY_SHAPE = "{ subtopics: [{ label, groupedBecause, startsWith }] } object";

/**
 * Whether a parsed reply is the documented list of at least one subtopic.
 *
 * @param value - The parsed reply.
 * @returns `true` when every subtopic carries its three strings.
 */
function isSplitReply(value: unknown): value is SplitReply {
	if (!isRecord(value) || !Array.isArray(value.subtopics) || value.subtopics.length === 0) {
		return false;
	}
	return value.subtopics.every(isReplySubtopic);
}

/**
 * Cuts the transcript where a reply says each subtopic begins. A reply giving
 * start words the transcript does not contain is as unusable as one that is not
 * JSON, so it is returned as a failure for the panel to resend.
 *
 * @param args - The transcript, and the reply's subtopics.
 * @param args.transcript - The transcript to divide.
 * @param args.subtopics - The subtopics the reply named, in order.
 * @returns The division, or why the reply could not be used.
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
		named: subtopics.map(replyNaming),
	});
	assertLossless({ text: transcript, subtopics: division });
	return { reply: division };
}

/**
 * Makes the panel of splitting runs, resuming from any an earlier launch saved.
 *
 * @param args - The stage's input, context and dependencies.
 * @param args.input - The transcript to divide.
 * @param args.context - The current lecture run context.
 * @param args.logger - The run's logger, on which each model call is recorded.
 * @param args.client - The OpenAI client the calls go through.
 * @param args.sendGate - The run's turns to send, which every call waits on.
 * @returns Every run, what this launch's calls cost, and the run files.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger and the OpenAI client carry mutable properties the rule cannot see past; both are only read from here (CLAUDE.md permits dropping readonly where a library requires a mutable type)
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
 * Reads the transcript this stage divides.
 *
 * @param context - The current lecture run context.
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

/**
 * Builds the `initial-subtopic-splitting` stage from the run's logger and the
 * invocation's OpenAI client.
 */
export const createInitialSubtopicSplittingStage: ModelStageFactory<
	InitialSubtopicSplittingInput,
	InitialSubtopicSplittingOutput
> = defineModelStage({ stageId: STAGE_ID, getInput: readInput, run: splitTranscript });
