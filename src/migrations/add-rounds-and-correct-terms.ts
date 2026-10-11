/**
 * The one-time migration of the stored lecture data (technical-design.md §4.5,
 * "The migration of the stored data"). The user runs it before a pipeline run,
 * because the manifest readers reject an entry with no `round`.
 */

import { rename } from "node:fs/promises";
import { join, relative } from "node:path";
import { moduleName, runLogsDirPath, stageDirectoryPath } from "../pipeline/layout.js";
import { listWorkspaces } from "../pipeline/lecture-files.js";
import { FIRST_ROUND, manifestPath } from "../pipeline/manifest.js";
import { ROUNDS_PER_PIPELINE_RUN, type StageId } from "../types/pipeline.js";
import { listFileNames, pathExists, readJsonSafe, writeJsonAtomic } from "../utils/files.js";
import { isRecord } from "../utils/record.js";

/** The stage id under which a manifest without a `correct-terms` entry holds the term corrections. */
const TERM_CORRECTION_STAGE_ID = "rewrite-subtopics";

/** The folder in which a manifest without a `correct-terms` entry records the term corrections. */
const TERM_CORRECTION_DIRECTORY = "Rewrite attempts";

const CORRECT_TERMS: StageId = "correct-terms";

/**
 * A stored stage map of a manifest or a run log, and a change to its entries.
 *
 * @typeParam TEntry - The entry that the change receives.
 */
type StageMapChange<TEntry> = {
	readonly stages: Readonly<Record<string, unknown>>;
	readonly change: (entry: TEntry) => unknown;
};

/**
 * One path of `filesWritten`, moved from {@link TERM_CORRECTION_DIRECTORY} to the folder of `correct-terms`.
 *
 * @param args - The path and the folder.
 * @param args.path - The workspace-relative path.
 * @param args.directory - The workspace-relative folder of `correct-terms`.
 * @returns The path in the folder of `correct-terms`.
 */
function correctTermsPath({
	path,
	directory,
}: {
	readonly path: string;
	readonly directory: string;
}): string {
	return join(directory, relative(TERM_CORRECTION_DIRECTORY, path));
}

/**
 * The test that a stage map holds the term corrections under
 * {@link TERM_CORRECTION_STAGE_ID}. A map with a `correct-terms` entry does not,
 * so a second run changes nothing.
 *
 * @param stages - The stored stage map.
 * @returns `true` when the term corrections must move to `correct-terms`.
 */
function holdsTermCorrections(stages: Readonly<Record<string, unknown>>): boolean {
	return !(CORRECT_TERMS in stages) && isRecord(stages[TERM_CORRECTION_STAGE_ID]);
}

/**
 * The stage map of a manifest or a run log, with the entry of
 * {@link TERM_CORRECTION_STAGE_ID} under `correct-terms`.
 *
 * @param args - The stage map and the change to the entry.
 * @param args.stages - The stored stage map.
 * @param args.change - The change that the entry gets as it moves.
 * @returns The stage map with the entry moved.
 */
function withTermCorrectionsMoved({
	stages,
	change,
}: StageMapChange<Readonly<Record<string, unknown>>>): Record<string, unknown> {
	const { [TERM_CORRECTION_STAGE_ID]: entry, ...others } = stages;
	return isRecord(entry) ? { ...others, [CORRECT_TERMS]: change(entry) } : { ...stages };
}

/**
 * The function that moves the term corrections of one workspace. It moves the
 * folder on disk. Then it gives back the stage map, which the caller writes
 * last. A run that stops before that write leaves the old entry, and the next
 * run moves it. The folder is then already gone, so a missing folder is not an
 * error.
 *
 * @param args - The workspace, its stage map and the folder of `correct-terms`.
 * @param args.workspaceRoot - The absolute path of the workspace.
 * @param args.stages - The stored stage map.
 * @param args.directoryPath - The absolute path of the folder of `correct-terms`.
 * @returns The stage map with the entry and its paths moved.
 */
async function moveTermCorrections({
	workspaceRoot,
	stages,
	directoryPath,
}: {
	readonly workspaceRoot: string;
	readonly stages: Readonly<Record<string, unknown>>;
	readonly directoryPath: string;
}): Promise<Record<string, unknown>> {
	const oldDirectoryPath = join(workspaceRoot, TERM_CORRECTION_DIRECTORY);
	if (await pathExists(oldDirectoryPath)) {
		await rename(oldDirectoryPath, directoryPath);
	}
	const directory = relative(workspaceRoot, directoryPath);
	return withTermCorrectionsMoved({
		stages,
		change: (entry) => ({
			...entry,
			filesWritten: Array.isArray(entry.filesWritten)
				? entry.filesWritten.map((path: unknown) =>
						correctTermsPath({ path: String(path), directory }),
					)
				: entry.filesWritten,
		}),
	});
}

/**
 * A stage map with each entry changed.
 *
 * @param args - The stage map and the change.
 * @param args.stages - The stored stage map of a manifest or a run log.
 * @param args.change - The change to one entry.
 * @returns The changed stage map.
 */
function withEachEntry({ stages, change }: StageMapChange<unknown>): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(stages).map(([stageId, entry]) => [stageId, change(entry)]),
	);
}

/**
 * One stored stage entry, with `round: 1` added when the entry needs a round
 * and has none. A `pending` entry has no round.
 *
 * @param entry - The stored stage entry.
 * @returns The entry in the current form.
 */
function withRound(entry: unknown): unknown {
	if (!isRecord(entry) || entry.status === "pending" || "round" in entry) {
		return entry;
	}
	return { ...entry, round: FIRST_ROUND };
}

/**
 * One run log entry, with `rounds` added when the stage ran and the entry has none.
 *
 * @param entry - The stored run log entry.
 * @returns The entry in the current form.
 */
function withRounds(entry: unknown): unknown {
	if (!isRecord(entry) || entry.action !== "ran" || "rounds" in entry) {
		return entry;
	}
	return { ...entry, rounds: ROUNDS_PER_PIPELINE_RUN };
}

/**
 * The function that migrates each run log of a workspace. It gives `rounds` to
 * each entry of a stage that ran. When the term corrections move, it also
 * renames {@link TERM_CORRECTION_STAGE_ID} to `correct-terms` in each run log
 * that has no `correct-terms` entry.
 *
 * @param args - The workspace and the move.
 * @param args.workspaceRoot - The absolute path of the workspace.
 * @param args.movesTermCorrections - `true` when the manifest still holds the term corrections under the old id.
 * @returns A promise that resolves when each run log is written.
 */
async function migrateRunLogs({
	workspaceRoot,
	movesTermCorrections,
}: {
	readonly workspaceRoot: string;
	readonly movesTermCorrections: boolean;
}): Promise<void> {
	const runLogsDir = runLogsDirPath({ workspaceRoot });
	for (const name of await listFileNames(runLogsDir)) {
		const path = join(runLogsDir, name);
		const runLog = await readJsonSafe(path);
		if (!isRecord(runLog) || !isRecord(runLog.stages)) {
			continue;
		}
		const moved =
			movesTermCorrections && holdsTermCorrections(runLog.stages)
				? withTermCorrectionsMoved({ stages: runLog.stages, change: (entry) => entry })
				: runLog.stages;
		const stages = withEachEntry({ stages: moved, change: withRounds });
		await writeJsonAtomic({ path, value: { ...runLog, stages } });
	}
}

/**
 * The function that migrates one workspace. A folder whose manifest is missing or holds no
 * stage map is left alone. The manifest is read as plain JSON, because the
 * manifest readers reject an entry with no `round`.
 *
 * @param workspaceRoot - The absolute path of the workspace.
 * @returns A promise that resolves when the manifest is written.
 */
async function migrateWorkspace(workspaceRoot: string): Promise<void> {
	const path = manifestPath({ workspaceRoot });
	const manifest = await readJsonSafe(path);
	if (!isRecord(manifest) || !isRecord(manifest.stages)) {
		return;
	}
	const movesTermCorrections = holdsTermCorrections(manifest.stages);
	await migrateRunLogs({ workspaceRoot, movesTermCorrections });
	const directoryPath = stageDirectoryPath({ workspaceRoot, stageId: CORRECT_TERMS });
	const moved = movesTermCorrections
		? await moveTermCorrections({ workspaceRoot, stages: manifest.stages, directoryPath })
		: manifest.stages;
	const stages = withEachEntry({ stages: moved, change: withRound });
	await writeJsonAtomic({ path, value: { ...manifest, stages } });
}

/**
 * The function that brings each workspace of a module to the current form of the stored data.
 *
 * @param args - The module.
 * @param args.moduleRoot - The absolute path of the module folder.
 * @returns A promise that resolves when each workspace is migrated.
 */
async function migrateModule({ moduleRoot }: { readonly moduleRoot: string }): Promise<void> {
	for (const workspaceRoot of await listWorkspaces({ moduleRoot })) {
		await migrateWorkspace(workspaceRoot);
	}
}

/**
 * The function that migrates each module, in the order given. It writes one
 * line for each module after the module is migrated.
 *
 * @param args - The modules and the output.
 * @param args.moduleRoots - The absolute path of each module folder.
 * @param args.write - The receiver of each output line.
 * @returns A promise that resolves when each module is migrated.
 */
export async function migrateModules({
	moduleRoots,
	write,
}: {
	readonly moduleRoots: readonly string[];
	readonly write: (line: string) => void;
}): Promise<void> {
	for (const moduleRoot of moduleRoots) {
		await migrateModule({ moduleRoot });
		write(`Migrated ${moduleName({ moduleRoot })}`);
	}
}
