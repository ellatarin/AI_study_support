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
import { NamedError } from "../utils/errors.js";

/**
 * A stage was asked to name its single output file and has none. Raised by
 * {@link stageOutputEntry} for the four stages that write no one file: source
 * normalisation writes nothing inside a workspace, image extraction writes a set
 * of images, the QA loop writes across two directories once per iteration, and
 * PDF generation writes its one file into the module's output directory rather
 * than the workspace (technical-design.md §3.3).
 */
export class NoStageOutputFileError extends NamedError {}

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
 * The debug log one invocation of the CLI writes.
 *
 * Anchored to the project rather than to a workspace, because an invocation is
 * a wider thing than a lecture run: `batch` covers every lecture in every
 * configured module, and Stage 0's work over a module happens before any lecture
 * has been chosen, so no single workspace could hold the log of it. The project
 * root is also the one location that does not move with the directory the user
 * happened to invoke from (technical-design.md §10).
 *
 * @param args - The invocation to name a log for.
 * @param args.projectRoot - Absolute path to the directory holding the configuration.
 * @param args.runId - The invocation's timestamp identifier.
 * @returns The absolute path to write the debug log at.
 */
export function debugLogPath({
	projectRoot,
	runId,
}: {
	readonly projectRoot: string;
	readonly runId: string;
}): string {
	return join(projectRoot, RUNS_DIR, `${runId}-debug.log`);
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
 * The runner deletes inside these directories, and `pdf-generation`'s resolves
 * against the module root rather than a workspace, so a value that reached this
 * map from the manifest or an LLM response could reach across the whole module.
 * The brand makes that a compile error rather than a convention: only
 * {@link declaredName} mints the type, and it refuses a widened `string`
 * (technical-design.md §4.4, "Stage cleanup boundaries").
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
 * Where a stage's work sits, and so what a `--from-stage` re-run may remove.
 *
 * The two variants are not two ways of saying the same thing. A workspace
 * directory holds one lecture's work and nothing else, so a reset takes the
 * whole directory. The module's `Final output/` holds every lecture in the
 * module, so a reset there can only ever take the one file belonging to the
 * lecture being reset — which is why this variant names a single directory
 * deposited *into* rather than a set of directories owned. A stage cannot
 * declare that it owns a module-wide directory, so no reset can sweep one
 * (technical-design.md §3.3, §4.7).
 *
 * @typeParam TName - How a directory is spelled: declared names here, absolute paths once resolved.
 */
type OutputLocation<TName extends string> =
	| {
			readonly root: "workspace";
			/** Every directory the stage owns inside the lecture's workspace. */
			readonly directories: readonly TName[];
	  }
	| {
			readonly root: "module";
			/** The module-wide directory the stage deposits this lecture's file into. */
			readonly directory: TName;
	  };

/** Where a stage's work sits, as declared in {@link STAGE_WORKSPACE}. */
export type StageOutputLocation = OutputLocation<StageDirectoryName>;

/** The same, resolved against a lecture's workspace into absolute paths. */
export type ResolvedStageOutput = OutputLocation<string>;

/** What one stage owns on disk. */
export type StageWorkspace = {
	/**
	 * Where the stage's work sits, and what a `--from-stage` re-run clears for
	 * the nominated stage and everything downstream (technical-design.md §4.7).
	 */
	readonly outputLocation: StageOutputLocation;
	/**
	 * The single file the stage writes **within the lecture's workspace**, and so
	 * the one `filesWritten` records. `null` where there is none:
	 * `source-normalisation` writes nothing of its own, the stages producing a
	 * set rather than a document have no one path to name, and
	 * `pdf-generation`'s one file is deposited outside the workspace, where a
	 * workspace-relative path cannot reach it.
	 */
	readonly outputFile: string | null;
};

/**
 * Applies the brand, in the one place it is applied.
 *
 * Private to this module, and the only route to the type: it refuses a widened
 * `string`, so nothing read back from the manifest, an LLM response, or the
 * filesystem can name a directory the runner acts on.
 *
 * @param name - A directory name written as a literal above.
 * @returns The same string, branded as declared here.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- a string literal type, which has nothing to mutate; the rule cannot see through the unresolved LiteralName conditional
function declaredName<TName extends string>(name: TName & LiteralName<TName>): StageDirectoryName {
	// Widened first: the brand goes on the string, while the signature above is
	// what refuses a name that was a widened string to begin with.
	const declared: string = name;
	return declared as StageDirectoryName;
}

/**
 * Names the directories a stage owns inside the lecture workspace.
 *
 * @param names - The directory names, each a literal, relative to the workspace root.
 * @returns Where the stage's work sits.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- a branded string: the rule reads the phantom property in the intersection as a mutable object, though it marks a string and is itself readonly. Readonly<> does not help — it strips the value back to an object and the brand stops typechecking
function inWorkspace(names: readonly StageDirectoryName[]): StageOutputLocation {
	return { root: "workspace", directories: names };
}

/**
 * A stage that owns one workspace directory and writes one file into it, which
 * is most of them.
 *
 * The directory is named once and the output path is built from it, because the
 * two are one fact: a stage's file sits in the stage's directory. Written out at
 * both ends — as the directory owned and again as the first segment of the
 * output path — the two could change apart, and the stage would then clear one
 * directory on a re-run while recording its output in another.
 *
 * @param args - What the stage owns and what it writes.
 * @param args.directory - The workspace directory's name, as a literal.
 * @param args.file - The file's name within that directory.
 * @returns The stage's workspace.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- string literal types, which have nothing to mutate; the rule cannot see through the unresolved LiteralName conditional
function writesInto<TName extends string>(args: {
	readonly directory: TName & LiteralName<TName>;
	readonly file: string;
}): StageWorkspace {
	return {
		outputLocation: inWorkspace([declaredName<TName>(args.directory)]),
		outputFile: join(args.directory, args.file),
	};
}

/**
 * What each stage owns, in pipeline order (technical-design.md §3.3).
 *
 * `qa-loop` owns `QA checked/` — the quality-checked notes are its output, and
 * `pdf-generation` only reads them. `pdf-generation` is the one stage whose
 * output lands outside the lecture's workspace: its PDF is deposited in the
 * module's `Final output/`, alongside every other lecture's, which is why it
 * deposits into that directory rather than owning it.
 */
export const STAGE_WORKSPACE: Readonly<Record<StageId, StageWorkspace>> = {
	"source-normalisation": { outputLocation: inWorkspace([]), outputFile: null },
	"audio-extraction": writesInto({ directory: "Audio", file: "audio.m4a" }),
	transcription: writesInto({ directory: "Transcript", file: "transcript.txt" }),
	"transcript-structuring": writesInto({
		directory: "Structured transcript",
		file: "structured-transcript.md",
	}),
	"slide-conversion": writesInto({ directory: "Slide content", file: "slides.md" }),
	"image-extraction": {
		outputLocation: inWorkspace([declaredName("Slide images")]),
		outputFile: null,
	},
	synthesis: writesInto({ directory: "Synthesised notes", file: "synthesised-notes.md" }),
	"qa-loop": {
		outputLocation: inWorkspace([declaredName("QA iterations"), declaredName("QA checked")]),
		outputFile: null,
	},
	"pdf-generation": {
		outputLocation: { root: "module", directory: declaredName(FINAL_OUTPUT_DIR) },
		outputFile: null,
	},
};

/**
 * A stage's output path relative to its workspace, as recorded in `filesWritten`
 * (technical-design.md §4.5).
 *
 * @param stageId - The stage whose output to name.
 * @returns The workspace-relative path.
 * @throws {NoStageOutputFileError} If the stage writes no single output file.
 */
export function stageOutputEntry(stageId: StageId): string {
	const { outputFile } = STAGE_WORKSPACE[stageId];
	if (outputFile === null) {
		throw new NoStageOutputFileError(`Stage "${stageId}" writes no single output file to name`);
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
 * @throws {NoStageOutputFileError} If the stage writes no single output file.
 */
export function stageOutputPath({ workspaceRoot, stageId }: StageInWorkspace): string {
	return join(workspaceRoot, stageOutputEntry(stageId));
}

/**
 * Where a stage's work sits for one lecture, as absolute paths.
 *
 * Which root a directory answers to is decided here rather than at each end — a
 * directory that moved between roots would otherwise be written in one place and
 * looked for in another. The variant comes through with the paths because it is
 * what tells a caller clearing the stage whether it may take the directory: only
 * the workspace variant holds this lecture's work and nothing else
 * (technical-design.md §4.7).
 *
 * @param args - The workspace and the stage.
 * @param args.workspaceRoot - Absolute path to the lecture workspace.
 * @param args.stageId - The stage whose work to locate.
 * @returns The stage's workspace directories, or the module directory it deposits into.
 */
export function resolveStageOutput({
	workspaceRoot,
	stageId,
}: StageInWorkspace): ResolvedStageOutput {
	const location = STAGE_WORKSPACE[stageId].outputLocation;
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
 * Every directory a stage works in, as absolute paths.
 *
 * This is what the stage factory creates and clears of leftovers before a run
 * (technical-design.md §4.3). It is deliberately not what a reset deletes: the
 * module directory `pdf-generation` deposits into appears here, because the
 * directory must exist before pandoc writes into it, and a reset that took this
 * list at face value would remove every lecture's PDF. A reset asks
 * {@link resolveStageOutput} instead.
 *
 * @param args - The workspace and the stage.
 * @param args.workspaceRoot - Absolute path to the lecture workspace.
 * @param args.stageId - The stage whose directories to locate.
 * @returns The absolute paths, in declaration order; `[]` for a stage working in none.
 */
export function stageDirectoryPaths({
	workspaceRoot,
	stageId,
}: StageInWorkspace): readonly string[] {
	const output = resolveStageOutput({ workspaceRoot, stageId });
	return output.root === "module" ? [output.directory] : output.directories;
}
