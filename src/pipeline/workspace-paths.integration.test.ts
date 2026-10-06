import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { testModuleName, useTempDir } from "./fixtures.js";
import { ManifestPathError, resolveManifestPath, workspacePath } from "./workspace-paths.js";

// Any absolute path will do. workspacePath only joins segments onto the root,
// so the value is not the subject of the test.
const TRUSTED_ROOT = "/workspace";

// The separators below are part of the test. Each expected path is written out.
// workspacePath calls `join`, so an expected path made with `join` would only
// test `join` against `join`. The written paths fix this suite to POSIX
// separators, which the rest of the code reads and writes. On Windows, `join`
// gives `\`, so each row fails. That failure is intentional, because the
// path separator on Windows is really different. This project targets macOS. If it must run on Windows,
// rewrite these expected paths.
describe("workspacePath", () => {
	it.each([
		{ segments: ["Audio", "audio.m4a"], expected: `${TRUSTED_ROOT}/Audio/audio.m4a` },
		{ segments: ["manifest.json"], expected: `${TRUSTED_ROOT}/manifest.json` },
		{
			segments: ["Slide content", "raw", "slide-01.png"],
			expected: `${TRUSTED_ROOT}/Slide content/raw/slide-01.png`,
		},
	])("should resolve a path under the workspace root when segments are $segments", ({
		segments,
		expected,
	}) => {
		expect(workspacePath({ workspaceRoot: TRUSTED_ROOT, segments })).toBe(expected);
	});

	it("should return the workspace root itself when no segments are given", () => {
		expect(workspacePath({ workspaceRoot: TRUSTED_ROOT, segments: [] })).toBe(TRUSTED_ROOT);
	});
});

describe("resolveManifestPath", () => {
	const tempDir = useTempDir({ prefix: "workspace-paths-" });
	let moduleRoot: string;
	let workspaceRoot: string;
	let outsideDir: string;

	beforeEach(async () => {
		moduleRoot = join(tempDir(), testModuleName);
		workspaceRoot = join(moduleRoot, "Lecture 1");
		outsideDir = join(tempDir(), "outside");

		// resolveManifestPath does not use the layout. It only tests if an entry
		// stays in moduleRoot. So the folders below are sample paths, written out
		// on purpose, and not the paths of the layout.
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
