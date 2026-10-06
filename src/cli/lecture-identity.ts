/**
 * The changes to the manifest and the lecture files that `rename`, `delete` and
 * `change-date` make.
 *
 * Each function makes its change. Then normalisation finishes the work. It
 * renumbers the lectures, and it renames the lecture files that the change made
 * out of date (technical-design.md §4.7, "Identity-change commands").
 */

import { rm } from "node:fs/promises";
import { type ModuleDirs, moduleDirs, sharedLectureFileDirs } from "../pipeline/layout.js";
import {
	baseNameForLecture,
	findLectureFileByDate,
	removeLectureFileByDate,
	renameLectureFiles,
} from "../pipeline/lecture-files.js";
import { patchManifest, readManifest } from "../pipeline/manifest.js";
import type { LectureMatch, Manifest } from "../types/pipeline.js";
import { errorMessage, NamedError } from "../utils/errors.js";
import { filenameSafe } from "../utils/naming.js";

/**
 * The error for an identity change that cannot be made. The causes are:
 * - a title that cannot be a file name
 * - a missing video recording or slide deck
 * - a new date that a source file already has.
 *
 * When this error comes, the manifest and every lecture file are as they were.
 */
export class LectureIdentityError extends NamedError {}

/**
 * Gets the module directories and the manifest of a lecture.
 *
 * @param match - The lecture that the lecture date named.
 * @returns The lecture's module directories and its manifest.
 * @throws {import("../pipeline/manifest.js").ManifestUnreadableError} When the manifest is missing or cannot be read.
 * @throws {import("../pipeline/manifest.js").ManifestNotJsonError} When the manifest is not JSON.
 * @throws {import("../pipeline/manifest.js").ManifestShapeError} When the manifest describes no lecture.
 */
async function openLecture(match: LectureMatch): Promise<{
	readonly dirs: ModuleDirs;
	readonly manifest: Manifest;
}> {
	return {
		dirs: moduleDirs({ moduleRoot: match.moduleRoot }),
		manifest: await readManifest({ workspaceRoot: match.workspaceRoot }),
	};
}

/**
 * Writes a user title to the manifest, as `userTitle` and as `lectureTitle`. A
 * user title outranks the other titles, and nothing overwrites it.
 *
 * It changes only the manifest. The normalisation after it renames the lecture
 * files (technical-design.md §4.7, "Identity-change commands").
 *
 * @param args - The lecture and its new title.
 * @param args.workspaceRoot - The absolute path of the lecture's workspace.
 * @param args.title - The user title.
 * @returns A promise that resolves when the manifest holds the new title.
 * @throws {LectureIdentityError} When the title has no characters that a file name can use.
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
	await patchManifest({
		workspaceRoot,
		manifest,
		changes: { userTitle: title, lectureTitle: title },
		updatedAt: new Date().toISOString(),
	});
}

/**
 * Deletes all the lecture files of a lecture: its video recording, its slide
 * deck, its notes PDF and its workspace. It does not ask the user. The command
 * asks first.
 *
 * The function deletes the source pair and the workspace together, so
 * normalisation finds no orphaned workspace. The normalisation after it renumbers the later lectures
 * (technical-design.md §4.7, "Identity-change commands").
 *
 * @param args - The lecture.
 * @param args.match - The lecture that the lecture date named.
 * @returns A promise that resolves when the lecture files are deleted.
 */
export async function deleteLecture({ match }: { readonly match: LectureMatch }): Promise<void> {
	const {
		dirs,
		manifest: { lectureDate },
	} = await openLecture(match);
	for (const dir of sharedLectureFileDirs({ dirs })) {
		await removeLectureFileByDate({ dir, lectureDate });
	}
	await rm(match.workspaceRoot, { recursive: true, force: true });
}

/**
 * Checks that a lecture still has its source pair before its date changes. A
 * move of only half the pair would leave a video recording or a slide deck with
 * no match on its date. Normalisation would then stop.
 *
 * @param args - The directories and the lecture.
 * @param args.dirs - The module's directories.
 * @param args.lectureDate - The lecture's current date.
 * @returns Nothing.
 * @throws {LectureIdentityError} When the video recording or slide deck is missing.
 */
async function assertSourcePairPresent({
	dirs,
	lectureDate,
}: {
	readonly dirs: ModuleDirs;
	readonly lectureDate: string;
}): Promise<void> {
	const videoRecording = await findLectureFileByDate({ dir: dirs.videoRecording, lectureDate });
	const slideDeck = await findLectureFileByDate({ dir: dirs.slideDeck, lectureDate });
	if (videoRecording === null || slideDeck === null) {
		throw new LectureIdentityError(
			`The lecture on ${lectureDate} has no ${videoRecording === null ? "video recording" : "slide deck"}, so its date cannot be changed. Restore the file and try again.`,
		);
	}
}

/**
 * Refuses a new date that a source file already has, so the move cannot
 * overwrite another lecture (technical-design.md §4.7, "Identity-change commands").
 *
 * It checks only the video recording and slide deck directories. A lecture's
 * date is in the names of its source files, so a date in use is in one of them.
 *
 * @param args - The directories and the new date.
 * @param args.dirs - The module's directories.
 * @param args.newLectureDate - The new date.
 * @returns Nothing.
 * @throws {LectureIdentityError} When a video recording or slide deck already has that date.
 */
async function assertDateIsFree({
	dirs,
	newLectureDate,
}: {
	readonly dirs: ModuleDirs;
	readonly newLectureDate: string;
}): Promise<void> {
	for (const dir of [dirs.videoRecording, dirs.slideDeck]) {
		const occupant = await findLectureFileByDate({ dir, lectureDate: newLectureDate });
		if (occupant !== null) {
			throw new LectureIdentityError(
				`"${occupant}" already carries the date ${newLectureDate}. Move or delete that lecture first.`,
			);
		}
	}
}

/**
 * Moves a lecture to a new date. It writes the new date and base name to the
 * manifest, and renames the lecture files to that base name.
 *
 * The base name is the one that normalisation gives at the new date. So the
 * normalisation after it has only the renumbering to do (technical-design.md
 * §4.7, "Identity-change commands").
 *
 * @param args - The lecture and the new date.
 * @param args.match - The lecture that its current date named.
 * @param args.newLectureDate - The new `YYYY-MM-DD` date.
 * @returns A promise that resolves when the lecture is at its new date.
 * @throws {LectureIdentityError} When the source pair is not complete, or a source file already has the new date.
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

	await patchManifest({
		workspaceRoot: match.workspaceRoot,
		manifest,
		changes: { lectureDate: newLectureDate, baseName },
		updatedAt: new Date().toISOString(),
	});
	await renameLectureFiles({
		dirs,
		workspaceRoot: match.workspaceRoot,
		lectureDate: manifest.lectureDate,
		baseName,
	});
}
