/**
 * This module tidies text. The naming rules and the date reader remove parts of
 * text and then close the gaps with {@link collapseWhitespace}
 * (technical-design.md §3.2). Several messages give a count of a thing with
 * {@link pluralise}. The size gate and term correction count words with
 * {@link countWords}.
 */

const WHITESPACE_RUN = /\s+/g;

/**
 * Makes each run of whitespace a single space, and trims the ends.
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
 * Counts the words in a text. Code counts them, because a model can only
 * estimate length (CONTEXT.md, "Size gate"). Term correction also counts the
 * words of each form of a correction (CONTEXT.md, "Correction").
 *
 * @param text - The text to count.
 * @returns The number of groups of characters between whitespace.
 * @example
 * countWords("  cell-cycle arrest "); // 2
 */
export function countWords(text: string): number {
	return text.split(WHITESPACE_RUN).filter((word) => word.length > 0).length;
}

/** A word ending in a consonant and `y`, whose plural ends in `ies`. */
const CONSONANT_THEN_Y = /[^aeiou]y$/i;

/**
 * Gives a count and a noun, with the plural noun for any count but one. A noun
 * that ends in a consonant and `y` takes `ies`. Every other noun takes `s`. No
 * caller gives an irregular noun.
 *
 * @param args - The thing that is counted, and its count.
 * @param args.count - The number of things that are counted.
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
