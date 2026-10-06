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
