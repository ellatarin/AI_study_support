import { access, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../pipeline/fixtures.js";
import {
	cleanTmpFiles,
	ManifestPathError,
	pathExists,
	resolveManifestPath,
	writeFileAtomic,
} from "./files.js";

describe("files utilities", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await makeTempDir({ prefix: "files-" });
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	describe("writeFileAtomic and cleanTmpFiles", () => {
		it("should write the file and remove the .tmp when the write succeeds", async () => {
			const target = join(tempDir, "notes.md");

			await writeFileAtomic({ path: target, content: "hello" });

			expect(await readFile(target, "utf8")).toBe("hello");
			await expect(access(`${target}.tmp`)).rejects.toThrow();
		});

		it("should leave no file behind when the write fails", async () => {
			const target = join(tempDir, "missing-subdir", "notes.md");

			await expect(writeFileAtomic({ path: target, content: "data" })).rejects.toThrow();

			await expect(access(target)).rejects.toThrow();
			await expect(access(`${target}.tmp`)).rejects.toThrow();
		});

		it("should delete every .tmp file when cleanTmpFiles runs", async () => {
			await writeFile(join(tempDir, "a.tmp"), "");
			await writeFile(join(tempDir, "b.tmp"), "");
			await writeFile(join(tempDir, "keep.md"), "content");

			await cleanTmpFiles(tempDir);

			await expect(access(join(tempDir, "a.tmp"))).rejects.toThrow();
			await expect(access(join(tempDir, "b.tmp"))).rejects.toThrow();
			await expect(access(join(tempDir, "keep.md"))).resolves.toBeUndefined();
		});
	});

	describe("pathExists", () => {
		it("should report the path as present when a file is on disk", async () => {
			const target = join(tempDir, "notes.md");
			await writeFile(target, "content");

			expect(await pathExists(target)).toBe(true);
		});

		it("should report the path as present when a directory is on disk", async () => {
			expect(await pathExists(tempDir)).toBe(true);
		});

		it("should report the path as absent when nothing is on disk", async () => {
			expect(await pathExists(join(tempDir, "never-written.md"))).toBe(false);
		});
	});

	describe("resolveManifestPath", () => {
		let moduleRoot: string;
		let workspaceRoot: string;
		let outsideDir: string;

		beforeEach(async () => {
			moduleRoot = join(tempDir, "Biology of Disease");
			workspaceRoot = join(moduleRoot, "Lecture 1");
			outsideDir = join(tempDir, "outside");

			await mkdir(join(workspaceRoot, "Audio"), { recursive: true });
			await mkdir(join(moduleRoot, "Final output"), { recursive: true });
			await mkdir(outsideDir, { recursive: true });
			await symlink(outsideDir, join(workspaceRoot, "escape"), "dir");
		});

		it.each([
			{ description: "a path within the workspace", entry: "Audio/audio.m4a", leaf: "audio.m4a" },
			{
				description: "a ..-escape into Final output under moduleRoot",
				entry: "../Final output/notes.pdf",
				leaf: "notes.pdf",
			},
			{ description: "the module root itself", entry: "..", leaf: "Biology of Disease" },
		])("should return a path under moduleRoot when the entry is $description", async ({
			entry,
			leaf,
		}) => {
			const result = await resolveManifestPath({ workspaceRoot, moduleRoot, entry });

			const moduleRootReal = await realpath(moduleRoot);
			expect(result.startsWith(moduleRootReal)).toBe(true);
			expect(result.endsWith(leaf)).toBe(true);
		});

		it.each([
			{
				description: "a ..-escape resolves outside moduleRoot",
				makeEntry: () => "../../outside.txt",
			},
			{
				description: "an absolute path outside moduleRoot",
				makeEntry: () => join(outsideDir, "secret.txt"),
			},
			{
				description: "a symlink resolves outside moduleRoot",
				makeEntry: () => "escape/secret.txt",
			},
		])("should throw ManifestPathError when $description", async ({ makeEntry }) => {
			await expect(
				resolveManifestPath({ workspaceRoot, moduleRoot, entry: makeEntry() }),
			).rejects.toThrow(ManifestPathError);
		});

		it("should rethrow a non-ENOENT error when a path segment is a file, not a directory", async () => {
			await writeFile(join(workspaceRoot, "blocker"), "");

			await expect(
				resolveManifestPath({ workspaceRoot, moduleRoot, entry: "blocker/child/notes.txt" }),
			).rejects.toThrow();
		});
	});
});
