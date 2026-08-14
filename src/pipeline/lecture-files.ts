/**
 * Moving the files a lecture's identity is spread across.
 *
 * A lecture is four things on disk — its source video, its source slides, its
 * pipeline workspace, and its finished PDF — and they share one base name.
 * Whenever that name changes they all have to move together, which happens in
 * two unrelated places: the CLI's `change-date` command (§4.7) and Stage 3, when
 * the LLM replaces the lecturer's provisional title (§5, Stage 3). The sweep
 * lives here so those two cannot drift apart.
 *
 * It sits under `src/pipeline/` rather than beside the CLI commands that first
 * needed it because a stage may not import from the CLI layer.
 *
 * See technical-design.md §4.7 ("Moving a lecture's files").
 */

import { rename } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { extractDate, formatDateISO } from "../utils/date.js";
import { listFileNames } from "../utils/files.js";
import type { ModuleDirs } from "./stages/source-normalisation.js";

/**
 * The single file in a directory whose name carries the given lecture date.
 *
 * Sources are addressed by date rather than by name because a lecture's name
 * changes with its number and title, while its date is what identifies it
 * (technical-design.md §3.2).
 *
 * @param args - Where to look and what date to look for.
 * @param args.dir - The directory to scan; a directory that does not exist holds none.
 * @param args.lectureDate - The `YYYY-MM-DD` date to match.
 * @returns The matching file name, or `null` when the directory holds none.
 */
export async function findDatedFile({
	dir,
	lectureDate,
}: {
	readonly dir: string;
	readonly lectureDate: string;
}): Promise<string | null> {
	for (const name of await listFileNames(dir)) {
		const date = extractDate(name);
		if (date !== null && formatDateISO(date) === lectureDate) {
			return name;
		}
	}
	return null;
}

/**
 * Renames a file to a new base name, keeping whatever extension it carried.
 *
 * @param args - The file to rename and its new base name.
 * @param args.dir - The directory holding the file.
 * @param args.name - The file's current name, or `null` when there is nothing to rename.
 * @param args.baseName - The new name, without extension.
 * @returns A promise that resolves once the file is renamed.
 */
async function renameToBase({
	dir,
	name,
	baseName,
}: {
	readonly dir: string;
	readonly name: string | null;
	readonly baseName: string;
}): Promise<void> {
	if (name === null) {
		return;
	}
	await rename(join(dir, name), join(dir, `${baseName}${extname(name)}`));
}

/**
 * Moves a whole lecture onto a new base name: its source video, its source
 * slides, its `Final output/` PDF, and its workspace folder.
 *
 * Anything absent is skipped rather than treated as an error, since a lecture
 * legitimately has no PDF until Stage 8 has run. A caller that needs a file to
 * be there checks for it first and says so in its own terms — `change-date`
 * refuses to move a lecture whose source pair is missing.
 *
 * @param args - The lecture to move and where to move it.
 * @param args.dirs - The module's directories.
 * @param args.workspaceRoot - Absolute path to the lecture's workspace, before the move.
 * @param args.lectureDate - The `YYYY-MM-DD` date its files are found by.
 * @param args.baseName - The base name every one of them is moved onto.
 * @returns The workspace's new absolute path.
 */
export async function renameLectureFiles({
	dirs,
	workspaceRoot,
	lectureDate,
	baseName,
}: {
	readonly dirs: ModuleDirs;
	readonly workspaceRoot: string;
	readonly lectureDate: string;
	readonly baseName: string;
}): Promise<string> {
	for (const dir of [dirs.video, dirs.slide, dirs.finalOutput]) {
		await renameToBase({ dir, name: await findDatedFile({ dir, lectureDate }), baseName });
	}
	const movedTo = join(dirname(workspaceRoot), baseName);
	await rename(workspaceRoot, movedTo);
	return movedTo;
}
