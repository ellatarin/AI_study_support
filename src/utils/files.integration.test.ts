import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTempDir } from "../pipeline/fixtures.js";
import {
	cleanTmpFiles,
	listFileNames,
	listSubdirectoryNames,
	pathExists,
	produceFileAtomic,
	readDirSafe,
	readJsonSafe,
	writeFileAtomic,
	writeJsonAtomic,
} from "./files.js";

describe("files utilities", () => {
	const tempDir = useTempDir({ prefix: "files-" });

	describe("writeFileAtomic and cleanTmpFiles", () => {
		it("should write the file and remove the .tmp when the write succeeds", async () => {
			const target = join(tempDir(), "notes.md");

			await writeFileAtomic({ path: target, content: "hello" });

			expect(await readFile(target, "utf8")).toBe("hello");
			await expect(access(`${target}.tmp`)).rejects.toThrow();
		});

		it("should delete every .tmp file when cleanTmpFiles runs", async () => {
			await writeFile(join(tempDir(), "a.tmp"), "");
			await writeFile(join(tempDir(), "b.tmp"), "");
			await writeFile(join(tempDir(), "keep.md"), "content");

			await cleanTmpFiles(tempDir());

			await expect(access(join(tempDir(), "a.tmp"))).rejects.toThrow();
			await expect(access(join(tempDir(), "b.tmp"))).rejects.toThrow();
			await expect(access(join(tempDir(), "keep.md"))).resolves.toBeUndefined();
		});
	});

	describe("writeJsonAtomic", () => {
		it("should write the value as indented JSON when a value is given", async () => {
			const target = join(tempDir(), "record.json");

			await writeJsonAtomic({ path: target, value: { version: "1", stages: {} } });

			expect(await readFile(target, "utf8")).toBe('{\n  "version": "1",\n  "stages": {}\n}');
		});
	});

	// One rule, and it is the reason all three writers exist: the real path never
	// holds partial output. Each writer is driven at a path whose parent
	// directory is absent, which is what makes the underlying write fail — for
	// produceFileAtomic that failure arrives from the producer, which is the only
	// way it can fail.
	describe("the atomic writers", () => {
		it.each([
			{
				writer: "writeFileAtomic",
				write: (path: string) => writeFileAtomic({ path, content: "data" }),
			},
			{ writer: "writeJsonAtomic", write: (path: string) => writeJsonAtomic({ path, value: {} }) },
			{
				writer: "produceFileAtomic",
				write: (path: string) =>
					produceFileAtomic({ path, produce: (tmpPath) => writeFile(tmpPath, "data") }),
			},
		])("should leave no file behind when a $writer write fails", async ({ write }) => {
			const target = join(tempDir(), "missing-subdir", "notes.md");

			await expect(write(target)).rejects.toThrow();

			await expect(access(target)).rejects.toThrow();
			await expect(access(`${target}.tmp`)).rejects.toThrow();
		});
	});

	describe("produceFileAtomic", () => {
		it("should hand the producer the tmp path and rename it onto the target when the producer succeeds", async () => {
			const target = join(tempDir(), "audio.m4a");
			const produce = vi.fn((tmpPath: string) => writeFile(tmpPath, "bytes"));

			await produceFileAtomic({ path: target, produce });

			expect(produce).toHaveBeenCalledWith(`${target}.tmp`);
			expect(await readFile(target, "utf8")).toBe("bytes");
			await expect(access(`${target}.tmp`)).rejects.toThrow();
		});
	});

	// One rule shared by all three: a directory that is not there is not an error
	// to raise, because every caller is scanning somewhere optional.
	describe("the directory listings", () => {
		it.each([
			{ listing: "readDirSafe", list: readDirSafe },
			{ listing: "listFileNames", list: listFileNames },
			{ listing: "listSubdirectoryNames", list: listSubdirectoryNames },
		])("should return nothing when $listing is given a missing directory", async ({ list }) => {
			expect(await list(join(tempDir(), "absent"))).toEqual([]);
		});

		describe("over a directory holding a file, a dotfile and a subdirectory", () => {
			const FILE_NAME = "notes.md";
			const DOTFILE_NAME = ".DS_Store";
			const SUBDIRECTORY_NAME = "Audio";

			beforeEach(async () => {
				await writeFile(join(tempDir(), FILE_NAME), "");
				await writeFile(join(tempDir(), DOTFILE_NAME), "");
				await mkdir(join(tempDir(), SUBDIRECTORY_NAME));
			});

			it("should list the files, leaving out the dotfile and the subdirectory, when listFileNames runs", async () => {
				expect(await listFileNames(tempDir())).toEqual([FILE_NAME]);
			});

			it("should list only the subdirectory when listSubdirectoryNames runs", async () => {
				expect(await listSubdirectoryNames(tempDir())).toEqual([SUBDIRECTORY_NAME]);
			});

			it("should report every entry with its kind when readDirSafe reads the directory", async () => {
				const entries = await readDirSafe(tempDir());

				expect(
					entries
						.filter((entry) => entry.isFile())
						.map((entry) => entry.name)
						.sort(),
				).toEqual([DOTFILE_NAME, FILE_NAME]);
				expect(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)).toEqual([
					SUBDIRECTORY_NAME,
				]);
			});
		});
	});

	describe("readJsonSafe", () => {
		it("should return the parsed value when the file holds JSON", async () => {
			const target = join(tempDir(), "record.json");
			await writeJsonAtomic({ path: target, value: { runId: "a-run" } });

			expect(await readJsonSafe(target)).toEqual({ runId: "a-run" });
		});

		it.each([
			{ scenario: "the file is not there", content: null },
			{ scenario: "the file is not JSON", content: "{ not json" },
		])("should return null when $scenario", async ({ content }) => {
			const target = join(tempDir(), "record.json");
			if (content !== null) {
				await writeFile(target, content);
			}

			expect(await readJsonSafe(target)).toBeNull();
		});
	});

	describe("pathExists", () => {
		it("should report the path as present when a file is on disk", async () => {
			const target = join(tempDir(), "notes.md");
			await writeFile(target, "content");

			expect(await pathExists(target)).toBe(true);
		});

		it("should report the path as present when a directory is on disk", async () => {
			expect(await pathExists(tempDir())).toBe(true);
		});

		it("should report the path as absent when nothing is on disk", async () => {
			expect(await pathExists(join(tempDir(), "never-written.md"))).toBe(false);
		});
	});
});
