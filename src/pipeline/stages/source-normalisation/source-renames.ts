/**
 * The two-pass renames that move the lecture files of a module onto a new
 * numbering (technical-design.md §5, `source-normalisation`,
 * 'Collision-safe renaming'). This file holds the two-pass rename and the
 * completion of interrupted renames, because both must use the same suffix.
 *
 * `renameLectureFiles` in `lecture-files.ts` moves one lecture in one pass. It
 * needs no temporary name, because one lecture that moves alone cannot collide
 * with another lecture file.
 */

import { rename } from "node:fs/promises";
import { extname, join } from "node:path";
import type { Logger } from "pino";
import { pathExists, readDirSafe } from "../../../utils/files.js";
import type { ModuleDirs } from "../../layout.js";
import type { Lecture } from "./lecture-resolution.js";

/**
 * The suffix of a lecture file between the two passes. A `.tmp` file is a
 * partial write that a stage deletes. A lecture file between the two passes is
 * complete, so its suffix is not `.tmp` (technical-design.md §5,
 * `source-normalisation`).
 */
const TEMP_SUFFIX = ".normalisation-tmp";

/** One planned rename in one folder. */
export type RenameOp = { readonly dir: string; readonly source: string; readonly target: string };

/** A temporary entry from an interrupted rename, and the name that it was moving to. */
type PendingRename = { readonly dir: string; readonly temp: string; readonly target: string };

/**
 * Finds each temporary entry that an interrupted rename left in the four folders
 * of the module. A source file, a workspace folder and a PDF all use the same suffix.
 *
 * @param dirs - The folders of the module.
 * @returns Each temporary entry, with the name that it was moving to.
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
 * Completes the second pass of each interrupted rename, before the stage reads
 * the source folders. A temporary entry holds a complete lecture file, such as
 * the only copy of a video recording. So the stage moves it to its target and
 * does not delete it.
 *
 * If any target name is taken, nothing moves. The result names each blocked
 * entry, and the caller stops (technical-design.md §5, `source-normalisation`).
 *
 * @param args - The folders of the module and the logger.
 * @param args.dirs - The folders of the module.
 * @param args.logger - The logger of the stage.
 * @returns One line for each blocked entry. The list is empty when each interrupted rename is complete.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger has mutable properties that the rule cannot ignore. This function only logs to it. CLAUDE.md permits a mutable type that a library requires.
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
 * Plans the rename of one lecture file. The result is `null` when the lecture
 * file is absent, or when it already has its target name. Each of the four
 * lecture files uses this one check.
 *
 * @param args - The lecture file and its target name.
 * @param args.dir - The folder of the lecture file.
 * @param args.source - Its current name, or `undefined` when the lecture file is absent.
 * @param args.target - The name that the new numbering gives it.
 * @returns The rename, or `null` when no rename is necessary.
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
 * Plans each rename for the new numbering: the video recording, the slide deck,
 * the workspace folder and the PDF of each lecture. A lecture file that already
 * has its target name gets no rename. So a second normalisation with no change
 * renames nothing.
 *
 * @param args - The lectures, the folders, and the existing workspaces and PDFs.
 * @param args.lectures - The lectures with their new numbers.
 * @param args.dirs - The folders of the module.
 * @param args.existingBaseNames - The base names of the existing workspaces, keyed by lecture date.
 * @param args.existingPdfs - The names of the PDFs in the final output folder, keyed by lecture date.
 * @returns The renames, for {@link applyRenames}.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- a ReadonlyMap is readonly, but the rule does not accept the built-in collection types as readonly. This function only reads both maps.
export function planRenames({
	lectures,
	dirs,
	existingBaseNames,
	existingPdfs,
}: {
	readonly lectures: readonly Lecture[];
	readonly dirs: ModuleDirs;
	readonly existingBaseNames: ReadonlyMap<string, string>;
	readonly existingPdfs: ReadonlyMap<string, string>;
}): readonly RenameOp[] {
	return lectures.flatMap((lecture) =>
		[
			renameIfMoved({
				dir: dirs.videoRecording,
				source: lecture.videoRecordingName,
				target: `${lecture.baseName}${extname(lecture.videoRecordingName)}`,
			}),
			renameIfMoved({
				dir: dirs.slideDeck,
				source: lecture.slideDeckName,
				target: `${lecture.baseName}${extname(lecture.slideDeckName)}`,
			}),
			renameIfMoved({
				dir: dirs.processing,
				source: existingBaseNames.get(lecture.lectureDate),
				target: lecture.baseName,
			}),
			renameIfMoved({
				dir: dirs.finalOutput,
				source: existingPdfs.get(lecture.lectureDate),
				target: `${lecture.baseName}.pdf`,
			}),
		].filter((operation) => operation !== null),
	);
}

/**
 * Gives the path of a lecture file between the two passes: its target name with
 * the temporary suffix. The first pass renames onto this path and the second
 * pass renames off it. After a stop between the passes,
 * {@link completeInterruptedRenames} finds the file there.
 *
 * @param operation - The rename.
 * @returns The absolute path of the lecture file between the passes.
 */
function stagingPath(operation: RenameOp): string {
	return join(operation.dir, `${operation.target}${TEMP_SUFFIX}`);
}

/**
 * Applies the renames in two passes. The first pass moves each lecture file to
 * its temporary name. The second pass moves each one to its target name.
 *
 * @param renames - The renames to apply.
 * @returns A promise that resolves when each rename is complete.
 */
export async function applyRenames(renames: readonly RenameOp[]): Promise<void> {
	for (const operation of renames) {
		await rename(join(operation.dir, operation.source), stagingPath(operation));
	}
	for (const operation of renames) {
		await rename(stagingPath(operation), join(operation.dir, operation.target));
	}
}
