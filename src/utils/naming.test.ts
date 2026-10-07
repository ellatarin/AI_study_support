import { describe, expect, it } from "vitest";
import { EmptyNameError, extractProvisionalTitle, filenameSafe, titledBaseName } from "./naming.js";

const NULL_BYTE = String.fromCharCode(0);
const CONTROL_CHAR = String.fromCharCode(1);

/** The module prefixes of each test, unless a test is about a different list. */
const MODULE_PREFIXES = ["BOD", "ANA"];

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
		// A file that `source-normalisation` already renamed, read again because its
		// lecture has no manifest yet. It must give the title that its name was built from.
		{ filename: "Lecture 1 - Cell Injury - 2025-10-10.mp4", expected: "Cell Injury" },
		// The capitals that the lecturer typed are the spelling of the subject. A
		// change of case would misspell it in the workspace folder and the PDF. No
		// rule can tell an acronym from an ordinary word (technical-design.md §3.2).
		{ filename: "2025-10-10 BOD_DNA replication.mp4", expected: "DNA replication" },
		{ filename: "2025-10-10 BOD_mRNA processing.mp4", expected: "mRNA processing" },
		{ filename: "2025-10-10 BOD_CELL INJURY.mp4", expected: "CELL INJURY" },
		// The cost of keeping the capitals that the lecturer typed: a filename in lower
		// case gives a title in lower case.
		{ filename: "2025-10-10 BOD_cell injury.mp4", expected: "cell injury" },
		// Every module prefix is removed, not only the first. Otherwise the titles of
		// a second module would keep its prefix.
		{ filename: "2025-10-10 ANA_Skeletal system.mp4", expected: "Skeletal system" },
		{ filename: "ANA Muscles of the Arm 2025-10-10.mp4", expected: "Muscles of the Arm" },
		// A prefix that is not in the config file is part of the title. A rule that
		// removed any capitals before an underscore would remove it.
		{ filename: "2025-10-10 XYZ_Cell injury.mp4", expected: "XYZ Cell injury" },
		// Lecturers do not write their module prefix in one case, so the case is ignored.
		{ filename: "2025-10-10 bod_Cell injury.mp4", expected: "Cell injury" },
		{ filename: "2025-10-10 Bod Cell injury.mp4", expected: "Cell injury" },
		{ filename: "BOD_Complement on 17102025 Fri copy.mp4", expected: "Complement" },
		{ filename: "BOD_Cancer Therapy on 16032026.mp4", expected: "Cancer Therapy" },
		{ filename: "BOD_Cell injury on Fri 10th Oct.mp4", expected: "Cell injury" },
		{ filename: "2025-10-10 BOD_Lights on.mp4", expected: "Lights on" },
		{ filename: "  BOD_Cell injury 2025-10-10  .mp4", expected: "Cell injury" },
	])("should extract provisional title when filename is $filename", ({ filename, expected }) => {
		expect(extractProvisionalTitle({ filename, modulePrefixes: MODULE_PREFIXES })).toBe(expected);
	});

	// Some lecturers write the full module name. So a module prefix can be
	// several words, not only a code.
	it.each([
		{ scenario: "an underscore", filename: "Biology of Disease_Cell injury 2025-10-10.mp4" },
		{ scenario: "a dash", filename: "biology of disease - Cell injury 2025-10-10.mp4" },
	])("should strip a spelled-out module name when the filename separates it with $scenario", ({
		filename,
	}) => {
		expect(extractProvisionalTitle({ filename, modulePrefixes: ["Biology of Disease"] })).toBe(
			"Cell injury",
		);
	});

	it("should leave a module prefix in place when none are configured", () => {
		expect(
			extractProvisionalTitle({ filename: "2025-10-10 BOD_Cell injury.mp4", modulePrefixes: [] }),
		).toBe("BOD Cell injury");
	});

	// The config file gives the module prefixes. So a character with a special
	// meaning in a pattern must match only itself.
	it.each([
		{ scenario: "the prefix itself", filename: "B.D_Cell injury.mp4", expected: "Cell injury" },
		{
			scenario: "a name the prefix would match only as a pattern",
			filename: "BXD_Cell injury.mp4",
			expected: "BXD Cell injury",
		},
	])("should treat a module prefix as literal text when the filename holds $scenario", ({
		filename,
		expected,
	}) => {
		expect(extractProvisionalTitle({ filename, modulePrefixes: ["B.D"] })).toBe(expected);
	});

	it.each([
		{ filename: "2025-10-10 Lecture 5.mp4", remainder: "a date and lecture number" },
		{ filename: "Lecture 1 - 2025-10-10.mp4", remainder: "an untitled base name" },
	])("should return an empty string when the filename holds only $remainder", ({ filename }) => {
		expect(extractProvisionalTitle({ filename, modulePrefixes: MODULE_PREFIXES })).toBe("");
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

describe("titledBaseName", () => {
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
	])("should build the base name when $scenario", ({ lectureNumber, title, date, expected }) => {
		expect(titledBaseName({ lectureNumber, title, date })).toBe(expected);
	});
});
