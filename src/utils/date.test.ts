import { describe, expect, it } from "vitest";
import { extractDate, formatDateISO, stripDateTokens } from "./date.js";

describe("extractDate", () => {
	it.each([
		{ filename: "2025-10-10 BOD_Cell Injury copy.mp4", iso: "2025-10-10" },
		{ filename: "BOD_Immunity to Infection 13 Oct 2025 v2.mp4", iso: "2025-10-13" },
		{ filename: "10 October 2025 Immune System.mp4", iso: "2025-10-10" },
	])("should extract correct date when filename format is $filename", ({ filename, iso }) => {
		const result = extractDate(filename);

		expect(result).not.toBeNull();
		expect(formatDateISO(result as Date)).toBe(iso);
	});

	it("should extract day and month when filename omits the year", () => {
		const result = extractDate("Fri 10th Oct Immune System copy.mp4");

		expect(result).not.toBeNull();
		expect((result as Date).getMonth()).toBe(9);
		expect((result as Date).getDate()).toBe(10);
	});

	it.each([
		{ filename: "BOD_Random Lecture no date.mp4" },
		{ filename: "Lecture 5 chapter 3.mp4" },
	])("should return null when filename has no date ($filename)", ({ filename }) => {
		expect(extractDate(filename)).toBeNull();
	});
});

describe("stripDateTokens", () => {
	it.each([
		{ input: "2025-10-10 Immune System Fri", expected: "Immune System" },
		{ input: "BOD_Immunity to Infection 13 Oct 2025 v2", expected: "BOD_Immunity to Infection v2" },
		{ input: "Fri 10th Oct Immune System copy", expected: "Immune System copy" },
	])("should remove date tokens when input is $input", ({ input, expected }) => {
		expect(stripDateTokens(input)).toBe(expected);
	});

	it("should return the text unchanged when no date is present", () => {
		expect(stripDateTokens("Immune System overview")).toBe("Immune System overview");
	});
});

describe("formatDateISO", () => {
	it.each([
		{ date: new Date(2025, 9, 10, 12, 0, 0), expected: "2025-10-10" },
		{ date: new Date(2025, 0, 5, 12, 0, 0), expected: "2025-01-05" },
		{ date: new Date(2025, 11, 31, 12, 0, 0), expected: "2025-12-31" },
	])("should format as YYYY-MM-DD when date is $expected", ({ date, expected }) => {
		expect(formatDateISO(date)).toBe(expected);
	});
});
