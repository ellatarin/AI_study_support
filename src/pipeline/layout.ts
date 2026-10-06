/**
 * The names of the module folders, the workspace folders, the manifest, the run
 * logs and the output files of each stage. A stage, the runner, the next stage and
 * the tests read each name from here.
 */

import { basename, dirname, join, resolve } from "node:path";
import type { StageId } from "../types/pipeline.js";

const SOURCE_DIR = "Source files";
const VIDEO_RECORDINGS_DIR = "Video recordings";
const SLIDE_DECKS_DIR = "Slide decks";
const PROCESSING_DIR = "Pipeline processing";
const FINAL_OUTPUT_DIR = "Final output";

/** The name of the manifest file in a workspace. */
export const MANIFEST_FILE = "manifest.json";

/** The folder in a workspace that holds the run logs of the lecture. */
export const RUN_LOGS_DIR = "Run logs";

/** The folder at the project root that holds the debug logs, one for each invocation. */
export const DEBUG_LOGS_DIR = "debug-logs";

/** The four folders of a module (technical-design.md §3.1). */
export type ModuleDirs = {
	/** The folder that holds the video recordings. */
	readonly videoRecording: string;
	/** The folder that holds the slide decks. */
	readonly slideDeck: string;
	/** The processing folder, which holds the workspaces. */
	readonly processing: string;
	/** The final output folder, which holds the notes PDFs. */
	readonly finalOutput: string;
};

/**
 * Gives the four folders of a module.
 *
 * @param args - The module.
 * @param args.moduleRoot - The absolute path to the module folder.
 * @returns The absolute paths to the four folders.
 */
export function moduleDirs({ moduleRoot }: { readonly moduleRoot: string }): ModuleDirs {
	return {
		videoRecording: join(moduleRoot, SOURCE_DIR, VIDEO_RECORDINGS_DIR),
		slideDeck: join(moduleRoot, SOURCE_DIR, SLIDE_DECKS_DIR),
		processing: join(moduleRoot, PROCESSING_DIR),
		finalOutput: join(moduleRoot, FINAL_OUTPUT_DIR),
	};
}

/**
 * Gives the module folders that hold one lecture file for each lecture, found by
 * its lecture date. The workspace is not in the list, because it is a folder, not
 * a file in a shared folder (technical-design.md §3.3).
 *
 * @param args - The module.
 * @param args.dirs - The four folders of the module.
 * @returns The video recordings, slide decks and final output folders, in that order.
 */
export function sharedLectureFileDirs({ dirs }: { readonly dirs: ModuleDirs }): readonly string[] {
	return [dirs.videoRecording, dirs.slideDeck, dirs.finalOutput];
}

/**
 * Gives the run logs folder of a workspace (technical-design.md §4.6).
 *
 * @param args - The workspace.
 * @param args.workspaceRoot - The absolute path to the workspace.
 * @returns The absolute path to the run logs folder.
 */
export function runLogsDirPath({ workspaceRoot }: { readonly workspaceRoot: string }): string {
	return join(workspaceRoot, RUN_LOGS_DIR);
}

/**
 * Gives the path of the debug log of one invocation, at the project root. The log
 * is not in a workspace, because one invocation can do many lectures
 * (technical-design.md §10).
 *
 * @param args - The project and the invocation.
 * @param args.projectRoot - The absolute path to the folder that holds the config file.
 * @param args.invocationId - The timestamp id of the invocation.
 * @returns The absolute path of the debug log.
 */
export function debugLogPath({
	projectRoot,
	invocationId,
}: {
	readonly projectRoot: string;
	readonly invocationId: string;
}): string {
	return join(projectRoot, DEBUG_LOGS_DIR, `${invocationId}-debug.log`);
}

/**
 * Gives the workspace of a lecture: a folder named with the base name of the
 * lecture, in the processing folder. {@link moduleRootOf} does the reverse.
 *
 * @param args - The module and the lecture.
 * @param args.moduleRoot - The absolute path to the module folder.
 * @param args.baseName - The base name of the lecture.
 * @returns The absolute path to the workspace.
 */
export function workspaceRootFor({
	moduleRoot,
	baseName,
}: {
	readonly moduleRoot: string;
	readonly baseName: string;
}): string {
	return join(moduleDirs({ moduleRoot }).processing, baseName);
}

/**
 * Gives the module that holds a workspace, two levels up
 * (`<module>/Pipeline processing/<workspace>`). {@link workspaceRootFor} does the
 * reverse.
 *
 * @param args - The workspace.
 * @param args.workspaceRoot - The absolute path to the workspace.
 * @returns The absolute path to the module folder.
 */
export function moduleRootOf({ workspaceRoot }: { readonly workspaceRoot: string }): string {
	return resolve(workspaceRoot, "..", "..");
}

/**
 * Gives the name of a module that the user sees. A module has no name other than
 * the name of its folder.
 *
 * @param args - The module.
 * @param args.moduleRoot - The absolute path to the module folder.
 * @returns The name of the module folder.
 */
export function moduleName({ moduleRoot }: { readonly moduleRoot: string }): string {
	return basename(moduleRoot);
}

declare const declaredInLayout: unique symbol;

/**
 * A folder name that is written as a literal in this file. Only
 * {@link declaredName} makes one, and it refuses a widened `string`. So a name
 * from the manifest or a model reply cannot reach a folder that the runner deletes
 * (technical-design.md §4.4, "Stage cleanup boundaries").
 */
type StageDirectoryName = string & { readonly [declaredInLayout]: true };

/**
 * The type is `TName` when `TName` is a literal type, and `never` when it is a
 * widened `string`. A
 * value read from the manifest, a model reply or the file system is a widened
 * `string`, so it does not typecheck.
 */
type LiteralName<TName extends string> = string extends TName ? never : TName;

/**
 * The place of a stage's work, which tells a reset what it can delete. A reset
 * deletes a workspace folder whole. The final output folder holds the PDFs of all
 * lectures. So a stage only puts its file into it, and a reset deletes only the
 * file of its lecture (technical-design.md §3.3, §4.4).
 *
 * @typeParam TName - The type of a folder name: a declared name here, or an absolute path after it is resolved.
 */
type OutputLocation<TName extends string> =
	| {
			readonly root: "workspace";
			/** Each folder that the stage owns in the workspace. */
			readonly directories: readonly TName[];
	  }
	| {
			readonly root: "module";
			/** The module folder that the stage puts the file of this lecture into. */
			readonly directory: TName;
	  };

/** The place of a stage's work, as {@link STAGE_FILES} declares it. */
export type StageOutputLocation = OutputLocation<StageDirectoryName>;

/** The place of a stage's work, as absolute paths for one workspace. */
export type ResolvedStageOutput = OutputLocation<string>;

/** The folders and files of one stage. */
export type StageFiles = {
	/**
	 * The place of the stage's work. A reset clears this place for this stage and
	 * for each stage after this stage (technical-design.md §4.7).
	 */
	readonly outputLocation: StageOutputLocation;
	/**
	 * The one file that the stage writes in the workspace, relative to the workspace.
	 * The stage entry records it in `filesWritten`. It is `null` for a stage that
	 * writes nothing of its own, writes a set of files, or writes its file outside
	 * the workspace (technical-design.md §3.3).
	 */
	readonly outputFile: string | null;
	/**
	 * A Markdown version of {@link outputFile}, for a person to read. It is a field of
	 * its own, not a second output, because the next stage reads only the output
	 * (technical-design.md §3.3).
	 */
	readonly markdownVersion: string | null;
	/**
	 * The name of the stage record. Only the name is declared, because the stage
	 * record is always in the folder of {@link outputFile} (technical-design.md §3.3).
	 */
	readonly stageRecord: string | null;
};

/**
 * The files of a stage that writes one output file. {@link writesInto},
 * {@link savesRunsThenWritesInto} and {@link writesIntoWithMarkdownVersion} return
 * this type, so {@link STAGE_FILES} keeps which stages have an output file.
 */
type StageFilesWithOutputFile = {
	readonly outputLocation: StageOutputLocation;
	/** The output file, relative to the workspace. */
	readonly outputFile: string;
	readonly markdownVersion: string | null;
	readonly stageRecord: string | null;
};

/**
 * Brands a folder name as declared in this file. This is the only function that
 * makes a {@link StageDirectoryName}, and it refuses a widened `string`.
 *
 * @param name - A folder name, written as a literal.
 * @returns The same string, with the brand.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- a string literal type has nothing to mutate. The rule cannot resolve the LiteralName conditional
function declaredName<TName extends string>(name: TName & LiteralName<TName>): StageDirectoryName {
	// The brand goes on a plain string. The signature above refuses a name that
	// was a widened string at the call.
	const declared: string = name;
	return declared as StageDirectoryName;
}

/**
 * Declares the folders that a stage owns in the workspace.
 *
 * @param names - The folder names, each a literal, relative to the workspace.
 * @returns The place of the stage's work.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- the rule reads the brand in the intersection as a mutable object, but the brand is on a string and is readonly. Readonly<> makes the value an object, and then the brand does not typecheck
function inWorkspace(names: readonly StageDirectoryName[]): StageOutputLocation {
	return { root: "workspace", directories: names };
}

/**
 * The folder that a stage owns and the name of the file that it writes there.
 *
 * @typeParam TName - The folder name, which must be a literal in this file.
 */
type WritesIntoArgs<TName extends string> = {
	readonly directory: TName & LiteralName<TName>;
	readonly file: string;
};

/**
 * Declares a stage that owns one workspace folder and writes one file into it. The
 * output path is built from the folder name, so a reset cannot clear one folder
 * while the stage entry records the output in another.
 *
 * @param args - The folder and the file.
 * @param args.directory - The folder name, as a literal.
 * @param args.file - The file name in that folder.
 * @returns The files of the stage.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- string literal types have nothing to mutate. The rule cannot resolve the LiteralName conditional
function writesInto<TName extends string>(args: WritesIntoArgs<TName>): StageFilesWithOutputFile {
	return { ...writesSetInto<TName>(args), outputFile: join(args.directory, args.file) };
}

/**
 * Declares a stage that owns one workspace folder and writes a set of files into
 * it. Examples are the saved runs of a panel and the images of the slides. The
 * stage has no single output file.
 *
 * @param args - The folder.
 * @param args.directory - The folder name, as a literal.
 * @returns The files of the stage.
 */
function writesSetInto<TName extends string>(
	// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- string literal types have nothing to mutate. The rule cannot resolve the LiteralName conditional
	args: Pick<WritesIntoArgs<TName>, "directory">,
): StageFiles & {
	readonly outputFile: null;
	readonly markdownVersion: null;
	readonly stageRecord: null;
} {
	return {
		outputLocation: inWorkspace([declaredName<TName>(args.directory)]),
		outputFile: null,
		markdownVersion: null,
		stageRecord: null,
	};
}

/**
 * Declares a panel stage that keeps its saved runs in one folder and writes its
 * result into another. The folder of the saved runs is first. A panel keeps its
 * saved runs in the first folder of its stage.
 *
 * @param args - The two folders and the file.
 * @param args.runsDirectory - The folder of the saved runs, as a literal.
 * @param args.directory - The folder of the result, as a literal.
 * @param args.file - The file name of the result in that folder.
 * @returns The files of the stage.
 */
function savesRunsThenWritesInto<TRunsName extends string, TName extends string>(
	// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- string literal types have nothing to mutate. The rule cannot resolve the LiteralName conditional
	args: WritesIntoArgs<TName> & { readonly runsDirectory: TRunsName & LiteralName<TRunsName> },
): StageFilesWithOutputFile {
	return {
		...writesInto<TName>(args),
		outputLocation: inWorkspace([
			declaredName<TRunsName>(args.runsDirectory),
			declaredName<TName>(args.directory),
		]),
	};
}

type StageFilesWithMarkdownVersion = StageFilesWithOutputFile & {
	readonly markdownVersion: string;
};

/**
 * Declares a stage that writes one file and a Markdown version of it. Both paths
 * are built from one folder name, so the two files are always in one folder.
 *
 * @param args - The folder and the two files.
 * @param args.directory - The folder name, as a literal.
 * @param args.file - The file name of the output in that folder.
 * @param args.markdownVersion - The file name of the Markdown version in that folder.
 * @returns The files of the stage.
 */
function writesIntoWithMarkdownVersion<TName extends string>(
	// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- string literal types have nothing to mutate. The rule cannot resolve the LiteralName conditional
	args: WritesIntoArgs<TName> & { readonly markdownVersion: string },
): StageFilesWithMarkdownVersion {
	return {
		...writesInto<TName>({ directory: args.directory, file: args.file }),
		markdownVersion: join(args.directory, args.markdownVersion),
	};
}

/**
 * The folders and files of each stage, in pipeline order (technical-design.md §3.3).
 * `pdf-generation` is the one stage that writes outside the workspace. It puts its
 * PDF into the final output folder, and it does not own that folder.
 *
 * The table has no type annotation, so the compiler keeps which stages have each
 * file. `satisfies` makes sure that each stage is in the table.
 */
export const STAGE_FILES = {
	"source-normalisation": {
		outputLocation: inWorkspace([]),
		outputFile: null,
		markdownVersion: null,
		stageRecord: null,
	},
	"audio-extraction": writesInto({ directory: "Audio", file: "audio.m4a" }),
	transcription: writesInto({ directory: "Transcript", file: "transcript.txt" }),
	"initial-subtopic-splitting": writesSetInto({ directory: "Initial subtopics" }),
	"deepen-subtopic-splitting": writesSetInto({ directory: "Deepened subtopics" }),
	"choose-division": {
		...writesInto({ directory: "Chosen division", file: "subtopics.json" }),
		stageRecord: "choice.json",
	},
	"retitle-subtopics": {
		...writesInto({ directory: "Retitled subtopics", file: "subtopics.json" }),
		stageRecord: "changes.json",
	},
	"group-into-topics": {
		...savesRunsThenWritesInto({
			runsDirectory: "Grouping runs",
			directory: "Topics",
			file: "topics.json",
		}),
		stageRecord: "choice.json",
	},
	"transcript-structuring": writesInto({
		directory: "Structured transcript",
		file: "structured-transcript.md",
	}),
	"transcript-verification": writesIntoWithMarkdownVersion({
		directory: "Transcript verification",
		file: "verification-report.json",
		markdownVersion: "verification-report.md",
	}),
	"slide-conversion": writesInto({ directory: "Slide content", file: "slides.md" }),
	"image-extraction": writesSetInto({ directory: "Slide images" }),
	synthesis: writesInto({ directory: "Synthesised notes", file: "synthesised-notes.md" }),
	"qa-loop": {
		outputLocation: inWorkspace([declaredName("QA iterations"), declaredName("QA checked")]),
		outputFile: null,
		markdownVersion: null,
		stageRecord: null,
	},
	"pdf-generation": {
		outputLocation: { root: "module", directory: declaredName(FINAL_OUTPUT_DIR) },
		outputFile: null,
		markdownVersion: null,
		stageRecord: null,
	},
} satisfies Readonly<Record<StageId, StageFiles>>;

/**
 * The stages that write one output file in the workspace. Only these stages can
 * be asked for the path of their output file. To ask another stage is a compile
 * error. The type is derived
 * from {@link STAGE_FILES} (technical-design.md §3.3).
 */
export type StageWithOutputFile = {
	[TStage in StageId]: (typeof STAGE_FILES)[TStage]["outputFile"] extends string ? TStage : never;
}[StageId];

/**
 * The stages that write a Markdown version. The type is derived from
 * {@link STAGE_FILES}. The verification report Markdown is temporary. When the
 * verification report Markdown is deleted, this type is empty. Each caller of
 * {@link stageMarkdownVersionEntry} and {@link stageMarkdownVersionPath} then fails
 * to compile (technical-design.md §5, `transcript-verification`).
 */
export type StageWithMarkdownVersion = {
	[TStage in StageId]: (typeof STAGE_FILES)[TStage]["markdownVersion"] extends string
		? TStage
		: never;
}[StageId];

/**
 * The stages that keep a stage record. The type is derived from
 * {@link STAGE_FILES}. It holds only stages that write one output file, because
 * the stage record is beside that file.
 */
export type StageWithStageRecord = StageWithOutputFile &
	{
		[TStage in StageId]: (typeof STAGE_FILES)[TStage]["stageRecord"] extends string
			? TStage
			: never;
	}[StageId];

/**
 * Gives the output file of a stage, relative to the workspace, as `filesWritten`
 * records it (technical-design.md §4.5).
 *
 * @param stageId - A stage that writes one output file.
 * @returns The path relative to the workspace.
 */
export function stageOutputEntry(stageId: StageWithOutputFile): string {
	return STAGE_FILES[stageId].outputFile;
}

/**
 * Gives the Markdown version of a stage's output, relative to the workspace, as
 * `filesWritten` records it (technical-design.md §3.3).
 *
 * @param stageId - A stage that writes a Markdown version.
 * @returns The path relative to the workspace.
 */
export function stageMarkdownVersionEntry(stageId: StageWithMarkdownVersion): string {
	return STAGE_FILES[stageId].markdownVersion;
}

/** One stage in one workspace. The functions that read, write or clear a stage's work take it. */
export type StageInWorkspace = {
	/** The absolute path to the workspace. */
	readonly workspaceRoot: string;
	readonly stageId: StageId;
};

/** One stage that writes one output file, in one workspace. */
export type StageFileInWorkspace = {
	/** The absolute path to the workspace. */
	readonly workspaceRoot: string;
	readonly stageId: StageWithOutputFile;
};

/**
 * Gives the output file of a stage as an absolute path. A stage calls this
 * function for its own output and for the output of the stage that it reads.
 *
 * @param args - The workspace and the stage.
 * @param args.workspaceRoot - The absolute path to the workspace.
 * @param args.stageId - A stage that writes one output file.
 * @returns The absolute path to the output file.
 */
export function stageOutputPath({ workspaceRoot, stageId }: StageFileInWorkspace): string {
	return join(workspaceRoot, stageOutputEntry(stageId));
}

/** One stage that writes a Markdown version, in one workspace. */
export type StageMarkdownVersionInWorkspace = {
	/** The absolute path to the workspace. */
	readonly workspaceRoot: string;
	readonly stageId: StageWithMarkdownVersion;
};

/**
 * Gives the Markdown version of a stage's output as an absolute path.
 *
 * @param args - The workspace and the stage.
 * @param args.workspaceRoot - The absolute path to the workspace.
 * @param args.stageId - A stage that writes a Markdown version.
 * @returns The absolute path to the Markdown version.
 */
export function stageMarkdownVersionPath({
	workspaceRoot,
	stageId,
}: StageMarkdownVersionInWorkspace): string {
	return join(workspaceRoot, stageMarkdownVersionEntry(stageId));
}

/**
 * Gives the stage record of a stage, relative to the workspace, as `filesWritten`
 * records it (technical-design.md §3.3).
 *
 * @param stageId - A stage that keeps a stage record.
 * @returns The path relative to the workspace.
 */
export function stageRecordEntry(stageId: StageWithStageRecord): string {
	return join(dirname(stageOutputEntry(stageId)), STAGE_FILES[stageId].stageRecord);
}

/**
 * Gives the stage record of a stage as an absolute path.
 *
 * @param args - The workspace and the stage.
 * @param args.workspaceRoot - The absolute path to the workspace.
 * @param args.stageId - A stage that keeps a stage record.
 * @returns The absolute path to the stage record.
 */
export function stageRecordPath({
	workspaceRoot,
	stageId,
}: {
	readonly workspaceRoot: string;
	readonly stageId: StageWithStageRecord;
}): string {
	return join(workspaceRoot, stageRecordEntry(stageId));
}

/**
 * Gives the place of a stage's work for one lecture, as absolute paths. The returned
 * value keeps `root`, because a reset reads `root` to decide if the reset can
 * delete the folders (technical-design.md §4.7).
 *
 * @param args - The workspace and the stage.
 * @param args.workspaceRoot - The absolute path to the workspace.
 * @param args.stageId - The stage.
 * @returns The workspace folders of the stage, or the module folder that it puts its file into.
 */
export function resolveStageOutput({
	workspaceRoot,
	stageId,
}: StageInWorkspace): ResolvedStageOutput {
	const location = STAGE_FILES[stageId].outputLocation;
	if (location.root === "module") {
		return {
			root: "module",
			directory: join(moduleRootOf({ workspaceRoot }), location.directory),
		};
	}
	return {
		root: "workspace",
		directories: location.directories.map((name) => join(workspaceRoot, name)),
	};
}

/**
 * Gives each folder that a stage works in, as absolute paths. The stage factory
 * makes these folders and clears temporary files from them before the stage runs
 * (technical-design.md §4.3).
 *
 * A reset must not use this list. For `pdf-generation`, the list holds the
 * final output folder, which holds the PDFs of all lectures. A reset uses
 * {@link resolveStageOutput}.
 *
 * @param args - The workspace and the stage.
 * @param args.workspaceRoot - The absolute path to the workspace.
 * @param args.stageId - The stage.
 * @returns The absolute paths, in the declared order. The list is empty for a stage with no folder.
 */
export function stageDirectoryPaths({
	workspaceRoot,
	stageId,
}: StageInWorkspace): readonly string[] {
	const output = resolveStageOutput({ workspaceRoot, stageId });
	return output.root === "module" ? [output.directory] : output.directories;
}
