/**
 * Moving a module's lectures onto the names their numbering gives them.
 *
 * A lecture is four things on disk — its source video, its slide deck, its
 * pipeline workspace, and its finished PDF — and inserting one lecture shifts
 * every later lecture's number, so a run can be moving many of them onto names
 * other lectures are still using. Everything is therefore moved twice: first
 * onto a temporary name, then off it. Nothing is ever renamed directly onto a
 * name something else still holds.
 *
 * The price of that is a crash between the two passes, which leaves a complete
 * item — possibly the only copy of a lecture's video — sitting under a temporary
 * name. Finishing those is the first thing the next run does, and it happens
 * here too, because the two halves only work by agreeing on the suffix.
 *
 * This is not `lecture-files.ts`'s `renameLectureFiles`, which moves **one**
 * lecture onto a new base name in a single pass: one lecture moving on its own
 * cannot collide with anything, so it needs none of this.
 *
 * See technical-design.md §5, Stage 0.
 */

import { rename } from "node:fs/promises";
import { extname, join } from "node:path";
import type { Logger } from "pino";
import { pathExists, readDirSafe } from "../../utils/files.js";
import type { ModuleDirs } from "../layout.js";
import type { Lecture } from "./lecture-resolution.js";

/**
 * The suffix an item wears between the two passes.
 *
 * Deliberately not the `.tmp` of an atomic write: a `.tmp` here would name a
 * *complete* item mid-move rather than a partial one, and §4.3's sweep of
 * leftover partial output would delete it (technical-design.md §4.3).
 */
const TEMP_SUFFIX = ".stage0-tmp";

/** A single planned rename within one directory. */
export type RenameOp = { readonly dir: string; readonly source: string; readonly target: string };

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
 * Finishes the second pass of a rename an earlier run was interrupted partway
 * through, before anything is read.
 *
 * A temporary entry holds a *complete* item that has left its old name and not
 * yet reached its new one — the sole copy of a source video, or a whole lecture
 * workspace — so the run that finds one moves it on to its target rather than
 * treating it as the discardable partial output §4.3 sweeps up. Left in place it
 * is read as a second video on its lecture's date, which validation then refuses
 * as a duplicate for as long as it sits there.
 *
 * A target name that is already taken cannot be resolved this way. Nothing is
 * then moved at all — every temporary entry is left exactly where it is, and the
 * blocked ones are named so the caller can abort saying which.
 *
 * @param args - The module's directories and the run logger.
 * @param args.dirs - The module's directories.
 * @param args.logger - The run logger.
 * @returns The problems that stopped it, one line each; empty when every interrupted rename is complete.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger carries mutable properties the rule cannot see past; it is only logged to here (CLAUDE.md permits dropping readonly where a library requires a mutable type)
export async function completeInterruptedRenames({
	dirs,
	logger,
}: {
	readonly dirs: ModuleDirs;
	readonly logger: Logger;
}): Promise<readonly string[]> {
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
		return blocked;
	}
	for (const operation of pending) {
		await rename(join(operation.dir, operation.temp), join(operation.dir, operation.target));
		logger.info(
			{ source: operation.temp, target: operation.target },
			"Completed interrupted rename",
		);
	}
	return [];
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
 * @param args.dirs - The module's directories.
 * @param args.existingFolders - Existing workspace folder names, keyed by lecture date.
 * @param args.existingPdfs - Existing `Final output/` PDF names, keyed by lecture date.
 * @returns The rename operations to apply, collision-safely.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- a ReadonlyMap is already the readonly form; the rule does not recognise the built-in collection interfaces as deeply readonly, and both maps are only read here
export function planRenames({
	lectures,
	dirs,
	existingFolders,
	existingPdfs,
}: {
	readonly lectures: readonly Lecture[];
	readonly dirs: ModuleDirs;
	readonly existingFolders: ReadonlyMap<string, string>;
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
				source: existingFolders.get(lecture.iso),
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
 * Where an item waits between the two passes of a rename: at its target name,
 * under the temporary suffix. Written once because the two passes address it
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
 * Applies renames in two passes — every source to a temporary name, then every
 * temporary name to its target — so shifting lecture numbers never collide
 * mid-rename.
 *
 * @param renames - The rename operations to apply.
 * @returns A promise that resolves once every rename is complete.
 */
export async function applyRenames(renames: readonly RenameOp[]): Promise<void> {
	for (const operation of renames) {
		await rename(join(operation.dir, operation.source), stagingPath(operation));
	}
	for (const operation of renames) {
		await rename(stagingPath(operation), join(operation.dir, operation.target));
	}
}
