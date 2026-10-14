/**
 * The files of the stages that write one file for each subtopic, such as
 * `correct-terms` and `rewrite-subtopics`.
 */

import { join, relative } from "node:path";
import type {
	SingleModelStageId,
	StageContext,
	StageId,
	StageResult,
} from "../../types/pipeline.js";
import { writeJsonAtomic } from "../../utils/files.js";
import { isRecord, readerFromCheck } from "../../utils/record.js";
import {
	type StageInWorkspace,
	type StageWithOutputFile,
	stageDirectoryPath,
	stageOutputPath,
} from "../layout.js";
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
	return subtopicFileIn({ directory: stageDirectoryPath(stage), subtopicId });
}

/**
 * Gives the path of the file of one subtopic in a folder.
 *
 * @param args - The folder and the subtopic.
 * @param args.directory - The absolute path of the folder.
 * @param args.subtopicId - The subtopic.
 * @returns The absolute path of the file.
 */
function subtopicFileIn({
	directory,
	subtopicId,
}: { readonly directory: string } & SubtopicFileFields): string {
	return join(directory, `subtopic-${subtopicId}.json`);
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
 * The saved files of a stage that writes one file for each subtopic. These are
 * their shape, the words for an unreadable file, and the stage's own error.
 *
 * @typeParam TContent - The content of the file of one subtopic.
 */
type SavedSubtopicFiles<TContent> = {
	readonly isSaved: (value: unknown) => value is TContent;
	readonly saved: { readonly content: string; readonly remake: string };
	readonly fail: (message: string) => Error;
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
type SubtopicFileStage<TInput, TSubtopic, TContent, TOutput> = SavedSubtopicFiles<TContent> & {
	readonly stageId: SingleModelStageId;
	readonly subtopicsOf: (input: TInput) => readonly TSubtopic[];
	readonly make: (args: SubtopicWork<TInput, TSubtopic>) => Promise<TContent>;
	readonly getInput: (context: StageContext) => Promise<TInput>;
	readonly output: (contents: readonly TContent[]) => TOutput;
};

/**
 * Reads or makes the file of each subtopic, in one run of a stage. As many
 * subtopics are in work as `concurrency` allows. Each file is written as soon as
 * it is made. A saved file is read back, and its subtopic gets no call.
 *
 * @param args - The folder, the subtopics, and the work on the file of each subtopic.
 * @param args.workspaceRoot - The absolute path of the lecture workspace.
 * @param args.directory - The absolute path of the folder that holds the files.
 * @param args.subtopics - The work of each subtopic, in lecture order.
 * @param args.isSaved - Checks that a parsed saved file has the shape that `make` gives.
 * @param args.saved - The words for the message about an unreadable file, such as `subtopic rewrite` and `rewrite the subtopic`.
 * @param args.fail - Builds the stage's own error from a message.
 * @param args.make - Makes the content of the file of one subtopic.
 * @param args.concurrency - The number of subtopics in work at the same time. Unset means one at a time.
 * @returns The content of each file in lecture order, and the `filesWritten` entry of each file.
 * @throws The error that `fail` builds, if a saved file is unreadable.
 * @typeParam TSubtopic - The work of one subtopic.
 * @typeParam TContent - The content of the file of one subtopic.
 */
export async function readOrMakeSubtopicFiles<
	TSubtopic extends { readonly subtopicId: number },
	TContent,
>({
	workspaceRoot,
	directory,
	subtopics,
	isSaved,
	saved,
	fail,
	make,
	concurrency,
}: SavedSubtopicFiles<TContent> & {
	readonly workspaceRoot: string;
	readonly directory: string;
	readonly subtopics: readonly TSubtopic[];
	readonly make: (subtopic: TSubtopic) => Promise<TContent>;
	readonly concurrency: number | undefined;
}): Promise<
	Omit<StageResult<unknown>, "output"> & {
		readonly contents: readonly TContent[];
	}
> {
	const files = subtopics.map((subtopic) => ({
		subtopic,
		path: subtopicFileIn({ directory, subtopicId: subtopic.subtopicId }),
	}));
	const { contents } = await readOrMakeSavedFiles<(typeof files)[number], TContent>({
		files,
		label: "Subtopics",
		concurrency,
		readSaved: readerFromCheck(isSaved),
		unreadable: (path) => fail(unreadableSavedFileMessage({ path, ...saved })),
		make: ({ subtopic }) => make(subtopic),
	});
	return {
		contents,
		filesWritten: files.map((file) => relative(workspaceRoot, file.path)),
	};
}

/**
 * Writes the file that holds the entry of each subtopic under one key, such as
 * `{ "factCorrectedSubtopics": [...] }`. A stage writes it when each subtopic has
 * its file. Its folder must already exist.
 *
 * @param args - The workspace, the file, the key, and the files of the subtopics.
 * @param args.workspaceRoot - The absolute path of the lecture workspace.
 * @param args.path - The absolute path of the file.
 * @param args.key - The field that holds the entries.
 * @param args.contents - The entry of each subtopic, in lecture order.
 * @param args.filesWritten - The `filesWritten` entry of the file of each subtopic.
 * @returns The value of the file, and the `filesWritten` entry of each file, this file last.
 * @typeParam TKey - The field that holds the entries.
 * @typeParam TEntry - The entry of one subtopic.
 */
async function writeSubtopicEntriesFile<TKey extends string, TEntry>({
	workspaceRoot,
	path,
	key,
	contents,
	filesWritten,
}: {
	readonly workspaceRoot: string;
	readonly path: string;
	readonly key: TKey;
	readonly contents: readonly TEntry[];
	readonly filesWritten: readonly string[];
}): Promise<{
	readonly output: { readonly [field in TKey]: readonly TEntry[] };
	readonly filesWritten: readonly string[];
}> {
	// The cast is safe: the object has one field, `key`, which holds the entries.
	const output = { [key]: contents } as { readonly [field in TKey]: readonly TEntry[] };
	await writeJsonAtomic({ path, value: output });
	return { output, filesWritten: [...filesWritten, relative(workspaceRoot, path)] };
}

/**
 * Defines a stage that writes one file for each subtopic, and gives the factory
 * that the CLI builds it with. The stage reads or makes the file of each
 * subtopic through {@link readOrMakeSubtopicFiles}.
 *
 * @param definition - The stage, its input, and the work that makes the file of one subtopic.
 * @param definition.stageId - The stage. Its folder holds the files.
 * @param definition.getInput - Gets and checks the input of the stage.
 * @param definition.subtopicsOf - Gives the work of each subtopic, in lecture order.
 * @param definition.make - Makes the content of the file of one subtopic.
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
	...work
}: SubtopicFileStage<TInput, TSubtopic, TContent, TOutput>): ModelStageFactory<TInput, TOutput> {
	return defineStageOverSubtopicFiles({
		...work,
		getInput,
		finish: ({ made: { contents, ...made } }) => ({ output: output(contents), ...made }),
	});
}

/**
 * Defines a stage that writes one file for each subtopic, and then the stage's
 * output file, which holds the entry of each subtopic under `key`. It gives the
 * factory that the CLI builds the stage with.
 *
 * @param definition - As for {@link defineSubtopicFileStage}, with the key in place of `output`.
 * @param definition.getInput - Gets and checks the input of the stage.
 * @param definition.key - The field of the output file that holds the entries.
 * @returns A factory that takes the logger and the client of the invocation.
 * @throws The error that `fail` builds, if a saved file is unreadable.
 * @typeParam TInput - The input of the stage.
 * @typeParam TSubtopic - The work of one subtopic.
 * @typeParam TContent - The content of the file of one subtopic.
 * @typeParam TKey - The field that holds the entries.
 */
export function defineSubtopicAndLectureFileStage<
	TInput,
	TSubtopic extends { readonly subtopicId: number },
	TContent,
	TKey extends string,
>({
	getInput,
	key,
	...work
}: Omit<SubtopicFileStage<TInput, TSubtopic, TContent, never>, "output" | "stageId"> & {
	readonly stageId: SingleModelStageId & StageWithOutputFile;
	readonly key: TKey;
}): ModelStageFactory<TInput, { readonly [field in TKey]: readonly TContent[] }> {
	return defineStageOverSubtopicFiles({
		...work,
		getInput,
		finish: ({ made, context: { workspaceRoot } }) =>
			writeSubtopicEntriesFile({
				workspaceRoot,
				path: stageOutputPath({ workspaceRoot, stageId: work.stageId }),
				key,
				...made,
			}),
	});
}

/**
 * Defines a stage that reads or makes the file of each subtopic in its folder,
 * through {@link readOrMakeSubtopicFiles}, and then gives its result with `finish`.
 *
 * @param definition - The stage, its input, the work on the file of one subtopic, and the last step.
 * @param definition.stageId - The stage. Its folder holds the files.
 * @param definition.getInput - Gets and checks the input of the stage.
 * @param definition.subtopicsOf - Gives the work of each subtopic, in lecture order.
 * @param definition.make - Makes the content of the file of one subtopic.
 * @param definition.finish - Gives the result of the stage from the files of the subtopics and the stage context.
 * @returns A factory that takes the logger and the client of the invocation.
 * @throws The error that `fail` builds, if a saved file is unreadable.
 * @typeParam TInput - The input of the stage.
 * @typeParam TSubtopic - The work of one subtopic.
 * @typeParam TContent - The content of the file of one subtopic.
 * @typeParam TOutput - The output of the stage.
 */
function defineStageOverSubtopicFiles<
	TInput,
	TSubtopic extends { readonly subtopicId: number },
	TContent,
	TOutput,
>({
	stageId,
	getInput,
	subtopicsOf,
	make,
	finish,
	...saved
}: Omit<SubtopicFileStage<TInput, TSubtopic, TContent, never>, "output"> & {
	readonly finish: (args: {
		readonly made: Awaited<ReturnType<typeof readOrMakeSubtopicFiles<TSubtopic, TContent>>>;
		readonly context: StageContext;
	}) => StageResult<TOutput> | Promise<StageResult<TOutput>>;
}): ModelStageFactory<TInput, TOutput> {
	return defineModelStage({
		stageId,
		getInput,
		run: async ({ input, context, calls, concurrency }) => {
			const { workspaceRoot } = context;
			const made = await readOrMakeSubtopicFiles({
				...saved,
				workspaceRoot,
				directory: stageDirectoryPath({ workspaceRoot, stageId }),
				subtopics: subtopicsOf(input),
				make: (subtopic) => make({ subtopic, context, calls }),
				concurrency,
			});
			return finish({ made, context });
		},
	});
}
