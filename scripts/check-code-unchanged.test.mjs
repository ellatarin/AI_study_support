import { describe, expect, it } from "vitest";
import { sameCode } from "./check-code-unchanged.mjs";

const fileName = "example.ts";
const before = "/** The count. */\nexport const count = 1;\n";

describe("sameCode", () => {
	it.each([
		{
			after: "/** How many there are. */\nexport const count = 1;\n",
			expected: true,
			why: "only a comment changed",
		},
		{
			after: "export const count = 1; // The count.\n",
			expected: true,
			why: "a comment moved to the end of the line",
		},
		{
			after: "/** The count. */\nexport const count = 2;\n",
			expected: false,
			why: "a value changed",
		},
		{
			after: "/** The count. */\nexport const total = 1;\n",
			expected: false,
			why: "a name changed",
		},
	])("should return $expected when $why", ({ after, expected }) => {
		expect(sameCode({ fileName, before, after })).toBe(expected);
	});
});
