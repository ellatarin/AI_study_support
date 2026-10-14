import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STAGE_IDS } from "../types/pipeline.js";
import { testLecture, testModuleName, testModuleRoot, testTimestampId } from "./fixtures.js";
import {
	DEBUG_LOGS_DIR,
	debugLogPath,
	lectureNotesDirPath,
	MANIFEST_FILE,
	moduleDirs,
	moduleName,
	moduleRootOf,
	NOTES_PAGE_FILE,
	notesSlideImageEntry,
	RUN_LOGS_DIR,
	runLogsDirPath,
	STAGE_FILES,
	type StageWithOutputFile,
	savedRunFileName,
	sharedLectureFileDirs,
	slideFileName,
	slideImageFileName,
	stageDirectoryPaths,
	stageOutputEntry,
	stageOutputPath,
	stageRecordPath,
	workspaceRootFor,
} from "./layout.js";

// The suite checks the names that layout.ts puts under the module root, the
// workspace and the project root. The names are
// written out here, not read from layout.ts, because a check against layout.ts
// itself would prove nothing.
const MODULE_ROOT = testModuleRoot;
const VIDEO_DIR = join(MODULE_ROOT, "Source files", "Video recordings");
const SLIDE_DIR = join(MODULE_ROOT, "Source files", "Slide decks");
const PROCESSING_DIR = join(MODULE_ROOT, "Pipeline processing");
const FINAL_OUTPUT_DIR = join(MODULE_ROOT, "Final output");
const WORKSPACE_ROOT = join(PROCESSING_DIR, testLecture.baseName);

describe("moduleDirs", () => {
	it.each([
		{ key: "videoRecording" as const, expected: VIDEO_DIR },
		{ key: "slideDeck" as const, expected: SLIDE_DIR },
		{ key: "processing" as const, expected: PROCESSING_DIR },
		{ key: "finalOutput" as const, expected: FINAL_OUTPUT_DIR },
	])("should place $key under the module root when the module is resolved", ({ key, expected }) => {
		expect(moduleDirs({ moduleRoot: MODULE_ROOT })[key]).toBe(expected);
	});
});

describe("sharedLectureFileDirs", () => {
	it("should give the directories a lecture's own files sit in when a module is given", () => {
		expect(sharedLectureFileDirs({ dirs: moduleDirs({ moduleRoot: MODULE_ROOT }) })).toStrictEqual([
			VIDEO_DIR,
			SLIDE_DIR,
			FINAL_OUTPUT_DIR,
		]);
	});
});

describe("lectureNotesDirPath", () => {
	it("should place a lecture's notes in a folder with its base name in the final output folder when the lecture is named", () => {
		expect(lectureNotesDirPath({ moduleRoot: MODULE_ROOT, baseName: testLecture.baseName })).toBe(
			join(FINAL_OUTPUT_DIR, testLecture.baseName),
		);
	});
});

// The page and the slides folder are names on disk that the user reads. The
// suite states them here once, so a change to either name fails a test.
describe("the files of a lecture's notes", () => {
	it("should name the notes page notes.html when the page is written", () => {
		expect(NOTES_PAGE_FILE).toBe("notes.html");
	});

	it("should place the copy of a slide image in slides/ beside the page when the slide is numbered", () => {
		expect(notesSlideImageEntry(4)).toBe("slides/slide-004.png");
	});
});

describe("runLogsDirPath", () => {
	it("should resolve the run logs under the workspace when a workspace is given", () => {
		expect(runLogsDirPath({ workspaceRoot: WORKSPACE_ROOT })).toBe(
			join(WORKSPACE_ROOT, "Run logs"),
		);
	});
});

describe("debugLogPath", () => {
	it("should place the invocation's debug log under the project root when an invocation is identified", () => {
		expect(debugLogPath({ projectRoot: MODULE_ROOT, invocationId: testTimestampId })).toBe(
			join(MODULE_ROOT, "debug-logs", `${testTimestampId}-debug.log`),
		);
	});
});

describe("workspaceRootFor", () => {
	it("should place a lecture's workspace under the module's processing directory when it is named", () => {
		expect(workspaceRootFor({ moduleRoot: MODULE_ROOT, baseName: testLecture.baseName })).toBe(
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
			baseName: testLecture.baseName,
		});

		expect(moduleRootOf({ workspaceRoot })).toBe(MODULE_ROOT);
	});
});

describe("moduleName", () => {
	it("should name a module by its directory leaf when its root is given", () => {
		expect(moduleName({ moduleRoot: MODULE_ROOT })).toBe(testModuleName);
	});
});

describe("STAGE_IDS", () => {
	it("should run the fact check, the fact correction, the slide relocation and the notes page after the rewrite when the pipeline is enumerated", () => {
		expect(STAGE_IDS.slice(STAGE_IDS.indexOf("rewrite-subtopics"))).toStrictEqual([
			"rewrite-subtopics",
			"check-facts",
			"correct-factual-errors",
			"relocate-slides",
			"build-notes-page",
		]);
	});
});

describe("STAGE_FILES", () => {
	it("should describe every stage when the pipeline is enumerated", () => {
		expect(Object.keys(STAGE_FILES).sort()).toStrictEqual([...STAGE_IDS].sort());
	});

	it("should keep a stage record from choose-division, retitle-subtopics and group-into-topics alone when ownership is read", () => {
		const stageRecordWriters = STAGE_IDS.filter(
			(stageId) => STAGE_FILES[stageId].stageRecord !== null,
		);

		expect(stageRecordWriters).toStrictEqual([
			"choose-division",
			"retitle-subtopics",
			"group-into-topics",
		]);
	});
});

describe("stageRecordPath", () => {
	it("should resolve the stage record beside the output it describes when a workspace is given", () => {
		expect(stageRecordPath({ workspaceRoot: WORKSPACE_ROOT, stageId: "choose-division" })).toBe(
			join(WORKSPACE_ROOT, "Chosen division", "choice.json"),
		);
	});
});

describe("stageDirectoryPaths", () => {
	it.each([
		{
			stageId: "render-slides" as const,
			scenario: "the one workspace directory of its slide images",
			expected: [join(WORKSPACE_ROOT, "Slide images")],
		},
		{
			stageId: "source-normalisation" as const,
			scenario: "no directory at all",
			expected: [],
		},
		{
			stageId: "build-notes-page" as const,
			scenario: "no workspace directory, because the notes go to the final output folder",
			expected: [],
		},
		{
			// The folder of the saved runs is first, because the panel keeps them in the first folder.
			stageId: "group-into-topics" as const,
			scenario: "its grouping runs and then the topics chosen from them",
			expected: [join(WORKSPACE_ROOT, "Grouping runs"), join(WORKSPACE_ROOT, "Topics")],
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
			stageId: "place-slides" as const,
			expected: join("Slide placements", "placements.json"),
		},
		{ stageId: "group-into-topics" as const, expected: join("Topics", "topics.json") },
		{ stageId: "check-facts" as const, expected: join("Fact checks", "factual-errors.json") },
		{
			stageId: "correct-factual-errors" as const,
			expected: join("Fact corrections", "fact-corrected-subtopics.json"),
		},
		{
			stageId: "relocate-slides" as const,
			expected: join("Slide relocations", "slide-relocations.json"),
		},
	])("should give the workspace-relative output of $stageId when it writes a single file", ({
		stageId,
		expected,
	}) => {
		expect(stageOutputEntry(stageId)).toBe(expected);
	});

	// The compiler refuses a stage that does not write a single output file. The
	// expect-error is the assertion. Without the narrower type StageWithOutputFile,
	// the expect-error is unused, and the build fails.
	it("should admit only the stages writing one file when a writer is named", () => {
		const writers: readonly StageWithOutputFile[] = [
			"audio-extraction",
			"transcription",
			"judge-lecture-title",
			"place-slides",
		];

		// @ts-expect-error -- render-slides writes one image for each slide, so it has no single output file
		const notAWriter: StageWithOutputFile = "render-slides";

		expect(writers.map(stageOutputEntry)).toHaveLength(writers.length);
		expect(notAWriter).toBe("render-slides");
	});
});

describe("stageOutputPath", () => {
	it("should resolve the stage's output under the workspace when a workspace is given", () => {
		expect(stageOutputPath({ workspaceRoot: WORKSPACE_ROOT, stageId: "transcription" })).toBe(
			join(WORKSPACE_ROOT, "Transcript", "transcript.txt"),
		);
	});
});

describe("savedRunFileName", () => {
	it.each([
		{ runNumber: 1, expected: "run-01.json" },
		{ runNumber: 12, expected: "run-12.json" },
	])("should name saved run $runNumber with two digits when the run is numbered", ({
		runNumber,
		expected,
	}) => {
		expect(savedRunFileName({ runNumber })).toBe(expected);
	});
});

describe("slideImageFileName", () => {
	// The slideFileName table checks the number part of the name.
	it("should give a slide image the PNG extension when the slide is numbered", () => {
		expect(slideImageFileName(4)).toMatch(/\.png$/u);
	});
});

describe("slideFileName", () => {
	it.each([
		{ slideNumber: 1, extension: "png", expected: "slide-001.png" },
		{ slideNumber: 42, extension: "json", expected: "slide-042.json" },
		{ slideNumber: 120, extension: "png", expected: "slide-120.png" },
	])("should name slide $slideNumber with three digits and the extension $extension when the slide is numbered", ({
		slideNumber,
		extension,
		expected,
	}) => {
		expect(slideFileName({ slideNumber, extension })).toBe(expected);
	});
});

describe("workspace filenames", () => {
	it.each([
		{ name: "MANIFEST_FILE", value: MANIFEST_FILE, expected: "manifest.json" },
		{ name: "RUN_LOGS_DIR", value: RUN_LOGS_DIR, expected: "Run logs" },
		{ name: "DEBUG_LOGS_DIR", value: DEBUG_LOGS_DIR, expected: "debug-logs" },
	])("should declare $name once when the layout is read", ({ value, expected }) => {
		expect(value).toBe(expected);
	});
});
