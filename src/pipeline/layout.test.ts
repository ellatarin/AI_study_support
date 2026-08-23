import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STAGE_IDS } from "../types/pipeline.js";
import { testLecture, testModuleName, testModuleRoot } from "./fixtures.js";
import {
	datedFileDirs,
	MANIFEST_FILE,
	moduleDirs,
	moduleName,
	moduleRootOf,
	RUNS_DIR,
	runsDirPath,
	STAGE_WORKSPACE,
	stageDirectoryPaths,
	stageOutputEntry,
	stageOutputPath,
} from "./layout.js";

// The roots are arbitrary inputs — this suite asserts the *names* layout.ts
// puts under them, and those stay written out below because verifying them
// against layout.ts itself would prove nothing. Each name is written out once
// here and read by every case that expects it.
const MODULE_ROOT = testModuleRoot;
const VIDEO_DIR = join(MODULE_ROOT, "Source files", "Video files");
const SLIDE_DIR = join(MODULE_ROOT, "Source files", "Lecture slides");
const PROCESSING_DIR = join(MODULE_ROOT, "Pipeline processing");
const FINAL_OUTPUT_DIR = join(MODULE_ROOT, "Final output");
const WORKSPACE_ROOT = join(PROCESSING_DIR, testLecture.folderName);

describe("moduleDirs", () => {
	it.each([
		{ key: "video" as const, expected: VIDEO_DIR },
		{ key: "slide" as const, expected: SLIDE_DIR },
		{ key: "processing" as const, expected: PROCESSING_DIR },
		{ key: "finalOutput" as const, expected: FINAL_OUTPUT_DIR },
	])("should place $key under the module root when the module is resolved", ({ key, expected }) => {
		expect(moduleDirs({ moduleRoot: MODULE_ROOT })[key]).toBe(expected);
	});
});

describe("datedFileDirs", () => {
	it("should give the directories a lecture's own files sit in when a module is given", () => {
		expect(datedFileDirs({ dirs: moduleDirs({ moduleRoot: MODULE_ROOT }) })).toStrictEqual([
			VIDEO_DIR,
			SLIDE_DIR,
			FINAL_OUTPUT_DIR,
		]);
	});
});

describe("runsDirPath", () => {
	it("should resolve the run logs under the workspace when a workspace is given", () => {
		expect(runsDirPath({ workspaceRoot: WORKSPACE_ROOT })).toBe(join(WORKSPACE_ROOT, "runs"));
	});
});

describe("moduleRootOf", () => {
	it("should resolve back to the module when a workspace beneath it is given", () => {
		expect(moduleRootOf({ workspaceRoot: WORKSPACE_ROOT })).toBe(MODULE_ROOT);
	});
});

describe("moduleName", () => {
	it("should name a module by its directory leaf when its root is given", () => {
		expect(moduleName({ moduleRoot: MODULE_ROOT })).toBe(testModuleName);
	});
});

describe("STAGE_WORKSPACE", () => {
	it("should describe every stage when the pipeline is enumerated", () => {
		expect(Object.keys(STAGE_WORKSPACE).sort()).toStrictEqual([...STAGE_IDS].sort());
	});

	it("should give source-normalisation no workspace directory when it owns none", () => {
		expect(STAGE_WORKSPACE["source-normalisation"].directories).toStrictEqual([]);
	});

	it("should root every directory but pdf-generation's in the workspace when ownership is read", () => {
		const moduleRooted = STAGE_IDS.filter((stageId) =>
			STAGE_WORKSPACE[stageId].directories.some((directory) => directory.root === "module"),
		);

		expect(moduleRooted).toStrictEqual(["pdf-generation"]);
	});
});

describe("stageDirectoryPaths", () => {
	it.each([
		{
			stageId: "qa-loop" as const,
			scenario: "the quality-checked notes it writes alongside its iterations",
			expected: [join(WORKSPACE_ROOT, "QA iterations"), join(WORKSPACE_ROOT, "QA checked")],
		},
		{
			stageId: "pdf-generation" as const,
			scenario: "the module directory its PDF is deposited in",
			expected: [FINAL_OUTPUT_DIR],
		},
		{
			stageId: "source-normalisation" as const,
			scenario: "no directory at all",
			expected: [],
		},
	])("should locate $scenario when $stageId owns it", ({ stageId, expected }) => {
		expect(stageDirectoryPaths({ workspaceRoot: WORKSPACE_ROOT, stageId })).toStrictEqual(expected);
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
