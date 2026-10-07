import { mkdir } from "node:fs/promises";
import { basename } from "node:path";
import type { Logger } from "pino";
import type { PipelineStage, StageContext, StageId, StageResult } from "../../types/pipeline.js";
import {
	cleanTmpFiles,
	jsonFileContent,
	type ProduceFile,
	pathExists,
	produceFileAtomic,
	writeFileAtomic,
} from "../../utils/files.js";
import { createStageLogger } from "../../utils/logger.js";
import {
	type StageWithMarkdownVersion,
	type StageWithOutputFile,
	type StageWithStageRecord,
	stageDirectoryPaths,
	stageMarkdownVersionEntry,
	stageMarkdownVersionPath,
	stageOutputEntry,
	stageOutputPath,
	stageRecordEntry,
	stageRecordPath,
} from "../layout.js";
import { locateSourceFile, type SourceFolder } from "../lecture-files.js";
import { isCompletedEntry } from "../run-status.js";
import {
	ManifestPathError,
	type ManifestPathQuery,
	resolveManifestPath,
} from "../workspace-paths.js";

/**
 * Tells whether one `filesWritten` entry is still on disk. An entry that cannot be
 * resolved counts as absent, because deleting an output often deletes its folder
 * too (technical-design.md §4.2).
 *
 * @param query - The entry, and the roots that bound it.
 * @returns `true` when the entry resolves and is on disk.
 * @throws {ManifestPathError} If the entry resolves outside `moduleRoot`.
 */
async function recordedFileExists(query: ManifestPathQuery): Promise<boolean> {
	try {
		return await pathExists(await resolveManifestPath(query));
	} catch (error: unknown) {
		if (error instanceof ManifestPathError) {
			throw error;
		}
		return false;
	}
}

/**
 * The `isComplete` check of every per-lecture stage. A stage is complete when its
 * stage entry is `complete` or `skipped` and every file in its `filesWritten` is on
 * disk. So a completed stage whose output was deleted runs again
 * (technical-design.md §4.2).
 *
 * The manifest is untrusted input, so each entry is first resolved by
 * {@link resolveManifestPath} (technical-design.md §4.4).
 *
 * @param args - The stage context, and the stage.
 * @param args.context - The stage context of the current lecture.
 * @param args.stageId - The stage to check.
 * @returns `true` when the stage is a completed stage.
 * @throws {ManifestPathError} If an entry resolves outside `moduleRoot`.
 */
export async function isStageComplete({
	context,
	stageId,
}: {
	readonly context: StageContext;
	readonly stageId: StageId;
}): Promise<boolean> {
	const entry = context.manifest.stages[stageId];
	if (!isCompletedEntry(entry)) {
		return false;
	}
	for (const written of entry.filesWritten) {
		const exists = await recordedFileExists({
			workspaceRoot: context.workspaceRoot,
			moduleRoot: context.moduleRoot,
			entry: written,
		});
		if (!exists) {
			return false;
		}
	}
	return true;
}

/**
 * Creates every folder that {@link stageDirectoryPaths} gives for the stage, and
 * deletes the `.tmp` files that a crash left in them (technical-design.md §4.3).
 *
 * @param args - The workspace, and the stage.
 * @param args.workspaceRoot - The absolute path of the lecture's workspace.
 * @param args.stageId - The stage whose folders to prepare.
 * @returns A promise that resolves when every folder is there and holds no `.tmp` file.
 */
async function prepareStageDirectories({
	workspaceRoot,
	stageId,
}: {
	readonly workspaceRoot: string;
	readonly stageId: StageId;
}): Promise<void> {
	for (const directory of stageDirectoryPaths({ workspaceRoot, stageId })) {
		await mkdir(directory, { recursive: true });
		await cleanTmpFiles(directory);
	}
}

/** The output file that a writer put in place. */
type RecordedStageOutput = {
	/** The absolute path of the output file. */
	readonly path: string;
	/** The workspace-relative entries of every file written. */
	readonly filesWritten: readonly string[];
};

/** A stage that writes one output file, and the stage context that holds the lecture's workspace. */
type StageOutputTarget = {
	readonly stageId: StageWithOutputFile;
	readonly context: Pick<StageContext, "workspaceRoot">;
};

/**
 * The stage and the workspace of an output, as the layout functions take them.
 *
 * @param target - The stage, and its stage context.
 * @param target.stageId - The stage.
 * @param target.context - The stage context that holds the lecture's workspace.
 * @returns The stage, and the absolute path of the lecture's workspace.
 * @typeParam TStageId - The stage, as narrow as the caller knows it.
 */
function stageInWorkspace<TStageId extends StageWithOutputFile>({
	stageId,
	context,
}: StageOutputTarget & { readonly stageId: TStageId }): {
	readonly stageId: TStageId;
	readonly workspaceRoot: string;
} {
	return { stageId, workspaceRoot: context.workspaceRoot };
}

/**
 * The source of an output file: text that the stage holds, or a producer that
 * writes the `.tmp` file, such as ffmpeg (technical-design.md §4.2, §4.3).
 */
type StageOutputSource =
	| {
			readonly content: string;
	  }
	| {
			/** Creates the file at the `.tmp` path that it gets. */
			readonly produce: ProduceFile;
	  };

/**
 * Writes the one output file of a stage, and gives its `filesWritten` entry. The
 * path and the entry come from the same stage id, so the entry always names the
 * file just written (technical-design.md §4.2, §4.3, §4.5).
 *
 * @param args - The stage, its stage context, and the text or the producer.
 * @param args.stageId - The stage. It must write one output file.
 * @param args.context - The stage context. It holds the lecture's workspace.
 * @returns The absolute path of the output file, and its `filesWritten` entry.
 * @throws The error of the producer, after the partial `.tmp` file is deleted.
 * @example
 * await writeStageOutput({ stageId, context, content: markdown });
 * await writeStageOutput({ stageId, context, produce: (tmp) => extractTo(tmp) });
 */
export async function writeStageOutput(
	args: StageOutputTarget & StageOutputSource,
): Promise<RecordedStageOutput> {
	const path = stageOutputPath(stageInWorkspace(args));
	await ("content" in args
		? writeFileAtomic({ path, content: args.content })
		: produceFileAtomic({ path, produce: args.produce }));
	return { path, filesWritten: [stageOutputEntry(args.stageId)] };
}

/**
 * Writes the output file of a stage and the Markdown version of it, and gives the
 * `filesWritten` entries of both (technical-design.md §3.3, §4.2, §4.5).
 *
 * This is a separate function, not an optional argument, so that its `stageId`
 * accepts only a stage with a Markdown version. Deleting either file makes the stage run
 * again.
 *
 * @param args - The stage, its stage context, and the text of both files.
 * @param args.stageId - The stage. It must write a Markdown version.
 * @param args.context - The stage context. It holds the lecture's workspace.
 * @param args.content - The text of the output file.
 * @param args.markdownVersion - The Markdown version of the output, for a person to read.
 * @returns The absolute path of the output file, and the `filesWritten` entries of both files.
 * @example
 * await writeStageOutputWithMarkdownVersion({ stageId, context, content: json, markdownVersion: markdown });
 */
export function writeStageOutputWithMarkdownVersion({
	markdownVersion,
	...output
}: StageOutputWrite & {
	readonly stageId: StageWithMarkdownVersion;
	readonly markdownVersion: string;
}): Promise<RecordedStageOutput> {
	const beside = {
		path: stageMarkdownVersionPath(stageInWorkspace(output)),
		entry: stageMarkdownVersionEntry(output.stageId),
	};
	return writeStageOutputBeside({ output, beside: { ...beside, content: markdownVersion } });
}

/**
 * Writes the output file of a stage and its stage record beside it, both as JSON,
 * and gives the `filesWritten` entries of both. The stage record is a file and not
 * a part of the manifest, so it is replaced and deleted with the output
 * (technical-design.md §3.3, §4.5).
 *
 * @param args - The stage, its stage context, the output, and its stage record.
 * @param args.stageId - The stage. It must keep a stage record.
 * @param args.context - The stage context. It holds the lecture's workspace.
 * @param args.value - The output, written as JSON.
 * @param args.stageRecord - The stage record: how the stage reached the output, written as JSON.
 * @returns The absolute path of the output file, and the `filesWritten` entries of both files.
 */
export function writeStageOutputWithStageRecord({
	value,
	stageRecord,
	...target
}: StageOutputTarget & {
	readonly stageId: StageWithStageRecord;
	readonly value: unknown;
	readonly stageRecord: unknown;
}): Promise<RecordedStageOutput> {
	return writeStageOutputBeside({
		output: { ...target, content: jsonFileContent(value) },
		beside: {
			path: stageRecordPath(stageInWorkspace(target)),
			entry: stageRecordEntry(target.stageId),
			content: jsonFileContent(stageRecord),
		},
	});
}

type StageOutputWrite = StageOutputTarget & { readonly content: string };

/**
 * Writes the output file of a stage and one more file beside it, and gives the
 * `filesWritten` entries of both. The Markdown version and the stage record are
 * written through it.
 *
 * @param args - The output, and the file beside it.
 * @param args.output - The stage, its stage context, and the text of the output file.
 * @param args.beside - The file beside the output.
 * @param args.beside.path - The absolute path of the file.
 * @param args.beside.entry - The `filesWritten` entry of the file.
 * @param args.beside.content - The text of the file.
 * @returns The absolute path of the output file, and the `filesWritten` entries of both files.
 */
async function writeStageOutputBeside({
	output,
	beside,
}: {
	readonly output: StageOutputWrite;
	readonly beside: { readonly path: string; readonly entry: string; readonly content: string };
}): Promise<RecordedStageOutput> {
	const written = await writeStageOutput(output);
	await writeFileAtomic({ path: beside.path, content: beside.content });
	return { path: written.path, filesWritten: [...written.filesWritten, beside.entry] };
}

/**
 * The work of a stage. It gets the stage's input, the stage context, and a logger
 * that names the stage and the lecture.
 *
 * @typeParam TInput - The input of the stage.
 * @typeParam TOutput - The output of the stage.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger type has mutable properties that the rule sees. This code only reads the logger. CLAUDE.md allows a mutable type where a library requires one.
type StageRun<TInput, TOutput> = (args: {
	readonly input: TInput;
	readonly context: StageContext;
	readonly logger: Logger;
}) => Promise<StageResult<TOutput>>;

/** The input of a stage that reads one source file of the lecture. */
export type SourceFileInput = {
	/** The absolute path of the source file. */
	readonly sourceFilePath: string;
};

/**
 * The parts of a stage that reads one source file of the lecture, such as the
 * video recording or the slide deck. {@link createSourceFileStage} builds the
 * stage from them.
 *
 * @typeParam TOutput - The output of the stage.
 */
export type SourceFileStageParts<TOutput> = {
	readonly stageId: StageId;
	/** The source folder that holds the file. */
	readonly source: SourceFolder;
	/** Builds the stage's own error from a message, when the file is missing or not unique. */
	readonly fail: (message: string) => Error;
	readonly run: StageRun<SourceFileInput, TOutput>;
};

/**
 * Builds a stage that reads one source file of the lecture. Its input is the
 * path of the one file in the source folder that has the lecture's base name
 * (technical-design.md §5, `audio-extraction` and `render-slides`).
 *
 * @param args - The parts of the stage, and the logger.
 * @param args.logger - The logger of the invocation.
 * @param args.stageId - The stage that this builds.
 * @param args.source - The source folder that holds the file.
 * @param args.fail - Builds the stage's own error from a message.
 * @param args.run - Does the work of the stage.
 * @returns The pipeline stage.
 * @typeParam TOutput - The output of the stage.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger type has mutable properties that the rule sees. This code only reads the logger. CLAUDE.md allows a mutable type where a library requires one.
export function createSourceFileStage<TOutput>({
	logger,
	stageId,
	source,
	fail,
	run,
}: SourceFileStageParts<TOutput> & { readonly logger: Logger }): PipelineStage<
	SourceFileInput,
	TOutput
> {
	return createPipelineStage({
		stageId,
		logger,
		getInput: async (context): Promise<SourceFileInput> => ({
			sourceFilePath: await locateSourceFile({ context, source, fail }),
		}),
		run,
	});
}

/**
 * Builds a per-lecture {@link PipelineStage} from the two parts that differ from
 * stage to stage: how it gets its input, and what it does (technical-design.md §4.2).
 *
 * The factory adds these to every stage:
 * - the shared `isComplete` check, for the stage id
 * - before `run` starts, the stage's folders are created and their `.tmp` files deleted (§4.3)
 * - `run` gets a logger that adds the stage and the lecture to each entry (§10).
 *
 * The logger is a parameter of this factory and not of {@link PipelineStage.run},
 * so the runner never passes a logger through the stage contract (§4.2).
 *
 * @param args - The stage id, the logger, and the behaviour of the stage.
 * @param args.stageId - The stage that this builds.
 * @param args.logger - The logger of the invocation. The factory adds the stage and the lecture to it.
 * @param args.getInput - Gets and checks the input of the stage.
 * @param args.run - Does the work of the stage, with its folders prepared.
 * @returns The pipeline stage.
 * @typeParam TInput - The input that `getInput` gives and `run` takes.
 * @typeParam TOutput - The output that `run` gives.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger type has mutable properties that the rule sees. This code only reads the logger. CLAUDE.md allows a mutable type where a library requires one.
export function createPipelineStage<TInput, TOutput>({
	stageId,
	logger,
	getInput,
	run,
}: {
	readonly stageId: StageId;
	readonly logger: Logger;
	readonly getInput: (context: StageContext) => Promise<TInput>;
	readonly run: StageRun<TInput, TOutput>;
}): PipelineStage<TInput, TOutput> {
	const stageLogger = createStageLogger({ logger, stageId });
	return {
		stageId,
		isComplete: (context) => isStageComplete({ context, stageId }),
		getInput,
		run: async ({ input, context }) => {
			await prepareStageDirectories({ workspaceRoot: context.workspaceRoot, stageId });
			// The lecture is added at each call of `run`, because a batch runs one stage
			// object for several lectures at the same time (technical-design.md §10).
			const lectureLogger = stageLogger.child({
				module: basename(context.moduleRoot),
				lectureNumber: context.lectureNumber,
				lectureDate: context.lectureDate,
			});
			return run({ input, context, logger: lectureLogger });
		},
	};
}
