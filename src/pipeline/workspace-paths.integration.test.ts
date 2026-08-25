import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { testModuleName, useTempDir } from "./fixtures.js";
import { ManifestPathError, resolveManifestPath, workspacePath } from "./workspace-paths.js";

// Any absolute path would do: workspacePath only joins onto the root it is
// given, so the value is scaffolding rather than the subject.
const TRUSTED_ROOT = "/workspace";

// The separators below are not scaffolding. Each expected path is written out
// rather than built by calling `join`, which is what workspacePath itself
// calls: expectations derived the same way the function derives its answer
// assert `join` against `join`, so they state nothing about what a workspace
// path looks like and accept whatever the platform's `join` happens to return.
// Writing them out fixes this suite to POSIX separators, which is the form the
// rest of the codebase reads and writes. On Windows `join` returns `\` and
// every row here would fail — deliberately, because that is a real difference
// and not one to pass over in silence. This project targets macOS; if it ever
// has to run on Windows, these expectations are what needs rewriting.
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
