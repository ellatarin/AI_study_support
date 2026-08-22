import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../src/pipeline/fixtures.ts";
import { walk } from "./audit-constants.mjs";

describe("walk", () => {
	let tempDir = "";

	beforeEach(async () => {
		tempDir = await makeTempDir({ prefix: "audit-constants-" });
		await mkdir(join(tempDir, "nested"), { recursive: true });
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	/**
	 * Writes an empty file into the temporary tree.
	 *
	 * @param {string} relativePath - Where to write it, relative to the temp dir.
	 * @returns {Promise<void>} Resolves once written.
	 */
	async function write(relativePath) {
		await writeFile(join(tempDir, relativePath), "", "utf8");
	}

	it.each([
		"module.ts",
		"component.tsx",
		"script.mjs",
		"helper.js",
		"legacy.cjs",
	])("should find %s when it sits in the tree", async (name) => {
		await write(name);

		const found = walk(tempDir);

		expect(found).toEqual([join(tempDir, name)]);
	});

	it("should skip a declaration file when the tree holds one", async () => {
		await write("types.d.ts");

		const found = walk(tempDir);

		expect(found).toEqual([]);
	});

	it("should skip a file that is not code when the tree holds one", async () => {
		await write("notes.md");

		const found = walk(tempDir);

		expect(found).toEqual([]);
	});

	it("should descend into a subdirectory when the tree is nested", async () => {
		await write(join("nested", "deep.ts"));

		const found = walk(tempDir);

		expect(found).toEqual([join(tempDir, "nested", "deep.ts")]);
	});
});
