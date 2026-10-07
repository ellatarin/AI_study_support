/**
 * The `group-into-topics` stage, the last division stage. A panel of grouping
 * runs groups the retitled subtopics into topics, with the `g23` prompt of the
 * prototype. The stage keeps the chosen grouping: the grouping that the most
 * runs made, or the winner of a tie (technical-design.md §5, `group-into-topics`).
 */

/* jscpd:ignore-start -- the model-calling stages import the same pipeline types,
   division helpers and model-stage helpers. So their import blocks are the
   same line for line. Imports cannot be shared, and CLAUDE.md (File
   Organisation) forbids barrel files. Only the imports are exempt. jscpd
   checks the code below. */
import type { StageResult } from "../../../types/pipeline.js";
import { isRecord } from "../../../utils/record.js";
import { isTitledReplyPart, subtopicsWithText, type TitledReplyPart } from "../division.js";
import {
	defineModelStage,
	type ModelStageFactory,
	type ModelStageRunArgs,
} from "../model-stage.js";
import { runOneCallPanel } from "../panel-runs.js";
import { writeStageOutputWithStageRecord } from "../pipeline-stage.js";
import { readTranscriptAndDivision, type TranscriptAndDivision } from "../stage-input.js";
import { isTopic, type Topic } from "../topics.js";
import { chooseGrouping, GroupIntoTopicsError, type GroupingRun } from "./choose-grouping.js";
import { buildGroupingMessages } from "./group-into-topics.prompt.js";

/* jscpd:ignore-end */

const STAGE_ID = "group-into-topics";

/** One topic as the `g23` prompt asks for it: its title, its reason, and the subtopic id where it starts. */
type ReplyTopic = TitledReplyPart & { readonly firstSubtopicId: number };

/** The reply that the `g23` prompt asks for: the topics of one grouping run, in order. */
type GroupingReply = { readonly topics: readonly ReplyTopic[] };

/** The text that ends the failure "The model's reply is not the documented …". */
const DOCUMENTED_REPLY_SHAPE = "{ topics: [{ label, groupedBecause, firstSubtopicId }] } object";

/**
 * Checks that a value in a parsed reply is one topic.
 *
 * @param value - One entry of the list in the reply.
 * @returns `true` when it has a string `label`, a string `groupedBecause` and a number `firstSubtopicId`.
 */
function isReplyTopic(value: unknown): value is ReplyTopic {
	return isTitledReplyPart(value) && typeof value.firstSubtopicId === "number";
}

/**
 * Checks that a value is an object that holds a list of topics. A reply and a
 * saved run have this shape. Their topics use different keys.
 *
 * @param args - The value, and the check for one topic.
 * @param args.value - The parsed reply or saved run.
 * @param args.isOneTopic - Checks that one entry of the list is a topic.
 * @returns `true` when the value holds a list and each entry is a topic.
 */
function holdsTopics({
	value,
	isOneTopic,
}: {
	readonly value: unknown;
	readonly isOneTopic: (entry: unknown) => boolean;
}): boolean {
	return isRecord(value) && Array.isArray(value.topics) && value.topics.every(isOneTopic);
}

/**
 * Checks that a parsed reply is a list of topics.
 *
 * @param value - The parsed reply.
 * @returns `true` when it holds a list and each entry is a topic.
 */
function isGroupingReply(value: unknown): value is GroupingReply {
	return holdsTopics({ value, isOneTopic: isReplyTopic });
}

/**
 * Checks that the topics of a reply put each subtopic in exactly one topic:
 * - There is at least one topic.
 * - The first topic starts at subtopic 1.
 * - Each later topic starts after the topic before it.
 * - No topic starts after the last subtopic.
 *
 * Each topic must also have a title and a reason that are not blank. A reply
 * that fails a check is an unusable reply, and it is resent.
 *
 * @param args - The reply, and the number of subtopics that it groups.
 * @param args.reply - The parsed reply.
 * @param args.subtopicCount - The number of subtopics in the lecture.
 * @returns The grouping run that the reply gives, or the reason that the reply is unusable.
 */
function checkGrouping({
	reply,
	subtopicCount,
}: {
	readonly reply: GroupingReply;
	readonly subtopicCount: number;
}): { readonly reply: GroupingRun } | { readonly failure: string } {
	if (reply.topics.length === 0) {
		return { failure: "The model's reply holds no topics" };
	}
	if (
		reply.topics.some((topic) => topic.label.trim() === "" || topic.groupedBecause.trim() === "")
	) {
		return { failure: "The model's reply gives a topic a blank title or groupedBecause" };
	}
	const starts = reply.topics.map((topic) => topic.firstSubtopicId);
	const eachAfterTheLast = [...starts.entries()].every(
		([index, start]) => start > (starts[index - 1] ?? 0),
	);
	if (starts[0] !== 1 || !eachAfterTheLast || Math.max(...starts) > subtopicCount) {
		return {
			failure: `The model's reply does not start its topics at subtopic 1 and then each later than the last, up to subtopic ${subtopicCount}`,
		};
	}
	return { reply: asGroupingRun(reply) };
}

/**
 * Checks that a value parsed from a saved run is a grouping run.
 *
 * @param value - A value parsed from a saved run.
 * @returns `true` when it holds a list and each entry is a topic.
 */
function isGroupingRun(value: unknown): value is GroupingRun {
	return holdsTopics({ value, isOneTopic: isTopic });
}

/**
 * Reads a saved run.
 *
 * @param value - A value parsed from a saved run.
 * @returns The grouping run, or `null` when the value is not one.
 */
function readGroupingRun(value: unknown): GroupingRun | null {
	return isGroupingRun(value) ? value : null;
}

/** The output of the stage: the topics of the chosen run, in order. */
type GroupIntoTopicsOutput = { readonly topics: readonly Topic[] };

/**
 * Changes a reply into the grouping run that is saved and that the chooser
 * reads. The `label` of the reply becomes `title`. The code uses the name
 * `title` because it is easier to read. The prompt keeps the word `label`.
 *
 * @param reply - A grouping run as the model replied.
 * @returns The topics of the run, with titles.
 */
function asGroupingRun(reply: GroupingReply): GroupingRun {
	return {
		topics: reply.topics.map(({ label, groupedBecause, firstSubtopicId }) => ({
			title: label,
			groupedBecause,
			firstSubtopicId,
		})),
	};
}

/**
 * Makes the panel of grouping runs, and chooses a grouping from it. Then it
 * writes the topics of the chosen grouping, with the stage record of the choice
 * beside them.
 *
 * @param args - The input, the stage context and the model calls of the stage run.
 * @param args.input - The transcript and the retitled division.
 * @param args.context - The stage context.
 * @param args.calls - The model calls of this stage run.
 * @returns The chosen topics, the cost of the calls of this invocation, and every file written.
 */
async function groupIntoTopics(
	// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger and the OpenAI client have mutable properties that the rule cannot ignore. This function only reads them. CLAUDE.md permits a mutable type that a library requires.
	args: ModelStageRunArgs<TranscriptAndDivision>,
): Promise<StageResult<GroupIntoTopicsOutput>> {
	const { context } = args;
	const panel = await makeGroupingRuns(args);
	const { topics, choice } = chooseGrouping({
		runs: panel.output.runs,
		bar: context.config.grouping.bar,
	});
	const written = await writeStageOutputWithStageRecord({
		stageId: STAGE_ID,
		context,
		value: topics,
		stageRecord: choice,
	});
	return {
		output: { topics },
		cost: panel.cost,
		filesWritten: [...panel.filesWritten, ...written.filesWritten],
	};
}

/**
 * Makes the panel of grouping runs. The stage reads a saved run that an earlier
 * invocation made, and does not make that run again.
 *
 * @param args - The input, the stage context and the dependencies of the stage.
 * @param args.input - The transcript and the retitled division.
 * @param args.context - The stage context.
 * @param args.calls - The model calls of this stage run.
 * @returns Every grouping run, the cost of the calls of this invocation, and the saved runs.
 */
function makeGroupingRuns(
	// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger has mutable properties that the rule cannot ignore. This function does not use it. CLAUDE.md permits a mutable type that a library requires.
	args: ModelStageRunArgs<TranscriptAndDivision>,
): Promise<StageResult<{ readonly runs: readonly GroupingRun[] }>> {
	const { input, context, calls } = args;
	const messages = buildGroupingMessages({
		subtopics: subtopicsWithText({ text: input.transcript, subtopics: input.subtopics }),
	});
	return runOneCallPanel({
		stageId: STAGE_ID,
		context,
		panelSize: context.config.grouping.panelSize,
		readRun: readGroupingRun,
		runName: "Grouping run",
		calls,
		request: {
			messages,
			isReply: isGroupingReply,
			documentedShape: DOCUMENTED_REPLY_SHAPE,
			use: (reply) => checkGrouping({ reply, subtopicCount: input.subtopics.length }),
		},
	});
}

/**
 * Builds the `group-into-topics` stage from the logger and the OpenAI client of
 * the invocation. The stage reads the transcript and the retitled division. It
 * fails with {@link GroupIntoTopicsError} when either is missing or unreadable.
 */
export const createGroupIntoTopicsStage: ModelStageFactory<
	TranscriptAndDivision,
	GroupIntoTopicsOutput
> = defineModelStage({
	stageId: STAGE_ID,
	getInput: (context) =>
		readTranscriptAndDivision({
			context,
			stageId: "retitle-subtopics",
			purpose: "group",
			fail: (message) => new GroupIntoTopicsError(message),
		}),
	run: groupIntoTopics,
});
