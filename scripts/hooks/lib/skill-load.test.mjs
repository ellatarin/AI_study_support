import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readEditorRecord, transcriptLoadsSkill } from "./skill-load.mjs";

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

describe("readEditorRecord", () => {
	const sessionId = "session-1";
	const agentId = "agent-1";
	let projectFolder = "";
	let transcriptPath = "";

	beforeEach(() => {
		projectFolder = fs.mkdtempSync(path.join(os.tmpdir(), "skill-record-"));
		transcriptPath = path.join(projectFolder, `${sessionId}.jsonl`);
		fs.writeFileSync(transcriptPath, "main session");
	});

	afterEach(() => {
		fs.rmSync(projectFolder, { recursive: true, force: true });
	});

	/**
	 * Writes an agent's session record below the session's subagents folder.
	 *
	 * @param {string[]} folders - The folders between the subagents folder and the record.
	 */
	function writeAgentRecord(folders) {
		const folder = path.join(projectFolder, sessionId, "subagents", ...folders);
		fs.mkdirSync(folder, { recursive: true });
		fs.writeFileSync(path.join(folder, `agent-${agentId}.jsonl`), "agent");
	}

	it("should return the main session's record when the edit has no agent", () => {
		const payload = { session_id: sessionId, transcript_path: transcriptPath };

		expect(readEditorRecord({ payload })).toBe("main session");
	});

	it.each([
		{ folders: [], why: "the agent's record is in the subagents folder" },
		{ folders: ["workflows", "run-1"], why: "the agent's record is in a workflow run folder" },
	])("should return the agent's own record when $why", ({ folders }) => {
		writeAgentRecord(folders);
		const payload = { session_id: sessionId, transcript_path: transcriptPath, agent_id: agentId };

		expect(readEditorRecord({ payload })).toBe("agent");
	});

	it("should return an empty record when the agent's record is missing", () => {
		const payload = { session_id: sessionId, transcript_path: transcriptPath, agent_id: agentId };

		expect(readEditorRecord({ payload })).toBe("");
	});
});
