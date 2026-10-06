import { describe, expect, it } from "vitest";
import { transcriptLoadsSkill } from "./skill-load.mjs";

/**
 * One session record line in which the assistant calls the Skill tool.
 *
 * @param {string} skill - The skill the call loads.
 * @returns {string} The line as JSON.
 */
function skillCall(skill) {
	return JSON.stringify({
		type: "assistant",
		message: { content: [{ type: "tool_use", name: "Skill", input: { skill } }] },
	});
}

/**
 * One session record line in which the user types a slash command.
 *
 * @param {string} command - The command name, without the slash.
 * @returns {string} The line as JSON.
 */
function slashCommand(command) {
	return JSON.stringify({
		type: "user",
		message: { content: `<command-name>/${command}</command-name>` },
	});
}

describe("transcriptLoadsSkill", () => {
	it.each([
		{
			lines: [skillCall("asd-ste100")],
			expected: true,
			why: "the assistant called the Skill tool for it",
		},
		{
			lines: [slashCommand("asd-ste100")],
			expected: true,
			why: "the user typed its slash command",
		},
		{
			lines: [skillCall("vera"), slashCommand("tdd")],
			expected: false,
			why: "only other skills loaded",
		},
		{
			lines: ["not json", skillCall("asd-ste100")],
			expected: true,
			why: "an earlier line is not JSON",
		},
		{ lines: [], expected: false, why: "the record is empty" },
	])("should return $expected when $why", ({ lines, expected }) => {
		const transcriptText = lines.join("\n");

		expect(transcriptLoadsSkill({ transcriptText, skillName: "asd-ste100" })).toBe(expected);
	});
});
