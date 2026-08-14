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

import { join } from "node:path";
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

/** What one stage owns inside a lecture workspace. */
export type StageWorkspace = {
	/**
	 * The directories the stage owns, relative to the workspace root. A
	 * `--from-stage` re-run deletes exactly these for the nominated stage and
	 * everything downstream (technical-design.md §4.7).
	 */
	readonly directories: readonly string[];
	/**
	 * The single file the stage writes, relative to the workspace root. `null`
	 * where there is no such file: `source-normalisation` owns no workspace
	 * directory at all, and the stages producing a set rather than a document
	 * have no one path to name.
	 */
	readonly outputFile: string | null;
};

/**
 * What each stage owns inside the workspace, in pipeline order
 * (technical-design.md §3.3).
 *
 * `pdf-generation` owns `Output/` for reset purposes while depositing its PDF at
 * module level, which the stage cleans itself rather than through this map.
 */
export const STAGE_WORKSPACE: Readonly<Record<StageId, StageWorkspace>> = {
	"source-normalisation": { directories: [], outputFile: null },
	"audio-extraction": { directories: ["Audio"], outputFile: join("Audio", "audio.m4a") },
	transcription: { directories: ["Transcript"], outputFile: join("Transcript", "transcript.txt") },
	"transcript-structuring": {
		directories: ["Structured transcript"],
		outputFile: join("Structured transcript", "structured-transcript.md"),
	},
	"slide-conversion": {
		directories: ["Slide content"],
		outputFile: join("Slide content", "slides.md"),
	},
	"image-extraction": { directories: ["Slide images"], outputFile: null },
	synthesis: {
		directories: ["Synthesised notes"],
		outputFile: join("Synthesised notes", "synthesised-notes.md"),
	},
	"qa-loop": { directories: ["QA iterations"], outputFile: null },
	"pdf-generation": { directories: ["Output"], outputFile: null },
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
