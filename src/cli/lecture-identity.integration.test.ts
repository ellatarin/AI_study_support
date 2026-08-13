import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureError, makeManifest, makeTempDir } from "../pipeline/fixtures.js";
import { readManifest, writeManifest } from "../pipeline/manifest.js";
import type { LectureMatch } from "../types/pipeline.js";
import {
	changeLectureDate,
	deleteLecture,
	LectureIdentityError,
	renameLecture,
} from "./lecture-identity.js";

const FOLDER = "Lecture 1 - Cell Injury - 2025-10-10";
const NEW_TITLE = "Cell Injury and Death";

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

describe("lecture identity commands", () => {
	let tempDir: string;
	let moduleRoot: string;
	let match: LectureMatch;
	let videoDir: string;
	let slideDir: string;
	let outputDir: string;

	beforeEach(async () => {
		tempDir = await makeTempDir({ prefix: "identity-" });
		moduleRoot = join(tempDir, "Biology of Disease");
		videoDir = join(moduleRoot, "Source files", "Video files");
		slideDir = join(moduleRoot, "Source files", "Lecture slides");
		outputDir = join(moduleRoot, "Final output");
		const workspaceRoot = join(moduleRoot, "Pipeline processing", FOLDER);
		match = { moduleRoot, workspaceRoot, lectureNumber: 1, lectureTitle: "Cell Injury" };

		for (const dir of [videoDir, slideDir, outputDir]) {
			await mkdir(dir, { recursive: true });
		}
		await writeFile(join(videoDir, `${FOLDER}.mp4`), "video");
		await writeFile(join(slideDir, `${FOLDER}.pdf`), "slides");
		await writeFile(join(outputDir, `${FOLDER}.pdf`), "notes");
		await writeManifest({
			workspaceRoot,
			manifest: makeManifest({
				lectureNumber: 1,
				lectureDate: "2025-10-10",
				provisionalTitle: "Cell Injury",
				lectureTitle: "Cell Injury",
				workspaceFolderName: FOLDER,
			}),
		});
		await writeFile(join(workspaceRoot, "notes.md"), "work in progress");
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	describe("renameLecture", () => {
		it.each([
			// The user's title wins the precedence, so it is recorded as both their own
			// and the effective one; the provisional title is history and stays put.
			{ field: "userTitle" as const, expected: NEW_TITLE },
			{ field: "lectureTitle" as const, expected: NEW_TITLE },
			{ field: "provisionalTitle" as const, expected: "Cell Injury" },
		])("should record $field as $expected when renaming", async ({ field, expected }) => {
			await renameLecture({ workspaceRoot: match.workspaceRoot, title: NEW_TITLE });

			const manifest = await readManifest({ workspaceRoot: match.workspaceRoot });
			expect(manifest[field]).toBe(expected);
		});

		it("should leave the files for the renormalisation to rename when renaming", async () => {
			await renameLecture({ workspaceRoot: match.workspaceRoot, title: NEW_TITLE });

			expect(await exists(join(videoDir, `${FOLDER}.mp4`))).toBe(true);
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

			expect(await exists(join(videoDir, `${FOLDER}.mp4`))).toBe(false);
			expect(await exists(join(slideDir, `${FOLDER}.pdf`))).toBe(false);
		});

		it("should remove the workspace and everything in it when deleting", async () => {
			await deleteLecture({ match });

			expect(await exists(match.workspaceRoot)).toBe(false);
		});

		it("should remove the final output when deleting", async () => {
			await deleteLecture({ match });

			expect(await exists(join(outputDir, `${FOLDER}.pdf`))).toBe(false);
		});

		it("should leave other lectures untouched when deleting", async () => {
			const other = "Lecture 2 - Inflammation - 2025-10-17";
			await writeFile(join(videoDir, `${other}.mp4`), "video");

			await deleteLecture({ match });

			expect(await exists(join(videoDir, `${other}.mp4`))).toBe(true);
		});

		it("should succeed when the lecture has produced no final output yet", async () => {
			await rm(join(outputDir, `${FOLDER}.pdf`));

			await expect(deleteLecture({ match })).resolves.toBeUndefined();
		});
	});

	describe("changeLectureDate", () => {
		const NEW_FOLDER = "Lecture 1 - Cell Injury - 2025-10-24";

		it("should record the new date in the manifest when changing the date", async () => {
			await changeLectureDate({ match, newLectureDate: "2025-10-24" });

			const manifest = await readManifest({
				workspaceRoot: join(moduleRoot, "Pipeline processing", NEW_FOLDER),
			});
			expect(manifest.lectureDate).toBe("2025-10-24");
			expect(manifest.workspaceFolderName).toBe(NEW_FOLDER);
		});

		it("should rename the source video and slide to the new date when changing the date", async () => {
			await changeLectureDate({ match, newLectureDate: "2025-10-24" });

			expect(await exists(join(videoDir, `${NEW_FOLDER}.mp4`))).toBe(true);
			expect(await exists(join(slideDir, `${NEW_FOLDER}.pdf`))).toBe(true);
			expect(await exists(join(videoDir, `${FOLDER}.mp4`))).toBe(false);
		});

		it("should rename the workspace to the new date when changing the date", async () => {
			await changeLectureDate({ match, newLectureDate: "2025-10-24" });

			expect(await exists(join(moduleRoot, "Pipeline processing", NEW_FOLDER, "notes.md"))).toBe(
				true,
			);
			expect(await exists(match.workspaceRoot)).toBe(false);
		});

		it("should rename the final output to the new date when changing the date", async () => {
			await changeLectureDate({ match, newLectureDate: "2025-10-24" });

			expect(await exists(join(outputDir, `${NEW_FOLDER}.pdf`))).toBe(true);
			expect(await exists(join(outputDir, `${FOLDER}.pdf`))).toBe(false);
		});

		it("should succeed when the lecture has produced no final output yet", async () => {
			await rm(join(outputDir, `${FOLDER}.pdf`));

			await changeLectureDate({ match, newLectureDate: "2025-10-24" });

			expect(await exists(join(videoDir, `${NEW_FOLDER}.mp4`))).toBe(true);
		});

		it("should reject the change when a source file already sits at the new date", async () => {
			await writeFile(join(videoDir, `${NEW_FOLDER}.mp4`), "another lecture");

			const error = await captureError(changeLectureDate({ match, newLectureDate: "2025-10-24" }));

			expect(error).toBeInstanceOf(LectureIdentityError);
			expect(error.message).toContain("2025-10-24");
		});

		it("should leave the lecture untouched when the change is rejected", async () => {
			await writeFile(join(videoDir, `${NEW_FOLDER}.mp4`), "another lecture");

			await captureError(changeLectureDate({ match, newLectureDate: "2025-10-24" }));

			expect(await exists(join(videoDir, `${FOLDER}.mp4`))).toBe(true);
			expect((await readManifest({ workspaceRoot: match.workspaceRoot })).lectureDate).toBe(
				"2025-10-10",
			);
		});

		it("should reject the change when the lecture's source video is missing", async () => {
			await rm(join(videoDir, `${FOLDER}.mp4`));

			const error = await captureError(changeLectureDate({ match, newLectureDate: "2025-10-24" }));

			expect(error).toBeInstanceOf(LectureIdentityError);
		});
	});
});
