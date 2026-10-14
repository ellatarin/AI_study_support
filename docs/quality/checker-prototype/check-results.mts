/**
 * The readers that the prototype's scripts share: the material of each subtopic
 * that a checker reads, the faults of a checker's subtopic file, and the answer
 * key of a lecture with the user's marks.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { stageOutputPath } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/pipeline/layout.js";
import { subtopicFilePath } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/pipeline/stages/subtopic-files.js";
import { readStructuredTranscript } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/pipeline/stages/structured-transcript.js";
import { isSubtopicRewrite } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/pipeline/stages/subtopic-rewrites.js";
import { isTermCorrectionResult } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/pipeline/stages/term-corrections.js";
import { isRecord } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/utils/record.js";
import type { QuotedFault } from "./fault-matching.mts";
import { PROJECT_ROOT } from "./prototype-layout.mts";

/** The answer key of each lecture and rewrites folder: the review with the user's marks. */
const ANSWER_KEYS: Readonly<Record<string, string>> = {
	"2026-03-04/Rewrites (sonnet-5.5, w1)": join(
		PROJECT_ROOT,
		"docs/quality/2026-10-11-lecture-3-checker-c2-review.json",
	),
};

/**
 * Gives the name of a rewrite file in a copied rewrites folder. The copies were
 * made before the pipeline dropped the attempt number, so they keep the old name.
 *
 * @param subtopicId - The subtopic.
 * @returns The file name.
 */
function copiedRewriteFileName(subtopicId: number): string {
	return `subtopic-${subtopicId}-attempt-1.json`;
}

/** What the checker gets for one subtopic: the same material as in the pipeline. */
export type Material = {
	readonly subtopicId: number;
	readonly text: string;
	readonly corrections: readonly { readonly wrongForm: string; readonly rightForm: string; readonly reason: string }[];
	readonly rewrite: readonly string[];
};

/**
 * Reads a JSON file and checks its shape.
 *
 * @param args - The file and its check.
 * @param args.path - The absolute path.
 * @param args.isShape - Checks the parsed value.
 * @returns The parsed value.
 * @throws Error when the value does not have the shape.
 * @typeParam TValue - The shape of the file.
 */
export async function readChecked<TValue>({
	path,
	isShape,
}: {
	readonly path: string;
	readonly isShape: (value: unknown) => value is TValue;
}): Promise<TValue> {
	const value: unknown = JSON.parse(await readFile(path, "utf8"));
	if (!isShape(value)) {
		throw new Error(`${path} does not have the expected shape`);
	}
	return value;
}

/**
 * Reads the material of each subtopic: its text, the kept corrections of the
 * first rewrite attempt, and its rewrite from the named rewrites folder.
 *
 * @param args - The workspace and the rewrites folder.
 * @param args.workspaceRoot - The absolute path of the workspace.
 * @param args.rewrites - The name of the rewrites folder in the workspace.
 * @returns The material of each subtopic, in lecture order.
 * @throws Error when the structured transcript is not readable.
 */
export async function readMaterial({
	workspaceRoot,
	rewrites,
}: {
	readonly workspaceRoot: string;
	readonly rewrites: string;
}): Promise<readonly Material[]> {
	const transcript = readStructuredTranscript(
		JSON.parse(await readFile(stageOutputPath({ workspaceRoot, stageId: "structure-transcript" }), "utf8")),
	);
	if (transcript === null) {
		throw new Error(`The structured transcript of ${workspaceRoot} is not readable`);
	}
	const subtopics = transcript.topics.flatMap((topic) => topic.subtopics);
	return Promise.all(
		subtopics.map(async ({ subtopicId, text }) => {
			const correction = await readChecked({
				path: subtopicFilePath({ workspaceRoot, subtopicId, stageId: "correct-terms" }),
				isShape: isTermCorrectionResult,
			});
			const rewrite = await readChecked({
				path: join(workspaceRoot, rewrites, copiedRewriteFileName(subtopicId)),
				isShape: isSubtopicRewrite,
			});
			return {
				subtopicId,
				text,
				corrections: correction.corrections.map(({ wrongForm, rightForm, reason }) => ({
					wrongForm,
					rightForm,
					reason,
				})),
				rewrite: rewrite.rewrittenSubtopic,
			};
		}),
	);
}

/** The user's mark for a fault that matters. */
export const MATTERS = "matters";

/** A fault that a checker reported. */
export type CheckerFault = QuotedFault & { readonly deficiencyType: string; readonly description: string };

/** A fault of the answer key, with the user's mark. */
export type KeyFault = QuotedFault & {
	readonly fault: string;
	readonly description: string;
	readonly userVerdict: string;
};

/**
 * Gives a passage of a parsed fault, or null.
 *
 * @param value - The passage as parsed.
 * @returns The passage when it is a string, or null.
 */
function passage(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

/**
 * Reads the faults of one result file of a subtopic.
 *
 * @param path - The absolute path of the file.
 * @returns The faults, with the subtopic of the file, in the order of the file.
 * @throws Error when the file is not a check of a subtopic.
 */
export async function readFaults(path: string): Promise<readonly CheckerFault[]> {
	const check: unknown = JSON.parse(await readFile(path, "utf8"));
	if (!isRecord(check) || typeof check.subtopicId !== "number" || !Array.isArray(check.deficiencies)) {
		throw new Error(`${path} is not a check of a subtopic`);
	}
	const { subtopicId } = check;
	return check.deficiencies.filter(isRecord).map((fault) => ({
		subtopicId,
		deficiencyType: String(fault.deficiencyType),
		description: String(fault.description),
		sourcePassage: passage(fault.sourcePassage),
		rewritePassage: passage(fault.rewritePassage),
	}));
}

/**
 * Lists the result files of the subtopics in a folder of checks.
 *
 * @param folder - The absolute path of the folder.
 * @returns The file names.
 */
export async function listSubtopicResultFiles(folder: string): Promise<readonly string[]> {
	return (await readdir(folder)).filter((file) => /^subtopic-\d+/.test(file));
}

/**
 * Reads the faults of each subtopic of a check run.
 *
 * @param folder - The absolute path of the run folder.
 * @returns The faults, each with its position in its subtopic's result file.
 */
export async function readRunFaults(
	folder: string,
): Promise<readonly (CheckerFault & { readonly faultIndex: number })[]> {
	const files = await listSubtopicResultFiles(folder);
	const subtopics = await Promise.all(files.map((file) => readFaults(join(folder, file))));
	return subtopics.flatMap((faults) => faults.map((fault, faultIndex) => ({ ...fault, faultIndex })));
}

/**
 * Reads the answer key of a lecture and rewrites folder.
 *
 * @param key - The lecture and the rewrites folder, joined by "/".
 * @returns The faults of the key: the faults of the review, then the faults that later checkers found.
 * @throws Error when the lecture and rewrites folder have no key.
 */
export async function readAnswerKey(key: string): Promise<readonly KeyFault[]> {
	const path = ANSWER_KEYS[key];
	if (path === undefined) {
		throw new Error(`No answer key for ${key}. The keys are ${Object.keys(ANSWER_KEYS).join(", ")}.`);
	}
	const review: unknown = JSON.parse(await readFile(path, "utf8"));
	if (!isRecord(review) || !Array.isArray(review.faults)) {
		throw new Error(`${path} has no list of faults`);
	}
	const addedFaults = Array.isArray(review.addedFaults) ? review.addedFaults : [];
	return [...review.faults, ...addedFaults] as readonly KeyFault[];
}
