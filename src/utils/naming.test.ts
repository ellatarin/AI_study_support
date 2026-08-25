import { describe, expect, it } from "vitest";
import {
	EmptyNameError,
	extractProvisionalTitle,
	filenameSafe,
	lectureFolderName,
} from "./naming.js";

const NULL_BYTE = String.fromCharCode(0);
const CONTROL_CHAR = String.fromCharCode(1);

describe("extractProvisionalTitle", () => {
	it.each([
		{
			filename: "2025-10-10 BOD_Disease cell injury and the immune system Fri co.mp4",
			expected: "Disease Cell Injury and the Immune System",
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
		// An acronym is a word the lecturer wrote in capitals on purpose, and the
		// title reaches the workspace folder and the final PDF, so lowercasing its
		// tail would misspell the subject in every name the run produces.
		{ filename: "2025-10-10 BOD_DNA replication.mp4", expected: "DNA Replication" },
		{ filename: "2025-10-10 BOD_Introduction to DNA.mp4", expected: "Introduction to DNA" },
		// The cost of the rule above, stated so it is a decision rather than a
		// surprise: a filename typed wholly in capitals is indistinguishable from
		// one made of acronyms, so it is left as the lecturer typed it.
		{ filename: "2025-10-10 BOD_CELL INJURY.mp4", expected: "CELL INJURY" },
	])("should extract provisional title when filename is $filename", ({ filename, expected }) => {
		expect(extractProvisionalTitle(filename)).toBe(expected);
	});

	it.each([
		{ filename: "2025-10-10 Lecture 5.mp4", remainder: "a date and lecture number" },
		{ filename: "Lecture 1 - 2025-10-10.mp4", remainder: "a canonical untitled name" },
	])("should return an empty string when the filename holds only $remainder", ({ filename }) => {
		expect(extractProvisionalTitle(filename)).toBe("");
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
