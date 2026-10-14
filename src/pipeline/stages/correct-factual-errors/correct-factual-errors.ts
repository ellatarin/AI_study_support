/**
 * The `correct-factual-errors` stage. It sends each subtopic that has factual
 * errors to the model, and writes the fact-corrected subtopic of each subtopic
 * (technical-design.md §5, `correct-factual-errors`). The stage is unlisted
 * (`UnlistedStageRun` in `model-stage.ts`).
 */

/* jscpd:ignore-start -- the modules of the unlisted stages import the same
   pipeline types and shared helpers. So their import blocks are the same line
   for line. Imports cannot be shared, and CLAUDE.md (File Organisation) forbids
   barrel files. Only the imports are exempt. jscpd checks the code below. */
import type { StageContext } from "../../../types/pipeline.js";
import { NamedError } from "../../../utils/errors.js";
import { isRecord, isStringList } from "../../../utils/record.js";
import { stageDirectoryPath, stageOutputPath } from "../../layout.js";
import {
	type FactualErrorsFile,
	type MergedFactualError,
	readFactualErrorsFile,
} from "../factual-errors.js";
import {
	rejectBlankParagraphs,
	sendToStageModelWithResends,
	type UnlistedStageRun,
} from "../model-stage.js";
import { hasSubtopicId, runUnlistedSubtopicFileStage } from "../subtopic-files.js";
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

/** One subtopic of the fact correction: its id, title, paragraphs and merged factual errors. */
export type CorrectionSubtopic = FactCorrectionMaterial & {
	readonly factualErrors: readonly MergedFactualError[];
};

/** The words of one change, before and after, as the reply and the saved file both give them. */
type ChangedWords = {
	readonly before: string;
	readonly after: string;
	/** The reason when the words did not change. */
	readonly note: string;
};

/** One change of the fact-corrected subtopic, in the project's words. */
type FactCorrectionChange = ChangedWords & {
	/** The factual error, by the number that the call gave it ({@link isSentFactualErrorNumber}). */
	readonly factualError: number;
};

/** The file of one subtopic in the folder `Fact corrections`. */
type FactCorrectionFile = {
	readonly subtopicId: number;
	readonly factCorrectionPromptVersion: string;
	readonly factualErrors: readonly MergedFactualError[];
	readonly factCorrectedSubtopic: readonly string[];
	readonly changes: readonly FactCorrectionChange[];
	readonly checkedBy: FactualErrorsFile["checkedBy"];
	readonly paragraphCountBefore: number;
	readonly paragraphCountAfter: number;
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
	return (
		isRecord(value) &&
		typeof value.error === "number" &&
		typeof value.before === "string" &&
		typeof value.after === "string" &&
		typeof value.note === "string"
	);
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

/**
 * Checks that a parsed saved file is the file of one subtopic.
 *
 * @param value - The parsed file.
 * @returns `true` when the value is a {@link FactCorrectionFile}.
 */
function isFactCorrectionFile(value: unknown): value is FactCorrectionFile {
	return (
		hasSubtopicId(value) &&
		typeof value.factCorrectionPromptVersion === "string" &&
		Array.isArray(value.factualErrors) &&
		isStringList(value.factCorrectedSubtopic) &&
		Array.isArray(value.changes) &&
		isStringList(value.checkedBy) &&
		typeof value.paragraphCountBefore === "number" &&
		typeof value.paragraphCountAfter === "number"
	);
}

/** The input of the fact correction: each subtopic with its factual errors, and the models that checked the facts. */
type FactCorrectionInput = {
	/** Each subtopic with its factual errors, in lecture order. */
	readonly subtopics: readonly CorrectionSubtopic[];
	readonly checkedBy: FactualErrorsFile["checkedBy"];
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
export async function readFactCorrectionInput(context: StageContext): Promise<FactCorrectionInput> {
	const [subtopics, { checkedBy, factualErrors }] = await Promise.all([
		readTitledRewrites({ context, purpose: "correct the factual errors", fail }),
		readFactualErrorsFile({ context, fail }),
	]);
	return {
		checkedBy,
		subtopics: subtopics.map((subtopic) => ({
			...subtopic,
			factualErrors: factualErrors.filter(({ subtopicId }) => subtopicId === subtopic.subtopicId),
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
 * errors gets no call, and keeps its rewrite.
 *
 * @param args - The subtopic, and the stage run.
 * @param args.subtopic - The subtopic and its factual errors.
 * @returns The paragraphs and the changes.
 * @throws {ResendsExhaustedError} If the third send is still unusable.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger type has mutable properties that the rule sees. This code only passes it on. CLAUDE.md allows a mutable type where a library requires one.
async function correctSubtopic({
	subtopic,
	...run
}: UnlistedStageRun & { readonly subtopic: CorrectionSubtopic }): Promise<CorrectedParagraphs> {
	if (subtopic.factualErrors.length === 0) {
		return { factCorrectedSubtopic: subtopic.rewrittenSubtopic, changes: [] };
	}
	const { reply } = await sendToStageModelWithResends({
		...run,
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
 * Corrects the factual errors of each subtopic, and writes the file of each
 * subtopic and `fact-corrected-subtopics.json`.
 *
 * @param run - The fact correction of the lecture: its input, and the stage run.
 * @param run.subtopics - Each subtopic with its factual errors, in lecture order.
 * @param run.checkedBy - The models that checked the facts, for the file of each subtopic.
 * @returns The content of `fact-corrected-subtopics.json`, and the `filesWritten` entry of each file.
 * @throws {CorrectFactualErrorsError} If a saved file holds nothing readable.
 * @throws {ResendsExhaustedError} If the third send of a call is still unusable.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger type has mutable properties that the rule sees. This code only passes it on. CLAUDE.md allows a mutable type where a library requires one.
export function correctFactualErrors({
	subtopics,
	checkedBy,
	...run
}: FactCorrectionInput & UnlistedStageRun): Promise<{
	readonly output: { readonly factCorrectedSubtopics: readonly FactCorrectionFile[] };
	readonly filesWritten: readonly string[];
}> {
	const stage = { workspaceRoot: run.workspaceRoot, stageId: STAGE_ID } as const;
	return runUnlistedSubtopicFileStage({
		workspaceRoot: run.workspaceRoot,
		directory: stageDirectoryPath(stage),
		subtopics,
		isSaved: isFactCorrectionFile,
		saved: { content: "fact correction", remake: "correct the factual errors of the subtopic" },
		fail,
		make: async (subtopic) => {
			const corrected = await correctSubtopic({ ...run, subtopic });
			return {
				subtopicId: subtopic.subtopicId,
				factCorrectionPromptVersion: FACT_CORRECTION_PROMPT_VERSION,
				factualErrors: subtopic.factualErrors,
				...corrected,
				checkedBy,
				paragraphCountBefore: subtopic.rewrittenSubtopic.length,
				paragraphCountAfter: corrected.factCorrectedSubtopic.length,
			};
		},
		concurrency: run.concurrency,
		entriesPath: stageOutputPath(stage),
		key: "factCorrectedSubtopics",
	});
}
