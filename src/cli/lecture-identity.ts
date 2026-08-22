/**
 * The filesystem half of the identity-mutation commands — `rename`, `delete`,
 * and `change-date`.
 *
 * A lecture's identity is spread across four places: its source video, its
 * slides, its pipeline workspace, and its finished PDF. Editing any of them by
 * hand desynchronises the manifest from the filesystem, so these commands are
 * the only supported way to change it. Each makes its change and leaves the
 * module in a state Stage 0 can finish — renumbering, and renaming anything the
 * change made stale (technical-design.md §4.7).
 */

import { rm } from "node:fs/promises";
import { join } from "node:path";
import { type ModuleDirs, moduleDirs } from "../pipeline/layout.js";
import {
	baseNameForLecture,
	findDatedFile,
	renameLectureFiles,
} from "../pipeline/lecture-files.js";
import { readManifest, writeManifest } from "../pipeline/manifest.js";
import type { LectureMatch, RunManifest } from "../types/pipeline.js";
import { errorMessage, NamedError } from "../utils/errors.js";
import { filenameSafe } from "../utils/naming.js";

/**
 * Thrown when a lecture's identity cannot be changed: an unusable new title, a
 * lecture whose sources are missing, or a target date whose files already exist.
 * The command makes no change when it throws (technical-design.md §8).
 */
export class LectureIdentityError extends NamedError {}

/**
 * Opens a lecture for change: where its files live, and what its manifest
 * currently says about it. Every change needs both.
 *
 * @param match - The lecture, as resolved from its date.
 * @returns The lecture's module directories and its manifest.
 * @throws Rethrows the filesystem error when the manifest cannot be read.
 */
async function openLecture(match: LectureMatch): Promise<{
	readonly dirs: ModuleDirs;
	readonly manifest: RunManifest;
}> {
	return {
		dirs: moduleDirs({ moduleRoot: match.moduleRoot }),
		manifest: await readManifest({ workspaceRoot: match.workspaceRoot }),
	};
}

/**
 * Removes a file, if it is there at all.
 *
 * @param args - What to remove and where from.
 * @param args.dir - The directory holding the file.
 * @param args.name - The file name, or `null` when there is nothing to remove.
 * @returns A promise that resolves once the file is gone.
 */
async function removeIfPresent({
	dir,
	name,
}: {
	readonly dir: string;
	readonly name: string | null;
}): Promise<void> {
	if (name !== null) {
		await rm(join(dir, name), { force: true });
	}
}

/**
 * Sets a lecture's title to one the user chose.
 *
 * The title is recorded as `userTitle`, which outranks both the provisional
 * title and any title Stage 3 derives, so it survives every later run. Only the
 * manifest changes here: the renaming of the video, slides, workspace, and PDF
 * falls out of the Stage 0 pass the command runs afterwards, which is the same
 * code path that names them in the first place (technical-design.md §5, Stage 0).
 *
 * @param args - The lecture and its new title.
 * @param args.workspaceRoot - Absolute path to the lecture's workspace.
 * @param args.title - The title the user chose.
 * @returns A promise that resolves once the manifest records the new title.
 * @throws {LectureIdentityError} When the title has no characters usable in a filename.
 */
export async function renameLecture({
	workspaceRoot,
	title,
}: {
	readonly workspaceRoot: string;
	readonly title: string;
}): Promise<void> {
	try {
		filenameSafe(title);
	} catch (error: unknown) {
		throw new LectureIdentityError(
			`"${title}" cannot be used as a lecture title: ${errorMessage(error)}`,
		);
	}
	const manifest = await readManifest({ workspaceRoot });
	await writeManifest({
		workspaceRoot,
		manifest: {
			...manifest,
			userTitle: title,
			lectureTitle: title,
			updatedAt: new Date().toISOString(),
		},
	});
}

/**
 * Removes a lecture entirely: its source video and slides, its workspace and
 * everything the pipeline produced in it, and its finished PDF.
 *
 * Deleting the sources as well as the workspace is what keeps the module
 * consistent — a workspace left without sources is an orphan Stage 0 would stop
 * to ask about, and sources left without a workspace would simply be normalised
 * back into one. The renumbering of the lectures that follow falls out of the
 * Stage 0 pass the command runs afterwards (technical-design.md §4.7, §5).
 *
 * @param args - The lecture to remove.
 * @param args.match - The lecture, as resolved from its date.
 * @returns A promise that resolves once every trace of the lecture is gone.
 */
export async function deleteLecture({ match }: { readonly match: LectureMatch }): Promise<void> {
	const {
		dirs,
		manifest: { lectureDate },
	} = await openLecture(match);
	for (const dir of [dirs.video, dirs.slide, dirs.finalOutput]) {
		await removeIfPresent({ dir, name: await findDatedFile({ dir, lectureDate }) });
	}
	await rm(match.workspaceRoot, { recursive: true, force: true });
}

/**
 * Insists a lecture still has both its sources before its date is changed: a
 * lecture without both is not one Stage 0 produced, and moving half of it would
 * leave the module in a state normalisation would reject.
 *
 * @param args - Where to look and for which lecture.
 * @param args.dirs - The module's directories.
 * @param args.lectureDate - The lecture's current date.
 * @returns Nothing.
 * @throws {LectureIdentityError} When the source video or slide is missing.
 */
async function assertSourcePairPresent({
	dirs,
	lectureDate,
}: {
	readonly dirs: ModuleDirs;
	readonly lectureDate: string;
}): Promise<void> {
	const video = await findDatedFile({ dir: dirs.video, lectureDate });
	const slide = await findDatedFile({ dir: dirs.slide, lectureDate });
	if (video === null || slide === null) {
		throw new LectureIdentityError(
			`The lecture on ${lectureDate} has no source ${video === null ? "video" : "slide"}, so its date cannot be changed. Restore the file and try again.`,
		);
	}
}

/**
 * Fails when a source file already sits on the date being moved to, so a change
 * can never overwrite another lecture's sources (technical-design.md §4.7).
 *
 * The video and slide directories are the whole check. A lecture's date lives in
 * its source filenames, so a date another lecture holds is a date one of those
 * two directories already carries.
 *
 * @param args - The destination to check.
 * @param args.dirs - The module's directories.
 * @param args.newLectureDate - The date being moved to.
 * @returns Nothing.
 * @throws {LectureIdentityError} When a source video or slide already carries that date.
 */
async function assertDateIsFree({
	dirs,
	newLectureDate,
}: {
	readonly dirs: ModuleDirs;
	readonly newLectureDate: string;
}): Promise<void> {
	for (const dir of [dirs.video, dirs.slide]) {
		const occupant = await findDatedFile({ dir, lectureDate: newLectureDate });
		if (occupant !== null) {
			throw new LectureIdentityError(
				`"${occupant}" already carries the date ${newLectureDate}. Move or delete that lecture first.`,
			);
		}
	}
}

/**
 * Moves a lecture to another date: its source video and slides, its workspace,
 * its finished PDF, and the date recorded in its manifest.
 *
 * The files are given the name Stage 0 would give them at the new date, so the
 * Stage 0 pass the command runs afterwards has only the renumbering left to do —
 * and will rename them again if the new date changes the lecture's number
 * (technical-design.md §4.7, §5).
 *
 * @param args - The lecture and the date to move it to.
 * @param args.match - The lecture, as resolved from its current date.
 * @param args.newLectureDate - The `YYYY-MM-DD` date to move it to.
 * @returns A promise that resolves once the lecture sits at its new date.
 * @throws {LectureIdentityError} When the lecture's sources are missing, or the new date is already taken.
 */
export async function changeLectureDate({
	match,
	newLectureDate,
}: {
	readonly match: LectureMatch;
	readonly newLectureDate: string;
}): Promise<void> {
	const { dirs, manifest } = await openLecture(match);
	await assertSourcePairPresent({ dirs, lectureDate: manifest.lectureDate });
	await assertDateIsFree({ dirs, newLectureDate });

	const baseName = baseNameForLecture({
		lectureNumber: manifest.lectureNumber,
		title: manifest.lectureTitle,
		lectureDate: newLectureDate,
	});

	await writeManifest({
		workspaceRoot: match.workspaceRoot,
		manifest: {
			...manifest,
			lectureDate: newLectureDate,
			workspaceFolderName: baseName,
			updatedAt: new Date().toISOString(),
		},
	});
	await renameLectureFiles({
		dirs,
		workspaceRoot: match.workspaceRoot,
		lectureDate: manifest.lectureDate,
		baseName,
	});
}
