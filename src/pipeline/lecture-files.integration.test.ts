import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pathExists } from "../utils/files.js";
import { makeTempDir } from "./fixtures.js";
import { findDatedFile, renameLectureFiles } from "./lecture-files.js";
import { type ModuleDirs, moduleDirs } from "./stages/source-normalisation.js";

const FOLDER = "Lecture 1 - Cell Injury - 2025-10-10";
const NEW_BASE_NAME = "Lecture 1 - Innate Immune Response - 2025-10-10";
const LECTURE_DATE = "2025-10-10";

describe("lecture files", () => {
	let tempDir: string;
	let dirs: ModuleDirs;
	let workspaceRoot: string;

	/** Moves the lecture laid out in `beforeEach` onto {@link NEW_BASE_NAME}. */
	const renameToNewBase = (): Promise<string> =>
		renameLectureFiles({ dirs, workspaceRoot, lectureDate: LECTURE_DATE, baseName: NEW_BASE_NAME });

	beforeEach(async () => {
		tempDir = await makeTempDir({ prefix: "lecture-files-" });
		dirs = moduleDirs({ moduleRoot: join(tempDir, "Biology of Disease") });
		workspaceRoot = join(dirs.processing, FOLDER);

		for (const dir of [dirs.video, dirs.slide, dirs.finalOutput, workspaceRoot]) {
			await mkdir(dir, { recursive: true });
		}
		await writeFile(join(dirs.video, `${FOLDER}.mp4`), "video");
		await writeFile(join(dirs.slide, `${FOLDER}.pdf`), "slides");
		await writeFile(join(dirs.finalOutput, `${FOLDER}.pdf`), "notes");
		await writeFile(join(workspaceRoot, "manifest.json"), "{}");
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	describe("findDatedFile", () => {
		it("should return the file carrying the lecture date when the directory holds one", async () => {
			const found = await findDatedFile({ dir: dirs.video, lectureDate: LECTURE_DATE });

			expect(found).toBe(`${FOLDER}.mp4`);
		});

		it("should return null when no file carries the lecture date", async () => {
			const found = await findDatedFile({ dir: dirs.video, lectureDate: "2025-11-21" });

			expect(found).toBeNull();
		});

		it("should return null when the directory does not exist", async () => {
			const found = await findDatedFile({
				dir: join(tempDir, "no-such-directory"),
				lectureDate: LECTURE_DATE,
			});

			expect(found).toBeNull();
		});
	});

	describe("renameLectureFiles", () => {
		it.each([
			{ what: "source video", key: "video" as const, extension: ".mp4" },
			{ what: "source slide", key: "slide" as const, extension: ".pdf" },
			{ what: "final output PDF", key: "finalOutput" as const, extension: ".pdf" },
		])("should rename the $what when the lecture moves to a new base name", async ({
			key,
			extension,
		}) => {
			await renameToNewBase();

			expect(await pathExists(join(dirs[key], `${NEW_BASE_NAME}${extension}`))).toBe(true);
			expect(await pathExists(join(dirs[key], `${FOLDER}${extension}`))).toBe(false);
		});

		it("should move the workspace and everything in it when the lecture moves", async () => {
			await renameToNewBase();

			expect(await pathExists(join(dirs.processing, NEW_BASE_NAME, "manifest.json"))).toBe(true);
			expect(await pathExists(workspaceRoot)).toBe(false);
		});

		it("should return the workspace's new path when the lecture moves", async () => {
			const movedTo = await renameToNewBase();

			expect(movedTo).toBe(join(dirs.processing, NEW_BASE_NAME));
		});

		it("should skip the final output PDF when the lecture has none yet", async () => {
			await rm(join(dirs.finalOutput, `${FOLDER}.pdf`));

			await renameToNewBase();

			expect(await pathExists(join(dirs.video, `${NEW_BASE_NAME}.mp4`))).toBe(true);
			expect(await pathExists(join(dirs.finalOutput, `${NEW_BASE_NAME}.pdf`))).toBe(false);
		});

		it("should leave another lecture's files untouched when one lecture moves", async () => {
			const other = "Lecture 2 - Inflammation - 2025-10-17";
			await writeFile(join(dirs.video, `${other}.mp4`), "video");

			await renameToNewBase();

			expect(await pathExists(join(dirs.video, `${other}.mp4`))).toBe(true);
		});
	});
});
