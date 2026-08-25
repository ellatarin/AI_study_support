import { describe, expect, it } from "vitest";
import {
	EmptyNameError,
	extractProvisionalTitle,
	filenameSafe,
	lectureFolderName,
} from "./naming.js";

const NULL_BYTE = String.fromCharCode(0);
const CONTROL_CHAR = String.fromCharCode(1);

/** The codes a run is configured with, unless a case is about a different set. */
const MODULE_CODES = ["BOD", "ANA"];

describe("extractProvisionalTitle", () => {
	it.each([
		{
			filename: "2025-10-10 BOD_Disease cell injury and the immune system Fri co.mp4",
			expected: "Disease cell injury and the immune system",
		},
		{
			filename: "10 Oct 2025 Lecture 2 Immunity to Infection v2.pdf",
			expected: "Immunity to Infection",
		},
		{ filename: "Fri 10th Oct Immune System copy.mp4", expected: "Immune System" },
		{ filename: "BOD_Virology 1.mp4", expected: "Virology 1" },
		// A file Stage 0 has already renamed, re-read because its lecture has no
		// manifest yet: the title it yields must be the one the name was built from.
		{ filename: "Lecture 1 - Cell Injury - 2025-10-10.mp4", expected: "Cell Injury" },
		// Capitals the lecturer typed are how they spell the subject, and the title
		// reaches the workspace folder and the final PDF. Re-casing it would
		// misspell the subject in every name the run produces, and no rule can tell
		// an acronym from an ordinary word once either may hold lower-case letters.
		{ filename: "2025-10-10 BOD_DNA replication.mp4", expected: "DNA replication" },
		{ filename: "2025-10-10 BOD_mRNA processing.mp4", expected: "mRNA processing" },
		{ filename: "2025-10-10 BOD_CELL INJURY.mp4", expected: "CELL INJURY" },
		// The cost, stated so it is a decision rather than a surprise: a filename
		// typed in lower case yields a lower-case title, where title-casing used to
		// tidy it. Names are now exactly as consistent as the filenames are.
		{ filename: "2025-10-10 BOD_cell injury.mp4", expected: "cell injury" },
		// Every configured code is stripped, not just the first: a second module's
		// lectures would otherwise carry its code into every title.
		{ filename: "2025-10-10 ANA_Skeletal system.mp4", expected: "Skeletal system" },
		{ filename: "ANA Muscles of the Arm 2025-10-10.mp4", expected: "Muscles of the Arm" },
		// A code that names no configured module is part of the title. Stripping
		// any capitals-then-underscore run would eat this.
		{ filename: "2025-10-10 XYZ_Cell injury.mp4", expected: "XYZ Cell injury" },
	])("should extract provisional title when filename is $filename", ({ filename, expected }) => {
		expect(extractProvisionalTitle({ filename, moduleCodes: MODULE_CODES })).toBe(expected);
	});

	it("should leave a module code in place when no codes are configured", () => {
		expect(
			extractProvisionalTitle({ filename: "2025-10-10 BOD_Cell injury.mp4", moduleCodes: [] }),
		).toBe("BOD Cell injury");
	});

	// Codes come from the config file, so a character with meaning inside a
	// pattern must match itself rather than being interpreted.
	it.each([
		{ scenario: "the code itself", filename: "B.D_Cell injury.mp4", expected: "Cell injury" },
		{
			scenario: "a name the code would match only as a pattern",
			filename: "BXD_Cell injury.mp4",
			expected: "BXD Cell injury",
		},
	])("should treat a module code as literal text when the filename holds $scenario", ({
		filename,
		expected,
	}) => {
		expect(extractProvisionalTitle({ filename, moduleCodes: ["B.D"] })).toBe(expected);
	});

	it.each([
		{ filename: "2025-10-10 Lecture 5.mp4", remainder: "a date and lecture number" },
		{ filename: "Lecture 1 - 2025-10-10.mp4", remainder: "a canonical untitled name" },
	])("should return an empty string when the filename holds only $remainder", ({ filename }) => {
		expect(extractProvisionalTitle({ filename, moduleCodes: MODULE_CODES })).toBe("");
	});
});

describe("filenameSafe", () => {
	it.each([
		{ input: "Cell/Injury\\Notes", expected: "Cell Injury Notes", label: "path separators" },
		{ input: "../etc/passwd", expected: "etc passwd", label: "parent traversal" },
		{ input: "./Cell Injury", expected: "Cell Injury", label: "current-dir segment" },
		{ input: `Cell${NULL_BYTE}Injury`, expected: "CellInjury", label: "a null byte" },
		{ input: `Cell${CONTROL_CHAR}Injury`, expected: "CellInjury", label: "a control char" },
		{ input: "Cell   Injury", expected: "Cell Injury", label: "collapsed whitespace" },
		{ input: "Cell Injury...", expected: "Cell Injury", label: "trailing dots" },
		{ input: "Cell Injury.", expected: "Cell Injury", label: "a single trailing dot" },
	])("should sanitise to $expected when input has $label", ({ input, expected }) => {
		expect(filenameSafe(input)).toBe(expected);
	});

	it.each([
		{ input: ".." },
		{ input: "." },
		{ input: "   " },
		{ input: " " },
	])("should throw EmptyNameError when sanitisation leaves nothing ($input)", ({ input }) => {
		expect(() => filenameSafe(input)).toThrow(EmptyNameError);
	});
});

describe("lectureFolderName", () => {
	it.each([
		{
			scenario: "given a number, a title, and a date",
			lectureNumber: 1,
			title: "Immune System",
			date: new Date(2025, 9, 10, 12, 0, 0),
			expected: "Lecture 1 - Immune System - 2025-10-10",
		},
		{
			scenario: "the title contains a path separator",
			lectureNumber: 2,
			title: "Cell/Injury",
			date: new Date(2025, 9, 13, 12, 0, 0),
			expected: "Lecture 2 - Cell Injury - 2025-10-13",
		},
	])("should build the canonical name when $scenario", ({
		lectureNumber,
		title,
		date,
		expected,
	}) => {
		expect(lectureFolderName({ lectureNumber, title, date })).toBe(expected);
	});
});
