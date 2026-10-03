/**
 * Reading what an earlier stage wrote. Shared by the stages that read the
 * transcript or a division: run files and divisions hold positions, never text,
 * so each needs the transcript to turn positions back into subtopics
 * (technical-design.md §5, "Dividing the transcript").
 */

import { readFile } from "node:fs/promises";
import type { StageContext } from "../../types/pipeline.js";
import { errorMessage } from "../../utils/errors.js";
import { type StageWithOutputFile, stageOutputPath } from "../layout.js";
import { readDivision, type Subtopic } from "./division.js";
import { panelDirectory, readPanel } from "./panel-runs.js";

/** The stage doing the reading: which lecture it is on, and how it fails. */
type ReadingStage = {
	/** The current lecture run context. */
	readonly context: StageContext;
	/** Builds the reading stage's own error from a message. */
	readonly fail: (message: string) => Error;
};

/** The reading stage, and which earlier stage's output it reads and why. */
type ReadingOutput = ReadingStage & {
	/** The stage whose output file to read; only a stage that writes one. */
	readonly stageId: StageWithOutputFile;
	/** What the reading stage does with it, for the failure a user reads, e.g. "divide". */
	readonly purpose: string;
};

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
}: ReadingOutput): Promise<string> {
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

/**
 * Reads the transcript a division stage divides, with the whitespace at its two
 * ends removed: what the prototype sent, and what every run's positions index
 * into (technical-design.md §5, "The model never returns text").
 *
 * @param args - The lecture, and how to fail.
 * @param args.context - The current lecture run context.
 * @param args.fail - Builds the reading stage's own error from a message.
 * @returns The transcript, trimmed.
 * @throws The error `fail` builds, if the transcript is missing or holds no text.
 */
export async function readTranscript({ context, fail }: ReadingStage): Promise<string> {
	const text = await readStageText({ context, stageId: "transcription", purpose: "divide", fail });
	return text.trim();
}

/**
 * Reads the division an earlier stage wrote as its output: a list of subtopics,
 * each a span of the transcript with its title and reason.
 *
 * @param args - Whose division to read, and how to fail.
 * @param args.context - The current lecture run context.
 * @param args.stageId - The stage whose division to read.
 * @param args.purpose - What the reading stage does with it, for the failure a user reads, e.g. "retitle".
 * @param args.fail - Builds the reading stage's own error from a message.
 * @returns The division's subtopics, in order.
 * @throws The error `fail` builds, if the file is missing, empty, not JSON, or not a list of subtopics.
 */
export async function readStageDivision({
	context,
	stageId,
	purpose,
	fail,
}: ReadingOutput): Promise<readonly Subtopic[]> {
	const text = await readStageText({ context, stageId, purpose, fail });
	const path = stageOutputPath({ workspaceRoot: context.workspaceRoot, stageId });
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error: unknown) {
		throw fail(`The file at ${path} is not JSON (${errorMessage(error)})`);
	}
	const subtopics = readDivision(parsed);
	if (subtopics === null) {
		throw fail(`The file at ${path} is not a list of subtopics`);
	}
	return subtopics;
}

/**
 * Reads the transcript and the whole panel of splitting runs an earlier stage
 * saved: what a division stage working from a finished panel starts from.
 *
 * @param args - The lecture, whose panel to read, and how to fail.
 * @param args.context - The current lecture run context.
 * @param args.panelStage - The splitting stage whose runs to read.
 * @param args.fail - Builds the reading stage's own error from a message.
 * @returns The transcript, trimmed, and the panel's runs in run order.
 * @throws The error `fail` builds, if the transcript is missing or empty, or a run is missing.
 * @throws {SavedRunUnreadableError} When a run file holds no readable run.
 */
export async function readTranscriptAndRuns({
	context,
	panelStage,
	fail,
}: ReadingStage & {
	readonly panelStage: "initial-subtopic-splitting" | "deepen-subtopic-splitting";
}): Promise<{ readonly transcript: string; readonly runs: readonly (readonly Subtopic[])[] }> {
	const transcript = await readTranscript({ context, fail });
	const runs = await readPanel({
		panelSize: context.config.division.panelSize,
		directory: panelDirectory({ workspaceRoot: context.workspaceRoot, stageId: panelStage }),
		readRun: readDivision,
		fail: (message) => fail(`${message}; run ${panelStage} first`),
	});
	return { transcript, runs };
}
