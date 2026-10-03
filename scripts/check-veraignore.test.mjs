import { describe, expect, it } from "vitest";
import { patternsMissingFromVeraignore } from "./check-veraignore.mjs";

describe("patternsMissingFromVeraignore", () => {
	it.each([
		{
			condition: "every .gitignore pattern is in .veraignore",
			gitignoreText: ".env*\n.claude/\n",
			veraignoreText: ".claude/\n.env*\nruns/\n",
			missing: [],
		},
		{
			condition: "a .gitignore pattern is absent from .veraignore",
			gitignoreText: ".env*\n.claude/\n",
			veraignoreText: ".claude/\n",
			missing: [".env*"],
		},
		{
			condition: "the files hold comments and blank lines",
			gitignoreText: "# secrets\n\n.env*\n",
			veraignoreText: "# a different comment\n.env*\n",
			missing: [],
		},
		{
			condition: "a pattern carries surrounding whitespace",
			gitignoreText: "  .env*  \n",
			veraignoreText: ".env*\n",
			missing: [],
		},
	])("should report $missing when $condition", ({ gitignoreText, veraignoreText, missing }) => {
		// Arrange is the table row.

		// Act
		const result = patternsMissingFromVeraignore({ gitignoreText, veraignoreText });

		// Assert
		expect(result).toEqual(missing);
	});
});
