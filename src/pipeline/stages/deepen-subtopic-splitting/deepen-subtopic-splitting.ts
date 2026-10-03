/**
 * `deepen-subtopic-splitting`: the second of the three division stages. In each
 * initial splitting run, every subtopic over the size gate is sent on its own
 * with the `d13` prompt and cut where the model says it divides, for at most two
 * rounds (technical-design.md §5, "Dividing the transcript").
 */

/* jscpd:ignore-start -- the division stages pull in the same pipeline types,
   division helpers and model-stage helpers, so their import blocks match line
   for line. There is nothing to extract: imports cannot be shared, and barrel
   files are forbidden (CLAUDE.md, File Organisation). Only the imports are
   exempt; the code below is checked as normal. */
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
	replyNaming,
	type Subtopic,
	sliceSubtopics,
	splittingPanel,
	subtopicText,
} from "../division.js";
import {
	defineModelStage,
	type ModelStageDependencies,
	type ModelStageFactory,
	type ModelStageRunArgs,
} from "../model-stage.js";
import { runStagePanel, sendJsonWithResends } from "../panel-runs.js";
import { readTranscriptAndRuns } from "../stage-input.js";
import { buildDeepeningMessages } from "./deepen-subtopic-splitting.prompt.js";
/* jscpd:ignore-end */

/**
 * Thrown when there is nothing to deepen: the transcript is missing or empty, or
 * an initial splitting run is missing. A subtopic whose replies stay unusable
 * fails the stage with the panel's own error.
 */
export class DeepenSubtopicSplittingError extends NamedError {}

const STAGE_ID = "deepen-subtopic-splitting";

/**
 * How many rounds a run is deepened for. A second round asks again about every
 * subtopic still over the gate; the prototype measured nothing gained by a third.
 */
const MAX_ROUNDS = 2;

/** The transcript, and the initial splitting runs this stage deepens. */
export type DeepenSubtopicSplittingInput = {
	readonly transcript: string;
	readonly initialRuns: readonly (readonly Subtopic[])[];
};

/** Every deepened run, in run order: one per initial run. */
export type DeepenSubtopicSplittingOutput = { readonly runs: readonly (readonly Subtopic[])[] };

/** The object the `d13` prompt asks for. Its `verdict` is not read: no cuts means one step. */
type DeepenReply = { readonly cuts: readonly ReplySubtopic[] };

/** The reply's shape in words, for the failure a user reads when a reply is not one. */
const DOCUMENTED_REPLY_SHAPE = "{ cuts: [{ label, groupedBecause, startsWith }] } object";

/**
 * Whether a parsed reply is the documented list of cuts. An empty list is the
 * model saying the subtopic is one step.
 *
 * @param value - The parsed reply.
 * @returns `true` when every cut carries its three strings.
 */
function isDeepenReply(value: unknown): value is DeepenReply {
	return isRecord(value) && Array.isArray(value.cuts) && value.cuts.every(isReplySubtopic);
}

/**
 * How many words a text holds, counted by code rather than estimated by the model.
 *
 * @param text - The text to count.
 * @returns The number of runs of non-whitespace.
 */
function countWords(text: string): number {
	return text.split(/\s+/u).filter((word) => word.length > 0).length;
}

/**
 * The cuts in a reply that can be found inside the subtopic's own text, each
 * searched for forward from the one before. A cut that cannot be found — one
 * proposed outside this subtopic, say — is dropped rather than guessed at, so
 * deepening can add cuts but never move one it did not make.
 *
 * @param args - The subtopic's text, and the cuts proposed in it.
 * @param args.passage - The subtopic's text.
 * @param args.cuts - The cuts the reply proposed, in order.
 * @returns The cuts that were found, and where each falls in the passage, after the passage's own start at 0.
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
		// The first quote stands for the passage's own start, which is never searched for.
		const placed = placeCuts({
			text: passage,
			quotes: ["", ...[...kept, cut].map((proposed) => proposed.startsWith)],
		});
		if ("cuts" in placed) {
			kept = [...kept, cut];
			positions = placed.cuts;
		}
	}
	return { kept, positions };
}

/**
 * Cuts one subtopic where the reply says it divides. The first piece keeps the
 * subtopic's own title and reason; each later one takes its cut's.
 *
 * @param args - The transcript, the subtopic, and the cuts proposed in it.
 * @param args.transcript - The transcript the subtopic's span indexes into.
 * @param args.subtopic - The subtopic that was sent.
 * @param args.cuts - The cuts the reply proposed.
 * @returns The subtopic's pieces, in order; the subtopic itself when nothing was cut.
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
		named: [subtopic, ...kept.map(replyNaming)],
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

/** A run being deepened, and what the calls about it need. */
type RunUnderDeepening = {
	readonly transcript: string;
	readonly runNumber: number;
	readonly context: StageContext;
} & ModelStageDependencies &
	Pick<ModelStageRunArgs<unknown>, "sendGate">;

/**
 * Deepens one subtopic in one round: sends it when it is over the size gate and
 * cuts it where the reply says it divides. One at or under the gate is never sent.
 *
 * @param args - The subtopic, the round, and the run it belongs to.
 * @param args.subtopic - The subtopic to deepen.
 * @param args.round - The round, counting from 1, for the log and any failure.
 * @param args.transcript - The transcript the subtopic's span indexes into.
 * @param args.runNumber - The run, counting from 1, for the log and any failure.
 * @param args.context - The current lecture run context.
 * @param args.logger - The stage's logger.
 * @param args.client - The OpenAI client the call goes through.
 * @param args.sendGate - The run's turns to send, which the call waits on.
 * @returns The subtopic's pieces, in order, and what its sends cost — `null` when it was not sent.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino Logger and OpenAI client are library types that are not deeply readonly
async function deepenSubtopic({
	subtopic,
	round,
	transcript,
	runNumber,
	context,
	logger,
	client,
	sendGate,
}: RunUnderDeepening & { readonly subtopic: Subtopic; readonly round: number }): Promise<{
	readonly pieces: readonly Subtopic[];
	readonly cost: StageCost | null;
}> {
	const passage = subtopicText({ text: transcript, subtopic });
	if (countWords(passage) <= context.config.division.sizeGateWords) {
		return { pieces: [subtopic], cost: null };
	}
	const sent = await sendJsonWithResends({
		what: `Deepening run ${runNumber}, round ${round}, subtopic "${subtopic.title}"`,
		messages: buildDeepeningMessages({ passage }),
		stageId: STAGE_ID,
		context,
		isReply: isDeepenReply,
		documentedShape: DOCUMENTED_REPLY_SHAPE,
		logger,
		client,
		sendGate,
		use: ({ cuts }) => ({ reply: cutSubtopic({ transcript, subtopic, cuts }) }),
	});
	return { pieces: sent.reply, cost: sent.cost };
}

/**
 * Deepens one initial splitting run. Each round sends every subtopic over the
 * size gate, as many at once as the stage's `callConcurrency` allows — one at a
 * time when it is unset — and puts each one's pieces back in its place, so how
 * many are sent together never changes the result. When a round cuts nothing,
 * another would ask the same questions again, so there is none. A subtopic
 * whose every send fails fails the stage, rather than being left whole as
 * though the model had called it one step.
 *
 * @param args - The transcript, the run, and what the calls need.
 * @param args.transcript - The transcript the run's spans index into.
 * @param args.initialRun - The initial splitting run to deepen.
 * @param args.runNumber - The run, counting from 1, for the log and any failure.
 * @param args.context - The current lecture run context.
 * @param args.logger - The stage's logger.
 * @param args.client - The OpenAI client the calls go through.
 * @returns The deepened run, and what its calls cost — `null` when none was over the gate.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino Logger and OpenAI client are library types that are not deeply readonly
async function deepenRun({
	initialRun,
	...underDeepening
}: RunUnderDeepening & { readonly initialRun: readonly Subtopic[] }): Promise<{
	readonly run: readonly Subtopic[];
	readonly cost: StageCost | null;
}> {
	const { transcript, context } = underDeepening;
	const callConcurrency = configuredStage({
		config: context.config,
		stageId: STAGE_ID,
	})?.callConcurrency;
	let subtopics = initialRun;
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
 * Makes the panel of deepened runs, one per initial run, resuming from any an
 * earlier launch saved.
 *
 * @param args - The stage's input, context and dependencies.
 * @param args.input - The transcript and the initial runs.
 * @param args.context - The current lecture run context.
 * @param args.logger - The run's logger, on which each model call is recorded.
 * @param args.client - The OpenAI client the calls go through.
 * @param args.sendGate - The run's turns to send, which every call waits on.
 * @returns Every deepened run, what this launch's calls cost, and the run files.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger and the OpenAI client carry mutable properties the rule cannot see past; both are only read from here (CLAUDE.md permits dropping readonly where a library requires a mutable type)
function deepenRuns({
	input,
	context,
	logger,
	client,
	sendGate,
}: ModelStageRunArgs<DeepenSubtopicSplittingInput>): Promise<
	StageResult<DeepenSubtopicSplittingOutput>
> {
	return runStagePanel({
		stageId: STAGE_ID,
		context,
		...splittingPanel(context),
		makeRun: ({ runNumber }) =>
			deepenRun({
				transcript: input.transcript,
				initialRun: input.initialRuns[runNumber - 1] ?? [],
				runNumber,
				context,
				logger,
				client,
				sendGate,
			}),
	});
}

/**
 * Reads the transcript and every initial splitting run.
 *
 * @param context - The current lecture run context.
 * @returns The transcript, trimmed, and the initial runs in run order.
 * @throws {DeepenSubtopicSplittingError} If the transcript is missing or empty, or an initial run is missing.
 */
async function readInput(context: StageContext): Promise<DeepenSubtopicSplittingInput> {
	const { transcript, runs } = await readTranscriptAndRuns({
		context,
		panelStage: "initial-subtopic-splitting",
		fail: (message) => new DeepenSubtopicSplittingError(message),
	});
	return { transcript, initialRuns: runs };
}

/**
 * Builds the `deepen-subtopic-splitting` stage from the run's logger and the
 * invocation's OpenAI client.
 */
export const createDeepenSubtopicSplittingStage: ModelStageFactory<
	DeepenSubtopicSplittingInput,
	DeepenSubtopicSplittingOutput
> = defineModelStage({
	stageId: STAGE_ID,
	getInput: readInput,
	run: deepenRuns,
});
