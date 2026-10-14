import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../src/pipeline/fixtures.ts";
import { MANIFEST_FILE } from "../src/pipeline/layout.ts";
import { migrateWorkspace } from "./migrate-lecture-data-to-one-pass.mjs";

const OLD_REWRITE = "Rewrites/subtopic-2-attempt-1.json";
const NEW_REWRITE = "Rewrites/subtopic-2.json";
const COPIED_REWRITE = "Rewrites (sonnet-5.5, w1)/subtopic-2-attempt-1.json";
const CHECK = "Checks/subtopic-2-attempt-1.json";

const rewrite = { subtopicId: 2, attemptNumber: 1, rewrittenSubtopic: ["Text."] };

const oldManifest = {
	lectureNumber: 3,
	lectureDate: "2026-03-04",
	stages: {
		transcription: { status: "pending" },
		"rewrite-subtopics": { status: "complete", round: 1, filesWritten: [OLD_REWRITE] },
		"check-rewrite-attempts": { status: "complete", round: 1, filesWritten: [CHECK] },
	},
};

const newManifest = {
	lectureNumber: 3,
	lectureDate: "2026-03-04",
	stages: {
		transcription: { status: "pending" },
		"rewrite-subtopics": { status: "complete", filesWritten: [NEW_REWRITE] },
	},
};

describe("migrateWorkspace", () => {
	let workspaceRoot = "";

	/**
	 * Reads a file of the workspace as text.
	 *
	 * @param {string} path - The path, relative to the workspace.
	 * @returns {Promise<string>} The text of the file.
	 */
	function readText(path) {
		return readFile(join(workspaceRoot, path), "utf8");
	}

	/**
	 * Writes a value as JSON to a file of the workspace, and makes its folder.
	 *
	 * @param {string} path - The path, relative to the workspace.
	 * @param {unknown} value - The value to write.
	 * @returns {Promise<void>} Resolves once the file is written.
	 */
	async function writeJson(path, value) {
		await mkdir(join(workspaceRoot, path, ".."), { recursive: true });
		await writeFile(join(workspaceRoot, path), JSON.stringify(value), "utf8");
	}

	beforeEach(async () => {
		workspaceRoot = await makeTempDir({ prefix: "migrate-lecture-data-" });
		await writeJson(MANIFEST_FILE, oldManifest);
		await writeJson(OLD_REWRITE, rewrite);
		await writeJson(COPIED_REWRITE, rewrite);
		await writeJson(CHECK, {});
	});

	afterEach(async () => {
		await rm(workspaceRoot, { recursive: true, force: true });
	});

	it("should list each change and change no file when apply is false", async () => {
		const before = await readText(MANIFEST_FILE);

		const changes = await migrateWorkspace({ workspaceRoot, apply: false });

		expect(changes).toEqual([
			`${MANIFEST_FILE}: remove the stage entry "check-rewrite-attempts"`,
			`${MANIFEST_FILE}: remove "round" from the stage entry "rewrite-subtopics"`,
			`${OLD_REWRITE} → ${NEW_REWRITE}, without "attemptNumber"`,
		]);
		expect(await readText(MANIFEST_FILE)).toBe(before);
		expect(await readdir(join(workspaceRoot, "Rewrites"))).toEqual(["subtopic-2-attempt-1.json"]);
	});

	it("should write the manifest with no check entry, no round and the new paths when apply is true", async () => {
		await migrateWorkspace({ workspaceRoot, apply: true });

		expect(JSON.parse(await readText(MANIFEST_FILE))).toStrictEqual(newManifest);
	});

	it("should rename each subtopic file and remove its attempt number when apply is true", async () => {
		await migrateWorkspace({ workspaceRoot, apply: true });

		expect(await readdir(join(workspaceRoot, "Rewrites"))).toEqual(["subtopic-2.json"]);
		expect(JSON.parse(await readText(NEW_REWRITE))).toStrictEqual({
			subtopicId: 2,
			rewrittenSubtopic: ["Text."],
		});
	});

	it("should leave a copied folder and the check folder as they are when apply is true", async () => {
		const copyBefore = await readText(COPIED_REWRITE);

		await migrateWorkspace({ workspaceRoot, apply: true });

		expect(await readText(COPIED_REWRITE)).toBe(copyBefore);
		expect(await readText(CHECK)).toBe("{}");
	});

	it("should list no change when the workspace was migrated before", async () => {
		await migrateWorkspace({ workspaceRoot, apply: true });

		const changes = await migrateWorkspace({ workspaceRoot, apply: true });

		expect(changes).toEqual([]);
	});
});
