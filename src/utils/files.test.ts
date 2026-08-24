import { describe, expect, it } from "vitest";
import { workspacePath } from "./files.js";

// Any absolute path would do: workspacePath only joins onto the root it is
// given, so the value is scaffolding rather than the subject.
const WORKSPACE_ROOT = "/workspace";

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
		{ segments: ["Audio", "audio.m4a"], expected: `${WORKSPACE_ROOT}/Audio/audio.m4a` },
		{ segments: ["manifest.json"], expected: `${WORKSPACE_ROOT}/manifest.json` },
		{
			segments: ["Slide content", "raw", "slide-01.png"],
			expected: `${WORKSPACE_ROOT}/Slide content/raw/slide-01.png`,
		},
	])("should resolve a path under the workspace root when segments are $segments", ({
		segments,
		expected,
	}) => {
		expect(workspacePath({ workspaceRoot: WORKSPACE_ROOT, segments })).toBe(expected);
	});

	it("should return the workspace root itself when no segments are given", () => {
		expect(workspacePath({ workspaceRoot: WORKSPACE_ROOT, segments: [] })).toBe(WORKSPACE_ROOT);
	});
});
