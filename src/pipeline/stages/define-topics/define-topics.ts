/**
 * `define-topics`: groups the retitled subtopics into topics by a panel of
 * grouping runs with the prototype's `g23` prompt, and keeps the grouping the
 * most runs made (technical-design.md §5, `define-topics`).
 */

/* jscpd:ignore-start -- the model-calling stages pull in the same pipeline types,
   division helpers and model-stage helpers, so their import blocks match line
   for line. There is nothing to extract: imports cannot be shared, and barrel
   files are forbidden (CLAUDE.md, File Organisation). Only the imports are
   exempt; the code below is checked as normal. */
import type { StageResult } from "../../../types/pipeline.js";
import { isRecord } from "../../../utils/record.js";
import { isNamedReplyPart, type NamedReplyPart, subtopicText } from "../division.js";
import {
	defineModelStage,
	type ModelStageFactory,
	type ModelStageRunArgs,
} from "../model-stage.js";
import { runOneCallPanel } from "../panel-runs.js";
import { writeStageOutputWithRecord } from "../pipeline-stage.js";
import { readTranscriptAndDivision, type TranscriptAndDivision } from "../stage-input.js";
import {
	chooseGrouping,
	DefineTopicsError,
	type GroupingRun,
	type Topic,
} from "./choose-grouping.js";
import { buildGroupingMessages } from "./define-topics.prompt.js";

/* jscpd:ignore-end */

const STAGE_ID = "define-topics";

/** One topic as the `g23` prompt asks for it: its title and reason, and the subtopic it starts at. */
type ReplyTopic = NamedReplyPart & { readonly firstSubtopicId: number };

/** A grouping run as the model replied: its topics, in order. Saved as it came. */
type GroupingReply = { readonly topics: readonly ReplyTopic[] };

/** The reply's shape in words, for the failure a user reads when a reply is not one. */
const DOCUMENTED_REPLY_SHAPE = "{ topics: [{ label, groupedBecause, firstSubtopicId }] } object";

/**
 * Whether a value in a parsed reply is one topic.
 *
 * @param value - One entry of the reply's list.
 * @returns `true` when it carries a string label and reason and a numeric first subtopic.
 */
function isReplyTopic(value: unknown): value is ReplyTopic {
	return isNamedReplyPart(value) && typeof value.firstSubtopicId === "number";
}

/**
 * Whether a parsed reply is the documented list of topics.
 *
 * @param value - The parsed reply.
 * @returns `true` when it holds a list whose every entry is a topic.
 */
function isGroupingReply(value: unknown): value is GroupingReply {
	return isRecord(value) && Array.isArray(value.topics) && value.topics.every(isReplyTopic);
}

/**
 * Checks that a reply's topics put every subtopic in exactly one topic: there
 * is at least one, the first starts at subtopic 1, each later one starts after
 * the one before, and none starts past the last subtopic. Every topic must also
 * carry a title and a reason. Anything else is resent.
 *
 * @param args - The reply, and how many subtopics it groups.
 * @param args.reply - The parsed reply.
 * @param args.subtopicCount - How many subtopics the lecture has.
 * @returns The reply unchanged, or why it could not be used.
 */
function checkGrouping({
	reply,
	subtopicCount,
}: {
	readonly reply: GroupingReply;
	readonly subtopicCount: number;
}): { readonly reply: GroupingReply } | { readonly failure: string } {
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
	return { reply };
}

/**
 * Reads a saved run back.
 *
 * @param value - A value parsed from a run file.
 * @returns The run, or `null` when the value is not one.
 */
function readGroupingRun(value: unknown): GroupingReply | null {
	return isGroupingReply(value) ? value : null;
}

/** What the stage hands on: the chosen run's topics, in order. */
type DefineTopicsOutput = { readonly topics: readonly Topic[] };

/**
 * A run as the chooser reads it: the reply's `label`, the prompt's word, read as the topic's title.
 *
 * @param reply - A grouping run as the model replied.
 * @returns The run's topics, titled.
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
 * Makes the panel of grouping runs, resuming from any an earlier launch saved,
 * then writes the topics of the grouping chosen from them, with the record
 * beside them of how it was chosen.
 *
 * @param args - The stage's input, context and dependencies.
 * @param args.input - The transcript and the retitled division.
 * @param args.context - The current lecture run context.
 * @param args.logger - The run's logger, on which each model call is recorded.
 * @param args.client - The OpenAI client the calls go through.
 * @returns The chosen topics, what this launch's calls cost, and every file written.
 */
async function defineTopics(
	// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger and the OpenAI client carry mutable properties the rule cannot see past; both are only read from here (CLAUDE.md permits dropping readonly where a library requires a mutable type)
	args: ModelStageRunArgs<TranscriptAndDivision>,
): Promise<StageResult<DefineTopicsOutput>> {
	const { context } = args;
	const panel = await makeGroupingRuns(args);
	const { topics, choice } = chooseGrouping({
		runs: panel.output.runs.map(asGroupingRun),
		bar: context.config.grouping.bar,
	});
	const written = await writeStageOutputWithRecord({
		stageId: STAGE_ID,
		workspaceRoot: context.workspaceRoot,
		value: topics,
		record: choice,
	});
	return {
		output: { topics },
		cost: panel.cost,
		filesWritten: [...panel.filesWritten, ...written.filesWritten],
	};
}

/**
 * Makes the panel of grouping runs, resuming from any an earlier launch saved.
 *
 * @param args - The stage's input, context and dependencies.
 * @param args.input - The transcript and the retitled division.
 * @param args.context - The current lecture run context.
 * @param args.logger - The run's logger, on which each model call is recorded.
 * @param args.client - The OpenAI client the calls go through.
 * @returns Every run, what this launch's calls cost, and the run files.
 */
function makeGroupingRuns(
	// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger and the OpenAI client carry mutable properties the rule cannot see past; both are only read from here (CLAUDE.md permits dropping readonly where a library requires a mutable type)
	args: ModelStageRunArgs<TranscriptAndDivision>,
): Promise<StageResult<{ readonly runs: readonly GroupingReply[] }>> {
	const { input, context, logger, client } = args;
	const messages = buildGroupingMessages({
		subtopics: input.subtopics.map((subtopic) => ({
			title: subtopic.title,
			text: subtopicText({ text: input.transcript, subtopic }),
		})),
	});
	return runOneCallPanel({
		stageId: STAGE_ID,
		context,
		panelSize: context.config.grouping.panelSize,
		readRun: readGroupingRun,
		runName: "Grouping run",
		request: {
			messages,
			isReply: isGroupingReply,
			documentedShape: DOCUMENTED_REPLY_SHAPE,
			logger,
			client,
			use: (reply) => checkGrouping({ reply, subtopicCount: input.subtopics.length }),
		},
	});
}

/**
 * Builds the `define-topics` stage from the run's logger and the invocation's
 * OpenAI client. It starts from the transcript and the retitled division, and
 * fails with a {@link DefineTopicsError} when either is missing or unreadable.
 */
export const createDefineTopicsStage: ModelStageFactory<TranscriptAndDivision, DefineTopicsOutput> =
	defineModelStage({
		stageId: STAGE_ID,
		getInput: (context) =>
			readTranscriptAndDivision({
				context,
				stageId: "retitle-subtopics",
				purpose: "group",
				fail: (message) => new DefineTopicsError(message),
			}),
		run: defineTopics,
	});
