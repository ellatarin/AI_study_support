/**
 * The files that the stages of the rewrite loop write. Each stage writes one file
 * for each rewrite attempt of a subtopic (CONTEXT.md, "Rewrite attempt").
 */

import { join, relative } from "node:path";
import type { StageContext, StageId, StageResult } from "../../types/pipeline.js";
import { isRecord, readerFromCheck } from "../../utils/record.js";
import { type StageInWorkspace, stageDirectoryPath } from "../layout.js";
import { FIRST_ROUND } from "../manifest.js";
import {
	defineModelStage,
	labelledJson,
	type ModelStageFactory,
	type ModelStageRunArgs,
	type PromptMessages,
	promptMessages,
} from "./model-stage.js";
import { type MadeFile, readOrMakeSavedFiles, unreadableSavedFileMessage } from "./saved-files.js";
import { type ReadingStage, readInputJson } from "./stage-input.js";

/** The fields that each file of a rewrite attempt starts with. */
export type RewriteAttemptFields = { readonly subtopicId: number; readonly attemptNumber: number };

/**
 * Gives the path of the file that a stage of the rewrite loop writes for one
 * rewrite attempt of a subtopic.
 *
 * @param args - The stage, the workspace, the subtopic and the rewrite attempt.
 * @param args.workspaceRoot - The absolute path to the lecture workspace.
 * @param args.stageId - The stage that writes the file.
 * @param args.subtopicId - The subtopic.
 * @param args.attemptNumber - The number of the rewrite attempt, from 1.
 * @returns The absolute path of the file.
 */
export function rewriteAttemptFilePath({
	subtopicId,
	attemptNumber,
	...stage
}: StageInWorkspace & RewriteAttemptFields): string {
	return join(stageDirectoryPath(stage), `subtopic-${subtopicId}-attempt-${attemptNumber}.json`);
}

/**
 * Checks that a parsed file has the fields that each file of a rewrite attempt
 * starts with: `subtopicId` and `attemptNumber`, both numbers.
 *
 * @param value - The parsed file.
 * @returns `true` when the value has both fields.
 */
export function hasRewriteAttemptFields(
	value: unknown,
): value is Record<string, unknown> & RewriteAttemptFields {
	return (
		isRecord(value) &&
		typeof value.subtopicId === "number" &&
		typeof value.attemptNumber === "number"
	);
}

/**
 * Reads the file that an earlier stage of the rewrite loop wrote for one rewrite
 * attempt of a subtopic.
 *
 * @param args - The reading stage, the earlier stage, the file and its shape.
 * @param args.context - The stage context.
 * @param args.fail - Builds the reading stage's error from a message.
 * @param args.stageId - The earlier stage that writes the file.
 * @param args.subtopicId - The subtopic.
 * @param args.attemptNumber - The number of the rewrite attempt, from 1.
 * @param args.isFile - Checks that the parsed file has the shape that the earlier stage writes.
 * @param args.shape - The shape, for the failure that a user reads, such as `a subtopic rewrite`.
 * @returns The content of the file.
 * @throws The error that `fail` builds, if the file is missing, not JSON or not of the shape.
 * @typeParam TContent - The content of the file.
 */
export function readRewriteAttemptFile<TContent>({
	context,
	fail,
	stageId,
	isFile,
	shape,
	...file
}: ReadingStage &
	RewriteAttemptFields & {
		readonly stageId: StageId;
		readonly isFile: (value: unknown) => value is TContent;
		readonly shape: string;
	}): Promise<TContent> {
	return readInputJson({
		path: rewriteAttemptFilePath({ workspaceRoot: context.workspaceRoot, stageId, ...file }),
		stageId,
		fail,
		read: readerFromCheck(isFile),
		shape,
	});
}

/**
 * Builds the messages of the call of a rewrite-loop stage for one subtopic: the
 * prompt, then the material of the subtopic as labelled JSON.
 *
 * @param args - The prompt, and the material of the subtopic.
 * @param args.system - The prompt of the stage.
 * @param args.material - The material that the prompt is about, such as the text of the subtopic.
 * @returns The system and user messages.
 */
export function subtopicPromptMessages({
	system,
	material,
}: {
	readonly system: string;
	readonly material: unknown;
}): PromptMessages {
	return promptMessages({ system, user: labelledJson({ label: "Subtopic", value: material }) });
}

/**
 * The work on one subtopic that the `make` of a rewrite-loop stage gets: the
 * subtopic, the stage context and the model calls of the stage run.
 *
 * @typeParam TInput - The input of the stage.
 * @typeParam TSubtopic - The work of one subtopic.
 */
export type RewriteAttemptWork<TInput, TSubtopic> = Pick<
	ModelStageRunArgs<TInput>,
	"context" | "calls"
> & { readonly subtopic: TSubtopic };

/**
 * The work of a stage of the rewrite loop on the file of each subtopic, for
 * {@link readOrMakeRewriteAttempts}.
 *
 * @typeParam TInput - The input of the stage.
 * @typeParam TSubtopic - The work of one subtopic.
 * @typeParam TContent - The content of the file of one subtopic.
 */
type RewriteAttemptFiles<TInput, TSubtopic, TContent> = {
	readonly stageId: StageId;
	readonly subtopicsOf: (input: TInput) => readonly TSubtopic[];
	readonly isSaved: (value: unknown) => value is TContent;
	readonly saved: { readonly content: string; readonly remake: string };
	readonly fail: (message: string) => Error;
	readonly make: (args: RewriteAttemptWork<TInput, TSubtopic>) => Promise<MadeFile<TContent>>;
};

/**
 * The definition of a stage of the rewrite loop, for
 * {@link defineRewriteAttemptStage}.
 *
 * @typeParam TInput - The input of the stage.
 * @typeParam TSubtopic - The work of one subtopic.
 * @typeParam TContent - The content of the file of one subtopic.
 * @typeParam TOutput - The output of the stage.
 */
type RewriteAttemptStage<TInput, TSubtopic, TContent, TOutput> = RewriteAttemptFiles<
	TInput,
	TSubtopic,
	TContent
> & {
	readonly getInput: (context: StageContext) => Promise<TInput>;
	readonly output: (contents: readonly TContent[]) => TOutput;
};

/**
 * Reads or makes the file of the first rewrite attempt of each subtopic, in one
 * run of a stage of the rewrite loop. As many subtopics are in work as the
 * stage's `concurrency` allows. Each file is written as soon as it is made. A
 * saved file is read back, and its subtopic gets no call.
 *
 * @param args - The work on the file of each subtopic, and the stage run.
 * @param args.stageId - The stage that writes the files.
 * @param args.subtopicsOf - Gives the work of each subtopic, in lecture order.
 * @param args.isSaved - Checks that a parsed saved file has the shape that `make` gives.
 * @param args.saved - The words for the message about an unreadable file, such as `subtopic rewrite` and `rewrite the subtopic`.
 * @param args.fail - Builds the stage's own error from a message.
 * @param args.make - Makes the file of one subtopic, and gives the cost of its calls.
 * @param args.input - The input of the stage.
 * @param args.context - The stage context.
 * @param args.calls - The model calls of this stage run.
 * @param args.concurrency - The number of subtopics in work at the same time.
 * @returns The content of each file in lecture order, the cost of the calls, and the `filesWritten` entry of each file.
 * @throws The error that `fail` builds, if a saved file is unreadable.
 * @typeParam TInput - The input of the stage.
 * @typeParam TSubtopic - The work of one subtopic.
 * @typeParam TContent - The content of the file of one subtopic.
 */
export async function readOrMakeRewriteAttempts<
	TInput,
	TSubtopic extends { readonly subtopicId: number },
	TContent,
>({
	stageId,
	subtopicsOf,
	isSaved,
	saved,
	fail,
	make,
	input,
	context,
	calls,
	concurrency,
}: RewriteAttemptFiles<TInput, TSubtopic, TContent> &
	Pick<ModelStageRunArgs<TInput>, "input" | "context" | "calls" | "concurrency">): Promise<
	Omit<StageResult<unknown>, "output"> & {
		readonly contents: readonly TContent[];
	}
> {
	const files = subtopicsOf(input).map((subtopic) => ({
		subtopic,
		path: rewriteAttemptFilePath({
			workspaceRoot: context.workspaceRoot,
			stageId,
			subtopicId: subtopic.subtopicId,
			attemptNumber: FIRST_ROUND,
		}),
	}));
	const { contents, cost } = await readOrMakeSavedFiles<(typeof files)[number], TContent>({
		files,
		label: "Subtopics",
		concurrency,
		readSaved: readerFromCheck(isSaved),
		unreadable: (path) => fail(unreadableSavedFileMessage({ path, ...saved })),
		make: ({ subtopic }) => make({ subtopic, context, calls }),
	});
	return {
		contents,
		cost,
		filesWritten: files.map((file) => relative(context.workspaceRoot, file.path)),
	};
}

/**
 * Defines a stage of the rewrite loop, and gives the factory that the CLI builds
 * it with. The stage reads or makes the file of the first rewrite attempt of
 * each subtopic through {@link readOrMakeRewriteAttempts}.
 *
 * @param definition - The stage, its input, and the work that makes the file of one subtopic.
 * @param definition.getInput - Gets and checks the input of the stage.
 * @param definition.output - Gives the output of the stage from the content of each file, in lecture order.
 * @returns A factory that takes the logger and the client of the invocation.
 * @throws The error that `fail` builds, if a saved file is unreadable.
 * @typeParam TInput - The input of the stage.
 * @typeParam TSubtopic - The work of one subtopic.
 * @typeParam TContent - The content of the file of one subtopic.
 * @typeParam TOutput - The output of the stage.
 */
export function defineRewriteAttemptStage<
	TInput,
	TSubtopic extends { readonly subtopicId: number },
	TContent,
	TOutput,
>({
	getInput,
	output,
	...files
}: RewriteAttemptStage<TInput, TSubtopic, TContent, TOutput>): ModelStageFactory<TInput, TOutput> {
	return defineModelStage({
		stageId: files.stageId,
		getInput,
		run: async (run) => {
			const { contents, ...made } = await readOrMakeRewriteAttempts({ ...files, ...run });
			return { output: output(contents), ...made };
		},
	});
}
