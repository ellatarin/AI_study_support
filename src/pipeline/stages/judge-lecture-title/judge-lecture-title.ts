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
import { moduleDirs } from "../../layout.js";
import { baseNameForLecture, renameLectureFiles } from "../../lecture-files.js";
import { subtopicsWithText } from "../division.js";
import {
	defineModelStage,
	type ModelStageFactory,
	type ModelStageRunArgs,
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

/** A title judgement, and the identity changes that it decides for the runner to write (technical-design.md §4.2). */
type DecidedTitle = {
	readonly judgement: TitleJudgement;
	readonly identityChanges: LectureIdentityChanges;
};

/**
 * Gives the identity changes that bring the lecture back to its provisional title,
 * for `kept-provisional`. An earlier run can have given the lecture an AI-derived
 * title and its base name. A user title outranks the provisional title, so then
 * only the AI-derived title is cleared. Only the fields that differ are returned.
 *
 * @param context - The stage context. It holds the lecture identity and the user title.
 * @returns The identity changes. They are empty when the lecture already has its provisional title.
 */
function changesBackToProvisional(context: StageContext): LectureIdentityChanges {
	const clearsAiDerivedTitle =
		context.manifest.aiDerivedTitle === null ? {} : { aiDerivedTitle: null };
	if (context.manifest.userTitle !== null || context.lectureTitle === context.provisionalTitle) {
		return clearsAiDerivedTitle;
	}
	return {
		...clearsAiDerivedTitle,
		lectureTitle: context.provisionalTitle,
		baseName: baseNameForLecture({ ...context, title: context.provisionalTitle }),
	};
}

/**
 * Makes the title judgement and its identity changes from a reply, or gives the
 * reason that the reply is unusable (technical-design.md §5, `judge-lecture-title`).
 * The model's proposed title is ignored when the provisional title is meaningful.
 * A user title outranks the judgement, so only the AI-derived title is recorded then.
 *
 * @param args - The reply, and the stage context.
 * @param args.reply - The parsed reply.
 * @param args.context - The stage context. It holds the lecture identity and the user title.
 * @returns The title judgement and its identity changes, or the reason that the reply is unusable.
 */
function decideTitle({
	reply,
	context,
}: {
	readonly reply: JudgementReply;
	readonly context: StageContext;
}): { readonly reply: DecidedTitle } | { readonly failure: string } {
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
			: {
					reply: {
						judgement: { ...judged, aiDerivedTitle: null, outcome: "kept-provisional" },
						identityChanges: changesBackToProvisional(context),
					},
				};
	}
	const aiDerivedTitle = reply.suggestedTitle?.trim() ?? "";
	if (aiDerivedTitle === "") {
		return {
			failure: "The model judged the provisional title not meaningful but proposed no title",
		};
	}
	let baseName: string;
	try {
		baseName = baseNameForLecture({ ...context, title: aiDerivedTitle });
	} catch (error: unknown) {
		return {
			failure: `The model proposed "${aiDerivedTitle}", which cannot be used in a filename: ${errorMessage(error)}`,
		};
	}
	if (context.manifest.userTitle !== null) {
		return {
			reply: {
				judgement: { ...judged, aiDerivedTitle, outcome: "kept-user-title" },
				identityChanges: { aiDerivedTitle },
			},
		};
	}
	return {
		reply: {
			judgement: { ...judged, aiDerivedTitle, outcome: "adopted-derived" },
			identityChanges: { aiDerivedTitle, lectureTitle: aiDerivedTitle, baseName },
		},
	};
}

/**
 * Asks the model to judge the provisional title against the grouped lecture, and
 * writes the title judgement. For `adopted-derived`, it then moves the lecture
 * files to the new base name. The judgement is written first, because the move
 * changes the workspace path (technical-design.md §5, `judge-lecture-title`,
 * "Order of Operations"). The debug log records the outcome, because every later
 * stage names its output from the lecture title (technical-design.md §10).
 *
 * @param args - The input, the stage context, the logger and the model calls of the stage run.
 * @param args.input - The grouped lecture.
 * @param args.context - The stage context.
 * @param args.logger - The logger that records the outcome.
 * @param args.calls - The model calls of this stage run.
 * @returns The title judgement, its identity changes, the cost of the call and the file written.
 * @throws {ResendsExhaustedError} If the third send is still unusable.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger has mutable properties that the rule cannot ignore. This function only writes log lines to it. CLAUDE.md permits a mutable type that a library requires.
async function judgeLectureTitle({
	input,
	context,
	logger,
	calls,
}: ModelStageRunArgs<GroupedLecture>): Promise<StageResult<TitleJudgement>> {
	const sent = await calls.sendJsonWithResends({
		what: "Title judgement",
		messages: buildTitleJudgementMessages({
			lecture: input,
			provisionalTitle: context.provisionalTitle,
			language: context.config.finalOutput.language,
		}),
		isReply: isJudgementReply,
		documentedShape: DOCUMENTED_REPLY_SHAPE,
		use: (reply) => decideTitle({ reply, context }),
	});
	const { judgement, identityChanges } = sent.reply;
	const { filesWritten } = await writeStageOutput({
		stageId: STAGE_ID,
		context,
		content: jsonFileContent(judgement),
	});
	logger.debug(
		{ aiDerivedTitle: judgement.aiDerivedTitle, outcome: judgement.outcome },
		"Decided lecture title",
	);
	if (identityChanges.baseName !== undefined) {
		await renameLectureFiles({
			dirs: moduleDirs({ moduleRoot: context.moduleRoot }),
			workspaceRoot: context.workspaceRoot,
			lectureDate: context.lectureDate,
			baseName: identityChanges.baseName,
		});
	}
	return { output: judgement, cost: sent.cost, filesWritten, identityChanges };
}

/** Builds the `judge-lecture-title` stage from the logger and the OpenAI client of the invocation. */
export const createJudgeLectureTitleStage: ModelStageFactory<GroupedLecture, TitleJudgement> =
	defineModelStage({ stageId: STAGE_ID, getInput: readGroupedLecture, run: judgeLectureTitle });
