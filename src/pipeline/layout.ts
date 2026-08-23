/**
 * Where everything lives on disk.
 *
 * Every directory and filename the pipeline reads or writes is declared here and
 * nowhere else: the module's four directories, each stage's workspace directory
 * and the file it writes, the manifest, and the run logs.
 *
 * One owner rather than one copy per user, because the same name is relied on by
 * parties that would otherwise drift apart — a stage writes into its directory
 * while the runner deletes that directory on `--from-stage`, and each stage reads
 * what the stage before it wrote. Stating a path at both ends lets it change at
 * one (technical-design.md §3.3, "The layout has one owner").
 */

import { basename, join, resolve } from "node:path";
import type { StageId } from "../types/pipeline.js";

const SOURCE_DIR = "Source files";
const VIDEO_SUBDIR = "Video files";
const SLIDE_SUBDIR = "Lecture slides";
const PROCESSING_DIR = "Pipeline processing";
const FINAL_OUTPUT_DIR = "Final output";

/** The lecture manifest's filename within a workspace. */
export const MANIFEST_FILE = "manifest.json";

/** The per-invocation run logs and debug log directory. */
export const RUNS_DIR = "runs";

/**
 * The four directories a module's lecture files are spread across
 * (technical-design.md §3.1).
 */
export type ModuleDirs = {
	/** Where the source videos live. */
	readonly video: string;
	/** Where the source slide decks live. */
	readonly slide: string;
	/** Where each lecture's pipeline workspace lives. */
	readonly processing: string;
	/** Where the finished PDFs are deposited. */
	readonly finalOutput: string;
};

/**
 * Resolves a module's four directories.
 *
 * @param args - The module to resolve.
 * @param args.moduleRoot - Absolute path to the module directory.
 * @returns The module's source, workspace, and output directory paths.
 */
export function moduleDirs({ moduleRoot }: { readonly moduleRoot: string }): ModuleDirs {
	return {
		video: join(moduleRoot, SOURCE_DIR, VIDEO_SUBDIR),
		slide: join(moduleRoot, SOURCE_DIR, SLIDE_SUBDIR),
		processing: join(moduleRoot, PROCESSING_DIR),
		finalOutput: join(moduleRoot, FINAL_OUTPUT_DIR),
	};
}

/**
 * The module directories a lecture keeps a file of its own in: its source video,
 * its source slides, and its finished PDF.
 *
 * The workspace directory is not among them, because a lecture's workspace is a
 * *folder* named after the lecture while these three hold a *file* named after
 * it — which is what lets all three be addressed by the lecture's date. Renaming
 * a lecture, deleting one, and laying one out in a fixture each walk exactly this
 * set, so which directories belong to it is decided here rather than at all three.
 *
 * @param args - The module to select from.
 * @param args.dirs - The module's four directories.
 * @returns The three directories, in video, slide, output order.
 */
export function datedFileDirs({ dirs }: { readonly dirs: ModuleDirs }): readonly string[] {
	return [dirs.video, dirs.slide, dirs.finalOutput];
}

/**
 * A workspace's run-log directory.
 *
 * Named here for the reason every other path is: the runner writes a log into it
 * and reads every log back out of it, and the suites look for what it wrote, so
 * three parties addressed the same directory by rebuilding it (technical-design.md
 * §4.6).
 *
 * @param args - The workspace to locate it in.
 * @param args.workspaceRoot - Absolute path to the lecture workspace.
 * @returns The absolute path to that workspace's run logs.
 */
export function runsDirPath({ workspaceRoot }: { readonly workspaceRoot: string }): string {
	return join(workspaceRoot, RUNS_DIR);
}

/**
 * Where one lecture's workspace sits: a folder named after the lecture, inside
 * the module's processing directory.
 *
 * The forward direction of {@link moduleRootOf}. Both exist so the nesting
 * between a module and its workspaces is written in one place — every stage, the
 * runner, the CLI and every suite that lays a lecture out had been rebuilding it,
 * which is what {@link moduleRootOf}'s inverse was only half preventing.
 *
 * @param args - The module and the lecture's folder.
 * @param args.moduleRoot - Absolute path to the module directory.
 * @param args.folderName - The lecture's workspace folder name.
 * @returns The absolute path to that lecture's workspace.
 */
export function workspaceRootFor({
	moduleRoot,
	folderName,
}: {
	readonly moduleRoot: string;
	readonly folderName: string;
}): string {
	return join(moduleDirs({ moduleRoot }).processing, folderName);
}

/**
 * Resolves the module a lecture workspace belongs to, two levels up from it
 * (`moduleRoot/Pipeline processing/<folder>`).
 *
 * The inverse of {@link workspaceRootFor}, so the nesting between a module and
 * its workspaces is stated once rather than at both ends.
 *
 * @param args - The workspace to resolve from.
 * @param args.workspaceRoot - Absolute path to the lecture workspace.
 * @returns The absolute path to the module root that contains it.
 */
export function moduleRootOf({ workspaceRoot }: { readonly workspaceRoot: string }): string {
	return resolve(workspaceRoot, "..", "..");
}

/**
 * What a module is called when it is shown to the user: the leaf of its root
 * directory, since a module has no name of its own beyond the folder it is.
 *
 * The batch summary's module column and the CLI's "nothing matched" message both
 * name a module, so the derivation lives here rather than at each of them.
 *
 * @param args - The module to name.
 * @param args.moduleRoot - Absolute path to the module root.
 * @returns The module's directory name.
 */
export function moduleName({ moduleRoot }: { readonly moduleRoot: string }): string {
	return basename(moduleRoot);
}

declare const declaredInLayout: unique symbol;

/**
 * A directory name written as a literal in this module.
 *
 * The runner deletes these directories outright, and `pdf-generation`'s resolves
 * against the module root rather than a workspace, so a value that reached this
 * map from the manifest or an LLM response could delete across the whole module.
 * The brand makes that a compile error rather than a convention: only
 * {@link inWorkspace} and {@link inModule} mint the type, and both refuse a
 * widened `string` (technical-design.md §4.4, "Stage cleanup boundaries").
 */
type StageDirectoryName = string & { readonly [declaredInLayout]: true };

/**
 * Admits a compile-time literal and rejects a widened `string`.
 *
 * `string extends TName` holds only once the argument has lost its literal type,
 * which is true of every value read back from the manifest, an LLM response, or
 * the filesystem — so those resolve to `never` and fail to typecheck.
 */
type LiteralName<TName extends string> = string extends TName ? never : TName;

/**
 * One directory a stage owns, and which root it hangs off.
 *
 * Almost every stage works inside the lecture workspace; `pdf-generation` alone
 * deposits its PDF in the module's `Final output/`, so the root is named rather
 * than assumed (technical-design.md §3.3).
 */
export type StageDirectory = {
	/** Which root `name` is relative to. */
	readonly root: "workspace" | "module";
	/** The directory's name, relative to that root. */
	readonly name: StageDirectoryName;
};

/** What one stage owns on disk. */
export type StageWorkspace = {
	/**
	 * The directories the stage owns. A `--from-stage` re-run deletes exactly
	 * these for the nominated stage and everything downstream
	 * (technical-design.md §4.7).
	 */
	readonly directories: readonly StageDirectory[];
	/**
	 * The single file the stage writes, relative to the workspace root. `null`
	 * where there is no such file: `source-normalisation` owns no workspace
	 * directory at all, and the stages producing a set rather than a document
	 * have no one path to name.
	 */
	readonly outputFile: string | null;
};

/**
 * Applies the brand, in the one place it is applied.
 *
 * Private to this module and reached only through {@link inWorkspace} and
 * {@link inModule}, which are what enforce that the name is a literal; this
 * function exists so the assertion those two share is written once.
 *
 * @param name - A directory name written as a literal above.
 * @returns The same string, branded as declared here.
 */
function declaredName(name: string): StageDirectoryName {
	return name as StageDirectoryName;
}

/**
 * Names a directory the stage owns inside the lecture workspace.
 *
 * @param name - The directory's name as a literal, relative to the workspace root.
 * @returns The directory, tagged with the root it hangs off.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- a string literal type, which has nothing to mutate; the rule cannot see through the unresolved LiteralName conditional
function inWorkspace<TName extends string>(name: TName & LiteralName<TName>): StageDirectory {
	return { root: "workspace", name: declaredName(name) };
}

/**
 * Names a directory the stage owns inside the module, outside any workspace.
 *
 * @param name - The directory's name as a literal, relative to the module root.
 * @returns The directory, tagged with the root it hangs off.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- a string literal type, which has nothing to mutate; the rule cannot see through the unresolved LiteralName conditional
function inModule<TName extends string>(name: TName & LiteralName<TName>): StageDirectory {
	return { root: "module", name: declaredName(name) };
}

/**
 * What each stage owns, in pipeline order (technical-design.md §3.3).
 *
 * `qa-loop` owns `QA checked/` — the quality-checked notes are its output, and
 * `pdf-generation` only reads them. `pdf-generation` owns the module's
 * `Final output/`, where its PDF is deposited: the one directory a stage owns
 * outside its workspace, so a re-run from either stage clears that stage's own
 * work and nothing upstream of it.
 */
export const STAGE_WORKSPACE: Readonly<Record<StageId, StageWorkspace>> = {
	"source-normalisation": { directories: [], outputFile: null },
	"audio-extraction": {
		directories: [inWorkspace("Audio")],
		outputFile: join("Audio", "audio.m4a"),
	},
	transcription: {
		directories: [inWorkspace("Transcript")],
		outputFile: join("Transcript", "transcript.txt"),
	},
	"transcript-structuring": {
		directories: [inWorkspace("Structured transcript")],
		outputFile: join("Structured transcript", "structured-transcript.md"),
	},
	"slide-conversion": {
		directories: [inWorkspace("Slide content")],
		outputFile: join("Slide content", "slides.md"),
	},
	"image-extraction": { directories: [inWorkspace("Slide images")], outputFile: null },
	synthesis: {
		directories: [inWorkspace("Synthesised notes")],
		outputFile: join("Synthesised notes", "synthesised-notes.md"),
	},
	"qa-loop": {
		directories: [inWorkspace("QA iterations"), inWorkspace("QA checked")],
		outputFile: null,
	},
	"pdf-generation": { directories: [inModule(FINAL_OUTPUT_DIR)], outputFile: null },
};

/**
 * A stage's output path relative to its workspace, as recorded in `filesWritten`
 * (technical-design.md §4.5).
 *
 * @param stageId - The stage whose output to name.
 * @returns The workspace-relative path.
 * @throws {Error} If the stage writes no single output file.
 */
export function stageOutputEntry(stageId: StageId): string {
	const { outputFile } = STAGE_WORKSPACE[stageId];
	if (outputFile === null) {
		throw new Error(`Stage "${stageId}" writes no single output file to name`);
	}
	return outputFile;
}

/**
 * One stage's work within one lecture's workspace — the pair addressed by
 * anything that reads, writes, or clears a stage's output.
 */
export type StageInWorkspace = {
	/** Absolute path to the lecture workspace. */
	readonly workspaceRoot: string;
	/** The stage whose work within it is meant. */
	readonly stageId: StageId;
};

/**
 * A stage's output as an absolute path.
 *
 * Used by a stage for its own output and for its upstream's input, so the
 * hand-off between two stages is stated once rather than at both ends.
 *
 * @param args - The workspace and the stage.
 * @param args.workspaceRoot - Absolute path to the lecture workspace.
 * @param args.stageId - The stage whose output to locate.
 * @returns The absolute path to that stage's output file.
 * @throws {Error} If the stage writes no single output file.
 */
export function stageOutputPath({ workspaceRoot, stageId }: StageInWorkspace): string {
	return join(workspaceRoot, stageOutputEntry(stageId));
}

/**
 * A directory a stage owns, as an absolute path, resolved against whichever root
 * it hangs off.
 *
 * The runner clears these on `--from-stage` and the suites assert on them, so
 * which root a directory answers to is decided here rather than at each end — a
 * directory that moved between roots would otherwise be deleted from one place
 * and looked for in another.
 *
 * @param args - The workspace and the directory to resolve.
 * @param args.workspaceRoot - Absolute path to the lecture workspace.
 * @param args.directory - The stage-owned directory, from {@link STAGE_WORKSPACE}.
 * @returns The absolute path to that directory.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- StageDirectory's fields are readonly; the rule reads the brand on `name` as a mutable object, though it marks a string
export function stageDirectoryPath({
	workspaceRoot,
	directory,
}: {
	readonly workspaceRoot: string;
	readonly directory: StageDirectory;
}): string {
	const base = directory.root === "module" ? moduleRootOf({ workspaceRoot }) : workspaceRoot;
	return join(base, directory.name);
}

/**
 * Every directory a stage owns, as absolute paths.
 *
 * @param args - The workspace and the stage.
 * @param args.workspaceRoot - Absolute path to the lecture workspace.
 * @param args.stageId - The stage whose directories to locate.
 * @returns The absolute paths, in declaration order; `[]` for a stage owning none.
 */
export function stageDirectoryPaths({
	workspaceRoot,
	stageId,
}: StageInWorkspace): readonly string[] {
	return STAGE_WORKSPACE[stageId].directories.map((directory) =>
		stageDirectoryPath({ workspaceRoot, directory }),
	);
}
