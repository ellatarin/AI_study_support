import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { workspacePath } from "./files.js";

// Any absolute path would do: workspacePath only joins onto the root it is
// given, so the value is scaffolding rather than the subject.
const WORKSPACE_ROOT = "/workspace";

describe("workspacePath", () => {
	it.each([
		{ segments: ["Audio", "audio.m4a"], expected: join(WORKSPACE_ROOT, "Audio", "audio.m4a") },
		{ segments: ["manifest.json"], expected: join(WORKSPACE_ROOT, "manifest.json") },
		{
			segments: ["Slide content", "raw", "slide-01.png"],
			expected: join(WORKSPACE_ROOT, "Slide content", "raw", "slide-01.png"),
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
