import { describe, expect, it } from "vitest";
import {
	extractDate,
	extractDates,
	formatDateISO,
	isCalendarDate,
	stripDateTokens,
} from "./date.js";

// This suite tests the date derivation itself, so it keeps its own literals
// rather than importing the shared lecture fixture: asserting a derived value
// against itself would prove nothing (fixtures.ts says the same of naming).
//
// Within the suite only the date token varies from row to row, so the subject it
// hangs off is named once. The `.mp4` extension is incidental to what is under
// test and stays inline.
const SUBJECT = "Cell Injury";
const TENTH_OF_OCTOBER = "2025-10-10";
const TENTH_OF_NOVEMBER = "2025-11-10";
const ELEVENTH_OF_OCTOBER = "2025-10-11";

describe("extractDate", () => {
	it.each([
		// Every positive case shares one body, so the table below is the whole
		// specification: a filename in, the date it must yield out.
		//
		// British convention throughout — a four-digit component is the year,
		// otherwise the day leads, and month-first is never read
		// (technical-design.md §3.2).
		{ filename: `10102025 ${SUBJECT}.mp4`, iso: TENTH_OF_OCTOBER },
		{ filename: `10-10-2025 ${SUBJECT}.mp4`, iso: TENTH_OF_OCTOBER },
		{ filename: `10.10.2025 ${SUBJECT}.mp4`, iso: TENTH_OF_OCTOBER },
		{ filename: `10/10/2025 ${SUBJECT}.mp4`, iso: TENTH_OF_OCTOBER },
		{ filename: `20251010 ${SUBJECT}.mp4`, iso: TENTH_OF_OCTOBER },
		{ filename: `2025-10-10 ${SUBJECT}.mp4`, iso: TENTH_OF_OCTOBER },
		{ filename: `2025.10.10 ${SUBJECT}.mp4`, iso: TENTH_OF_OCTOBER },
		{ filename: `2025/10/10 ${SUBJECT}.mp4`, iso: TENTH_OF_OCTOBER },

		// The distinguishing pair: with both components under thirteen, only the
		// convention decides. The mirror rules out guessing from magnitude.
		{ filename: `10112025 ${SUBJECT}.mp4`, iso: TENTH_OF_NOVEMBER },
		{ filename: `10-11-2025 ${SUBJECT}.mp4`, iso: TENTH_OF_NOVEMBER },
		{ filename: `10.11.2025 ${SUBJECT}.mp4`, iso: TENTH_OF_NOVEMBER },
		{ filename: `10/11/2025 ${SUBJECT}.mp4`, iso: TENTH_OF_NOVEMBER },
		{ filename: `11102025 ${SUBJECT}.mp4`, iso: ELEVENTH_OF_OCTOBER },
		{ filename: `11-10-2025 ${SUBJECT}.mp4`, iso: ELEVENTH_OF_OCTOBER },
		{ filename: `11.10.2025 ${SUBJECT}.mp4`, iso: ELEVENTH_OF_OCTOBER },
		{ filename: `11/10/2025 ${SUBJECT}.mp4`, iso: ELEVENTH_OF_OCTOBER },

		// Single-digit day and month.
		{ filename: `1/2/2025 ${SUBJECT}.mp4`, iso: "2025-02-01" },
		{ filename: `2025-1-2 ${SUBJECT}.mp4`, iso: "2025-01-02" },

		// A two-digit year is read only at the end, and always as 20xx. A leading
		// two-digit component is the day, so `YY-MM-DD` is not a form: nothing in
		// `26-11-10` could distinguish it from `DD-MM-YY`.
		{ filename: `10-11-26 ${SUBJECT}.mp4`, iso: "2026-11-10" },
		{ filename: `10.11.26 ${SUBJECT}.mp4`, iso: "2026-11-10" },
		{ filename: `10/11/26 ${SUBJECT}.mp4`, iso: "2026-11-10" },
		{ filename: `26-11-10 ${SUBJECT}.mp4`, iso: "2010-11-26" },

		// Six bare digits are as likely to be an identifier as a date, so DDMMYY is
		// tried last: any other date in the filename wins, prose included.
		{ filename: `101126 ${SUBJECT}.mp4`, iso: "2026-11-10" },
		{ filename: `101126 2025-10-10 ${SUBJECT}.mp4`, iso: TENTH_OF_OCTOBER },
		{ filename: `101126 10 Oct 2025 ${SUBJECT}.mp4`, iso: TENTH_OF_OCTOBER },

		// The boundary is "not a digit" rather than a list of tolerated characters,
		// so anything may abut the date. Underscores matter most — they defeat
		// detection entirely without this.
		{ filename: `BOD_10102025_${SUBJECT}.mp4`, iso: TENTH_OF_OCTOBER },
		{ filename: `BOD_2025-10-10_${SUBJECT}.mp4`, iso: TENTH_OF_OCTOBER },
		{ filename: `(10.10.2025)${SUBJECT}.mp4`, iso: TENTH_OF_OCTOBER },
		{ filename: `~2025/10/10~${SUBJECT}.mp4`, iso: TENTH_OF_OCTOBER },
		{ filename: `BOD[20251010]${SUBJECT}.mp4`, iso: TENTH_OF_OCTOBER },

		// Dates written in words stay with chrono, which reads them unambiguously.
		{ filename: `2025-10-10 BOD_${SUBJECT} copy.mp4`, iso: TENTH_OF_OCTOBER },
		{ filename: "BOD_Immunity to Infection 13 Oct 2025 v2.mp4", iso: "2025-10-13" },
		{ filename: "10 October 2025 Immune System.mp4", iso: TENTH_OF_OCTOBER },
	])("should extract $iso when the filename is $filename", ({ filename, iso }) => {
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
		{ scenario: "an impossible day", filename: `31022025 ${SUBJECT}.mp4` },
		{ scenario: "a month above twelve", filename: `2025-13-10 ${SUBJECT}.mp4` },
		{ scenario: "eight digits that are no date either way", filename: `12345678 ${SUBJECT}.mp4` },
		{ scenario: "six digits that are no date", filename: `993456 ${SUBJECT}.mp4` },
		{ scenario: "a longer digit run", filename: `1010202512 ${SUBJECT}.mp4` },
	])("should return null when the filename holds $scenario", ({ filename }) => {
		expect(extractDate(filename)).toBeNull();
	});

	// A weekday alone names no day of the year. It is still stripped from titles,
	// so the set of spans removed there is wider than the set a date is read
	// from — the two must not be conflated.
	it.each([
		{ filename: `Fri ${SUBJECT}.mp4` },
		{ filename: `${SUBJECT} Monday.mp4` },
	])("should return null when the filename carries only a weekday ($filename)", ({ filename }) => {
		expect(extractDate(filename)).toBeNull();
	});

	it.each([
		{ filename: "BOD_Random Lecture no date.mp4" },
		{ filename: "Lecture 5 chapter 3.mp4" },
	])("should return null when filename has no date ($filename)", ({ filename }) => {
		expect(extractDate(filename)).toBeNull();
	});
});

describe("extractDates", () => {
	it("should return every date in the order it appears when a filename carries more than one", () => {
		const found = extractDates(`Cohort 01-02-2019 ${SUBJECT} ${TENTH_OF_OCTOBER}.mp4`);

		expect(found.map(formatDateISO)).toEqual(["2019-02-01", TENTH_OF_OCTOBER]);
	});

	it("should return the one date when a filename carries a single date", () => {
		const found = extractDates(`${TENTH_OF_OCTOBER} ${SUBJECT}.mp4`);

		expect(found.map(formatDateISO)).toEqual([TENTH_OF_OCTOBER]);
	});

	it("should return nothing when a filename carries no date", () => {
		expect(extractDates("Lecture 5 chapter 3.mp4")).toEqual([]);
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

describe("isCalendarDate", () => {
	it.each([
		{ scenario: "an ordinary date", value: "2025-10-10" },
		{ scenario: "a leap day in a leap year", value: "2024-02-29" },
	])("should accept the value when it is $scenario ($value)", ({ value }) => {
		expect(isCalendarDate(value)).toBe(true);
	});

	it.each([
		{ scenario: "the day does not exist in that month", value: "2025-02-30" },
		{ scenario: "the leap day falls in a common year", value: "2025-02-29" },
		{ scenario: "the month does not exist", value: "2025-13-01" },
		{ scenario: "the date is written British-style", value: "10/10/2025" },
		{ scenario: "the components are not zero-padded", value: "2025-1-5" },
		{ scenario: "the date is a phrase rather than a date", value: "yesterday" },
		{ scenario: "there is nothing to read", value: "" },
	])("should reject the value when $scenario", ({ value }) => {
		expect(isCalendarDate(value)).toBe(false);
	});
});
