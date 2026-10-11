/**
 * The files that the stages of the rewrite loop write. Each stage writes one file
 * for each rewrite attempt of a subtopic (CONTEXT.md, "Rewrite attempt").
 */

import { join, relative } from "node:path";
import type { StageContext, StageId } from "../../types/pipeline.js";
import { isRecord, readerFromCheck } from "../../utils/record.js";
import { type StageInWorkspace, stageDirectoryPath } from "../layout.js";
import { FIRST_ROUND } from "../manifest.js";
import { defineModelStage, type ModelStageFactory, type ModelStageRunArgs } from "./model-stage.js";
import { type MadeFile, readOrMakeSavedFiles, unreadableSavedFileMessage } from "./saved-files.js";

/** The fields that each file of a rewrite attempt starts with. */
type RewriteAttemptFields = { readonly subtopicId: number; readonly attemptNumber: number };

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
 * The definition of a stage of the rewrite loop, for
 * {@link defineRewriteAttemptStage}.
 *
 * @typeParam TInput - The input of the stage.
 * @typeParam TSubtopic - The work of one subtopic.
 * @typeParam TContent - The content of the file of one subtopic.
 * @typeParam TOutput - The output of the stage.
 */
type RewriteAttemptStage<TInput, TSubtopic, TContent, TOutput> = {
	readonly stageId: StageId;
	readonly getInput: (context: StageContext) => Promise<TInput>;
	readonly subtopicsOf: (input: TInput) => readonly TSubtopic[];
	readonly isSaved: (value: unknown) => value is TContent;
	readonly saved: { readonly content: string; readonly remake: string };
	readonly fail: (message: string) => Error;
	readonly make: (args: RewriteAttemptWork<TInput, TSubtopic>) => Promise<MadeFile<TContent>>;
	readonly output: (contents: readonly TContent[]) => TOutput;
};

/**
 * Defines a stage of the rewrite loop, and gives the factory that the CLI builds
 * it with. The stage reads or makes the file of the first rewrite attempt of each
 * subtopic. As many subtopics are in work as the stage's `concurrency` allows.
 * Each file is written as soon as it is made. A saved file is read back, and its
 * subtopic gets no call.
 *
 * @param definition - The stage, its input, and the work that makes the file of one subtopic.
 * @param definition.stageId - The stage that this defines.
 * @param definition.getInput - Gets and checks the input of the stage.
 * @param definition.subtopicsOf - Gives the work of each subtopic, in lecture order.
 * @param definition.isSaved - Checks that a parsed saved file has the shape that `make` gives.
 * @param definition.saved - The words for the message about an unreadable file, such as `subtopic rewrite` and `rewrite the subtopic`.
 * @param definition.fail - Builds the stage's own error from a message.
 * @param definition.make - Makes the file of one subtopic, and gives the cost of its calls.
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
	stageId,
	getInput,
	subtopicsOf,
	isSaved,
	saved,
	fail,
	make,
	output,
}: RewriteAttemptStage<TInput, TSubtopic, TContent, TOutput>): ModelStageFactory<TInput, TOutput> {
	return defineModelStage({
		stageId,
		getInput,
		run: async ({ input, context, calls, concurrency }) => {
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
				output: output(contents),
				cost,
				filesWritten: files.map((file) => relative(context.workspaceRoot, file.path)),
			};
		},
	});
}
