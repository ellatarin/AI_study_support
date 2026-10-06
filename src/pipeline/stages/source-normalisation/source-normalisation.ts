/**
 * The `source-normalisation` stage. The runner runs it once for each module,
 * before any lecture. It completes interrupted renames, checks the source rules
 * and asks before it deletes orphaned workspaces. Then it numbers the lectures by
 * date, renames the lecture files and writes each manifest.
 *
 * This file holds the order of these steps and what an abort does. The steps are
 * in `lecture-resolution.ts`, `source-renames.ts` and `orphaned-workspaces.ts`
 * (technical-design.md §5, `source-normalisation`).
 */

import type { Logger } from "pino";
import type { Manifest, SourceNormalisationStage } from "../../../types/pipeline.js";
import { extractDate, formatDateISO } from "../../../utils/date.js";
import { NamedError } from "../../../utils/errors.js";
import { listFileNames } from "../../../utils/files.js";
import { moduleDirs, workspaceRootFor } from "../../layout.js";
import { MANIFEST_VERSION, pendingStages, readManifest, writeManifest } from "../../manifest.js";
import {
	checkSourceRules,
	type Lecture,
	orderLectures,
	toDatedFiles,
} from "./lecture-resolution.js";
import {
	type ConfirmPrompt,
	discoverWorkspaces,
	type ExistingWorkspace,
	findOrphanedWorkspaces,
	resolveOrphanedWorkspaces,
} from "./orphaned-workspaces.js";
import { applyRenames, completeInterruptedRenames, planRenames } from "./source-renames.js";

/**
 * The error when the stage stops for a module. A source rule is broken, an
 * interrupted rename cannot be completed, or the user declines a deletion. The
 * message lists each broken rule or blocked rename. Before it throws, the stage
 * changes no file, except the interrupted renames that it completed first.
 */
export class SourceNormalisationError extends NamedError {}

/**
 * Stops the stage before it applies the renames of the new numbering. It logs
 * each line at `error` and throws.
 *
 * @param args - The details of the abort.
 * @param args.logger - The logger of the stage.
 * @param args.moduleRoot - The module that the stage normalises.
 * @param args.problems - Each broken rule or blocked rename, one line each.
 * @param args.reason - The kind of failure, for the log message.
 * @throws {@link SourceNormalisationError} Always.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger has mutable properties that the rule cannot ignore. This function only logs to it. CLAUDE.md permits a mutable type that a library requires.
function abortNormalisation({
	logger,
	moduleRoot,
	problems,
	reason,
}: {
	readonly logger: Logger;
	readonly moduleRoot: string;
	readonly problems: readonly string[];
	readonly reason: string;
}): never {
	logger.error({ moduleRoot, problems }, `Source normalisation aborted: ${reason}`);
	throw new SourceNormalisationError(
		`Source normalisation failed for ${moduleRoot}:\n- ${problems.join("\n- ")}`,
	);
}

/**
 * Stops the stage when the user declines a deletion, before anything is deleted.
 * It logs the reason at `error` and throws.
 *
 * @param args - The details of the abort.
 * @param args.logger - The logger of the stage.
 * @param args.moduleRoot - The module that the stage normalises.
 * @param args.reason - The question that the user declined.
 * @throws {@link SourceNormalisationError} Always.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger has mutable properties that the rule cannot ignore. This function only logs to it. CLAUDE.md permits a mutable type that a library requires.
function abortOrphanedWorkspaceHandling({
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
 * Finds the name of each dated file in the final output folder, so that the PDF
 * of a renumbered lecture can be renamed.
 *
 * @param finalOutputDirPath - The absolute path of the final output folder.
 * @returns The current file name for each lecture date.
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
 * Keeps one part of each existing workspace. The numbering and the renames each
 * get only the part that they use.
 *
 * @param args - The workspaces and the part to keep.
 * @param args.workspaces - The existing workspaces, keyed by lecture date.
 * @param args.take - The function that selects the part to keep.
 * @returns The selected part of each workspace, keyed by lecture date.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- a ReadonlyMap is readonly, but the rule does not accept it. This function only reads it.
function projectWorkspaces<TValue>({
	workspaces,
	take,
}: {
	readonly workspaces: ReadonlyMap<string, ExistingWorkspace>;
	readonly take: (workspace: ExistingWorkspace) => TValue;
}): ReadonlyMap<string, TValue> {
	return new Map([...workspaces].map(([lectureDate, workspace]) => [lectureDate, take(workspace)]));
}

/**
 * Builds the first manifest of a new lecture. The lecture title is the
 * provisional title. The user title and the AI-derived title are `null`. Each
 * stage is pending (technical-design.md §5, `source-normalisation`, step 6).
 *
 * @param lecture - The lecture from the numbering.
 * @returns The first manifest.
 */
function initialManifest(lecture: Lecture): Manifest {
	const now = new Date().toISOString();
	const stages = pendingStages();
	return {
		version: MANIFEST_VERSION,
		lectureNumber: lecture.lectureNumber,
		lectureDate: lecture.lectureDate,
		provisionalTitle: lecture.provisionalTitle,
		lectureTitle: lecture.provisionalTitle,
		userTitle: null,
		aiDerivedTitle: null,
		baseName: lecture.baseName,
		createdAt: now,
		updatedAt: now,
		stages,
	};
}

/**
 * Creates the workspace and manifest of a new lecture. For an existing lecture,
 * it changes `lectureNumber` and `baseName` after a renumbering. It does not
 * write a manifest that has no change.
 *
 * @param args - The lecture, its module, and whether its workspace exists.
 * @param args.lecture - The lecture from the numbering.
 * @param args.moduleRoot - The absolute path of the module.
 * @param args.isExisting - True when a workspace for this lecture date exists.
 * @returns The change to the manifest: `created`, `updated` or `unchanged`.
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
	const workspaceRoot = workspaceRootFor({ moduleRoot, baseName: lecture.baseName });
	if (!isExisting) {
		await writeManifest({ workspaceRoot, manifest: initialManifest(lecture) });
		return "created";
	}
	const manifest = await readManifest({ workspaceRoot });
	if (manifest.lectureNumber === lecture.lectureNumber && manifest.baseName === lecture.baseName) {
		return "unchanged";
	}
	const updated: Manifest = {
		...manifest,
		lectureNumber: lecture.lectureNumber,
		baseName: lecture.baseName,
		updatedAt: new Date().toISOString(),
	};
	await writeManifest({ workspaceRoot, manifest: updated });
	return "updated";
}

/**
 * Builds the `source-normalisation` stage (technical-design.md §5, `source-normalisation`).
 *
 * @param args - The dependencies of the stage.
 * @param args.logger - The logger that records each action and each failure.
 * @param args.confirm - The question that the stage asks before a deletion that cannot be undone.
 * @param args.modulePrefixes - The module prefixes that the stage removes from a filename to get the provisional title.
 * @returns The stage, which the runner runs once for each module.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger has mutable properties that the rule cannot ignore. This function only reads it. CLAUDE.md permits a mutable type that a library requires.
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
				problems: blocked,
				reason: "interrupted renames cannot be completed",
			});
		}

		const videoRecordings = toDatedFiles(await listFileNames(dirs.videoRecording));
		const slideDecks = toDatedFiles(await listFileNames(dirs.slideDeck));
		logger.info(
			{ moduleRoot, videos: videoRecordings.dated.length, slides: slideDecks.dated.length },
			"Normalising module sources",
		);

		const checked = checkSourceRules({ videoRecordings, slideDecks });
		if (checked.state === "rules-broken") {
			abortNormalisation({
				logger,
				moduleRoot,
				problems: checked.brokenRules,
				reason: "source rules broken",
			});
		}

		const existingWorkspaces = await discoverWorkspaces({ moduleRoot });
		const existingPdfs = await discoverFinalOutput(dirs.finalOutput);

		const orphanedWorkspaces = findOrphanedWorkspaces({
			workspaces: existingWorkspaces,
			presentLectureDates: new Set(
				videoRecordings.dated.map((videoRecording) => videoRecording.lectureDate),
			),
		});
		if (orphanedWorkspaces.length > 0) {
			const outcome = await resolveOrphanedWorkspaces({
				orphanedWorkspaces,
				moduleRoot,
				existingPdfs,
				logger,
				confirm,
			});
			if (outcome.state === "declined") {
				abortOrphanedWorkspaceHandling({ logger, moduleRoot, reason: outcome.reason });
			}
		}

		const lectures = orderLectures({
			sourcePairs: checked.sourcePairs,
			existingManifests: projectWorkspaces({
				workspaces: existingWorkspaces,
				take: (workspace) => workspace.manifest,
			}),
			modulePrefixes,
		});
		// One debug line for each lecture, before any rename: its lecture date, its
		// lecture number and its source pair. These lines answer "why is this
		// Lecture 3?". Without them, a person must do the numbering again by hand.
		for (const lecture of lectures) {
			logger.debug(
				{
					lectureNumber: lecture.lectureNumber,
					lectureDate: lecture.lectureDate,
					videoName: lecture.videoRecordingName,
					slideName: lecture.slideDeckName,
					provisionalTitle: lecture.provisionalTitle,
				},
				"Resolved lecture",
			);
		}

		const renames = planRenames({
			lectures,
			dirs,
			existingBaseNames: projectWorkspaces({
				workspaces: existingWorkspaces,
				take: (workspace) => workspace.baseName,
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
				isExisting: existingWorkspaces.has(lecture.lectureDate),
			});
			if (action !== "unchanged") {
				logger.info(
					{ baseName: lecture.baseName, lectureNumber: lecture.lectureNumber, action },
					"Reconciled lecture workspace",
				);
			}
		}
	}

	return { stageId: "source-normalisation", normaliseModule };
}
