import { access, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempDir, testModuleName } from "../pipeline/fixtures.js";
import {
	cleanTmpFiles,
	ManifestPathError,
	pathExists,
	resolveManifestPath,
	writeFileAtomic,
	writeJsonAtomic,
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

	describe("writeJsonAtomic", () => {
		it("should write the value as indented JSON when a value is given", async () => {
			const target = join(tempDir, "record.json");

			await writeJsonAtomic({ path: target, value: { version: "1", stages: {} } });

			expect(await readFile(target, "utf8")).toBe('{\n  "version": "1",\n  "stages": {}\n}');
		});
	});

	// One rule, and it is the reason both writers exist: the real path never
	// holds partial output. Each writer is driven at a path whose parent
	// directory is absent, which is what makes the underlying write fail.
	describe("the atomic writers", () => {
		it.each([
			{
				writer: "writeFileAtomic",
				write: (path: string) => writeFileAtomic({ path, content: "data" }),
			},
			{ writer: "writeJsonAtomic", write: (path: string) => writeJsonAtomic({ path, value: {} }) },
		])("should leave no file behind when a $writer write fails", async ({ write }) => {
			const target = join(tempDir, "missing-subdir", "notes.md");

			await expect(write(target)).rejects.toThrow();

			await expect(access(target)).rejects.toThrow();
			await expect(access(`${target}.tmp`)).rejects.toThrow();
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
			moduleRoot = join(tempDir, testModuleName);
			workspaceRoot = join(moduleRoot, "Lecture 1");
			outsideDir = join(tempDir, "outside");

			// resolveManifestPath is layout-agnostic — it only decides whether an
			// entry stays under moduleRoot — so the directories below are sample
			// paths rather than the layout's, and are deliberately written out.
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
			{ description: "the module root itself", entry: "..", leaf: testModuleName },
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
