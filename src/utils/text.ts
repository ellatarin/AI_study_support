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

/** A word ending in a consonant and `y`, whose plural ends in `ies`. */
const CONSONANT_THEN_Y = /[^aeiou]y$/i;

/**
 * Counts a thing in a sentence: the number, then the noun, pluralised for any
 * count but one.
 *
 * A noun that ends in a consonant and `y` takes `ies`. Every other noun takes a
 * plain `s`. No noun this is asked for is irregular.
 *
 * @param args - What is being counted.
 * @param args.count - How many there are.
 * @param args.noun - The singular noun.
 * @returns The count and the noun, agreeing with each other.
 * @example
 * pluralise({ count: 1, noun: "lecture" });    // "1 lecture"
 * pluralise({ count: 3, noun: "call" });       // "3 calls"
 * pluralise({ count: 2, noun: "deficiency" }); // "2 deficiencies"
 */
export function pluralise({
	count,
	noun,
}: {
	readonly count: number;
	readonly noun: string;
}): string {
	if (count === 1) {
		return `${count} ${noun}`;
	}
	return `${count} ${CONSONANT_THEN_Y.test(noun) ? `${noun.slice(0, -1)}ies` : `${noun}s`}`;
}
