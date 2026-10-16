/**
 * This module names the module folders, the workspace folders, the manifest, the
 * run logs and the output files of each stage. The stages, the runner and the
 * tests read each name from here.
 */

import { basename, dirname, join, posix, resolve } from "node:path";
import type { StageId } from "../types/pipeline.js";

const SOURCE_DIR = "Source files";
const VIDEO_RECORDINGS_DIR = "Video recordings";
const SLIDE_DECKS_DIR = "Slide decks";
const PROCESSING_DIR = "Pipeline processing";
const FINAL_OUTPUT_DIR = "Final output";

/** The manifest of a lecture is in this file in its workspace. */
export const MANIFEST_FILE = "manifest.json";

/** The run logs of a lecture are in this folder in its workspace. */
export const RUN_LOGS_DIR = "Run logs";

/** The debug logs are in this folder at the project root, one log for each invocation. */
export const DEBUG_LOGS_DIR = "debug-logs";

/**
 * The notes page of a lecture is in this file, in the lecture's folder in the
 * final output folder (technical-design.md §3.1).
 */
export const NOTES_PAGE_FILE = "notes.html";

/** The Notes PDF is in this file, beside the notes page (CONTEXT.md, "Notes PDF"). */
export const NOTES_PDF_FILE = "notes.pdf";

/** The slide images of the notes are in this folder, beside the notes page. */
export const NOTES_SLIDES_DIR = "slides";

/**
 * Each module contains these four folders (technical-design.md §3.1). The
 * processing folder contains the workspaces. The final output folder contains one
 * folder for each lecture.
 */
export type ModuleDirs = {
	readonly videoRecording: string;
	readonly slideDeck: string;
	readonly processing: string;
	readonly finalOutput: string;
};

/**
 * Returns the four folders of a module.
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
 * Returns the module folders in which a caller finds a lecture file by its lecture
 * date. The processing folder is not in the list, because a caller already holds
 * the path of the lecture's workspace (technical-design.md §3.3).
 *
 * @param args - The module.
 * @param args.dirs - The four folders of the module.
 * @returns The video recordings, slide decks and final output folders, in that order.
 */
export function sharedLectureFileDirs({ dirs }: { readonly dirs: ModuleDirs }): readonly string[] {
	return [dirs.videoRecording, dirs.slideDeck, dirs.finalOutput];
}

/** The layout functions find the folders of a lecture from its module and its base name. */
export type LectureInModule = { readonly moduleRoot: string; readonly baseName: string };

/**
 * Returns the folder of a lecture in one folder of its module. The name of the
 * lecture's folder is the base name of the lecture.
 *
 * @param args - The lecture, and the folder of the module.
 * @param args.moduleRoot - The absolute path to the module folder.
 * @param args.baseName - The base name of the lecture.
 * @param args.moduleDir - The folder of the module that holds the lecture's folder.
 * @returns The absolute path to the lecture's folder.
 */
function lectureDirIn({
	moduleRoot,
	baseName,
	moduleDir,
}: LectureInModule & { readonly moduleDir: keyof ModuleDirs }): string {
	return join(moduleDirs({ moduleRoot })[moduleDir], baseName);
}

/**
 * Returns the folder of a lecture's notes, in the final output folder. The folder
 * contains {@link NOTES_PAGE_FILE}, {@link NOTES_PDF_FILE} and {@link NOTES_SLIDES_DIR}
 * (technical-design.md §3.1).
 *
 * @param lecture - The module and the lecture.
 * @returns The absolute path to the folder.
 */
export function lectureNotesDirPath(lecture: LectureInModule): string {
	return lectureDirIn({ ...lecture, moduleDir: "finalOutput" });
}

/**
 * Returns the path of a lecture's notes page, {@link NOTES_PAGE_FILE} in the
 * lecture's folder in the final output folder.
 *
 * @param lecture - The module and the lecture.
 * @returns The absolute path to the notes page.
 */
export function notesPagePath(lecture: LectureInModule): string {
	return join(lectureNotesDirPath(lecture), NOTES_PAGE_FILE);
}

/**
 * Returns the path of a lecture's Notes PDF, {@link NOTES_PDF_FILE} beside the
 * notes page.
 *
 * @param lecture - The module and the lecture.
 * @returns The absolute path to the Notes PDF.
 */
export function notesPdfPath(lecture: LectureInModule): string {
	return join(lectureNotesDirPath(lecture), NOTES_PDF_FILE);
}

/**
 * Returns the run logs folder of a workspace (technical-design.md §4.6).
 *
 * @param args - The workspace.
 * @param args.workspaceRoot - The absolute path to the workspace.
 * @returns The absolute path to the run logs folder.
 */
export function runLogsDirPath({ workspaceRoot }: { readonly workspaceRoot: string }): string {
	return join(workspaceRoot, RUN_LOGS_DIR);
}

/**
 * Returns the path of the debug log of one invocation, at the project root. The
 * debug log is not in a workspace, because one invocation can run many lectures
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
 * Returns the file name of one saved run of a panel. The run number has two
 * digits, so that a folder listing shows the files in run order.
 *
 * @param args - The run.
 * @param args.runNumber - The number of the run, from 1.
 * @returns The file name, such as `run-01.json`.
 */
export function savedRunFileName({ runNumber }: { readonly runNumber: number }): string {
	return `run-${String(runNumber).padStart(2, "0")}.json`;
}

/**
 * Returns the file name of one slide's image or reading. The slide number has
 * three digits, so that a folder listing shows the files in deck order
 * (technical-design.md §3.3).
 *
 * @param args - The slide and the file type.
 * @param args.slideNumber - The number of the slide in the deck, from 1.
 * @param args.extension - The file extension, such as `png` or `json`.
 * @returns The file name, such as `slide-001.png`.
 */
export function slideFileName({
	slideNumber,
	extension,
}: {
	readonly slideNumber: number;
	readonly extension: string;
}): string {
	return `slide-${String(slideNumber).padStart(3, "0")}.${extension}`;
}

/**
 * Returns the file name of one slide image. `render-slides` writes the image with
 * this name, and `build-notes-page` uses the same name for its copy.
 *
 * @param slideNumber - The number of the slide in the deck, from 1.
 * @returns The file name, such as `slide-004.png`.
 */
export function slideImageFileName(slideNumber: number): string {
	return slideFileName({ slideNumber, extension: "png" });
}

/**
 * Returns the path of the copy of one slide image, relative to the folder of the
 * lecture's notes. `build-notes-page` writes the copy at this path, and puts the
 * same path in the link on the notes page. The separator is `/`, because a link
 * needs it.
 *
 * @param slideNumber - The number of the slide in the deck, from 1.
 * @returns The relative path, such as `slides/slide-004.png`.
 */
export function notesSlideImageEntry(slideNumber: number): string {
	return posix.join(NOTES_SLIDES_DIR, slideImageFileName(slideNumber));
}

/**
 * Returns the workspace of a lecture, in the processing folder.
 * {@link moduleRootOf} is the reverse function.
 *
 * @param lecture - The module and the lecture.
 * @returns The absolute path to the workspace.
 */
export function workspaceRootFor(lecture: LectureInModule): string {
	return lectureDirIn({ ...lecture, moduleDir: "processing" });
}

/**
 * Returns the module that contains a workspace, two levels up
 * (`<module>/Pipeline processing/<workspace>`). {@link workspaceRootFor} is the
 * reverse function.
 *
 * @param args - The workspace.
 * @param args.workspaceRoot - The absolute path to the workspace.
 * @returns The absolute path to the module folder.
 */
export function moduleRootOf({ workspaceRoot }: { readonly workspaceRoot: string }): string {
	return resolve(workspaceRoot, "..", "..");
}

/**
 * Returns the module name that the user sees: the name of the module folder. A
 * module has no other name.
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
 * This type holds only a folder name that this file writes as a literal. Only
 * {@link declaredName} makes a value of this type, and it refuses a widened
 * `string`. So a name from the manifest or a model reply cannot reach a folder
 * that the runner deletes (technical-design.md §4.4, "Stage cleanup boundaries").
 */
type StageDirectoryName = string & { readonly [declaredInLayout]: true };

/**
 * This type resolves to `TName` when `TName` is a literal type, and to `never`
 * when `TName` is a widened `string`. A value read from the manifest, a model reply or the file
 * system is a widened `string`, so it does not typecheck.
 */
type LiteralName<TName extends string> = string extends TName ? never : TName;

/** A stage writes its work into these folders and files. */
export type StageFiles = {
	/**
	 * The stage owns each of these folders in the workspace. Each folder contains
	 * the work of one lecture and nothing else. So a reset deletes each folder
	 * whole, for this stage and for each later stage (technical-design.md §3.3, §4.7).
	 */
	readonly directories: readonly StageDirectoryName[];
	/**
	 * The stage writes this one file, relative to the workspace. The stage entry
	 * lists the same path in `filesWritten`. The value is `null` for a stage that
	 * writes nothing of its own or writes a set of files (technical-design.md §3.3).
	 */
	readonly outputFile: string | null;
	/**
	 * The stage writes its stage record with this name. Only the name is here,
	 * because the stage record is always in the folder of {@link outputFile}
	 * (technical-design.md §3.3).
	 */
	readonly stageRecord: string | null;
};

/**
 * This type is for a stage that writes one output file. {@link writesInto} and
 * {@link savesRunsThenWritesInto} return this type, so that the compiler knows
 * from {@link STAGE_FILES} which stages write an output file.
 */
type StageFilesWithOutputFile = StageFiles & {
	readonly outputFile: string;
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
	// This function puts the brand on a plain string. The signature above refuses
	// a name that was a widened string at the call.
	const declared: string = name;
	return declared as StageDirectoryName;
}

/**
 * A stage owns this folder and writes a file with this name into it.
 *
 * @typeParam TName - The folder name, which must be a literal in this file.
 */
type WritesIntoArgs<TName extends string> = {
	readonly directory: TName & LiteralName<TName>;
	readonly file: string;
};

/**
 * Declares a stage that owns one workspace folder and writes one file into it.
 * This function builds the output path from the folder name. So a reset always
 * clears the folder that contains the recorded output.
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
 * it. The saved runs of a panel and the slide images are two such sets. The stage
 * writes no single output file.
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
	readonly stageRecord: null;
} {
	return {
		directories: [declaredName<TName>(args.directory)],
		outputFile: null,
		stageRecord: null,
	};
}

/**
 * Declares a panel stage that keeps its saved runs in one folder and writes its
 * result into another. The folder of the saved runs is first in the list, because
 * a panel keeps its saved runs in the first folder of its stage.
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
		directories: [declaredName<TRunsName>(args.runsDirectory), declaredName<TName>(args.directory)],
	};
}

/**
 * Each stage writes its work into the folders and files in this table, which is in
 * pipeline order (technical-design.md §3.3). Only `build-notes-page` writes
 * outside the workspace.
 *
 * There is no type annotation on the table, so the compiler knows which stage
 * writes which files. The `satisfies` check makes sure that each stage is in the table.
 */
export const STAGE_FILES = {
	"source-normalisation": { directories: [], outputFile: null, stageRecord: null },
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
	"judge-lecture-title": writesInto({ directory: "Title judgement", file: "judgement.json" }),
	"structure-transcript": writesInto({
		directory: "Structured transcript",
		file: "structured-transcript.json",
	}),
	"render-slides": writesSetInto({ directory: "Slide images" }),
	"read-slides": writesSetInto({ directory: "Slide readings" }),
	"place-slides": writesInto({ directory: "Slide placements", file: "placements.json" }),
	"correct-terms": writesSetInto({ directory: "Term corrections" }),
	"rewrite-subtopics": writesSetInto({ directory: "Rewrites" }),
	"check-facts": writesInto({ directory: "Fact checks", file: "factual-errors.json" }),
	"correct-factual-errors": writesInto({
		directory: "Fact corrections",
		file: "fact-corrected-subtopics.json",
	}),
	"relocate-slides": writesInto({ directory: "Slide relocations", file: "slide-relocations.json" }),
	// This stage writes the lecture's folder in `Final output/`, not in the workspace.
	"build-notes-page": { directories: [], outputFile: null, stageRecord: null },
} satisfies Readonly<Record<StageId, StageFiles>>;

/**
 * This type includes only the stages that write one output file in the
 * workspace. A call that asks another stage for the path of its output file is a
 * compile error. The compiler derives the type from {@link STAGE_FILES}
 * (technical-design.md §3.3).
 */
export type StageWithOutputFile = {
	[TStage in StageId]: (typeof STAGE_FILES)[TStage]["outputFile"] extends string ? TStage : never;
}[StageId];

/**
 * This type includes only the stages that keep a stage record. Each of these
 * stages also writes one output file, because the stage record is beside that
 * file. The compiler derives the type from {@link STAGE_FILES}.
 */
export type StageWithStageRecord = StageWithOutputFile &
	{
		[TStage in StageId]: (typeof STAGE_FILES)[TStage]["stageRecord"] extends string
			? TStage
			: never;
	}[StageId];

/**
 * Returns the output file of a stage, relative to the workspace, in the same form
 * as the stage entry's `filesWritten` (technical-design.md §4.5).
 *
 * @param stageId - A stage that writes one output file.
 * @returns The path relative to the workspace.
 */
export function stageOutputEntry(stageId: StageWithOutputFile): string {
	return STAGE_FILES[stageId].outputFile;
}

/** The functions that read, write or clear the work of a stage take this workspace and stage. */
export type StageInWorkspace = {
	readonly workspaceRoot: string;
	readonly stageId: StageId;
};

/** The functions that find the output file of a stage take this workspace and stage. */
export type StageFileInWorkspace = {
	readonly workspaceRoot: string;
	readonly stageId: StageWithOutputFile;
};

/**
 * Returns the output file of a stage as an absolute path. A stage calls this
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

/**
 * Returns the stage record of a stage, relative to the workspace, in the same form
 * as the stage entry's `filesWritten` (technical-design.md §3.3).
 *
 * @param stageId - A stage that keeps a stage record.
 * @returns The path relative to the workspace.
 */
export function stageRecordEntry(stageId: StageWithStageRecord): string {
	return join(dirname(stageOutputEntry(stageId)), STAGE_FILES[stageId].stageRecord);
}

/**
 * Returns the stage record of a stage as an absolute path.
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
 * Returns each folder that a stage works in, as absolute paths. The stage factory
 * makes these folders and clears temporary files from them before the stage runs
 * (technical-design.md §4.3). A reset deletes these folders (§4.7).
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
	return STAGE_FILES[stageId].directories.map((name) => join(workspaceRoot, name));
}

/**
 * Returns the folder that a stage writes into: the first folder of
 * {@link stageDirectoryPaths}. The function returns the workspace when the stage
 * owns no folder.
 *
 * @param args - The workspace and the stage.
 * @param args.workspaceRoot - The absolute path to the workspace.
 * @param args.stageId - The stage.
 * @returns The absolute path of the folder.
 */
export function stageDirectoryPath({ workspaceRoot, stageId }: StageInWorkspace): string {
	const [directory = workspaceRoot] = stageDirectoryPaths({ workspaceRoot, stageId });
	return directory;
}
