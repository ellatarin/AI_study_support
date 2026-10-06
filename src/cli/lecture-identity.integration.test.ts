import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	captureError,
	changedDate,
	makeLectureTree,
	makeManifest,
	otherLecture,
	testLecture,
	testUserTitle,
} from "../pipeline/fixtures.js";
import { type ModuleDirs, workspaceRootFor } from "../pipeline/layout.js";
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
			{ field: "userTitle" as const, expected: testUserTitle },
			{ field: "lectureTitle" as const, expected: testUserTitle },
			{ field: "provisionalTitle" as const, expected: testLecture.title },
		])("should record $field as $expected when renaming", async ({ field, expected }) => {
			await renameLecture({ workspaceRoot: match.workspaceRoot, title: testUserTitle });

			const manifest = await readManifest({ workspaceRoot: match.workspaceRoot });
			expect(manifest[field]).toBe(expected);
		});

		it("should leave the files for the renormalisation to rename when renaming", async () => {
			await renameLecture({ workspaceRoot: match.workspaceRoot, title: testUserTitle });

			expect(await pathExists(join(dirs.videoRecording, testLecture.videoRecordingFile))).toBe(
				true,
			);
		});

		it("should reject the rename when the title has no usable characters", async () => {
			const error = await captureError(
				renameLecture({ workspaceRoot: match.workspaceRoot, title: ".." }),
			);

			expect(error).toBeInstanceOf(LectureIdentityError);
			expect((await readManifest({ workspaceRoot: match.workspaceRoot })).userTitle).toBeNull();
		});
	});

	describe("deleteLecture", () => {
		// Thunks, because every path here is built from state the enclosing
		// beforeEach assigns, long after this table is read.
		it.each([
			{
				what: "the source video",
				path: () => join(dirs.videoRecording, testLecture.videoRecordingFile),
			},
			{ what: "the source slide", path: () => join(dirs.slideDeck, testLecture.slideDeckFile) },
			{ what: "the workspace and everything in it", path: () => match.workspaceRoot },
			{ what: "the final output", path: () => join(dirs.finalOutput, testLecture.finalOutputFile) },
		])("should remove $what when deleting", async ({ path }) => {
			await deleteLecture({ match });

			expect(await pathExists(path())).toBe(false);
		});

		it("should leave other lectures untouched when deleting", async () => {
			await writeFile(join(dirs.videoRecording, `${otherLecture.baseName}.mp4`), "video");

			await deleteLecture({ match });

			expect(await pathExists(join(dirs.videoRecording, `${otherLecture.baseName}.mp4`))).toBe(
				true,
			);
		});

		it("should succeed when the lecture has produced no final output yet", async () => {
			await rm(join(dirs.finalOutput, testLecture.finalOutputFile));

			await expect(deleteLecture({ match })).resolves.toBeUndefined();
		});
	});

	describe("changeLectureDate", () => {
		// The name `source-normalisation` would give this lecture at its new date, derived rather
		// than written out so the expectation follows the naming rule.
		const MOVED_BASE_NAME = baseNameForLecture({
			lectureNumber: testLecture.number,
			title: testLecture.title,
			lectureDate: changedDate,
		});

		/** Where that folder sits, once the module the lecture is in is known. */
		const movedWorkspaceRoot = (): string =>
			workspaceRootFor({ moduleRoot: match.moduleRoot, baseName: MOVED_BASE_NAME });

		/** The act every case here performs: move the lecture onto {@link changedDate}. */
		function changeDate(): Promise<void> {
			return changeLectureDate({ match, newLectureDate: changedDate });
		}

		it("should record the new date in the manifest when changing the date", async () => {
			await changeDate();

			const manifest = await readManifest({ workspaceRoot: movedWorkspaceRoot() });
			expect(manifest.lectureDate).toBe(changedDate);
			expect(manifest.baseName).toBe(MOVED_BASE_NAME);
		});

		// Each of the four things a lecture is on disk moves, and the name it left
		// stops existing. The workspace is checked through a file inside it, which
		// is what shows the contents moved rather than just the folder.
		it.each([
			{
				what: "the source video",
				moved: () => join(dirs.videoRecording, `${MOVED_BASE_NAME}.mp4`),
				left: () => join(dirs.videoRecording, testLecture.videoRecordingFile),
			},
			{
				what: "the source slide",
				moved: () => join(dirs.slideDeck, `${MOVED_BASE_NAME}.pdf`),
				left: () => join(dirs.slideDeck, testLecture.slideDeckFile),
			},
			{
				what: "the workspace",
				moved: () => join(movedWorkspaceRoot(), "notes.md"),
				left: () => match.workspaceRoot,
			},
			{
				what: "the final output",
				moved: () => join(dirs.finalOutput, `${MOVED_BASE_NAME}.pdf`),
				left: () => join(dirs.finalOutput, testLecture.finalOutputFile),
			},
		])("should rename $what to the new date when changing the date", async ({ moved, left }) => {
			await changeDate();

			expect(await pathExists(moved())).toBe(true);
			expect(await pathExists(left())).toBe(false);
		});

		it("should succeed when the lecture has produced no final output yet", async () => {
			await rm(join(dirs.finalOutput, testLecture.finalOutputFile));

			await changeDate();

			expect(await pathExists(join(dirs.videoRecording, `${MOVED_BASE_NAME}.mp4`))).toBe(true);
		});

		describe("with another lecture's file at the new date", () => {
			beforeEach(async () => {
				await writeFile(join(dirs.videoRecording, `${MOVED_BASE_NAME}.mp4`), "another lecture");
			});

			it("should reject the change when the move would overwrite it", async () => {
				const error = await captureError(changeDate());

				expect(error).toBeInstanceOf(LectureIdentityError);
				expect(error.message).toContain(changedDate);
			});

			it("should leave the lecture untouched when the change is rejected", async () => {
				await captureError(changeDate());

				expect(await pathExists(join(dirs.videoRecording, testLecture.videoRecordingFile))).toBe(
					true,
				);
				expect((await readManifest({ workspaceRoot: match.workspaceRoot })).lectureDate).toBe(
					testLecture.date,
				);
			});
		});

		it("should reject the change when the lecture's video recording is missing", async () => {
			await rm(join(dirs.videoRecording, testLecture.videoRecordingFile));

			const error = await captureError(changeDate());

			expect(error).toBeInstanceOf(LectureIdentityError);
		});
	});
});
