/**
 * The `correct-factual-errors` stage. It sends each subtopic that has factual
 * errors to the model, and writes the fact-corrected subtopic of each subtopic
 * (technical-design.md §5, `correct-factual-errors`).
 */

/* jscpd:ignore-start -- the modules of the fact-check stages import the same
   pipeline types and shared helpers. So their import blocks are the same line
   for line. Imports cannot be shared, and CLAUDE.md (File Organisation) forbids
   barrel files. Only the imports are exempt. jscpd checks the code below. */
import type { StageContext } from "../../../types/pipeline.js";
import { formatDateISO } from "../../../utils/date.js";
import { NamedError } from "../../../utils/errors.js";
import { isRecord, isStringList } from "../../../utils/record.js";
import { stageConfigFor } from "../../openrouter.js";
import {
	type ChangedWords,
	type FactCorrectionFile,
	type FactCorrectionRecord,
	hasChangedWords,
	isFactCorrectionFile,
} from "../fact-corrections.js";
import {
	type FactualErrorsFile,
	type MergedFactualError,
	readFactualErrorsFile,
} from "../factual-errors.js";
import { rejectBlankParagraphs } from "../model-stage.js";
import { defineSubtopicAndLectureFileStage, type SubtopicWork } from "../subtopic-files.js";
import { readTitledRewrites } from "../subtopic-rewrites.js";
import {
	buildFactCorrectionMessages,
	FACT_CORRECTION_PROMPT_VERSION,
	type FactCorrectionMaterial,
	isSentFactualErrorNumber,
} from "./correct-factual-errors.prompt.js";
/* jscpd:ignore-end */

/**
 * The error of the stage in two cases:
 * - an input file is missing or unreadable
 * - a saved file of a subtopic holds nothing readable.
 */
export class CorrectFactualErrorsError extends NamedError {}

const STAGE_ID = "correct-factual-errors";

/**
 * Checks that the fact correction is a bypassed stage in this run.
 *
 * @param context - The stage context, which holds the config of the stage.
 * @returns `true` when the stage's `bypass` switch is on.
 */
function isBypassed(context: StageContext): boolean {
	return context.config.stages[STAGE_ID]?.bypass === true;
}

/**
 * Gives the model and the date of the fact correction, for the file of the whole lecture.
 *
 * @param context - The stage context, which holds the config of the stage.
 * @returns The model id and today's date, or two `null`s when the stage is bypassed.
 */
function factCorrectionRecord(context: StageContext): FactCorrectionRecord {
	if (isBypassed(context)) {
		return { correctedBy: null, correctedOn: null };
	}
	return {
		correctedBy: stageConfigFor({ config: context.config, stageId: STAGE_ID }).modelId,
		correctedOn: formatDateISO(new Date()),
	};
}

/** One subtopic of the fact correction: its id, title, paragraphs and merged factual errors, and the models that checked the facts. */
type CorrectionSubtopic = FactCorrectionMaterial & {
	readonly factualErrors: readonly MergedFactualError[];
	readonly checkedBy: FactualErrorsFile["checkedBy"];
};

/** The part of the file of one subtopic that the reply gives. */
type CorrectedParagraphs = Pick<FactCorrectionFile, "factCorrectedSubtopic" | "changes">;

/** One change of a reply, in the words of prompt k3. */
type ReplyChange = ChangedWords & { readonly error: number };

/** The reply that prompt k3 asks for. */
type CorrectionReply = {
	readonly paragraphs: readonly string[];
	readonly changes: readonly ReplyChange[];
};

const DOCUMENTED_REPLY_SHAPE = "{ paragraphs, changes: [{ error, before, after, note }] } object";

/**
 * Checks that a value is one change of a reply, with each of its four fields.
 *
 * @param value - One entry of the reply's `changes`.
 * @returns `true` when the value is a {@link ReplyChange}.
 */
function isReplyChange(value: unknown): value is ReplyChange {
	return hasChangedWords(value) && typeof value.error === "number";
}

/**
 * Checks that a parsed reply has the shape that prompt k3 asks for.
 *
 * @param value - The parsed reply.
 * @returns `true` when the value is a {@link CorrectionReply}.
 */
function isCorrectionReply(value: unknown): value is CorrectionReply {
	return (
		isRecord(value) &&
		isStringList(value.paragraphs) &&
		Array.isArray(value.changes) &&
		value.changes.every(isReplyChange)
	);
}

/** The input of the fact correction. */
type FactCorrectionInput = {
	/** Each subtopic with its factual errors, in lecture order. */
	readonly subtopics: readonly CorrectionSubtopic[];
};

/**
 * Builds the stage's own error from a message.
 *
 * @param message - The message.
 * @returns The error.
 */
function fail(message: string): Error {
	return new CorrectFactualErrorsError(message);
}

/**
 * Reads the subtopics of the structured transcript, the rewrite of each one, and
 * the merged factual errors of the lecture.
 *
 * @param context - The stage context.
 * @returns Each subtopic in lecture order with its title, rewrite and factual errors, and the models that checked the facts.
 * @throws {CorrectFactualErrorsError} If an input file is missing, unreadable or the wrong shape.
 */
async function readFactCorrectionInput(context: StageContext): Promise<FactCorrectionInput> {
	const [subtopics, { checkedBy, factualErrors }] = await Promise.all([
		readTitledRewrites({ context, purpose: "correct the factual errors", fail }),
		readFactualErrorsFile({ context, fail }),
	]);
	return {
		subtopics: subtopics.map((subtopic) => ({
			...subtopic,
			factualErrors: factualErrors.filter(({ subtopicId }) => subtopicId === subtopic.subtopicId),
			checkedBy,
		})),
	};
}

/**
 * Gives a reply in the project's words, or the reason that it is unusable. A
 * reply with a blank paragraph is unusable. A reply is also unusable when a
 * change names a factual error number that the call did not send.
 *
 * @param args - The reply, and the number of factual errors that the call sent.
 * @param args.reply - The parsed reply, with the documented shape.
 * @param args.sentCount - The number of factual errors that the call sent.
 * @returns The paragraphs and the changes, or the reason that the reply is unusable.
 */
function usableReply({
	reply,
	sentCount,
}: {
	readonly reply: CorrectionReply;
	readonly sentCount: number;
}): { readonly reply: CorrectedParagraphs } | { readonly failure: string } {
	const paragraphs = rejectBlankParagraphs(reply);
	if ("failure" in paragraphs) {
		return paragraphs;
	}
	const unknown = reply.changes
		.map(({ error }) => error)
		.filter((factualError) => !isSentFactualErrorNumber({ factualError, sentCount }));
	if (unknown.length > 0) {
		return {
			failure: `The model's reply names factual errors that the call did not send: ${unknown.join(", ")}`,
		};
	}
	return { reply: inProjectWords(reply) };
}

/**
 * Gives a reply in the project's words. The reply's "error" becomes `factualError`.
 *
 * @param reply - The parsed reply, with the documented shape.
 * @returns The paragraphs and the changes.
 */
function inProjectWords(reply: CorrectionReply): CorrectedParagraphs {
	return {
		factCorrectedSubtopic: reply.paragraphs,
		changes: reply.changes.map(({ error, before, after, note }) => ({
			factualError: error,
			before,
			after,
			note,
		})),
	};
}

/**
 * Gives the fact-corrected paragraphs of one subtopic. A subtopic with no factual
 * errors gets no call, and keeps its rewrite. With the stage's `bypass` on, each
 * subtopic keeps its rewrite.
 *
 * @param args - The subtopic, the stage context, and the model calls of the stage run.
 * @param args.subtopic - The subtopic and its factual errors.
 * @param args.context - The stage context, which holds the config of the stage.
 * @param args.calls - The model calls of the stage run.
 * @returns The paragraphs and the changes.
 * @throws {ResendsExhaustedError} If the third send is still unusable.
 */
async function correctSubtopic({
	subtopic,
	context,
	calls,
}: SubtopicWork<FactCorrectionInput, CorrectionSubtopic>): Promise<CorrectedParagraphs> {
	if (isBypassed(context) || subtopic.factualErrors.length === 0) {
		return { factCorrectedSubtopic: subtopic.rewrittenSubtopic, changes: [] };
	}
	const { reply } = await calls.sendJsonWithResends({
		what: `Fact correction of subtopic ${subtopic.subtopicId}`,
		messages: buildFactCorrectionMessages(subtopic),
		isReply: isCorrectionReply,
		documentedShape: DOCUMENTED_REPLY_SHAPE,
		use: (correction) =>
			usableReply({ reply: correction, sentCount: subtopic.factualErrors.length }),
	});
	return reply;
}

/**
 * Makes the file of one subtopic: its fact-corrected paragraphs, its changes and
 * its factual errors.
 *
 * @param work - The subtopic, the stage context, and the model calls of the stage run.
 * @returns The file of the subtopic.
 * @throws {ResendsExhaustedError} If the third send is still unusable.
 */
async function makeFactCorrectionFile(
	work: SubtopicWork<FactCorrectionInput, CorrectionSubtopic>,
): Promise<FactCorrectionFile> {
	const { subtopic } = work;
	const corrected = await correctSubtopic(work);
	return {
		subtopicId: subtopic.subtopicId,
		factCorrectionPromptVersion: FACT_CORRECTION_PROMPT_VERSION,
		bypassed: isBypassed(work.context),
		factualErrors: subtopic.factualErrors,
		...corrected,
		checkedBy: subtopic.checkedBy,
		paragraphCountBefore: subtopic.rewrittenSubtopic.length,
		paragraphCountAfter: corrected.factCorrectedSubtopic.length,
	};
}

/** The factory of the stage, before its result says whether the stage was bypassed. */
const createFactCorrectionStage = defineSubtopicAndLectureFileStage({
	stageId: STAGE_ID,
	getInput: readFactCorrectionInput,
	subtopicsOf: (input) => input.subtopics,
	isSaved: isFactCorrectionFile,
	saved: { content: "fact correction", remake: "correct the factual errors of the subtopic" },
	fail,
	make: makeFactCorrectionFile,
	lectureFields: factCorrectionRecord,
	key: "factCorrectedSubtopics",
});

/**
 * Builds the `correct-factual-errors` stage from the logger and the OpenAI client
 * of the invocation. Its result says whether the stage was bypassed, so that the
 * runner records the status `bypassed` (CONTEXT.md, "Bypassed stage").
 *
 * @param dependencies - The logger and the client of the invocation.
 * @returns The stage.
 */
export const createCorrectFactualErrorsStage: typeof createFactCorrectionStage = (dependencies) => {
	const stage = createFactCorrectionStage(dependencies);
	return {
		...stage,
		run: async (args) => ({ ...(await stage.run(args)), bypassed: isBypassed(args.context) }),
	};
};
