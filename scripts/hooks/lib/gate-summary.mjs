/*
 * The one-line account pre-commit-check gives of a gate that passed.
 *
 * Claude Code shows a hook's output only when the hook blocks, so a passing
 * gate was indistinguishable from one that never ran. The summary is read out
 * of the test run's own closing lines rather than assumed.
 */

/** The checks that must have passed for the tests to be reached at all. */
const EARLIER_CHECKS = "secrets, format, types, lint and duplication clean";

/**
 * Summarises a passed gate from the output of its test run.
 *
 * @param {{ testOutput: string }} args - What `check:tests` printed.
 * @returns {string} One sentence naming the test count, file count and line
 *   coverage, or saying they were not found — never a count it did not read.
 */
export function summariseGate({ testOutput }) {
	const tests = testOutput.match(/^\s*Tests\s+(\d+) passed/m)?.[1];
	const files = testOutput.match(/^\s*Test Files\s+(\d+) passed/m)?.[1];
	const lines = testOutput.match(/^All files\s*\|[^|]*\|[^|]*\|[^|]*\|\s*([\d.]+)/m)?.[1];
	if (tests === undefined || files === undefined || lines === undefined) {
		return `Gate passed, but the test run's closing summary was not found in its output, so no counts are given; ${EARLIER_CHECKS}.`;
	}
	return `Gate passed: ${tests} tests in ${files} files, ${lines}% line coverage; ${EARLIER_CHECKS}.`;
}

/**
 * The JSON a PreToolUse hook prints to report a passed gate without deciding
 * anything. `systemMessage` is shown to the user; `additionalContext` reaches
 * Claude. No `permissionDecision`: "allow" would skip the commit's permission
 * prompt, so the call goes through Claude Code's normal permission flow.
 *
 * @param {{ summary: string }} args - The sentence to report.
 * @returns {string} The hook's stdout.
 */
export function gateHookOutput({ summary }) {
	return JSON.stringify({
		systemMessage: summary,
		hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: summary },
	});
}
