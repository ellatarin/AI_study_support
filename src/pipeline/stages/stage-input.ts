/**
 * Reading the text an earlier stage wrote. Shared by the four division stages,
 * which each read the transcript: their run files hold positions, never text,
 * so each needs the transcript to turn positions back into subtopics
 * (technical-design.md §5, "Dividing the transcript").
 */

import { readFile } from "node:fs/promises";
import type { StageContext } from "../../types/pipeline.js";
import { errorMessage } from "../../utils/errors.js";
import { type StageWithOutputFile, stageOutputPath } from "../layout.js";

/**
 * Reads the file an earlier stage wrote, insisting it holds text. The caller
 * supplies how to fail, so each stage raises its own named error while the two
 * sentences a user reads are the same wherever they come from.
 *
 * @param args - Whose output to read, why, and how to fail.
 * @param args.context - The current lecture run context.
 * @param args.stageId - The stage whose output file to read; only a stage that writes one.
 * @param args.purpose - What the reading stage does with it, for the failure a user reads, e.g. "divide".
 * @param args.fail - Builds the reading stage's own error from a message.
 * @returns The file's text, as written.
 * @throws The error `fail` builds, if the file is missing or holds no text.
 */
export async function readStageText({
	context,
	stageId,
	purpose,
	fail,
}: {
	readonly context: StageContext;
	readonly stageId: StageWithOutputFile;
	readonly purpose: string;
	readonly fail: (message: string) => Error;
}): Promise<string> {
	const path = stageOutputPath({ workspaceRoot: context.workspaceRoot, stageId });
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (error: unknown) {
		throw fail(`No file at ${path}; run ${stageId} first (${errorMessage(error)})`);
	}
	if (text.trim() === "") {
		throw fail(`The file at ${path} holds no text; there is nothing to ${purpose}`);
	}
	return text;
}
