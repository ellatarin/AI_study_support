import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RunManifest } from "../types/pipeline.js";
import { captureError, makeManifest, makeTempDir, testLecture } from "./fixtures.js";
import { MANIFEST_FILE, moduleDirs } from "./layout.js";
import { manifestPath, readManifest, readManifestSafe, writeManifest } from "./manifest.js";

describe("manifest I/O", () => {
	let workspaceRoot: string;

	beforeEach(async () => {
		workspaceRoot = await makeTempDir({ prefix: "manifest-" });
	});

	afterEach(async () => {
		await rm(workspaceRoot, { recursive: true, force: true });
	});

	async function writeRaw(content: string): Promise<void> {
		await writeFile(manifestPath({ workspaceRoot }), content);
	}

	describe("manifestPath", () => {
		// The one assertion here that must state the filename: it is what the
		// function under test is for, and deriving it would prove nothing.
		it("should resolve manifest.json inside the workspace when given a workspace root", () => {
			expect(manifestPath({ workspaceRoot })).toBe(join(workspaceRoot, "manifest.json"));
		});
	});

	describe("readManifest", () => {
		it("should return the parsed manifest when the workspace holds one", async () => {
			const manifest = makeManifest({ lectureNumber: 4, lectureTitle: "Immune System" });
			await writeRaw(JSON.stringify(manifest));

			expect(await readManifest({ workspaceRoot })).toEqual(manifest);
		});

		it("should reject when the manifest is missing", async () => {
			const error = await captureError(readManifest({ workspaceRoot }));

			expect(error.message).toContain("manifest.json");
		});
	});

	describe("readManifestSafe", () => {
		it("should return the parsed manifest when the workspace holds one", async () => {
			const manifest = makeManifest();
			await writeRaw(JSON.stringify(manifest));

			expect(await readManifestSafe({ workspaceRoot })).toEqual(manifest);
		});

		it.each([
			{ scenario: "the manifest is missing", content: null },
			{ scenario: "the manifest is malformed", content: "{ not json" },
		])("should return null when $scenario", async ({ content }) => {
			if (content !== null) {
				await writeRaw(content);
			}

			expect(await readManifestSafe({ workspaceRoot })).toBeNull();
		});

		it("should return null when the workspace directory does not exist", async () => {
			const missing = join(workspaceRoot, "absent");

			expect(await readManifestSafe({ workspaceRoot: missing })).toBeNull();
		});
	});

	describe("writeManifest", () => {
		it("should persist the manifest as formatted JSON when writing", async () => {
			const manifest = makeManifest({ lectureDate: "2025-11-03" });

			await writeManifest({ workspaceRoot, manifest });

			const written = await readFile(join(workspaceRoot, "manifest.json"), "utf8");
			expect(JSON.parse(written) as RunManifest).toEqual(manifest);
			expect(written).toContain('\n  "version"');
		});

		it("should leave no temporary file behind when the write succeeds", async () => {
			await writeManifest({ workspaceRoot, manifest: makeManifest() });

			expect(await readdir(workspaceRoot)).toEqual([MANIFEST_FILE]);
		});

		it("should create the workspace directory when it does not yet exist", async () => {
			// Nested as deeply as a real workspace, so the test exercises the depth
			// writeManifest actually has to create.
			const nested = join(
				moduleDirs({ moduleRoot: workspaceRoot }).processing,
				testLecture.folderName,
			);

			await writeManifest({ workspaceRoot: nested, manifest: makeManifest() });

			expect(await readManifest({ workspaceRoot: nested })).toEqual(makeManifest());
		});

		it("should replace an existing manifest when writing over one", async () => {
			await mkdir(workspaceRoot, { recursive: true });
			await writeManifest({ workspaceRoot, manifest: makeManifest({ lectureNumber: 1 }) });

			await writeManifest({ workspaceRoot, manifest: makeManifest({ lectureNumber: 2 }) });

			expect((await readManifest({ workspaceRoot })).lectureNumber).toBe(2);
		});
	});
});
