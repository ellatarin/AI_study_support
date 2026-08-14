import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	captureError,
	makeLectureTree,
	makeManifest,
	otherLecture,
	testLecture,
	userChosenTitle,
} from "../pipeline/fixtures.js";
import type { ModuleDirs } from "../pipeline/layout.js";
import { baseNameForLecture } from "../pipeline/lecture-files.js";
import { readManifest, writeManifest } from "../pipeline/manifest.js";
import type { LectureMatch } from "../types/pipeline.js";
import { pathExists } from "../utils/files.js";
import {
	changeLectureDate,
	deleteLecture,
	LectureIdentityError,
	renameLecture,
} from "./lecture-identity.js";

describe("lecture identity commands", () => {
	let tempDir: string;
	let dirs: ModuleDirs;
	let match: LectureMatch;

	beforeEach(async () => {
		let workspaceRoot: string;
		let moduleRoot: string;
		({ tempDir, moduleRoot, dirs, workspaceRoot } = await makeLectureTree({ prefix: "identity-" }));
		match = {
			moduleRoot,
			workspaceRoot,
			lectureNumber: testLecture.number,
			lectureTitle: testLecture.title,
		};

		await writeManifest({ workspaceRoot, manifest: makeManifest() });
		await writeFile(join(workspaceRoot, "notes.md"), "work in progress");
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	describe("renameLecture", () => {
		it.each([
			// The user's title wins the precedence, so it is recorded as both their own
			// and the effective one; the provisional title is history and stays put.
			{ field: "userTitle" as const, expected: userChosenTitle },
			{ field: "lectureTitle" as const, expected: userChosenTitle },
			{ field: "provisionalTitle" as const, expected: "Cell Injury" },
		])("should record $field as $expected when renaming", async ({ field, expected }) => {
			await renameLecture({ workspaceRoot: match.workspaceRoot, title: userChosenTitle });

			const manifest = await readManifest({ workspaceRoot: match.workspaceRoot });
			expect(manifest[field]).toBe(expected);
		});

		it("should leave the files for the renormalisation to rename when renaming", async () => {
			await renameLecture({ workspaceRoot: match.workspaceRoot, title: userChosenTitle });

			expect(await pathExists(join(dirs.video, `${testLecture.folderName}.mp4`))).toBe(true);
		});

		it("should reject the rename when the title has no usable characters", async () => {
			const error = await captureError(
				renameLecture({ workspaceRoot: match.workspaceRoot, title: ".." }),
			);

			expect(error).toBeInstanceOf(LectureIdentityError);
			expect(
				await (await readManifest({ workspaceRoot: match.workspaceRoot })).userTitle,
			).toBeNull();
		});
	});

	describe("deleteLecture", () => {
		it("should remove the source video and slide when deleting", async () => {
			await deleteLecture({ match });

			expect(await pathExists(join(dirs.video, `${testLecture.folderName}.mp4`))).toBe(false);
			expect(await pathExists(join(dirs.slide, `${testLecture.folderName}.pdf`))).toBe(false);
		});

		it("should remove the workspace and everything in it when deleting", async () => {
			await deleteLecture({ match });

			expect(await pathExists(match.workspaceRoot)).toBe(false);
		});

		it("should remove the final output when deleting", async () => {
			await deleteLecture({ match });

			expect(await pathExists(join(dirs.finalOutput, `${testLecture.folderName}.pdf`))).toBe(false);
		});

		it("should leave other lectures untouched when deleting", async () => {
			await writeFile(join(dirs.video, `${otherLecture.folderName}.mp4`), "video");

			await deleteLecture({ match });

			expect(await pathExists(join(dirs.video, `${otherLecture.folderName}.mp4`))).toBe(true);
		});

		it("should succeed when the lecture has produced no final output yet", async () => {
			await rm(join(dirs.finalOutput, `${testLecture.folderName}.pdf`));

			await expect(deleteLecture({ match })).resolves.toBeUndefined();
		});
	});

	describe("changeLectureDate", () => {
		const NEW_DATE = "2025-10-24";
		// The name Stage 0 would give this lecture at its new date, derived rather
		// than written out so the expectation follows the naming rule.
		const MOVED_FOLDER = baseNameForLecture({
			lectureNumber: testLecture.number,
			title: testLecture.title,
			lectureDate: NEW_DATE,
		});

		it("should record the new date in the manifest when changing the date", async () => {
			await changeLectureDate({ match, newLectureDate: NEW_DATE });

			const manifest = await readManifest({
				workspaceRoot: join(dirs.processing, MOVED_FOLDER),
			});
			expect(manifest.lectureDate).toBe("2025-10-24");
			expect(manifest.workspaceFolderName).toBe(MOVED_FOLDER);
		});

		it("should rename the source video and slide to the new date when changing the date", async () => {
			await changeLectureDate({ match, newLectureDate: NEW_DATE });

			expect(await pathExists(join(dirs.video, `${MOVED_FOLDER}.mp4`))).toBe(true);
			expect(await pathExists(join(dirs.slide, `${MOVED_FOLDER}.pdf`))).toBe(true);
			expect(await pathExists(join(dirs.video, `${testLecture.folderName}.mp4`))).toBe(false);
		});

		it("should rename the workspace to the new date when changing the date", async () => {
			await changeLectureDate({ match, newLectureDate: NEW_DATE });

			expect(await pathExists(join(dirs.processing, MOVED_FOLDER, "notes.md"))).toBe(true);
			expect(await pathExists(match.workspaceRoot)).toBe(false);
		});

		it("should rename the final output to the new date when changing the date", async () => {
			await changeLectureDate({ match, newLectureDate: NEW_DATE });

			expect(await pathExists(join(dirs.finalOutput, `${MOVED_FOLDER}.pdf`))).toBe(true);
			expect(await pathExists(join(dirs.finalOutput, `${testLecture.folderName}.pdf`))).toBe(false);
		});

		it("should succeed when the lecture has produced no final output yet", async () => {
			await rm(join(dirs.finalOutput, `${testLecture.folderName}.pdf`));

			await changeLectureDate({ match, newLectureDate: NEW_DATE });

			expect(await pathExists(join(dirs.video, `${MOVED_FOLDER}.mp4`))).toBe(true);
		});

		it("should reject the change when a source file already sits at the new date", async () => {
			await writeFile(join(dirs.video, `${MOVED_FOLDER}.mp4`), "another lecture");

			const error = await captureError(changeLectureDate({ match, newLectureDate: NEW_DATE }));

			expect(error).toBeInstanceOf(LectureIdentityError);
			expect(error.message).toContain("2025-10-24");
		});

		it("should leave the lecture untouched when the change is rejected", async () => {
			await writeFile(join(dirs.video, `${MOVED_FOLDER}.mp4`), "another lecture");

			await captureError(changeLectureDate({ match, newLectureDate: NEW_DATE }));

			expect(await pathExists(join(dirs.video, `${testLecture.folderName}.mp4`))).toBe(true);
			expect((await readManifest({ workspaceRoot: match.workspaceRoot })).lectureDate).toBe(
				"2025-10-10",
			);
		});

		it("should reject the change when the lecture's source video is missing", async () => {
			await rm(join(dirs.video, `${testLecture.folderName}.mp4`));

			const error = await captureError(changeLectureDate({ match, newLectureDate: NEW_DATE }));

			expect(error).toBeInstanceOf(LectureIdentityError);
		});
	});
});
