/**
 * The files of the stages that write one file for each subtopic, such as
 * `correct-terms` and `rewrite-subtopics`.
 */

import { join, relative } from "node:path";
import type { StageContext, StageId, StageResult } from "../../types/pipeline.js";
import { isRecord, readerFromCheck } from "../../utils/record.js";
import { type StageInWorkspace, stageDirectoryPath } from "../layout.js";
import {
	defineModelStage,
	labelledJson,
	type ModelStageFactory,
	type ModelStageRunArgs,
	type PromptMessages,
	promptMessages,
} from "./model-stage.js";
import { readOrMakeSavedFiles, unreadableSavedFileMessage } from "./saved-files.js";
import { type ReadingStage, readInputJson } from "./stage-input.js";

/** The field that each subtopic file starts with. */
export type SubtopicFileFields = { readonly subtopicId: number };

/**
 * Gives the path of the file that a stage writes for one subtopic.
 *
 * @param args - The stage, the workspace and the subtopic.
 * @param args.workspaceRoot - The absolute path to the lecture workspace.
 * @param args.stageId - The stage that writes the file.
 * @param args.subtopicId - The subtopic.
 * @returns The absolute path of the file.
 */
export function subtopicFilePath({
	subtopicId,
	...stage
}: StageInWorkspace & SubtopicFileFields): string {
	return join(stageDirectoryPath(stage), `subtopic-${subtopicId}.json`);
}

/**
 * Checks that a parsed file has the field that each subtopic file starts with:
 * `subtopicId`, a number.
 *
 * @param value - The parsed file.
 * @returns `true` when the value has the field.
 */
export function hasSubtopicId(
	value: unknown,
): value is Record<string, unknown> & SubtopicFileFields {
	return isRecord(value) && typeof value.subtopicId === "number";
}

/**
 * Reads the file that an earlier stage wrote for one subtopic.
 *
 * @param args - The reading stage, the earlier stage, the file and its shape.
 * @param args.context - The stage context.
 * @param args.fail - Builds the reading stage's error from a message.
 * @param args.stageId - The earlier stage that writes the file.
 * @param args.subtopicId - The subtopic.
 * @param args.isFile - Checks that the parsed file has the shape that the earlier stage writes.
 * @param args.shape - The shape, for the failure that a user reads, such as `a subtopic rewrite`.
 * @returns The content of the file.
 * @throws The error that `fail` builds, if the file is missing, not JSON or not of the shape.
 * @typeParam TContent - The content of the file.
 */
export function readSubtopicFile<TContent>({
	context,
	fail,
	stageId,
	isFile,
	shape,
	...file
}: ReadingStage &
	SubtopicFileFields & {
		readonly stageId: StageId;
		readonly isFile: (value: unknown) => value is TContent;
		readonly shape: string;
	}): Promise<TContent> {
	return readInputJson({
		path: subtopicFilePath({ workspaceRoot: context.workspaceRoot, stageId, ...file }),
		stageId,
		fail,
		read: readerFromCheck(isFile),
		shape,
	});
}

/**
 * Builds the messages of the call for one subtopic: the prompt, then the
 * material of the subtopic as labelled JSON.
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
 * The work on one subtopic that the `make` of a stage gets: the subtopic, the
 * stage context and the model calls of the stage run.
 *
 * @typeParam TInput - The input of the stage.
 * @typeParam TSubtopic - The work of one subtopic.
 */
export type SubtopicWork<TInput, TSubtopic> = Pick<
	ModelStageRunArgs<TInput>,
	"context" | "calls"
> & { readonly subtopic: TSubtopic };

/**
 * The work of a stage on the file of each subtopic, for
 * {@link readOrMakeSubtopicFiles}.
 *
 * @typeParam TInput - The input of the stage.
 * @typeParam TSubtopic - The work of one subtopic.
 * @typeParam TContent - The content of the file of one subtopic.
 */
type SubtopicFiles<TInput, TSubtopic, TContent> = {
	readonly stageId: StageId;
	readonly subtopicsOf: (input: TInput) => readonly TSubtopic[];
	readonly isSaved: (value: unknown) => value is TContent;
	readonly saved: { readonly content: string; readonly remake: string };
	readonly fail: (message: string) => Error;
	readonly make: (args: SubtopicWork<TInput, TSubtopic>) => Promise<TContent>;
};

/**
 * The definition of a stage that writes one file for each subtopic, for
 * {@link defineSubtopicFileStage}.
 *
 * @typeParam TInput - The input of the stage.
 * @typeParam TSubtopic - The work of one subtopic.
 * @typeParam TContent - The content of the file of one subtopic.
 * @typeParam TOutput - The output of the stage.
 */
type SubtopicFileStage<TInput, TSubtopic, TContent, TOutput> = SubtopicFiles<
	TInput,
	TSubtopic,
	TContent
> & {
	readonly getInput: (context: StageContext) => Promise<TInput>;
	readonly output: (contents: readonly TContent[]) => TOutput;
};

/**
 * Reads or makes the file of each subtopic, in one run of a stage. As many
 * subtopics are in work as the stage's `concurrency` allows. Each file is written
 * as soon as it is made. A saved file is read back, and its subtopic gets no call.
 *
 * @param args - The work on the file of each subtopic, and the stage run.
 * @param args.stageId - The stage that writes the files.
 * @param args.subtopicsOf - Gives the work of each subtopic, in lecture order.
 * @param args.isSaved - Checks that a parsed saved file has the shape that `make` gives.
 * @param args.saved - The words for the message about an unreadable file, such as `subtopic rewrite` and `rewrite the subtopic`.
 * @param args.fail - Builds the stage's own error from a message.
 * @param args.make - Makes the content of the file of one subtopic.
 * @param args.input - The input of the stage.
 * @param args.context - The stage context.
 * @param args.calls - The model calls of this stage run.
 * @param args.concurrency - The number of subtopics in work at the same time.
 * @returns The content of each file in lecture order, and the `filesWritten` entry of each file.
 * @throws The error that `fail` builds, if a saved file is unreadable.
 * @typeParam TInput - The input of the stage.
 * @typeParam TSubtopic - The work of one subtopic.
 * @typeParam TContent - The content of the file of one subtopic.
 */
export async function readOrMakeSubtopicFiles<
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
}: SubtopicFiles<TInput, TSubtopic, TContent> &
	Pick<ModelStageRunArgs<TInput>, "input" | "context" | "calls" | "concurrency">): Promise<
	Omit<StageResult<unknown>, "output"> & {
		readonly contents: readonly TContent[];
	}
> {
	const files = subtopicsOf(input).map((subtopic) => ({
		subtopic,
		path: subtopicFilePath({
			workspaceRoot: context.workspaceRoot,
			stageId,
			subtopicId: subtopic.subtopicId,
		}),
	}));
	const { contents } = await readOrMakeSavedFiles<(typeof files)[number], TContent>({
		files,
		label: "Subtopics",
		concurrency,
		readSaved: readerFromCheck(isSaved),
		unreadable: (path) => fail(unreadableSavedFileMessage({ path, ...saved })),
		make: ({ subtopic }) => make({ subtopic, context, calls }),
	});
	return {
		contents,
		filesWritten: files.map((file) => relative(context.workspaceRoot, file.path)),
	};
}

/**
 * Defines a stage that writes one file for each subtopic, and gives the factory
 * that the CLI builds it with. The stage reads or makes the file of each
 * subtopic through {@link readOrMakeSubtopicFiles}.
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
export function defineSubtopicFileStage<
	TInput,
	TSubtopic extends { readonly subtopicId: number },
	TContent,
	TOutput,
>({
	getInput,
	output,
	...files
}: SubtopicFileStage<TInput, TSubtopic, TContent, TOutput>): ModelStageFactory<TInput, TOutput> {
	return defineModelStage({
		stageId: files.stageId,
		getInput,
		run: async (run) => {
			const { contents, ...made } = await readOrMakeSubtopicFiles({ ...files, ...run });
			return { output: output(contents), ...made };
		},
	});
}
