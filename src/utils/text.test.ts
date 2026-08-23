import { describe, expect, it } from "vitest";
import { collapseWhitespace } from "./text.js";

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
