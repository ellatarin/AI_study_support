import { describe, expect, it } from "vitest";
import { extractProvisionalTitle, filenameSafe, lectureFolderName } from "./naming.js";

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
	])("should extract provisional title when filename is $filename", ({ filename, expected }) => {
		expect(extractProvisionalTitle(filename)).toBe(expected);
	});

	it("should return an empty string when the filename has only a date and lecture number", () => {
		expect(extractProvisionalTitle("2025-10-10 Lecture 5.mp4")).toBe("");
	});
});

describe("filenameSafe", () => {
	it.each([
		{ input: "a/b\\c", expected: "a b c", label: "path separators" },
		{ input: "../etc/passwd", expected: "etc passwd", label: "parent traversal" },
		{ input: "./foo", expected: "foo", label: "current-dir segment" },
		{ input: `foo${NULL_BYTE}bar`, expected: "foobar", label: "a null byte" },
		{ input: `foo${CONTROL_CHAR}bar`, expected: "foobar", label: "a control char" },
		{ input: "a   b", expected: "a b", label: "collapsed whitespace" },
		{ input: "name...", expected: "name", label: "trailing dots" },
		{ input: "Cell Injury.", expected: "Cell Injury", label: "a single trailing dot" },
	])("should sanitise to $expected when input has $label", ({ input, expected }) => {
		expect(filenameSafe(input)).toBe(expected);
	});

	it.each([
		{ input: ".." },
		{ input: "." },
		{ input: "   " },
		{ input: " " },
	])("should throw when sanitisation leaves nothing ($input)", ({ input }) => {
		expect(() => filenameSafe(input)).toThrow();
	});
});

describe("lectureFolderName", () => {
	it("should build the canonical name when given number, title, and date", () => {
		const result = lectureFolderName({
			lectureNumber: 1,
			title: "Immune System",
			date: new Date(2025, 9, 10, 12, 0, 0),
		});

		expect(result).toBe("Lecture 1 - Immune System - 2025-10-10");
	});

	it("should sanitise the title when it contains a path separator", () => {
		const result = lectureFolderName({
			lectureNumber: 2,
			title: "Cell/Injury",
			date: new Date(2025, 9, 13, 12, 0, 0),
		});

		expect(result).toBe("Lecture 2 - Cell Injury - 2025-10-13");
	});
});
