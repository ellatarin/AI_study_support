/**
 * The `judge-lecture-title` stage. It judges whether the provisional title is
 * meaningful for the grouped lecture, and proposes an AI-derived title when it is
 * not (technical-design.md §5, `judge-lecture-title`).
 */

/* jscpd:ignore-start -- the model-calling stages import the same pipeline types,
   division helpers and model-stage helpers. So their import blocks are the
   same line for line. Imports cannot be shared, and CLAUDE.md (File
   Organisation) forbids barrel files. Only the imports are exempt. jscpd
   checks the code below. */
import type { LectureIdentityChanges, StageContext, StageResult } from "../../../types/pipeline.js";
import { errorMessage, NamedError } from "../../../utils/errors.js";
import { jsonFileContent } from "../../../utils/files.js";
import { isRecord } from "../../../utils/record.js";
import { baseNameForLecture } from "../../lecture-files.js";
import { subtopicsWithText } from "../division.js";
import {
	defineModelStage,
	type ModelStageFactory,
	type ModelStageRunArgs,
	sendJsonWithResends,
} from "../model-stage.js";
import { writeStageOutput } from "../pipeline-stage.js";
import { readStageTopics, readTranscriptAndDivision } from "../stage-input.js";
import type { Topic } from "../topics.js";
import { buildTitleJudgementMessages, type GroupedLecture } from "./judge-lecture-title.prompt.js";

/* jscpd:ignore-end */

/**
 * The error when the transcript, the retitled subtopics or the topics are missing
 * or unreadable. A call whose third send is still unusable fails the stage with
 * `ResendsExhaustedError`.
 */
export class JudgeLectureTitleError extends NamedError {}

const STAGE_ID = "judge-lecture-title";

/** The reply that the prompt asks for. */
type JudgementReply = {
	readonly provisionalTitleMeaningful: boolean;
	readonly suggestedTitle?: string | null;
	readonly judgedBecause: string;
};

/** The text that ends the failure "The model's reply is not the documented …". */
const DOCUMENTED_REPLY_SHAPE =
	"{ provisionalTitleMeaningful, suggestedTitle, judgedBecause } object";

/**
 * Checks that a parsed reply has the three fields of the prompt, with the right
 * types. An absent `suggestedTitle` means the same as a null one.
 *
 * @param value - The parsed reply.
 * @returns `true` when the value is a {@link JudgementReply}.
 */
function isJudgementReply(value: unknown): value is JudgementReply {
	if (!isRecord(value)) {
		return false;
	}
	const { suggestedTitle } = value;
	return (
		typeof value.provisionalTitleMeaningful === "boolean" &&
		typeof value.judgedBecause === "string" &&
		(suggestedTitle === null || suggestedTitle === undefined || typeof suggestedTitle === "string")
	);
}

/**
 * Reads the transcript, the retitled subtopics and the topics, and puts each
 * subtopic's title and text under its topic.
 *
 * @param context - The stage context.
 * @returns The grouped lecture.
 * @throws {JudgeLectureTitleError} If the transcript, the retitled subtopics or the topics are missing or unreadable.
 */
async function readGroupedLecture(context: StageContext): Promise<GroupedLecture> {
	const reading = {
		context,
		purpose: "judge",
		fail: (message: string) => new JudgeLectureTitleError(message),
	};
	const { transcript, subtopics } = await readTranscriptAndDivision({
		...reading,
		stageId: "retitle-subtopics",
	});
	const topics = await readStageTopics(reading);
	// A subtopic id counts from 1, so subtopic id N is at index N - 1. A topic runs
	// to the subtopic before the next topic's first.
	const startIndex = (topic: Topic | undefined): number =>
		topic === undefined ? subtopics.length : topic.firstSubtopicId - 1;
	return {
		topics: [...topics.entries()].map(([index, topic]) => ({
			title: topic.title,
			subtopics: subtopicsWithText({
				text: transcript,
				subtopics: subtopics.slice(startIndex(topic), startIndex(topics[index + 1])),
			}),
		})),
	};
}

/** The title judgement that the stage writes (technical-design.md §5, `judge-lecture-title`). */
export type TitleJudgement = {
	readonly provisionalTitle: string;
	readonly provisionalTitleMeaningful: boolean;
	readonly judgedBecause: string;
} & (
	| { readonly outcome: "kept-provisional"; readonly aiDerivedTitle: null }
	| {
			readonly outcome: "adopted-derived" | "kept-user-title";
			/** The title that the model proposed. */
			readonly aiDerivedTitle: string;
	  }
);

/**
 * Makes the title judgement from a reply, or gives the reason that the reply is
 * unusable (technical-design.md §5, `judge-lecture-title`). The model's proposed
 * title is ignored when the provisional title is meaningful.
 *
 * @param args - The reply, and the stage context.
 * @param args.reply - The parsed reply.
 * @param args.context - The stage context. It holds the lecture identity and the user title.
 * @returns The title judgement, or the reason that the reply is unusable.
 */
function titleJudgement({
	reply,
	context,
}: {
	readonly reply: JudgementReply;
	readonly context: StageContext;
}): { readonly reply: TitleJudgement } | { readonly failure: string } {
	const judged = {
		provisionalTitle: context.provisionalTitle,
		provisionalTitleMeaningful: reply.provisionalTitleMeaningful,
		judgedBecause: reply.judgedBecause,
	};
	if (reply.judgedBecause.trim() === "") {
		return { failure: "The model's reply gives a blank judgedBecause" };
	}
	if (reply.provisionalTitleMeaningful) {
		return context.provisionalTitle.trim() === ""
			? { failure: "The model judged an empty provisional title meaningful" }
			: { reply: { ...judged, aiDerivedTitle: null, outcome: "kept-provisional" } };
	}
	const aiDerivedTitle = reply.suggestedTitle?.trim() ?? "";
	if (aiDerivedTitle === "") {
		return {
			failure: "The model judged the provisional title not meaningful but proposed no title",
		};
	}
	try {
		baseNameForLecture({ ...context, title: aiDerivedTitle });
	} catch (error: unknown) {
		return {
			failure: `The model proposed "${aiDerivedTitle}", which cannot be used in a filename: ${errorMessage(error)}`,
		};
	}
	return {
		reply: {
			...judged,
			aiDerivedTitle,
			outcome: context.manifest.userTitle === null ? "adopted-derived" : "kept-user-title",
		},
	};
}

/**
 * The identity changes of a title judgement, for the runner to write. A user title
 * outranks the judgement, so only the AI-derived title is recorded then. The
 * rename for `adopted-derived` is not built yet.
 *
 * @param judgement - The title judgement.
 * @returns The identity changes.
 */
function identityChangesOf(judgement: TitleJudgement): LectureIdentityChanges {
	return judgement.outcome === "kept-user-title"
		? { aiDerivedTitle: judgement.aiDerivedTitle }
		: {};
}

/**
 * Asks the model to judge the provisional title against the grouped lecture, and
 * writes the title judgement. The debug log records the outcome, because every
 * later stage names its output from the lecture title (technical-design.md §10).
 *
 * @param args - The input, the stage context and the dependencies of the stage.
 * @param args.input - The grouped lecture.
 * @param args.context - The stage context.
 * @param args.logger - The logger that records the model call and the outcome.
 * @param args.client - The OpenAI client that sends the call.
 * @param args.sendGate - The send gate of this stage run. Every send waits on it.
 * @returns The title judgement, its identity changes, the cost of the call and the file written.
 * @throws {ResendsExhaustedError} If the third send is still unusable.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger and the OpenAI client have mutable properties that the rule cannot ignore. This function only reads them. CLAUDE.md permits a mutable type that a library requires.
async function judgeLectureTitle({
	input,
	context,
	logger,
	client,
	sendGate,
}: ModelStageRunArgs<GroupedLecture>): Promise<StageResult<TitleJudgement>> {
	const sent = await sendJsonWithResends({
		what: "Title judgement",
		messages: buildTitleJudgementMessages({
			lecture: input,
			provisionalTitle: context.provisionalTitle,
			language: context.config.finalOutput.language,
		}),
		stageId: STAGE_ID,
		context,
		isReply: isJudgementReply,
		documentedShape: DOCUMENTED_REPLY_SHAPE,
		logger,
		client,
		sendGate,
		use: (reply) => titleJudgement({ reply, context }),
	});
	const judgement = sent.reply;
	const { filesWritten } = await writeStageOutput({
		stageId: STAGE_ID,
		workspaceRoot: context.workspaceRoot,
		content: jsonFileContent(judgement),
	});
	logger.debug(
		{ aiDerivedTitle: judgement.aiDerivedTitle, outcome: judgement.outcome },
		"Decided lecture title",
	);
	return {
		output: judgement,
		cost: sent.cost,
		filesWritten,
		identityChanges: identityChangesOf(judgement),
	};
}

/** Builds the `judge-lecture-title` stage from the logger and the OpenAI client of the invocation. */
export const createJudgeLectureTitleStage: ModelStageFactory<GroupedLecture, TitleJudgement> =
	defineModelStage({ stageId: STAGE_ID, getInput: readGroupedLecture, run: judgeLectureTitle });
