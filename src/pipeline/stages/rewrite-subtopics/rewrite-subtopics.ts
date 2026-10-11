/**
 * The `rewrite-subtopics` stage. It writes the corrected text of each subtopic
 * as textbook prose (technical-design.md §5, `rewrite-subtopics`).
 */

/* jscpd:ignore-start -- the model-calling stages import the same pipeline types,
   division helpers and model-stage helpers. So their import blocks are the
   same line for line. Imports cannot be shared, and CLAUDE.md (File
   Organisation) forbids barrel files. Only the imports are exempt. jscpd
   checks the code below. */
import type { StageContext } from "../../../types/pipeline.js";
import { NamedError } from "../../../utils/errors.js";
import { isRecord, isStringList } from "../../../utils/record.js";
import { FIRST_ROUND } from "../../manifest.js";
import type { ModelStageFactory } from "../model-stage.js";
/* jscpd:ignore-end */
import {
	defineRewriteAttemptStage,
	hasRewriteAttemptFields,
	type RewriteAttemptWork,
} from "../rewrite-attempts.js";
import type { MadeFile } from "../saved-files.js";
import { readStageStructuredTranscript } from "../stage-input.js";
import { readTermCorrectionResult, type TermCorrectionResult } from "../term-corrections.js";
import { buildWriterMessages, WRITER_PROMPT_VERSION } from "./rewrite-subtopics.prompt.js";

/**
 * The error when an input file is missing or unreadable. A call whose third send
 * is still unusable fails the stage with `ResendsExhaustedError`.
 */
export class RewriteSubtopicsError extends NamedError {}

/**
 * Builds the stage's own error from a message.
 *
 * @param message - The message.
 * @returns The error.
 */
function fail(message: string): Error {
	return new RewriteSubtopicsError(message);
}

const STAGE_ID = "rewrite-subtopics";

/** The term-correction result of each subtopic, in lecture order. */
type RewriteSubtopicsInput = { readonly corrected: readonly TermCorrectionResult[] };

/** The reply that the writer prompt asks for. */
type WriterReply = { readonly paragraphs: readonly string[] };

/** The rewrite of one rewrite attempt of a subtopic, as the stage writes it (technical-design.md §5, `rewrite-subtopics`). */
type SubtopicRewrite = {
	readonly subtopicId: number;
	readonly attemptNumber: number;
	readonly writerPromptVersion: string;
	readonly rewrittenSubtopic: readonly string[];
};

/** The output of `rewrite-subtopics`. */
type RewriteSubtopicsOutput = {
	/** The rewrite of each subtopic, in lecture order. */
	readonly rewrites: readonly SubtopicRewrite[];
};

/** The text that ends the failure "The model's reply is not the documented …". */
const DOCUMENTED_REPLY_SHAPE = "{ paragraphs } object";

/**
 * Checks that a parsed reply has a list `paragraphs` of strings.
 *
 * @param value - The parsed reply.
 * @returns `true` when the value is a {@link WriterReply}.
 */
function isWriterReply(value: unknown): value is WriterReply {
	return isRecord(value) && isStringList(value.paragraphs);
}

/**
 * Reads the subtopics of the structured transcript, and the term-correction
 * result of each one.
 *
 * @param context - The stage context.
 * @returns The term-correction result of each subtopic, in lecture order.
 * @throws {RewriteSubtopicsError} If an input file is missing, unreadable or the wrong shape.
 */
async function readRewriteSubtopicsInput(context: StageContext): Promise<RewriteSubtopicsInput> {
	const { topics } = await readStageStructuredTranscript({ context, purpose: "rewrite", fail });
	const subtopicIds = topics.flatMap((topic) =>
		topic.subtopics.map((subtopic) => subtopic.subtopicId),
	);
	return {
		corrected: await Promise.all(
			subtopicIds.map((subtopicId) =>
				readTermCorrectionResult({ context, subtopicId, attemptNumber: FIRST_ROUND, fail }),
			),
		),
	};
}

/**
 * Gives the reply, or the reason that it is unusable. A reply with no paragraph,
 * or with a blank paragraph, is unusable.
 *
 * @param reply - The parsed reply, with the documented shape.
 * @returns The reply, or the reason that it is unusable.
 */
function usableReply(
	reply: WriterReply,
): { readonly reply: WriterReply } | { readonly failure: string } {
	if (reply.paragraphs.length === 0) {
		return { failure: "The model's reply gives no paragraph" };
	}
	return reply.paragraphs.some((paragraph) => paragraph.trim() === "")
		? { failure: "The model's reply gives a blank paragraph" }
		: { reply };
}

/**
 * Checks that a parsed saved file is a subtopic rewrite.
 *
 * @param value - The parsed file.
 * @returns `true` when the value is a {@link SubtopicRewrite}.
 */
function isSubtopicRewrite(value: unknown): value is SubtopicRewrite {
	return (
		hasRewriteAttemptFields(value) &&
		typeof value.writerPromptVersion === "string" &&
		isStringList(value.rewrittenSubtopic)
	);
}

/**
 * Rewrites one subtopic from its corrected text.
 *
 * @param args - The subtopic, the stage context and the model calls of the stage run.
 * @param args.subtopic - The term-correction result of the subtopic.
 * @param args.context - The stage context.
 * @param args.calls - The model calls of this stage run.
 * @returns The subtopic rewrite, and the cost of its calls.
 * @throws {ResendsExhaustedError} If the third send is still unusable.
 */
async function rewriteSubtopic({
	subtopic,
	context,
	calls,
}: RewriteAttemptWork<RewriteSubtopicsInput, TermCorrectionResult>): Promise<
	MadeFile<SubtopicRewrite>
> {
	const sent = await calls.sendJsonWithResends({
		what: `Rewrite of subtopic ${subtopic.subtopicId}`,
		messages: buildWriterMessages({
			text: subtopic.correctedText,
			language: context.config.finalOutput.language,
		}),
		isReply: isWriterReply,
		documentedShape: DOCUMENTED_REPLY_SHAPE,
		use: usableReply,
	});
	return {
		content: {
			subtopicId: subtopic.subtopicId,
			attemptNumber: FIRST_ROUND,
			writerPromptVersion: WRITER_PROMPT_VERSION,
			rewrittenSubtopic: sent.reply.paragraphs,
		},
		cost: sent.cost,
	};
}

/** Builds the `rewrite-subtopics` stage from the logger and the OpenAI client of the invocation. */
export const createRewriteSubtopicsStage: ModelStageFactory<
	RewriteSubtopicsInput,
	RewriteSubtopicsOutput
> = defineRewriteAttemptStage({
	stageId: STAGE_ID,
	getInput: readRewriteSubtopicsInput,
	subtopicsOf: (input) => input.corrected,
	isSaved: isSubtopicRewrite,
	saved: { content: "subtopic rewrite", remake: "rewrite the subtopic" },
	fail,
	make: rewriteSubtopic,
	output: (rewrites) => ({ rewrites }),
});
