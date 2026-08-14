import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STAGE_IDS } from "../types/pipeline.js";
import {
	MANIFEST_FILE,
	moduleDirs,
	RUNS_DIR,
	STAGE_WORKSPACE,
	stageOutputEntry,
	stageOutputPath,
} from "./layout.js";

const MODULE_ROOT = join("/modules", "Biology of Disease");
const WORKSPACE_ROOT = join(
	MODULE_ROOT,
	"Pipeline processing",
	"Lecture 1 - Cell Injury - 2025-10-10",
);

describe("moduleDirs", () => {
	it.each([
		{ key: "video" as const, expected: join("Source files", "Video files") },
		{ key: "slide" as const, expected: join("Source files", "Lecture slides") },
		{ key: "processing" as const, expected: "Pipeline processing" },
		{ key: "finalOutput" as const, expected: "Final output" },
	])("should place $key under the module root when the module is resolved", ({ key, expected }) => {
		expect(moduleDirs({ moduleRoot: MODULE_ROOT })[key]).toBe(join(MODULE_ROOT, expected));
	});
});

describe("STAGE_WORKSPACE", () => {
	it("should describe every stage when the pipeline is enumerated", () => {
		expect(Object.keys(STAGE_WORKSPACE).sort()).toStrictEqual([...STAGE_IDS].sort());
	});

	it("should give source-normalisation no workspace directory when it owns none", () => {
		expect(STAGE_WORKSPACE["source-normalisation"].directories).toStrictEqual([]);
	});
});

describe("stageOutputEntry", () => {
	it.each([
		{ stageId: "audio-extraction" as const, expected: join("Audio", "audio.m4a") },
		{ stageId: "transcription" as const, expected: join("Transcript", "transcript.txt") },
		{
			stageId: "transcript-structuring" as const,
			expected: join("Structured transcript", "structured-transcript.md"),
		},
	])("should give the workspace-relative output of $stageId when it writes a single file", ({
		stageId,
		expected,
	}) => {
		expect(stageOutputEntry(stageId)).toBe(expected);
	});

	it("should fail when the stage writes no single output file", () => {
		expect(() => stageOutputEntry("qa-loop")).toThrow(/qa-loop/);
	});
});

describe("stageOutputPath", () => {
	it("should resolve the stage's output under the workspace when a workspace is given", () => {
		expect(stageOutputPath({ workspaceRoot: WORKSPACE_ROOT, stageId: "transcription" })).toBe(
			join(WORKSPACE_ROOT, "Transcript", "transcript.txt"),
		);
	});
});

describe("workspace filenames", () => {
	it.each([
		{ name: "MANIFEST_FILE", value: MANIFEST_FILE, expected: "manifest.json" },
		{ name: "RUNS_DIR", value: RUNS_DIR, expected: "runs" },
	])("should declare $name once when the layout is read", ({ value, expected }) => {
		expect(value).toBe(expected);
	});
});
