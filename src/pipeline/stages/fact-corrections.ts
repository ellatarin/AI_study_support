/**
 * The files that `correct-factual-errors` writes, for the stages that write and
 * read them (technical-design.md §5, `correct-factual-errors`).
 */

/* jscpd:ignore-start -- the modules of the whole-lecture files import the same
   readers and checks. So their import blocks are the same line for line. Imports
   cannot be shared, and CLAUDE.md (File Organisation) forbids barrel files. Only
   the imports are exempt. jscpd checks the code below. */
import { isRecord, isStringList, readerFromCheck } from "../../utils/record.js";
import { stageOutputPath } from "../layout.js";
import type { FactualErrorsFile, MergedFactualError } from "./factual-errors.js";
import { type ReadingStage, readInputJson } from "./stage-input.js";
import { hasSubtopicId } from "./subtopic-files.js";

/* jscpd:ignore-end */

/** The words of one change, before and after, as the reply and the saved file both give them. */
export type ChangedWords = {
	readonly before: string;
	readonly after: string;
	/** The reason when the words did not change. */
	readonly note: string;
};

/** One change of the fact-corrected subtopic, in the project's words. */
type FactCorrectionChange = ChangedWords & {
	/** The factual error, by the number that the call gave it, from 1 in the order of `factualErrors`. */
	readonly factualError: number;
};

/** The file of one subtopic in the folder `Fact corrections`. */
export type FactCorrectionFile = {
	readonly subtopicId: number;
	readonly factCorrectionPromptVersion: string;
	readonly factualErrors: readonly MergedFactualError[];
	readonly factCorrectedSubtopic: readonly string[];
	readonly changes: readonly FactCorrectionChange[];
	readonly checkedBy: FactualErrorsFile["checkedBy"];
	readonly paragraphCountBefore: number;
	readonly paragraphCountAfter: number;
};

/** The file of the whole lecture, `fact-corrected-subtopics.json`. */
export type FactCorrectedSubtopics = {
	readonly factCorrectedSubtopics: readonly FactCorrectionFile[];
};

/**
 * Checks that a parsed file is the file of one subtopic.
 *
 * @param value - The parsed file.
 * @returns `true` when the value is a {@link FactCorrectionFile}.
 */
export function isFactCorrectionFile(value: unknown): value is FactCorrectionFile {
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

/**
 * Checks that a parsed file is the file of the whole lecture.
 *
 * @param value - The parsed file.
 * @returns `true` when the value is {@link FactCorrectedSubtopics}.
 */
function isFactCorrectedSubtopics(value: unknown): value is FactCorrectedSubtopics {
	return (
		isRecord(value) &&
		Array.isArray(value.factCorrectedSubtopics) &&
		value.factCorrectedSubtopics.every(isFactCorrectionFile)
	);
}

/**
 * Reads `fact-corrected-subtopics.json`, the file of the whole lecture that
 * `correct-factual-errors` writes.
 *
 * @param reading - The stage context, and the error to raise.
 * @param reading.context - The stage context of the current lecture.
 * @param reading.fail - Builds the reading stage's own error from a message.
 * @returns The file of each subtopic, in lecture order.
 * @throws The error that `fail` builds, if the file is missing, not JSON or not the documented shape. The message names the file.
 */
export function readFactCorrections({
	context,
	fail,
}: ReadingStage): Promise<FactCorrectedSubtopics> {
	return readInputJson({
		path: stageOutputPath({
			workspaceRoot: context.workspaceRoot,
			stageId: "correct-factual-errors",
		}),
		stageId: "correct-factual-errors",
		fail,
		read: readerFromCheck(isFactCorrectedSubtopics),
		shape: "the fact-corrected subtopics of a lecture",
	});
}
