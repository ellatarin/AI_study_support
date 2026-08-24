/**
 * Finding, moving and removing the files a lecture's identity is spread across.
 *
 * A lecture is four things on disk — its source video, its source slides, its
 * pipeline workspace, and its finished PDF — and they share one base name.
 * Whenever that name changes they all have to move together, which happens in
 * two unrelated places: the CLI's `change-date` command (§4.7) and Stage 3, when
 * the LLM replaces the lecturer's provisional title (§5, Stage 3). The sweep
 * lives here so those two cannot drift apart.
 *
 * Three of those four sit in directories shared with every other lecture in the
 * module, so anything acting on one lecture there addresses it by the date its
 * filename carries rather than by sweeping the directory. That is what
 * {@link findDatedFile} and {@link removeDatedFile} are for.
 *
 * It sits under `src/pipeline/` rather than beside the CLI commands that first
 * needed it because a stage may not import from the CLI layer.
 *
 * See technical-design.md §4.7 ("Moving a lecture's files").
 */

import { rename, rm } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { extractDates, formatDateISO } from "../utils/date.js";
import { listFileNames } from "../utils/files.js";
import { lectureBaseName } from "../utils/naming.js";
import { datedFileDirs, type ModuleDirs } from "./layout.js";

/**
 * The canonical base name for a lecture sitting on an ISO date.
 *
 * Both callers that rename a lecture — `change-date` and Stage 3 — hold the date
 * as the `YYYY-MM-DD` string the manifest stores, while {@link lectureBaseName}
 * takes a `Date`. Converting it in one place keeps the trap in one place too:
 * the string must be read as **local** midnight, matching how dates are read out
 * of filenames, or the base name lands a day early west of Greenwich.
 *
 * @param args - The lecture's identity.
 * @param args.lectureNumber - The assigned lecture number.
 * @param args.title - The title to name it by; may be empty.
 * @param args.lectureDate - The lecture's `YYYY-MM-DD` date.
 * @returns The base name its files and workspace share.
 * @throws Error when the title has no characters usable in a filename.
 */
export function baseNameForLecture({
	lectureNumber,
	title,
	lectureDate,
}: {
	readonly lectureNumber: number;
	readonly title: string;
	readonly lectureDate: string;
}): string {
	return lectureBaseName({
		lectureNumber,
		title,
		date: new Date(`${lectureDate}T00:00:00`),
	});
}

/**
 * A directory, and the lecture whose file is wanted in it.
 *
 * Looking one up and removing it ask the same question of the same pair, so the
 * pair is named rather than written at both.
 */
type DatedFileQuery = {
	/** The directory to scan; a directory that does not exist holds none. */
	readonly dir: string;
	/** The `YYYY-MM-DD` date the lecture's file carries. */
	readonly lectureDate: string;
};

/**
 * The single file in a directory whose name carries the given lecture date.
 *
 * Sources are addressed by date rather than by name because a lecture's name
 * changes with its number and title, while its date is what identifies it
 * (technical-design.md §3.2).
 *
 * The **last** date in the name is the one compared. These directories hold
 * names Stage 0 has normalised, and {@link lectureBaseName} puts the title
 * before the date — so a title naming a date of its own (a cohort, a study, a
 * historical event) precedes the lecture's own date and the last one is it.
 *
 * @param args - Where to look and what date to look for.
 * @param args.dir - The directory to scan; a directory that does not exist holds none.
 * @param args.lectureDate - The `YYYY-MM-DD` date to match.
 * @returns The matching file name, or `null` when the directory holds none.
 */
export async function findDatedFile({ dir, lectureDate }: DatedFileQuery): Promise<string | null> {
	for (const name of await listFileNames(dir)) {
		const date = extractDates(name).at(-1);
		if (date !== undefined && formatDateISO(date) === lectureDate) {
			return name;
		}
	}
	return null;
}

/**
 * Removes the one file in a directory carrying a lecture's date, where there is
 * one.
 *
 * Every directory a lecture's own files sit in — its sources and the module's
 * `Final output/` — is shared with every other lecture in the module, so
 * clearing one lecture out of them can never be a sweep of the directory.
 * Removal goes by date for the same reason lookup does: the date is what
 * identifies a lecture, while its name changes with its number and title
 * (technical-design.md §3.2).
 *
 * Two callers need exactly this: `delete` clears a lecture out of all three
 * directories, and a `--from-stage` re-run at or before Stage 8 clears that
 * lecture's PDF out of `Final output/`.
 *
 * @param args - Where to look and whose file to remove.
 * @param args.dir - The directory to clear the file from.
 * @param args.lectureDate - The `YYYY-MM-DD` date identifying it.
 * @returns A promise that resolves once the file is gone, or at once when the directory holds none.
 */
export async function removeDatedFile({ dir, lectureDate }: DatedFileQuery): Promise<void> {
	const name = await findDatedFile({ dir, lectureDate });
	if (name === null) {
		return;
	}
	await rm(join(dir, name), { force: true });
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
	for (const dir of datedFileDirs({ dirs })) {
		await renameToBase({ dir, name: await findDatedFile({ dir, lectureDate }), baseName });
	}
	const movedTo = join(dirname(workspaceRoot), baseName);
	await rename(workspaceRoot, movedTo);
	return movedTo;
}
