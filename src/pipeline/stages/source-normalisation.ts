/**
 * Stage 0 — normalising a module's raw sources.
 *
 * The stage the runner drives once per module, before any lecture is processed.
 * It finishes any rename an earlier run was interrupted partway through, checks
 * every source rule that must stop the run, asks before discarding a lecture
 * whose sources have gone, numbers the lectures by date, renames everything onto
 * those numbers, and creates or updates each lecture's manifest.
 *
 * The rules themselves live beside it: what counts as a readable date and which
 * lecture is Lecture 1 in `lecture-resolution.ts`, the two-pass rename engine in
 * `source-renames.ts`, and the deletion-confirmation protocol in
 * `orphaned-workspaces.ts`. What is left here is the order those things happen
 * in, and what aborting means.
 *
 * See technical-design.md §5, Stage 0.
 */

import type { Logger } from "pino";
import type { RunManifest, SourceNormalisationStage } from "../../types/pipeline.js";
import { extractDate, formatDateISO } from "../../utils/date.js";
import { NamedError } from "../../utils/errors.js";
import { listFileNames } from "../../utils/files.js";
import { moduleDirs, workspaceRootFor } from "../layout.js";
import { MANIFEST_VERSION, pendingStages, readManifest, writeManifest } from "../manifest.js";
import { checkSources, type Lecture, orderLectures, toDatedFiles } from "./lecture-resolution.js";
import {
	type ConfirmPrompt,
	discoverWorkspaces,
	type ExistingWorkspace,
	findOrphans,
	resolveOrphans,
} from "./orphaned-workspaces.js";
import { applyRenames, completeInterruptedRenames, planRenames } from "./source-renames.js";

/**
 * Thrown when a module's raw sources cannot be normalised: an undateable video or
 * slide, a video or slide with no 1:1 date match, or a duplicate video or slide
 * date. Carries every problem found so the CLI can list them; Stage 0 makes no
 * filesystem changes when it throws (technical-design.md §5, Stage 0).
 */
export class SourceNormalisationError extends NamedError {}

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
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger carries mutable properties the rule cannot see past; it is only logged to here (CLAUDE.md permits dropping readonly where a library requires a mutable type)
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
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger carries mutable properties the rule cannot see past; it is only logged to here (CLAUDE.md permits dropping readonly where a library requires a mutable type)
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
 * Narrows discovered workspaces to the one field each consumer needs, so neither
 * the numbering nor the renames is handed a whole workspace to pick over.
 *
 * @param args - The workspaces and which of their parts is wanted.
 * @param args.workspaces - Existing workspaces keyed by lecture date.
 * @param args.take - What to keep from each one.
 * @returns The same keys, mapped to what `take` selected.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- a ReadonlyMap is already the readonly form the rule declines to recognise; it is only read here
function projectWorkspaces<TValue>({
	workspaces,
	take,
}: {
	readonly workspaces: ReadonlyMap<string, ExistingWorkspace>;
	readonly take: (workspace: ExistingWorkspace) => TValue;
}): ReadonlyMap<string, TValue> {
	return new Map([...workspaces].map(([iso, workspace]) => [iso, take(workspace)]));
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
	const stages = pendingStages();
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
 * @param args - The lecture, the module it belongs to, and whether it pre-existed.
 * @param args.lecture - The resolved lecture.
 * @param args.moduleRoot - Absolute path to the module directory.
 * @param args.isExisting - Whether a workspace already existed for this date.
 * @returns What happened to the manifest: created, updated, or unchanged.
 */
async function reconcileManifest({
	lecture,
	moduleRoot,
	isExisting,
}: {
	readonly lecture: Lecture;
	readonly moduleRoot: string;
	readonly isExisting: boolean;
}): Promise<"created" | "updated" | "unchanged"> {
	const workspaceRoot = workspaceRootFor({ moduleRoot, folderName: lecture.baseName });
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
 * @param args.modulePrefixes - The configured module prefixes, stripped from a filename before it becomes a title.
 * @returns A {@link SourceNormalisationStage} the runner drives once per module.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger carries mutable properties the rule cannot see past; it is only read from here (CLAUDE.md permits dropping readonly where a library requires a mutable type)
export function createSourceNormalisationStage({
	logger,
	confirm,
	modulePrefixes,
}: {
	readonly logger: Logger;
	readonly confirm: ConfirmPrompt;
	readonly modulePrefixes: readonly string[];
}): SourceNormalisationStage {
	async function normaliseModule({ moduleRoot }: { readonly moduleRoot: string }): Promise<void> {
		const dirs = moduleDirs({ moduleRoot });
		const blocked = await completeInterruptedRenames({ dirs, logger });
		if (blocked.length > 0) {
			abortNormalisation({
				logger,
				moduleRoot,
				anomalies: blocked,
				reason: "interrupted renames cannot be completed",
			});
		}

		const videos = toDatedFiles(await listFileNames(dirs.video));
		const slides = toDatedFiles(await listFileNames(dirs.slide));
		logger.info(
			{ moduleRoot, videos: videos.dated.length, slides: slides.dated.length },
			"Normalising module sources",
		);

		const checked = checkSources({ videos, slides });
		if (checked.state === "anomalies") {
			abortNormalisation({
				logger,
				moduleRoot,
				anomalies: checked.anomalies,
				reason: "source anomalies",
			});
		}

		const existingWorkspaces = await discoverWorkspaces({ moduleRoot });
		const existingPdfs = await discoverFinalOutput(dirs.finalOutput);

		const orphans = findOrphans({
			workspaces: existingWorkspaces,
			presentIsos: new Set(videos.dated.map((video) => video.iso)),
		});
		if (orphans.length > 0) {
			const outcome = await resolveOrphans({
				orphans,
				moduleRoot,
				existingPdfs,
				logger,
				confirm,
			});
			if (outcome.state === "declined") {
				abortOrphanHandling({ logger, moduleRoot, reason: outcome.reason });
			}
		}

		const lectures = orderLectures({
			pairs: checked.pairs,
			existingManifests: projectWorkspaces({
				workspaces: existingWorkspaces,
				take: (workspace) => workspace.manifest,
			}),
			modulePrefixes,
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

		const renames = planRenames({
			lectures,
			dirs,
			existingFolders: projectWorkspaces({
				workspaces: existingWorkspaces,
				take: (workspace) => workspace.folder,
			}),
			existingPdfs,
		});
		await applyRenames(renames);
		for (const operation of renames) {
			logger.info({ source: operation.source, target: operation.target }, "Renamed source file");
		}

		for (const lecture of lectures) {
			const action = await reconcileManifest({
				lecture,
				moduleRoot,
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
