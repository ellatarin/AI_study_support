/**
 * The factual errors that `check-facts` writes, for the stages that write and read
 * them (technical-design.md §5, `check-facts` and `correct-factual-errors`).
 */

/* jscpd:ignore-start -- the modules of the whole-lecture files import the same
   readers and checks. So their import blocks are the same line for line. Imports
   cannot be shared, and CLAUDE.md (File Organisation) forbids barrel files. Only
   the imports are exempt. jscpd checks the code below. */
import { isOneOf, isRecord, isStringList, readerFromCheck } from "../../utils/record.js";
import { stageDirectoryPath, stageOutputPath } from "../layout.js";
import { type ReadingStage, readInputJson } from "./stage-input.js";
import { hasSubtopicId } from "./subtopic-files.js";

/* jscpd:ignore-end */

/** The severities that a fact check gives a factual error. */
export const SEVERITIES = ["serious", "minor"] as const;

/** One statement that a fact check reports as wrong or doubtful (CONTEXT.md, "Factual error"). */
export type FactualError = {
	readonly subtopicId: number;
	readonly passage: string;
	readonly problem: string;
	readonly correctStatement: string;
	readonly severity: (typeof SEVERITIES)[number];
};

/** A factual error after the merge, with the model ids that report it. */
export type FactualErrorFoundBy = FactualError & { readonly foundBy: readonly string[] };

/** A factual error of the merged file: the models that report it, and whether its passage is in its subtopic. */
export type MergedFactualError = FactualErrorFoundBy & { readonly wordsFound: boolean };

/** The merged file of the lecture, `factual-errors.json`. */
export type FactualErrorsFile = {
	readonly factCheckPromptVersion: string;
	/** `true` when the fact check was a bypassed stage. Then both lists are empty (CONTEXT.md, "Bypassed stage"). */
	readonly bypassed: boolean;
	/** The ids of the models that `check-facts` called, the primary model first. */
	readonly checkedBy: readonly string[];
	readonly factualErrors: readonly MergedFactualError[];
};

/**
 * Gives the absolute path of the folder of `check-facts` in a lecture's workspace.
 *
 * @param workspaceRoot - The absolute path of the lecture's workspace.
 * @returns The absolute path of the folder.
 */
export function factChecksDirectory(workspaceRoot: string): string {
	return stageDirectoryPath({ workspaceRoot, stageId: "check-facts" });
}

/**
 * Gives the absolute path of the merged file in a lecture's workspace.
 *
 * @param workspaceRoot - The absolute path of the lecture's workspace.
 * @returns The absolute path of `factual-errors.json`.
 */
export function factualErrorsPath(workspaceRoot: string): string {
	return stageOutputPath({ workspaceRoot, stageId: "check-facts" });
}

/** Checks that a value is one of the {@link SEVERITIES}. */
export const isSeverity = isOneOf(SEVERITIES);

/**
 * Checks that a value is one factual error.
 *
 * @param value - One entry of a file's `factualErrors`.
 * @returns `true` when the value is a {@link FactualError}.
 */
export function isFactualError(value: unknown): value is FactualError {
	return (
		hasSubtopicId(value) &&
		typeof value.passage === "string" &&
		typeof value.problem === "string" &&
		typeof value.correctStatement === "string" &&
		isSeverity(value.severity)
	);
}

/**
 * Checks that a value is one factual error of the merged file.
 *
 * @param value - One entry of the merged file's `factualErrors`.
 * @returns `true` when the value is a {@link MergedFactualError}.
 */
export function isMergedFactualError(value: unknown): value is MergedFactualError {
	return (
		isRecord(value) &&
		isStringList(value.foundBy) &&
		typeof value.wordsFound === "boolean" &&
		isFactualError(value)
	);
}

/**
 * Checks that a parsed file is the merged file of the lecture.
 *
 * @param value - The parsed file.
 * @returns `true` when the value is a {@link FactualErrorsFile}.
 */
function isFactualErrorsFile(value: unknown): value is FactualErrorsFile {
	return (
		isRecord(value) &&
		typeof value.factCheckPromptVersion === "string" &&
		isStringList(value.checkedBy) &&
		Array.isArray(value.factualErrors) &&
		value.factualErrors.every(isMergedFactualError)
	);
}

/**
 * Reads the merged file of the lecture.
 *
 * @param stage - The reading stage.
 * @param stage.context - The stage context.
 * @param stage.fail - Builds the reading stage's own error from a message.
 * @returns The merged file.
 * @throws The error that `fail` builds, if the file is missing, not JSON or not the merged file.
 */
export function readFactualErrorsFile({ context, fail }: ReadingStage): Promise<FactualErrorsFile> {
	return readInputJson({
		path: factualErrorsPath(context.workspaceRoot),
		stageId: "check-facts",
		fail,
		read: readerFromCheck(isFactualErrorsFile),
		shape: "the merged factual errors of the lecture",
	});
}
