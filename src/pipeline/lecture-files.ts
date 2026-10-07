/**
 * The code that finds, renames and removes the lecture files
 * (technical-design.md §4.7, "Moving a lecture's files").
 *
 * A lecture has four things on disk with one base name: its video recording, its
 * slide deck, its notes PDF and its workspace. The CLI's `change-date` and
 * `judge-lecture-title` both move all four to a new base name, so the code that
 * moves them is here once. It is in `src/pipeline/`, because a stage must not
 * import from the CLI.
 *
 * The video recording, the slide deck and the notes PDF are in folders
 * that all the lectures of the module share. So a lecture's file in such a folder
 * is found by the date in its name.
 */

import { rename, rm } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import type { StageContext } from "../types/pipeline.js";
import { extractDates, formatDateISO } from "../utils/date.js";
import { listFileNames } from "../utils/files.js";
import { lectureBaseName } from "../utils/naming.js";
import { type ModuleDirs, moduleDirs, sharedLectureFileDirs } from "./layout.js";

/**
 * Gives a lecture's base name from the `YYYY-MM-DD` date that the manifest stores.
 * {@link lectureBaseName} takes a `Date`, so the conversion from the `YYYY-MM-DD`
 * text to a `Date` is here once. The date
 * is read as **local** midnight, as {@link formatDateISO} writes it. Otherwise the
 * base name is one day early west of Greenwich (technical-design.md §4.7).
 *
 * @param args - The lecture identity.
 * @param args.lectureNumber - The lecture number.
 * @param args.title - The title for the name. It can be empty.
 * @param args.lectureDate - The lecture's `YYYY-MM-DD` date.
 * @returns The base name of the lecture files and the workspace.
 * @throws Error When the title has no characters that are safe in a file name.
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

type LectureFileQuery = {
	/** The folder to search. A folder that does not exist holds no file. */
	readonly dir: string;
	/** The `YYYY-MM-DD` date in the name of the lecture's file. */
	readonly lectureDate: string;
};

/**
 * Finds the file in a folder whose name has the lecture date. The date, not the
 * name, identifies a lecture (technical-design.md §3.2).
 *
 * The **last** date in the name is compared. A title can hold a date of its own,
 * and {@link lectureBaseName} puts the title before the lecture date
 * (technical-design.md §4.7).
 *
 * @param args - The folder and the date.
 * @param args.dir - The folder to search. A folder that does not exist holds no file.
 * @param args.lectureDate - The `YYYY-MM-DD` date to match.
 * @returns The file name, or `null` when no file has the date.
 */
export async function findLectureFileByDate({
	dir,
	lectureDate,
}: LectureFileQuery): Promise<string | null> {
	for (const name of await listFileNames(dir)) {
		const date = extractDates(name).at(-1);
		if (date !== undefined && formatDateISO(date) === lectureDate) {
			return name;
		}
	}
	return null;
}

/** The two source folders of a module, as their keys in {@link ModuleDirs}. */
export type SourceFolder = keyof Pick<ModuleDirs, "videoRecording" | "slideDeck">;

/** The name of each kind of source file, for the failure that a user reads. */
const SOURCE_FILE_KINDS: Readonly<Record<SourceFolder, string>> = {
	videoRecording: "video recording",
	slideDeck: "slide deck",
};

/**
 * Finds the lecture's source file in one source folder by the lecture's base
 * name, for the stage that reads the file. The file keeps its own extension, so
 * the match is the one file whose name without its extension is the base name
 * (technical-design.md §5, `audio-extraction`).
 *
 * @param args - The lecture, the source folder and the error to raise.
 * @param args.context - The stage context of the lecture.
 * @param args.source - The source folder: `videoRecording` or `slideDeck`.
 * @param args.fail - Builds the calling stage's own error from a message.
 * @returns The absolute path of the file.
 * @throws The error that `fail` builds, when no file or more than one file has the base name.
 */
export async function locateSourceFile({
	context,
	source,
	fail,
}: {
	readonly context: StageContext;
	readonly source: SourceFolder;
	readonly fail: (message: string) => Error;
}): Promise<string> {
	const dir = moduleDirs({ moduleRoot: context.moduleRoot })[source];
	const baseName = context.manifest.baseName;
	const kind = SOURCE_FILE_KINDS[source];
	const matches = (await listFileNames(dir)).filter(
		(name) => basename(name, extname(name)) === baseName,
	);
	const [match, ...surplus] = matches;
	if (match === undefined) {
		throw fail(`No ${kind} named "${baseName}" found in ${dir}`);
	}
	if (surplus.length > 0) {
		throw fail(`Multiple ${kind}s named "${baseName}" found in ${dir}: ${matches.join(", ")}`);
	}
	return join(dir, match);
}

/**
 * Removes the file in a folder whose name has the lecture date, if there is one.
 * All the lectures of the module share the video recording, slide deck and final
 * output folders, so such a folder is never cleared whole. `delete` calls this
 * function on each of the three folders. A `--from-stage` reset at or before
 * `pdf-generation` calls this function on `Final output/` (technical-design.md §4.7).
 *
 * @param args - The folder and the date.
 * @param args.dir - The folder to remove the file from.
 * @param args.lectureDate - The `YYYY-MM-DD` date of the lecture.
 * @returns A promise that resolves when the file is removed, or at once when no file has the date.
 */
export async function removeLectureFileByDate({
	dir,
	lectureDate,
}: LectureFileQuery): Promise<void> {
	const name = await findLectureFileByDate({ dir, lectureDate });
	if (name === null) {
		return;
	}
	await rm(join(dir, name), { force: true });
}

/**
 * Renames a file to a new base name, and keeps its extension.
 *
 * @param args - The file and its new base name.
 * @param args.dir - The folder that holds the file.
 * @param args.name - The file's name, or `null` when there is no file to rename.
 * @param args.baseName - The new name, without the extension.
 * @returns A promise that resolves when the file is renamed.
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
 * Moves a lecture to a new base name: its video recording, its slide deck, its
 * notes PDF and its workspace folder (technical-design.md §4.7).
 *
 * A missing file is skipped, because a lecture has no PDF until `pdf-generation`
 * runs. A caller that needs a file checks for it first, as `change-date` does for
 * the source pair.
 *
 * @param args - The lecture and its new base name.
 * @param args.dirs - The module's folders.
 * @param args.workspaceRoot - Absolute path to the lecture's workspace, before the move.
 * @param args.lectureDate - The `YYYY-MM-DD` date in the names of the lecture files.
 * @param args.baseName - The new base name.
 * @returns The new absolute path of the workspace.
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
	for (const dir of sharedLectureFileDirs({ dirs })) {
		await renameToBase({ dir, name: await findLectureFileByDate({ dir, lectureDate }), baseName });
	}
	const movedTo = join(dirname(workspaceRoot), baseName);
	await rename(workspaceRoot, movedTo);
	return movedTo;
}
