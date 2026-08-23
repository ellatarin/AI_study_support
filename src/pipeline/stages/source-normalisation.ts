import { rename, rm } from "node:fs/promises";
import { extname, join } from "node:path";
import type { Logger } from "pino";
import type { RunManifest, SourceNormalisationStage } from "../../types/pipeline.js";
import { STAGE_IDS } from "../../types/pipeline.js";
import { extractDate, formatDateISO } from "../../utils/date.js";
import { NamedError } from "../../utils/errors.js";
import {
	listFileNames,
	listSubdirectoryNames,
	pathExists,
	readDirSafe,
} from "../../utils/files.js";
import { extractProvisionalTitle, lectureBaseName } from "../../utils/naming.js";
import { type ModuleDirs, moduleDirs } from "../layout.js";
import { MANIFEST_VERSION, readManifest, readManifestSafe, writeManifest } from "../manifest.js";

// prefer-readonly-parameter-types is disabled file-wide: this stage's helpers take
// a pino Logger and a Date (library/built-in types carrying methods) and the
// RunManifest (a large intersection type the rule cannot verify as deeply
// readonly). None of them mutate their arguments; CLAUDE.md permits dropping
// readonly for such types.
/* eslint-disable @typescript-eslint/prefer-readonly-parameter-types */

/**
 * Thrown when a module's raw sources cannot be normalised: an undateable video or
 * slide, a video or slide with no 1:1 date match, or a duplicate video or slide
 * date. Carries every problem found so the CLI can list them; Stage 0 makes no
 * filesystem changes when it throws (technical-design.md §5, Stage 0).
 */
export class SourceNormalisationError extends NamedError {}

/**
 * Asks the user to approve an irreversible action, returning their answer. The
 * CLI backs this with `@inquirer/prompts`; tests stub it. Injected rather than
 * imported so Stage 0 never reaches for stdin itself (technical-design.md §5,
 * Stage 0).
 */
export type ConfirmPrompt = (args: { readonly message: string }) => Promise<boolean>;

const TEMP_SUFFIX = ".stage0-tmp";

/** A source file identified only by its name and extracted `YYYY-MM-DD` date. */
type SourceRef = { readonly name: string; readonly iso: string };

/** A source file that also carries its parsed `Date` (for local-safe formatting). */
type DatedFile = SourceRef & { readonly date: Date };

/** The dated files in one source directory, split from those with no date. */
type DatedListing = {
	readonly dated: readonly DatedFile[];
	readonly undateable: readonly string[];
};

/** A fully-resolved lecture: its number, date, title, and current source names. */
type Lecture = {
	readonly lectureNumber: number;
	readonly iso: string;
	readonly provisionalTitle: string;
	readonly baseName: string;
	readonly videoName: string;
	readonly slideName: string;
};

/** A single planned rename within one directory. */
type RenameOp = { readonly dir: string; readonly source: string; readonly target: string };

/** An existing lecture workspace, discovered by its manifest's date. */
type ExistingWorkspace = { readonly folder: string; readonly manifest: RunManifest };

/**
 * Splits file names into those with a confidently extractable date and those
 * without.
 *
 * @param names - The source file names to classify.
 * @returns The dated files (with parsed date and ISO string) and the undateable names.
 */
function toDatedFiles(names: readonly string[]): DatedListing {
	const dated: DatedFile[] = [];
	const undateable: string[] = [];
	for (const name of names) {
		const date = extractDate(name);
		if (date === null) {
			undateable.push(name);
			continue;
		}
		dated.push({ name, iso: formatDateISO(date), date });
	}
	return { dated, undateable };
}

/**
 * Finds the ISO dates that appear on more than one file.
 *
 * @param files - The dated files to inspect.
 * @returns The ISO dates shared by two or more files.
 */
function duplicateIsos(files: readonly SourceRef[]): readonly string[] {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const file of files) {
		if (seen.has(file.iso)) {
			duplicates.add(file.iso);
		} else {
			seen.add(file.iso);
		}
	}
	return [...duplicates];
}

/**
 * Collects every source anomaly that must stop the run: undateable files,
 * duplicate dates within videos or slides, and any video/slide without a 1:1
 * date match.
 *
 * @param args - The dated video and slide listings.
 * @param args.videos - The classified video files.
 * @param args.slides - The classified slide files.
 * @returns A human-readable description of every anomaly found (empty when valid).
 */
/**
 * The dates a listing's dateable files carry, for asking what the other side
 * matched.
 *
 * @param listing - One source directory's classified files.
 * @returns The `YYYY-MM-DD` dates present in it.
 */
function datedIsos(listing: DatedListing): ReadonlySet<string> {
	return new Set(listing.dated.map((file) => file.iso));
}

function collectAnomalies({
	videos,
	slides,
}: {
	readonly videos: DatedListing;
	readonly slides: DatedListing;
}): readonly string[] {
	// Each rule holds of both kinds of source, and the report keeps the rules in
	// order rather than the kinds, so the reader meets every undateable file
	// before the first missing match.
	const sides = [
		{ kind: "video", counterpart: "slide", listing: videos, matched: datedIsos(slides) },
		{ kind: "slide", counterpart: "video", listing: slides, matched: datedIsos(videos) },
	] as const;

	const anomalies: string[] = [];
	for (const { kind, listing } of sides) {
		for (const name of listing.undateable) {
			anomalies.push(`${kind} "${name}" has no extractable date`);
		}
	}
	for (const { kind, listing } of sides) {
		for (const iso of duplicateIsos(listing.dated)) {
			anomalies.push(`two or more ${kind}s share the date ${iso}`);
		}
	}
	for (const { kind, counterpart, listing, matched } of sides) {
		for (const file of listing.dated) {
			if (!matched.has(file.iso)) {
				anomalies.push(`${kind} "${file.name}" has no matching ${counterpart} (date ${file.iso})`);
			}
		}
	}
	return anomalies;
}

/**
 * Aborts the run before anything is applied: logs every problem found at `error`
 * and throws, having made no filesystem change (technical-design.md §5, Stage 0).
 *
 * @param args - The abort context.
 * @param args.logger - The run logger.
 * @param args.moduleRoot - The module being normalised.
 * @param args.anomalies - Every problem found, one human-readable line each.
 * @param args.reason - The class of problem, for the log message.
 * @throws {@link SourceNormalisationError} always — this function never returns.
 */
function abortNormalisation({
	logger,
	moduleRoot,
	anomalies,
	reason,
}: {
	readonly logger: Logger;
	readonly moduleRoot: string;
	readonly anomalies: readonly string[];
	readonly reason: string;
}): never {
	logger.error({ moduleRoot, anomalies }, `Source normalisation aborted: ${reason}`);
	throw new SourceNormalisationError(
		`Source normalisation failed for ${moduleRoot}:\n- ${anomalies.join("\n- ")}`,
	);
}

/** A temporary entry left by an interrupted run, and the name it was moving to. */
type PendingRename = { readonly dir: string; readonly temp: string; readonly target: string };

/**
 * Finds every temporary entry an interrupted run left across the module's four
 * directories, of whatever kind — a source file, a workspace folder, or a
 * `Final output/` PDF all pass through the same temporary name.
 *
 * @param dirs - The module's directories.
 * @returns The temporary entries found, each paired with the name it was moving to.
 */
async function findPendingRenames(dirs: ModuleDirs): Promise<readonly PendingRename[]> {
	const pending: PendingRename[] = [];
	for (const dir of Object.values(dirs)) {
		for (const entry of await readDirSafe(dir)) {
			if (entry.name.endsWith(TEMP_SUFFIX)) {
				pending.push({
					dir,
					temp: entry.name,
					target: entry.name.slice(0, -TEMP_SUFFIX.length),
				});
			}
		}
	}
	return pending;
}

/**
 * Finishes the second phase of a rename an earlier run was interrupted partway
 * through, before anything is read.
 *
 * A temporary entry holds a *complete* item that has left its old name and not
 * yet reached its new one — the sole copy of a source video, or a whole lecture
 * workspace — so the run that finds one moves it on to its target rather than
 * treating it as the discardable partial output §4.3 sweeps up. Left in place it
 * is read as a second video on its lecture's date, which validation then refuses
 * as a duplicate for as long as it sits there.
 *
 * A target name that is already taken cannot be resolved this way, so the run
 * aborts and names the entries, leaving every one of them where it is.
 *
 * @param args - The module and its directories.
 * @param args.dirs - The module's directories.
 * @param args.moduleRoot - The module being normalised.
 * @param args.logger - The run logger.
 * @returns A promise that resolves once every interrupted rename is complete.
 * @throws {@link SourceNormalisationError} when a temporary entry's target name is taken.
 */
async function completeInterruptedRenames({
	dirs,
	moduleRoot,
	logger,
}: {
	readonly dirs: ModuleDirs;
	readonly moduleRoot: string;
	readonly logger: Logger;
}): Promise<void> {
	const pending = await findPendingRenames(dirs);
	const blocked: string[] = [];
	for (const operation of pending) {
		if (await pathExists(join(operation.dir, operation.target))) {
			blocked.push(
				`"${operation.temp}" was left by an interrupted run and "${operation.target}" is already taken`,
			);
		}
	}
	if (blocked.length > 0) {
		abortNormalisation({
			logger,
			moduleRoot,
			anomalies: blocked,
			reason: "interrupted renames cannot be completed",
		});
	}
	for (const operation of pending) {
		await rename(join(operation.dir, operation.temp), join(operation.dir, operation.target));
		logger.info(
			{ source: operation.temp, target: operation.target },
			"Completed interrupted rename",
		);
	}
}

/**
 * Orders dated videos by date, assigns sequential lecture numbers, and resolves
 * each lecture's title, base name, and matched slide. A new lecture's title is
 * freshly extracted from its raw filename; an existing lecture's title is taken
 * from its manifest, so a re-run neither re-parses an already-canonical filename
 * (which would corrupt the title) nor reverts a Stage 3 AI-derived rename.
 *
 * @param args - The valid, dated videos and slides, and existing workspaces.
 * @param args.videos - The dated video files (unique dates guaranteed by validation).
 * @param args.slides - The dated slide files, matched to videos by date.
 * @param args.existing - Existing workspaces keyed by date, for title continuity.
 * @returns The lectures in date order, numbered from 1.
 */
function orderLectures({
	videos,
	slides,
	existing,
}: {
	videos: readonly DatedFile[];
	readonly slides: readonly SourceRef[];
	readonly existing: ReadonlyMap<string, ExistingWorkspace>;
}): readonly Lecture[] {
	const videoByIso = new Map(videos.map((video) => [video.iso, video] as const));
	const slideByIso = new Map(slides.map((slide) => [slide.iso, slide.name] as const));
	const orderedIsos = [...videoByIso.keys()].sort();
	return Array.from(orderedIsos.entries(), ([index, iso]) => {
		const video = videoByIso.get(iso) as DatedFile;
		const priorManifest = existing.get(iso)?.manifest;
		const provisionalTitle = priorManifest?.provisionalTitle ?? extractProvisionalTitle(video.name);
		const title = priorManifest?.lectureTitle ?? provisionalTitle;
		const lectureNumber = index + 1;
		return {
			lectureNumber,
			iso,
			provisionalTitle,
			baseName: lectureBaseName({ lectureNumber, title, date: video.date }),
			videoName: video.name,
			slideName: slideByIso.get(iso) as string,
		};
	});
}

/**
 * Maps each existing lecture workspace to its folder name by reading its
 * manifest's `lectureDate`, so a renumbered lecture can be found by date.
 *
 * @param processingDirPath - Absolute path to the module's `Pipeline processing/`.
 * @returns A map of `lectureDate` → existing workspace (folder name and manifest).
 */
async function discoverWorkspaces(
	processingDirPath: string,
): Promise<ReadonlyMap<string, ExistingWorkspace>> {
	const workspaces = new Map<string, ExistingWorkspace>();
	for (const folder of await listSubdirectoryNames(processingDirPath)) {
		const manifest = await readManifestSafe({
			workspaceRoot: join(processingDirPath, folder),
		});
		if (manifest === null) {
			continue;
		}
		workspaces.set(manifest.lectureDate, { folder, manifest });
	}
	return workspaces;
}

/**
 * Maps each existing `Final output/` PDF to its date, so a renumbered lecture's
 * PDF can be renamed.
 *
 * @param finalOutputDirPath - Absolute path to the module's `Final output/`.
 * @returns A map of `lectureDate` → current PDF file name.
 */
async function discoverFinalOutput(
	finalOutputDirPath: string,
): Promise<ReadonlyMap<string, string>> {
	const pdfs = new Map<string, string>();
	for (const name of await listFileNames(finalOutputDirPath)) {
		const date = extractDate(name);
		if (date !== null) {
			pdfs.set(formatDateISO(date), name);
		}
	}
	return pdfs;
}

/**
 * One item's rename, or `null` when there is nothing to do: the item is absent,
 * or it already sits at the name the numbering wants.
 *
 * The four things a lecture is spread across each ask this same question, and a
 * fifth would too, so it is asked in one place — the absent case and the
 * already-there case being the same answer is what each of the four was
 * spelling out for itself.
 *
 * @param args - The item and where it should end up.
 * @param args.dir - The directory the item sits in.
 * @param args.source - Its current name, or `undefined` when there is no such item.
 * @param args.target - The name the target numbering gives it.
 * @returns The rename to apply, or `null` when none is needed.
 */
function renameIfMoved({
	dir,
	source,
	target,
}: {
	readonly dir: string;
	readonly source: string | undefined;
	readonly target: string;
}): RenameOp | null {
	if (source === undefined || source === target) {
		return null;
	}
	return { dir, source, target };
}

/**
 * Plans every rename needed to bring the module to its target numbering: source
 * video, matched slide, existing workspace folder, and existing `Final output/`
 * PDF. Items already at their target are omitted (so a re-run is a no-op).
 *
 * @param args - The lectures and the directories and existing state to reconcile.
 * @param args.lectures - The target lectures.
 * @param args.dirs - The source, workspace, and output directory paths.
 * @param args.dirs.video - Absolute path to the video source directory.
 * @param args.dirs.slide - Absolute path to the slide source directory.
 * @param args.dirs.processing - Absolute path to `Pipeline processing/`.
 * @param args.dirs.finalOutput - Absolute path to `Final output/`.
 * @param args.existingWorkspaces - Existing workspace folders keyed by date.
 * @param args.existingPdfs - Existing `Final output/` PDFs keyed by date.
 * @returns The rename operations to apply, collision-safely.
 */
function planRenames({
	lectures,
	dirs,
	existingWorkspaces,
	existingPdfs,
}: {
	readonly lectures: readonly Lecture[];
	readonly dirs: ModuleDirs;
	readonly existingWorkspaces: ReadonlyMap<string, ExistingWorkspace>;
	readonly existingPdfs: ReadonlyMap<string, string>;
}): readonly RenameOp[] {
	return lectures.flatMap((lecture) =>
		[
			renameIfMoved({
				dir: dirs.video,
				source: lecture.videoName,
				target: `${lecture.baseName}${extname(lecture.videoName)}`,
			}),
			renameIfMoved({
				dir: dirs.slide,
				source: lecture.slideName,
				target: `${lecture.baseName}${extname(lecture.slideName)}`,
			}),
			renameIfMoved({
				dir: dirs.processing,
				source: existingWorkspaces.get(lecture.iso)?.folder,
				target: lecture.baseName,
			}),
			renameIfMoved({
				dir: dirs.finalOutput,
				source: existingPdfs.get(lecture.iso),
				target: `${lecture.baseName}.pdf`,
			}),
		].filter((operation) => operation !== null),
	);
}

/**
 * Where an item waits between the two phases of a rename: at its target name,
 * under the temporary suffix. Written once because the two phases address it
 * from opposite ends — one renames onto it, the next renames off it — and a
 * crash between them leaves it there for the sweep at the start of the next run
 * to find.
 *
 * @param operation - The rename being applied.
 * @returns The absolute path the item is staged at.
 */
function stagingPath(operation: RenameOp): string {
	return join(operation.dir, `${operation.target}${TEMP_SUFFIX}`);
}

/**
 * Applies renames in two phases — every source to a temp name, then every temp
 * to its target — so shifting lecture numbers never collide mid-rename.
 *
 * @param renames - The rename operations to apply.
 * @returns A promise that resolves once every rename is complete.
 */
async function executeRenames(renames: readonly RenameOp[]): Promise<void> {
	for (const operation of renames) {
		await rename(join(operation.dir, operation.source), stagingPath(operation));
	}
	for (const operation of renames) {
		await rename(stagingPath(operation), join(operation.dir, operation.target));
	}
}

/**
 * The workspaces whose lecture date no longer has a source pair present. Their
 * sources were deleted directly rather than through the CLI, so Stage 0 must ask
 * before discarding the work (technical-design.md §5, Stage 0).
 *
 * @param args - The discovered workspaces and the dates still backed by sources.
 * @param args.workspaces - Existing workspaces keyed by lecture date.
 * @param args.presentIsos - The ISO dates that still have a video and slide.
 * @returns The orphaned workspaces, in date order.
 */
function findOrphans({
	workspaces,
	presentIsos,
}: {
	readonly workspaces: ReadonlyMap<string, ExistingWorkspace>;
	readonly presentIsos: ReadonlySet<string>;
}): readonly ExistingWorkspace[] {
	return [...workspaces.keys()]
		.filter((iso) => !presentIsos.has(iso))
		.sort()
		.map((iso) => workspaces.get(iso) as ExistingWorkspace);
}

/**
 * The per-orphan prompt: which lecture it is, so the user can judge the deletion
 * rather than answer blind.
 *
 * It quotes no figure. What a lecture has cost is the sum of its stages, and
 * stage costs are summed nowhere (NFR-2.2); `cost-report` still has the
 * per-stage figures for as long as the workspace stands.
 *
 * @param args - The lecture being asked about.
 * @param args.manifest - The orphaned lecture's manifest.
 * @returns The question put to the user.
 */
function orphanPrompt({ manifest }: { readonly manifest: RunManifest }): string {
	const title = manifest.lectureTitle === "" ? "(untitled)" : manifest.lectureTitle;
	return `Lecture ${manifest.lectureNumber} "${title}" (${manifest.lectureDate}) has no source video or slide left. Delete its workspace and any final output?`;
}

/**
 * Aborts orphan handling: logs why at `error` and throws, having made no
 * filesystem change. Declining any prompt lands here, so a whole source folder
 * moved by mistake costs nothing.
 *
 * @param args - The abort context.
 * @param args.logger - The run logger.
 * @param args.moduleRoot - The module being normalised.
 * @param args.reason - What the user declined.
 * @throws {@link SourceNormalisationError} always — this function never returns.
 */
function abortOrphanHandling({
	logger,
	moduleRoot,
	reason,
}: {
	readonly logger: Logger;
	readonly moduleRoot: string;
	readonly reason: string;
}): never {
	logger.error({ moduleRoot, reason }, "Source normalisation aborted: deletion declined");
	throw new SourceNormalisationError(
		`Source normalisation aborted for ${moduleRoot}: ${reason}. No changes were made. ` +
			"Remove a lecture with the CLI `delete` command; if its sources were moved by mistake, " +
			"restore them and re-run.",
	);
}

/** Where an orphan's files live and where its removal is recorded. */
type OrphanContext = {
	readonly dirs: { readonly processing: string; readonly finalOutput: string };
	readonly existingPdfs: ReadonlyMap<string, string>;
	readonly logger: Logger;
};

/**
 * Deletes one approved orphan — its workspace folder (manifest included) and its
 * `Final output/` PDF — and records the prior state the deletion destroyed.
 *
 * @param args - The orphan and where its files live.
 * @param args.orphan - The orphaned workspace to delete.
 * @param args.dirs - The processing and final-output directory paths.
 * @param args.dirs.processing - Absolute path to `Pipeline processing/`.
 * @param args.dirs.finalOutput - Absolute path to `Final output/`.
 * @param args.existingPdfs - Existing `Final output/` PDFs keyed by date.
 * @param args.logger - The run logger.
 * @returns A promise that resolves once the workspace and PDF are gone.
 */
async function deleteOrphan({
	orphan,
	dirs,
	existingPdfs,
	logger,
}: { readonly orphan: ExistingWorkspace } & OrphanContext): Promise<void> {
	const { manifest } = orphan;
	await rm(join(dirs.processing, orphan.folder), { recursive: true, force: true });
	const pdf = existingPdfs.get(manifest.lectureDate);
	if (pdf !== undefined) {
		await rm(join(dirs.finalOutput, pdf), { force: true });
	}
	logger.info(
		{
			folder: orphan.folder,
			lectureNumber: manifest.lectureNumber,
			lectureTitle: manifest.lectureTitle,
			lectureDate: manifest.lectureDate,
		},
		"Deleted orphaned lecture workspace",
	);
}

/**
 * Runs the direct-deletion guard: asks about each orphan in turn, then asks once
 * more before acting. Every orphan must be approved and the final confirmation
 * given, or nothing is deleted at all — a partial "delete some, keep others"
 * outcome is never produced, since a missing batch of sources usually means one
 * mistake rather than several deliberate deletions.
 *
 * @param args - The orphans, their locations, and the injected dependencies.
 * @param args.orphans - The orphaned workspaces (non-empty).
 * @param args.moduleRoot - The module being normalised.
 * @param args.dirs - The processing and final-output directory paths.
 * @param args.dirs.processing - Absolute path to `Pipeline processing/`.
 * @param args.dirs.finalOutput - Absolute path to `Final output/`.
 * @param args.existingPdfs - Existing `Final output/` PDFs keyed by date.
 * @param args.logger - The run logger.
 * @param args.confirm - The user prompt.
 * @returns A promise that resolves once every orphan has been deleted.
 * @throws {@link SourceNormalisationError} when any prompt is declined.
 */
async function resolveOrphans({
	orphans,
	moduleRoot,
	dirs,
	existingPdfs,
	logger,
	confirm,
}: {
	readonly orphans: readonly ExistingWorkspace[];
	readonly moduleRoot: string;
	readonly confirm: ConfirmPrompt;
} & OrphanContext): Promise<void> {
	logger.info(
		{ moduleRoot, orphans: orphans.map((orphan) => orphan.folder) },
		"Lecture workspaces have no source files left",
	);

	for (const orphan of orphans) {
		if (!(await confirm({ message: orphanPrompt({ manifest: orphan.manifest }) }))) {
			abortOrphanHandling({
				logger,
				moduleRoot,
				reason: `deleting lecture ${orphan.manifest.lectureDate} was declined`,
			});
		}
	}

	const finalMessage = `Permanently delete ${orphans.length} lecture workspace(s) and their final output? This cannot be undone.`;
	if (!(await confirm({ message: finalMessage }))) {
		abortOrphanHandling({ logger, moduleRoot, reason: "the final confirmation was declined" });
	}

	for (const orphan of orphans) {
		await deleteOrphan({ orphan, dirs, existingPdfs, logger });
	}
}

/**
 * Builds the initial manifest for a brand-new lecture: identity from Stage 0,
 * `lectureTitle` seeded to the provisional, `userTitle` and `aiDerivedTitle`
 * null, every stage pending, and zeroed cost.
 *
 * @param lecture - The resolved lecture.
 * @returns The initial `RunManifest`.
 */
function initialManifest(lecture: Lecture): RunManifest {
	const now = new Date().toISOString();
	const stages = Object.fromEntries(
		STAGE_IDS.map((stageId) => [stageId, { status: "pending" }]),
	) as RunManifest["stages"];
	return {
		version: MANIFEST_VERSION,
		lectureNumber: lecture.lectureNumber,
		lectureDate: lecture.iso,
		provisionalTitle: lecture.provisionalTitle,
		lectureTitle: lecture.provisionalTitle,
		userTitle: null,
		aiDerivedTitle: null,
		workspaceFolderName: lecture.baseName,
		createdAt: now,
		updatedAt: now,
		stages,
	};
}

/**
 * Creates a new lecture's workspace and manifest, or updates an existing
 * lecture's `lectureNumber`/`workspaceFolderName` after renumbering. Leaves an
 * unchanged lecture's manifest untouched.
 *
 * @param args - The lecture, the processing directory, and whether it pre-existed.
 * @param args.lecture - The resolved lecture.
 * @param args.processingDirPath - Absolute path to `Pipeline processing/`.
 * @param args.isExisting - Whether a workspace already existed for this date.
 * @returns What happened to the manifest: created, updated, or unchanged.
 */
async function reconcileManifest({
	lecture,
	processingDirPath,
	isExisting,
}: {
	readonly lecture: Lecture;
	readonly processingDirPath: string;
	readonly isExisting: boolean;
}): Promise<"created" | "updated" | "unchanged"> {
	const workspaceRoot = join(processingDirPath, lecture.baseName);
	if (!isExisting) {
		await writeManifest({ workspaceRoot, manifest: initialManifest(lecture) });
		return "created";
	}
	const manifest = await readManifest({ workspaceRoot });
	if (
		manifest.lectureNumber === lecture.lectureNumber &&
		manifest.workspaceFolderName === lecture.baseName
	) {
		return "unchanged";
	}
	const updated: RunManifest = {
		...manifest,
		lectureNumber: lecture.lectureNumber,
		workspaceFolderName: lecture.baseName,
		updatedAt: new Date().toISOString(),
	};
	await writeManifest({ workspaceRoot, manifest: updated });
	return "updated";
}

/**
 * Builds Stage 0, the per-module source-normalisation stage. The returned stage
 * validates a module's raw sources and, when valid, renames them and creates or
 * renumbers lecture workspaces; when invalid it logs every problem and throws
 * without touching the filesystem (technical-design.md §5, Stage 0).
 *
 * @param args - The stage dependencies.
 * @param args.logger - The pino logger that records every action and any failure.
 * @param args.confirm - The prompt asked before any irreversible deletion.
 * @returns A {@link SourceNormalisationStage} the runner drives once per module.
 */
export function createSourceNormalisationStage({
	logger,
	confirm,
}: {
	readonly logger: Logger;
	readonly confirm: ConfirmPrompt;
}): SourceNormalisationStage {
	async function normaliseModule({ moduleRoot }: { readonly moduleRoot: string }): Promise<void> {
		const dirs = moduleDirs({ moduleRoot });
		await completeInterruptedRenames({ dirs, moduleRoot, logger });

		const videos = toDatedFiles(await listFileNames(dirs.video));
		const slides = toDatedFiles(await listFileNames(dirs.slide));
		logger.info(
			{ moduleRoot, videos: videos.dated.length, slides: slides.dated.length },
			"Normalising module sources",
		);

		const anomalies = collectAnomalies({ videos, slides });
		if (anomalies.length > 0) {
			abortNormalisation({ logger, moduleRoot, anomalies, reason: "source anomalies" });
		}

		const existingWorkspaces = await discoverWorkspaces(dirs.processing);
		const existingPdfs = await discoverFinalOutput(dirs.finalOutput);

		const orphans = findOrphans({
			workspaces: existingWorkspaces,
			presentIsos: new Set(videos.dated.map((video) => video.iso)),
		});
		if (orphans.length > 0) {
			await resolveOrphans({ orphans, moduleRoot, dirs, existingPdfs, logger, confirm });
		}

		const lectures = orderLectures({
			videos: videos.dated,
			slides: slides.dated,
			existing: existingWorkspaces,
		});
		// One line per lecture, before anything is renamed: the date read off the
		// filename, the number that date earned it, and the slide it was matched
		// with. Between them they are the whole answer to "why is this Lecture 3?",
		// which is otherwise reconstructable only by re-deriving the ordering by hand
		// (technical-design.md §10).
		for (const lecture of lectures) {
			logger.debug(
				{
					lectureNumber: lecture.lectureNumber,
					lectureDate: lecture.iso,
					videoName: lecture.videoName,
					slideName: lecture.slideName,
					provisionalTitle: lecture.provisionalTitle,
				},
				"Resolved lecture",
			);
		}

		const renames = planRenames({ lectures, dirs, existingWorkspaces, existingPdfs });
		await executeRenames(renames);
		for (const operation of renames) {
			logger.info({ source: operation.source, target: operation.target }, "Renamed source file");
		}

		for (const lecture of lectures) {
			const action = await reconcileManifest({
				lecture,
				processingDirPath: dirs.processing,
				isExisting: existingWorkspaces.has(lecture.iso),
			});
			if (action !== "unchanged") {
				logger.info(
					{ folder: lecture.baseName, lectureNumber: lecture.lectureNumber, action },
					"Reconciled lecture workspace",
				);
			}
		}
	}

	return { stageId: "source-normalisation", normaliseModule };
}
