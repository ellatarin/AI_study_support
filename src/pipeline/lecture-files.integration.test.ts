import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pathExists } from "../utils/files.js";
import { aiDerivedLecture, makeLectureTree, otherLecture, testLecture } from "./fixtures.js";
import { type ModuleDirs, workspaceRootFor } from "./layout.js";
import {
	findLectureFileByDate,
	removeLectureFileByDate,
	renameLectureFiles,
} from "./lecture-files.js";
import { manifestPath } from "./manifest.js";

describe("lecture files", () => {
	let tempDir: string;
	let moduleRoot: string;
	let dirs: ModuleDirs;
	let workspaceRoot: string;

	/** Where the lecture's workspace lands once it has been renamed. */
	const renamedWorkspaceRoot = (): string =>
		workspaceRootFor({ moduleRoot, baseName: aiDerivedLecture.baseName });

	/** Moves the lecture laid out in `beforeEach` onto the AI-derived name. */
	const renameToNewBase = (): Promise<string> =>
		renameLectureFiles({
			dirs,
			workspaceRoot,
			lectureDate: testLecture.date,
			baseName: aiDerivedLecture.baseName,
		});

	beforeEach(async () => {
		({ tempDir, moduleRoot, dirs, workspaceRoot } = await makeLectureTree({
			prefix: "lecture-files-",
		}));
		await writeFile(manifestPath({ workspaceRoot }), "{}");
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	describe("findLectureFileByDate", () => {
		it("should return the file carrying the lecture date when the directory holds one", async () => {
			const found = await findLectureFileByDate({
				dir: dirs.videoRecording,
				lectureDate: testLecture.date,
			});

			expect(found).toBe(testLecture.videoRecordingFile);
		});

		it("should return null when no file carries the lecture date", async () => {
			const found = await findLectureFileByDate({
				dir: dirs.videoRecording,
				lectureDate: "2025-11-21",
			});

			expect(found).toBeNull();
		});

		it("should return the file when its title carries a date of its own", async () => {
			// A base name puts the title before the date, and titles come from
			// lecturer filenames or `transcript-structuring`'s LLM — so one can name a date too.
			const lectureDate = "2025-12-05";
			const named = `Lecture 4 - Cohort 01-02-2019 Results - ${lectureDate}.mp4`;
			await writeFile(join(dirs.videoRecording, named), "");

			const found = await findLectureFileByDate({ dir: dirs.videoRecording, lectureDate });

			expect(found).toBe(named);
		});

		it("should return null when the directory does not exist", async () => {
			const found = await findLectureFileByDate({
				dir: join(tempDir, "no-such-directory"),
				lectureDate: testLecture.date,
			});

			expect(found).toBeNull();
		});
	});

	describe("removeLectureFileByDate", () => {
		beforeEach(async () => {
			await writeFile(join(dirs.videoRecording, otherLecture.videoRecordingFile), "video");
		});

		it.each([
			{ given: "the lecture's own date", lectureDate: testLecture.date, remains: false },
			{ given: "a date no file carries", lectureDate: "2025-11-21", remains: true },
		])("should take only the file carrying the date when $given is passed", async ({
			lectureDate,
			remains,
		}) => {
			await removeLectureFileByDate({ dir: dirs.videoRecording, lectureDate });

			expect(await pathExists(join(dirs.videoRecording, testLecture.videoRecordingFile))).toBe(
				remains,
			);
			expect(await pathExists(join(dirs.videoRecording, otherLecture.videoRecordingFile))).toBe(
				true,
			);
		});
	});

	describe("renameLectureFiles", () => {
		it.each([
			{ what: "video recording", key: "videoRecording" as const, extension: ".mp4" },
			{ what: "slide deck", key: "slideDeck" as const, extension: ".pdf" },
			{ what: "final output PDF", key: "finalOutput" as const, extension: ".pdf" },
		])("should rename the $what when the lecture moves to a new base name", async ({
			key,
			extension,
		}) => {
			await renameToNewBase();

			expect(await pathExists(join(dirs[key], `${aiDerivedLecture.baseName}${extension}`))).toBe(
				true,
			);
			expect(await pathExists(join(dirs[key], `${testLecture.baseName}${extension}`))).toBe(false);
		});

		it("should move the workspace and everything in it when the lecture moves", async () => {
			await renameToNewBase();

			expect(await pathExists(manifestPath({ workspaceRoot: renamedWorkspaceRoot() }))).toBe(true);
			expect(await pathExists(workspaceRoot)).toBe(false);
		});

		it("should return the workspace's new path when the lecture moves", async () => {
			const movedTo = await renameToNewBase();

			expect(movedTo).toBe(renamedWorkspaceRoot());
		});

		it("should skip the final output PDF when the lecture has none yet", async () => {
			await rm(join(dirs.finalOutput, testLecture.finalOutputFile));

			await renameToNewBase();

			expect(await pathExists(join(dirs.videoRecording, `${aiDerivedLecture.baseName}.mp4`))).toBe(
				true,
			);
			expect(await pathExists(join(dirs.finalOutput, `${aiDerivedLecture.baseName}.pdf`))).toBe(
				false,
			);
		});

		it("should leave another lecture's files untouched when one lecture moves", async () => {
			await writeFile(join(dirs.videoRecording, otherLecture.videoRecordingFile), "video");

			await renameToNewBase();

			expect(await pathExists(join(dirs.videoRecording, otherLecture.videoRecordingFile))).toBe(
				true,
			);
		});
	});
});
