/**
 * The readers of what an earlier stage wrote, for the stages that read the
 * transcript or a division. A saved run or a division holds positions and no
 * text, so these stages also need the transcript (technical-design.md §5,
 * "Dividing the transcript").
 */

import { readFile } from "node:fs/promises";
import type { StageContext } from "../../types/pipeline.js";
import { errorMessage } from "../../utils/errors.js";
import { type StageWithOutputFile, stageDirectoryPath, stageOutputPath } from "../layout.js";
import { readDivision, type Subtopic, splittingPanel } from "./division.js";
import { readPanel } from "./panel-runs.js";
import { readTopics, type Topic } from "./topics.js";

/** The stage that reads: its stage context, and the builder of its error. */
type ReadingStage = {
	readonly context: StageContext;
	/** Builds the reading stage's own error from a message. */
	readonly fail: (message: string) => Error;
};

/** The reading stage, the earlier stage whose output it reads, and the purpose. */
type ReadingOutput = ReadingStage & {
	readonly stageId: StageWithOutputFile;
	/** The use that the reading stage makes of the output, for the failure that a user reads, such as "divide". */
	readonly purpose: string;
};

/**
 * Reads the output file of an earlier stage, and checks that it holds text. Each
 * stage raises its own error through `fail`, and the messages are the same in
 * every stage.
 *
 * @param args - The stage context, the earlier stage, the purpose, and the error to raise.
 * @param args.context - The stage context of the current lecture.
 * @param args.stageId - The earlier stage. It must write one output file.
 * @param args.purpose - The use that the reading stage makes of the output, for the failure that a user reads, such as "divide".
 * @param args.fail - Builds the reading stage's own error from a message.
 * @returns The text of the file, as written.
 * @throws The error that `fail` builds, if the file is missing or holds no text.
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
 * Reads the transcript, with the whitespace at its two ends removed. The positions
 * of every run index into this text (technical-design.md §5, "The model never
 * returns text").
 *
 * @param args - The stage context, and the error to raise.
 * @param args.context - The stage context of the current lecture.
 * @param args.fail - Builds the reading stage's own error from a message.
 * @returns The trimmed transcript.
 * @throws The error that `fail` builds, if the transcript is missing or holds no text.
 */
export async function readTranscript({ context, fail }: ReadingStage): Promise<string> {
	const text = await readStageText({ context, stageId: "transcription", purpose: "divide", fail });
	return text.trim();
}

/**
 * Reads the JSON output file of an earlier stage, and checks its shape.
 *
 * @param args - The stage context, the earlier stage, the purpose, the error to raise, and the check of the shape.
 * @param args.context - The stage context of the current lecture.
 * @param args.stageId - The earlier stage. It must write one output file.
 * @param args.purpose - The use that the reading stage makes of the output, for the failure that a user reads, such as "retitle".
 * @param args.fail - Builds the reading stage's own error from a message.
 * @param args.read - Reads the parsed file, or gives `null` when the file does not have the shape.
 * @param args.shape - The shape, for the failure that a user reads, such as "a list of subtopics".
 * @returns The value that `read` gives.
 * @throws The error that `fail` builds, if the file is missing, empty, not JSON, or not the shape.
 * @typeParam TValue - The value that the file holds.
 */
async function readStageJson<TValue>({
	read,
	shape,
	...reading
}: ReadingOutput & {
	readonly read: (value: unknown) => TValue | null;
	readonly shape: string;
}): Promise<TValue> {
	const text = await readStageText(reading);
	const path = stageOutputPath({
		workspaceRoot: reading.context.workspaceRoot,
		stageId: reading.stageId,
	});
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error: unknown) {
		throw reading.fail(`The file at ${path} is not JSON (${errorMessage(error)})`);
	}
	const value = read(parsed);
	if (value === null) {
		throw reading.fail(`The file at ${path} is not ${shape}`);
	}
	return value;
}

/**
 * Reads the division that an earlier stage wrote as its output. Each subtopic has
 * its span of the transcript, its title and its reason.
 *
 * @param reading - The stage context, the earlier stage, the purpose, and the error to raise.
 * @param reading.context - The stage context of the current lecture.
 * @param reading.stageId - The stage whose division to read.
 * @param reading.purpose - The use that the reading stage makes of the division, for the failure that a user reads, such as "retitle".
 * @param reading.fail - Builds the reading stage's own error from a message.
 * @returns The subtopics of the division, in order.
 * @throws The error that `fail` builds, if the file is missing, empty, not JSON, or not a list of subtopics.
 */
export function readStageDivision(reading: ReadingOutput): Promise<readonly Subtopic[]> {
	return readStageJson({ ...reading, read: readDivision, shape: "a list of subtopics" });
}

/**
 * Reads the topics that `group-into-topics` wrote.
 *
 * @param reading - The stage context, the purpose, and the error to raise.
 * @param reading.context - The stage context of the current lecture.
 * @param reading.purpose - The use that the reading stage makes of the topics, for the failure that a user reads, such as "judge".
 * @param reading.fail - Builds the reading stage's own error from a message.
 * @returns The topics, in order.
 * @throws The error that `fail` builds, if the file is missing, empty, not JSON, or not a list of topics.
 */
export function readStageTopics(
	reading: Omit<ReadingOutput, "stageId">,
): Promise<readonly Topic[]> {
	return readStageJson({
		...reading,
		stageId: "group-into-topics",
		read: readTopics,
		shape: "a list of topics",
	});
}

/** The trimmed transcript, and the subtopics of a division of it. */
export type TranscriptAndDivision = {
	readonly transcript: string;
	readonly subtopics: readonly Subtopic[];
};

/**
 * Reads the transcript and the division that an earlier stage wrote. A stage that
 * works on the subtopics of a division needs both, because the division holds only
 * spans of the transcript.
 *
 * @param reading - The stage context, the earlier stage, the purpose, and the error to raise.
 * @param reading.context - The stage context of the current lecture.
 * @param reading.stageId - The stage whose division to read.
 * @param reading.purpose - The use that the reading stage makes of the division, for the failure that a user reads, such as "retitle".
 * @param reading.fail - Builds the reading stage's own error from a message.
 * @returns The trimmed transcript, and the subtopics of the division in order.
 * @throws The error that `fail` builds, if the transcript is missing or empty, or the division is missing, empty, not JSON, or not a list of subtopics.
 */
export async function readTranscriptAndDivision(
	reading: ReadingOutput,
): Promise<TranscriptAndDivision> {
	const transcript = await readTranscript(reading);
	return { transcript, subtopics: await readStageDivision(reading) };
}

/**
 * Reads the transcript and every saved run of the splitting panel that an earlier
 * stage made.
 *
 * @param args - The stage context, the panel stage, and the error to raise.
 * @param args.context - The stage context of the current lecture.
 * @param args.panelStage - The splitting stage whose saved runs to read.
 * @param args.fail - Builds the reading stage's own error from a message.
 * @returns The trimmed transcript, and the runs of the panel in run order.
 * @throws The error that `fail` builds, if the transcript is missing or empty, or a run is missing.
 * @throws {SavedRunUnreadableError} When a saved run holds no readable run.
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
		...splittingPanel(context),
		directory: stageDirectoryPath({ workspaceRoot: context.workspaceRoot, stageId: panelStage }),
		fail: (message) => fail(`${message}; run ${panelStage} first`),
	});
	return { transcript, runs };
}
