import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { workspacePath } from "./files.js";

describe("workspacePath", () => {
	it.each([
		{ segments: ["Audio", "audio.m4a"], expected: join("/workspace", "Audio", "audio.m4a") },
		{ segments: ["manifest.json"], expected: join("/workspace", "manifest.json") },
		{
			segments: ["Slide content", "raw", "slide-01.png"],
			expected: join("/workspace", "Slide content", "raw", "slide-01.png"),
		},
	])("should resolve a path under the workspace root when segments are $segments", ({
		segments,
		expected,
	}) => {
		expect(workspacePath({ workspaceRoot: "/workspace", segments })).toBe(expected);
	});

	it("should return the workspace root itself when no segments are given", () => {
		expect(workspacePath({ workspaceRoot: "/workspace", segments: [] })).toBe("/workspace");
	});
});
