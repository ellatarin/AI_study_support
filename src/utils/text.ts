/**
 * Tidying text that is shown to a user or assembled by taking pieces out of
 * other text.
 *
 * Both the naming rules and the date reader work by removal — a noise token, a
 * date span — and removal leaves gaps behind, so each of them ends by closing
 * the gaps up. That final tidy is written here once rather than at each of them
 * (technical-design.md §3). Counting a thing in a sentence is here for the same
 * reason: several places tell the user how many of something there are.
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

/**
 * Counts a thing in a sentence: the number, then the noun, pluralised with a
 * trailing `s` for any count but one.
 *
 * Every noun this is asked for takes a plain `s`; a noun that does not would
 * have to say so, and none of them arises here.
 *
 * @param args - What is being counted.
 * @param args.count - How many there are.
 * @param args.noun - The singular noun.
 * @returns The count and the noun, agreeing with each other.
 * @example
 * pluralise({ count: 1, noun: "lecture" }); // "1 lecture"
 * pluralise({ count: 3, noun: "call" });    // "3 calls"
 */
export function pluralise({
	count,
	noun,
}: {
	readonly count: number;
	readonly noun: string;
}): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
