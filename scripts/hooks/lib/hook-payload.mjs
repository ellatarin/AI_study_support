/**
 * Reads the Bash command out of a Claude Code hook payload on stdin.
 *
 * The result says whether the payload could be read at all, rather than
 * collapsing an unreadable payload into an empty command: the two hooks that
 * call this want opposite things when the schema surprises them. A blocker
 * should let the call through; the commit gate should run the checks anyway.
 *
 * @returns {Promise<{ parsed: true, command: string } | { parsed: false }>} The command, or a
 *   flag saying the payload could not be parsed.
 */
export async function readCommandFromStdin() {
	const payload = await readPayloadFromStdin();
	if (payload === null) return { parsed: false };
	return { parsed: true, command: String(payload?.tool_input?.command ?? "") };
}

/**
 * Reads a Claude Code hook payload from stdin.
 *
 * @returns {Promise<any>} The parsed payload, or null when stdin is not JSON.
 */
export async function readPayloadFromStdin() {
	try {
		return JSON.parse(await readStdin());
	} catch {
		return null;
	}
}

/**
 * Reads the whole of stdin as text. Shared by the hook scripts that are handed
 * something on stdin — a hook payload, or a check's output.
 *
 * @returns {Promise<string>} Everything written to stdin.
 */
export async function readStdin() {
	const chunks = [];
	for await (const chunk of process.stdin) {
		chunks.push(chunk);
	}
	return chunks.join("");
}
