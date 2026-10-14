import { describe, expect, it } from "vitest";
import { collapseWhitespace, countWords, pluralise, splitWords } from "./text.js";

describe("countWords", () => {
	it.each([
		{ scenario: "single spaces separate the words", text: "beta cell injury", expected: 3 },
		{ scenario: "runs of whitespace separate the words", text: "beta \n\t cell", expected: 2 },
		{ scenario: "whitespace leads and trails the text", text: "  cell  ", expected: 1 },
		{ scenario: "a hyphen joins two words", text: "cell-cycle arrest", expected: 2 },
		{ scenario: "the text is nothing but whitespace", text: " \n ", expected: 0 },
	])("should count $expected words when $scenario", ({ text, expected }) => {
		expect(countWords(text)).toBe(expected);
	});
});

describe("splitWords", () => {
	it.each([
		{
			scenario: "runs of whitespace separate the words",
			text: "beta \n\t cell",
			expected: ["beta", "cell"],
		},
		{ scenario: "whitespace leads and trails the text", text: "  cell  ", expected: ["cell"] },
		{ scenario: "the text is nothing but whitespace", text: " \n ", expected: [] },
	])("should give the words between whitespace when $scenario", ({ text, expected }) => {
		expect(splitWords(text)).toStrictEqual(expected);
	});
});

describe("collapseWhitespace", () => {
	it.each([
		{
			scenario: "a run of spaces separates two words",
			text: "Cell    Injury",
			expected: "Cell Injury",
		},
		{
			scenario: "the whitespace is not a space",
			text: "Cell\tInjury\nand Death",
			expected: "Cell Injury and Death",
		},
		{
			scenario: "whitespace leads and trails the text",
			text: "  Cell Injury  ",
			expected: "Cell Injury",
		},
		{
			scenario: "removing a fragment has left a gap at the end",
			text: "Cell Injury   ",
			expected: "Cell Injury",
		},
		{
			scenario: "the text is already spaced as it should be",
			text: "Cell Injury",
			expected: "Cell Injury",
		},
		{
			scenario: "the text is nothing but whitespace",
			text: " \n\t ",
			expected: "",
		},
	])("should read $expected when $scenario", ({ text, expected }) => {
		expect(collapseWhitespace(text)).toBe(expected);
	});
});

describe("pluralise", () => {
	it.each([
		{ scenario: "there is one of them", count: 1, expected: "1 lecture" },
		{ scenario: "there are several", count: 3, expected: "3 lectures" },
		{ scenario: "there are none", count: 0, expected: "0 lectures" },
	])("should read $expected when $scenario", ({ count, expected }) => {
		expect(pluralise({ count, noun: "lecture" })).toBe(expected);
	});

	it.each([
		{ noun: "summary", count: 2, expected: "2 summaries" },
		{ noun: "summary", count: 1, expected: "1 summary" },
		{ noun: "day", count: 2, expected: "2 days" },
	])("should read $expected when the noun ends in y", ({ noun, count, expected }) => {
		expect(pluralise({ count, noun })).toBe(expected);
	});
});
