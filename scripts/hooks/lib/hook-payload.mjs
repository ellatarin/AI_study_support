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
	const chunks = [];
	for await (const chunk of process.stdin) {
		chunks.push(chunk);
	}
	try {
		const payload = JSON.parse(chunks.join(""));
		return { parsed: true, command: String(payload?.tool_input?.command ?? "") };
	} catch {
		return { parsed: false };
	}
}
