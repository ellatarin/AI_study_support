/**
 * The `deepen-subtopic-splitting` stage, the second division stage. In each
 * splitting run, it sends each subtopic above the size gate alone with the `d13`
 * prompt. Then it cuts the subtopic where the model says that it divides. There
 * are at most two deepening rounds (technical-design.md §5, "Dividing the transcript").
 */

/* jscpd:ignore-start -- the division stages import the same pipeline types,
   division helpers and model-stage helpers. So their import blocks are the
   same line for line. Imports cannot be shared, and CLAUDE.md (File
   Organisation) forbids barrel files. Only the imports are exempt. jscpd
   checks the code below. */
import type { StageContext, StageCost, StageResult } from "../../../types/pipeline.js";
import { mapWithConcurrency } from "../../../utils/concurrency.js";
import { totalCost } from "../../../utils/cost.js";
import { NamedError } from "../../../utils/errors.js";
import { isRecord } from "../../../utils/record.js";
import { configuredStage } from "../../../utils/stage-config.js";
import {
	assertLossless,
	isReplySubtopic,
	placeCuts,
	type ReplySubtopic,
	replyTitleAndReason,
	type Subtopic,
	sliceSubtopics,
	splittingPanel,
	subtopicText,
} from "../division.js";
import {
	defineModelStage,
	type ModelStageFactory,
	type ModelStageRunArgs,
	type StageModelCalls,
} from "../model-stage.js";
import { runStagePanel } from "../panel-runs.js";
import { readTranscriptAndRuns } from "../stage-input.js";
import { buildDeepeningMessages } from "./deepen-subtopic-splitting.prompt.js";
/* jscpd:ignore-end */

/**
 * The error when the transcript is missing or holds no text, or when a splitting
 * run before deepening is missing. A subtopic whose third send is still unusable
 * fails the stage with `ResendsExhaustedError`.
 */
export class DeepenSubtopicSplittingError extends NamedError {}

const STAGE_ID = "deepen-subtopic-splitting";

/**
 * The most deepening rounds in one splitting run. The second round sends each
 * subtopic still above the size gate again (technical-design.md §5,
 * `deepen-subtopic-splitting`).
 */
const MAX_ROUNDS = 2;

/** The transcript, and the splitting runs that this stage deepens. */
export type DeepenSubtopicSplittingInput = {
	readonly transcript: string;
	readonly splittingRunsBeforeDeepening: readonly (readonly Subtopic[])[];
};

/** Every deepened splitting run, in run order. */
export type DeepenSubtopicSplittingOutput = { readonly runs: readonly (readonly Subtopic[])[] };

/**
 * The reply that the `d13` prompt asks for. The code does not read the reply's
 * `verdict`. An empty list of cuts means that the subtopic is one step.
 */
type DeepenReply = { readonly cuts: readonly ReplySubtopic[] };

/** The text that ends the failure "The model's reply is not the documented …". */
const DOCUMENTED_REPLY_SHAPE = "{ cuts: [{ label, groupedBecause, startsWith }] } object";

/**
 * Checks that a parsed reply is a list of cuts. An empty list is valid. It means
 * that the subtopic is one step.
 *
 * @param value - The parsed reply.
 * @returns `true` when each cut has its three strings.
 */
function isDeepenReply(value: unknown): value is DeepenReply {
	return isRecord(value) && Array.isArray(value.cuts) && value.cuts.every(isReplySubtopic);
}

/**
 * Counts the words in a text. Code counts them, because a model can only
 * estimate length (CONTEXT.md, "Size gate").
 *
 * @param text - The text to count.
 * @returns The number of groups of characters between whitespace.
 */
function countWords(text: string): number {
	return text.split(/\s+/u).filter((word) => word.length > 0).length;
}

/**
 * Finds the cuts of a reply in the text of one subtopic. The search for each cut
 * starts at the cut before it. The function drops a cut that it cannot find, and
 * does not guess. So deepening can add cuts, but it cannot move or remove a cut
 * (technical-design.md §5, `deepen-subtopic-splitting`).
 *
 * @param args - The text of the subtopic, and the cuts of the reply.
 * @param args.passage - The text of the subtopic.
 * @param args.cuts - The cuts of the reply, in order.
 * @returns The cuts that were found, and their positions in the passage. The first position is 0, the start of the passage.
 */
function placeWithin({
	passage,
	cuts,
}: {
	readonly passage: string;
	readonly cuts: readonly ReplySubtopic[];
}): { readonly kept: readonly ReplySubtopic[]; readonly positions: readonly number[] } {
	let kept: readonly ReplySubtopic[] = [];
	let positions: readonly number[] = [0];
	for (const cut of cuts) {
		// The empty first start words stand for the start of the passage. placeCuts never searches for them.
		const placed = placeCuts({
			text: passage,
			startWords: ["", ...[...kept, cut].map((proposed) => proposed.startsWith)],
		});
		if ("cuts" in placed) {
			kept = [...kept, cut];
			positions = placed.cuts;
		}
	}
	return { kept, positions };
}

/**
 * Cuts one subtopic where the reply says that it divides. The first piece keeps
 * the title and reason of the subtopic, as an inherited title. Each later piece
 * takes the title and reason of its cut.
 *
 * @param args - The transcript, the subtopic, and the cuts of the reply.
 * @param args.transcript - The transcript that the span of the subtopic indexes into.
 * @param args.subtopic - The subtopic that was sent.
 * @param args.cuts - The cuts of the reply.
 * @returns The pieces of the subtopic, in order. The list holds only the subtopic when no cut was found.
 */
function cutSubtopic({
	transcript,
	subtopic,
	cuts,
}: {
	readonly transcript: string;
	readonly subtopic: Subtopic;
	readonly cuts: readonly ReplySubtopic[];
}): readonly Subtopic[] {
	const passage = subtopicText({ text: transcript, subtopic });
	const { kept, positions } = placeWithin({ passage, cuts });
	const [first, ...later] = sliceSubtopics({
		text: passage,
		cuts: positions,
		titled: [subtopic, ...kept.map(replyTitleAndReason)],
	}).map((piece) => ({
		...piece,
		start: piece.start + subtopic.start,
		end: piece.end + subtopic.start,
	}));
	if (kept.length === 0 || first === undefined) {
		return [subtopic];
	}
	return [first, ...later];
}

type DeepeningCallArgs = {
	readonly transcript: string;
	readonly runNumber: number;
	readonly context: StageContext;
	readonly calls: StageModelCalls;
};

/**
 * Deepens one subtopic in one deepening round. A subtopic above the size gate is
 * sent, and cut where the reply says that it divides. A subtopic at or under the
 * size gate is never sent.
 *
 * @param args - The subtopic, the deepening round, and the splitting run of the subtopic.
 * @param args.subtopic - The subtopic to deepen.
 * @param args.round - The deepening round, counting from 1, for the log and the failure message.
 * @param args.transcript - The transcript that the span of the subtopic indexes into.
 * @param args.runNumber - The splitting run, counting from 1, for the log and the failure message.
 * @param args.context - The stage context.
 * @param args.calls - The model calls of this stage run.
 * @returns The pieces of the subtopic in order, and the cost of its sends. The cost is `null` when the subtopic was not sent.
 */
async function deepenSubtopic({
	subtopic,
	round,
	transcript,
	runNumber,
	context,
	calls,
}: DeepeningCallArgs & { readonly subtopic: Subtopic; readonly round: number }): Promise<{
	readonly pieces: readonly Subtopic[];
	readonly cost: StageCost | null;
}> {
	const passage = subtopicText({ text: transcript, subtopic });
	if (countWords(passage) <= context.config.subtopicSplitting.sizeGateWords) {
		return { pieces: [subtopic], cost: null };
	}
	const sent = await calls.sendJsonWithResends({
		what: `Deepening splitting run ${runNumber}, round ${round}, subtopic "${subtopic.title}"`,
		messages: buildDeepeningMessages({ passage }),
		isReply: isDeepenReply,
		documentedShape: DOCUMENTED_REPLY_SHAPE,
		use: ({ cuts }) => ({ reply: cutSubtopic({ transcript, subtopic, cuts }) }),
	});
	return { pieces: sent.reply, cost: sent.cost };
}

/**
 * Deepens one splitting run. Each deepening round sends the subtopics above the
 * size gate, up to the stage's `callConcurrency` at once. When `callConcurrency`
 * is unset, the stage sends one subtopic at a time. The stage puts the pieces of
 * each subtopic in the place of that subtopic. So the number of calls at once
 * never changes the deepened splitting run. A round that cuts nothing is the last round.
 * A subtopic whose third send is still unusable fails the stage, and is not kept
 * whole (technical-design.md §5, `deepen-subtopic-splitting`).
 *
 * @param args - The transcript, the splitting run, the stage context and the model calls.
 * @param args.transcript - The transcript that the spans of the splitting run index into.
 * @param args.splittingRunBeforeDeepening - The splitting run to deepen.
 * @param args.runNumber - The splitting run, counting from 1, for the log and the failure message.
 * @param args.context - The stage context.
 * @param args.calls - The model calls of this stage run.
 * @returns The deepened splitting run, and the cost of its calls. The cost is `null` when no subtopic was above the size gate.
 * @throws {ResendsExhaustedError} If the third send for a subtopic is still unusable.
 * @throws {DivisionNotLosslessError} If the deepened splitting run does not reproduce the transcript. A deepened splitting run that does not reproduce the transcript is always a bug.
 */
async function deepenSplittingRun({
	splittingRunBeforeDeepening,
	...underDeepening
}: DeepeningCallArgs & {
	readonly splittingRunBeforeDeepening: readonly Subtopic[];
}): Promise<{
	readonly run: readonly Subtopic[];
	readonly cost: StageCost | null;
}> {
	const { transcript, context } = underDeepening;
	const callConcurrency = configuredStage({
		config: context.config,
		stageId: STAGE_ID,
	})?.callConcurrency;
	let subtopics = splittingRunBeforeDeepening;
	let cost: StageCost | null = null;
	for (let round = 1; round <= MAX_ROUNDS; round += 1) {
		const deepened = await mapWithConcurrency({
			items: subtopics,
			limit: callConcurrency,
			work: ({ item: subtopic }) => deepenSubtopic({ ...underDeepening, subtopic, round }),
		});
		cost = totalCost([cost, ...deepened.map((outcome) => outcome.cost)]);
		const deeper = deepened.flatMap((outcome) => outcome.pieces);
		const cutAnything = deeper.length > subtopics.length;
		subtopics = deeper;
		if (!cutAnything) {
			break;
		}
	}
	assertLossless({ text: transcript, subtopics });
	return { run: subtopics, cost };
}

/**
 * Deepens every splitting run of the panel. The stage reads a saved run that an
 * earlier invocation made, and does not make that run again.
 *
 * @param args - The input, the stage context and the model calls of the stage run.
 * @param args.input - The transcript and the splitting runs before deepening.
 * @param args.context - The stage context.
 * @param args.calls - The model calls of this stage run.
 * @returns Every deepened splitting run, the cost of the calls of this invocation, and the saved runs.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger has mutable properties that the rule cannot ignore. This function does not use it. CLAUDE.md permits a mutable type that a library requires.
function deepenSplittingRuns({
	input,
	context,
	calls,
}: ModelStageRunArgs<DeepenSubtopicSplittingInput>): Promise<
	StageResult<DeepenSubtopicSplittingOutput>
> {
	return runStagePanel({
		stageId: STAGE_ID,
		context,
		...splittingPanel(context),
		makeRun: ({ runNumber }) =>
			deepenSplittingRun({
				transcript: input.transcript,
				splittingRunBeforeDeepening: input.splittingRunsBeforeDeepening[runNumber - 1] ?? [],
				runNumber,
				context,
				calls,
			}),
	});
}

/**
 * Reads the transcript and every splitting run before deepening.
 *
 * @param context - The stage context.
 * @returns The transcript with the whitespace at its ends removed, and the splitting runs in run order.
 * @throws {DeepenSubtopicSplittingError} If the transcript is missing or holds no text, or a splitting run is missing.
 * @throws {SavedRunUnreadableError} When a saved run holds no readable run.
 */
async function readInput(context: StageContext): Promise<DeepenSubtopicSplittingInput> {
	const { transcript, runs } = await readTranscriptAndRuns({
		context,
		panelStage: "initial-subtopic-splitting",
		fail: (message) => new DeepenSubtopicSplittingError(message),
	});
	return { transcript, splittingRunsBeforeDeepening: runs };
}

/** Builds the `deepen-subtopic-splitting` stage from the logger and the OpenAI client of the invocation. */
export const createDeepenSubtopicSplittingStage: ModelStageFactory<
	DeepenSubtopicSplittingInput,
	DeepenSubtopicSplittingOutput
> = defineModelStage({
	stageId: STAGE_ID,
	getInput: readInput,
	run: deepenSplittingRuns,
});
