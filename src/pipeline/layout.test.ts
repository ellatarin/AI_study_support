import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STAGE_IDS } from "../types/pipeline.js";
import { testLecture, testModuleName, testModuleRoot, testRunId } from "./fixtures.js";
import {
	datedFileDirs,
	debugLogPath,
	MANIFEST_FILE,
	moduleDirs,
	moduleName,
	moduleRootOf,
	RUNS_DIR,
	resolveStageOutput,
	runsDirPath,
	STAGE_WORKSPACE,
	type StageWithOutputFile,
	stageDirectoryPaths,
	stageOutputEntry,
	stageOutputPath,
	workspaceRootFor,
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
const QA_DIRS = [join(WORKSPACE_ROOT, "QA iterations"), join(WORKSPACE_ROOT, "QA checked")];

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

describe("debugLogPath", () => {
	// Anchored to the project, not the workspace: one invocation writes one debug
	// log and may run many lectures, so no single workspace could hold it.
	it("should place the invocation's debug log under the project root when a run is identified", () => {
		expect(debugLogPath({ projectRoot: MODULE_ROOT, runId: testRunId })).toBe(
			join(MODULE_ROOT, "runs", `${testRunId}-debug.log`),
		);
	});
});

describe("workspaceRootFor", () => {
	it("should place a lecture's workspace under the module's processing directory when it is named", () => {
		expect(workspaceRootFor({ moduleRoot: MODULE_ROOT, folderName: testLecture.folderName })).toBe(
			WORKSPACE_ROOT,
		);
	});
});

describe("moduleRootOf", () => {
	it("should resolve back to the module when a workspace beneath it is given", () => {
		expect(moduleRootOf({ workspaceRoot: WORKSPACE_ROOT })).toBe(MODULE_ROOT);
	});

	it("should invert workspaceRootFor when a workspace it built is given", () => {
		const workspaceRoot = workspaceRootFor({
			moduleRoot: MODULE_ROOT,
			folderName: testLecture.folderName,
		});

		expect(moduleRootOf({ workspaceRoot })).toBe(MODULE_ROOT);
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
		expect(STAGE_WORKSPACE["source-normalisation"].outputLocation).toStrictEqual({
			root: "workspace",
			directories: [],
		});
	});

	it("should keep every stage but pdf-generation inside the workspace when ownership is read", () => {
		const moduleRooted = STAGE_IDS.filter(
			(stageId) => STAGE_WORKSPACE[stageId].outputLocation.root === "module",
		);

		expect(moduleRooted).toStrictEqual(["pdf-generation"]);
	});
});

describe("resolveStageOutput", () => {
	it("should give the workspace directories it owns when a stage works inside the workspace", () => {
		expect(resolveStageOutput({ workspaceRoot: WORKSPACE_ROOT, stageId: "qa-loop" })).toStrictEqual(
			{
				root: "workspace",
				directories: QA_DIRS,
			},
		);
	});

	// The one place a reset must not sweep: `Final output/` holds every lecture in
	// the module, so what comes back names the directory rather than a set to clear.
	it("should give the module directory it deposits into when pdf-generation is resolved", () => {
		expect(
			resolveStageOutput({ workspaceRoot: WORKSPACE_ROOT, stageId: "pdf-generation" }),
		).toStrictEqual({ root: "module", directory: FINAL_OUTPUT_DIR });
	});
});

describe("stageDirectoryPaths", () => {
	it.each([
		{
			stageId: "qa-loop" as const,
			scenario: "the quality-checked notes it writes alongside its iterations",
			expected: QA_DIRS,
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

	// The four stages that write no single file cannot be asked for one at all:
	// each is null for its own reason, and none of them has an answer to give.
	// The refusal is the compiler's, so this case is written as a type the
	// annotations below make load-bearing — remove the narrowing and the
	// expect-error becomes unused, which fails the build.
	it("should admit only the stages writing one file when a writer is named", () => {
		const writers: readonly StageWithOutputFile[] = [
			"audio-extraction",
			"transcription",
			"transcript-structuring",
			"slide-conversion",
			"synthesis",
		];

		// @ts-expect-error -- qa-loop writes across two directories once per iteration, so it names no single file
		const notAWriter: StageWithOutputFile = "qa-loop";

		expect(writers.map(stageOutputEntry)).toHaveLength(writers.length);
		expect(notAWriter).toBe("qa-loop");
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
