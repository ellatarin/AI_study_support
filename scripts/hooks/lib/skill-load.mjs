import fs from "node:fs";
import path from "node:path";

/**
 * Reads the session record of the session or agent that makes an edit.
 *
 * In an agent, the payload's `transcript_path` names the main session's record.
 * So a skill that only the main session loaded must not count for the agent.
 * The agent's own record is below `<session_id>/subagents/`, next to the main
 * record. A workflow agent's record is in a deeper folder there.
 *
 * @param {{ payload: any }} args - The hook payload.
 * @returns {string} The record text, or an empty string when the record cannot be read.
 */
export function readEditorRecord({ payload }) {
	const recordPath = payload?.agent_id ? agentRecordPath({ payload }) : payload?.transcript_path;
	try {
		return fs.readFileSync(String(recordPath), "utf8");
	} catch {
		return "";
	}
}

/**
 * Finds an agent's session record below the session's subagents folder.
 *
 * @param {{ payload: any }} args - The hook payload.
 * @returns {string | undefined} The record path, or undefined when no record is found.
 */
function agentRecordPath({ payload }) {
	const subagentsFolder = path.join(
		path.dirname(String(payload.transcript_path)),
		String(payload.session_id),
		"subagents",
	);
	const recordName = `agent-${payload.agent_id}.jsonl`;
	try {
		const found = fs
			.readdirSync(subagentsFolder, { recursive: true, encoding: "utf8" })
			.find((entry) => path.basename(entry) === recordName);
		return found === undefined ? undefined : path.join(subagentsFolder, found);
	} catch {
		return undefined;
	}
}

/**
 * Tells whether a session record shows that a skill was loaded.
 *
 * A skill loads in two ways. The assistant calls the Skill tool, or the user
 * types the skill's slash command. A line that is not JSON is skipped.
 *
 * @param {{ transcriptText: string, skillName: string }} args - The session record, one JSON
 *   object for each line, and the name of the skill.
 * @returns {boolean} True when the skill was loaded in the session.
 */
export function transcriptLoadsSkill({ transcriptText, skillName }) {
	const command = `<command-name>/${skillName}</command-name>`;
	return transcriptText.split("\n").some((line) => {
		const entry = parseLine(line);
		const content = entry?.message?.content;
		if (typeof content === "string") return content.includes(command);
		if (!Array.isArray(content)) return false;
		return content.some(
			(item) =>
				(item?.type === "tool_use" && item.name === "Skill" && item.input?.skill === skillName) ||
				(item?.type === "text" && String(item.text).includes(command)),
		);
	});
}

/**
 * Reads one line of a session record.
 *
 * @param {string} line - The line.
 * @returns {any} The parsed object, or null when the line is not JSON.
 */
function parseLine(line) {
	try {
		return JSON.parse(line);
	} catch {
		return null;
	}
}
