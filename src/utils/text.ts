/**
 * Tidying text that has been assembled by taking pieces out of other text.
 *
 * Both the naming rules and the date reader work by removal — a noise token, a
 * date span — and removal leaves gaps behind, so each of them ends by closing
 * the gaps up. That final tidy is written here once rather than at each of them
 * (technical-design.md §3).
 */

/** Any run of whitespace, however it is spelt. */
const WHITESPACE_RUN = /\s+/g;

/**
 * Closes up the whitespace in text something has been removed from: every run
 * becomes a single space, and the ends are trimmed.
 *
 * @param text - The text to tidy.
 * @returns The text, singly spaced and trimmed.
 * @example
 * collapseWhitespace("Cell  Injury   "); // "Cell Injury"
 */
export function collapseWhitespace(text: string): string {
	return text.replace(WHITESPACE_RUN, " ").trim();
}
