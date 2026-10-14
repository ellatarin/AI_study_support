/**
 * The word comparison of the notes page (CONTEXT.md, "Word comparison", and
 * technical-design.md §5, `build-notes-page`, "The word comparison").
 */

import { PUNCTUATION } from "../../../utils/text.js";
import { BRACKETED_FIGURE_LABEL, FIGURE_MARK } from "../slide-relocations.js";

/**
 * A word of a text: the characters between whitespace. A figure label in
 * brackets is one word, with the punctuation next to it.
 */
const WORD = new RegExp(String.raw`\S*${BRACKETED_FIGURE_LABEL}\S*|\S+`, "gu");

/** A word that holds a figure label in brackets. */
const LABEL_WORD = new RegExp(BRACKETED_FIGURE_LABEL, "u");

/**
 * Splits a text into the words that the comparison compares.
 *
 * @param text - The text.
 * @returns The words, in order.
 */
function comparedWords(text: string): readonly string[] {
	return text.match(WORD) ?? [];
}

/** The mark of one word of a word comparison. */
export type WordChange = "unchanged" | "removed" | "added";

/** One word of a word comparison, as its text writes it. */
export type ComparedWord = { readonly word: string; readonly change: WordChange };

/**
 * Gives the form of a word that the comparison matches: lower case, with no
 * punctuation. Each word at a figure has the same form, so a figure label in
 * brackets matches a figure mark.
 *
 * @param word - The word as its text writes it.
 * @returns The form that the comparison matches.
 */
function comparisonKey(word: string): string {
	return LABEL_WORD.test(word) || word.includes(FIGURE_MARK)
		? FIGURE_MARK
		: word.toLowerCase().replace(PUNCTUATION, "");
}

/**
 * Gives the length of the longest run of words that two word lists share in
 * order, for each pair of ends of the lists.
 *
 * @param lists - The two word lists.
 * @param lists.before - The words of the earlier text.
 * @param lists.after - The words of the later text.
 * @returns A function that gives the length for the words from `beforeIndex` and from `afterIndex` to the ends.
 */
function sharedRunLengths({
	before,
	after,
}: {
	readonly before: readonly string[];
	readonly after: readonly string[];
}): (indexes: { readonly beforeIndex: number; readonly afterIndex: number }) => number {
	const width = after.length + 1;
	const lengths = new Uint32Array((before.length + 1) * width);
	for (let beforeIndex = before.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
		for (let afterIndex = after.length - 1; afterIndex >= 0; afterIndex -= 1) {
			const cell = beforeIndex * width + afterIndex;
			lengths[cell] =
				before[beforeIndex] === after[afterIndex]
					? (lengths[cell + width + 1] ?? 0) + 1
					: Math.max(lengths[cell + width] ?? 0, lengths[cell + 1] ?? 0);
		}
	}
	return ({ beforeIndex, afterIndex }) => lengths[beforeIndex * width + afterIndex] ?? 0;
}

/**
 * Compares the words of two texts in order. The comparison keeps the longest run
 * of words that both texts have in the same order. In a place where the texts
 * differ, the removed words come before the added words.
 *
 * @param texts - The two texts.
 * @param texts.before - The earlier text, such as the rewrite.
 * @param texts.after - The later text, such as the notes.
 * @returns Each word of both texts in reading order, with its mark.
 * @example
 * compareWords({ before: "Some injury", after: "Some damage" });
 * // [{ word: "Some", change: "unchanged" }, { word: "injury", change: "removed" },
 * //  { word: "damage", change: "added" }]
 */
export function compareWords({
	before,
	after,
}: {
	readonly before: string;
	readonly after: string;
}): readonly ComparedWord[] {
	const beforeWords = comparedWords(before);
	const afterWords = comparedWords(after);
	const beforeKeys = beforeWords.map(comparisonKey);
	const afterKeys = afterWords.map(comparisonKey);
	const lengthFrom = sharedRunLengths({ before: beforeKeys, after: afterKeys });
	const compared: ComparedWord[] = [];
	let beforeIndex = 0;
	let afterIndex = 0;
	while (beforeIndex < beforeWords.length || afterIndex < afterWords.length) {
		const beforeWord = beforeWords[beforeIndex];
		const afterWord = afterWords[afterIndex];
		if (afterWord !== undefined && beforeKeys[beforeIndex] === afterKeys[afterIndex]) {
			compared.push({ word: afterWord, change: "unchanged" });
			beforeIndex += 1;
			afterIndex += 1;
		} else if (
			beforeWord !== undefined &&
			(afterWord === undefined ||
				lengthFrom({ beforeIndex: beforeIndex + 1, afterIndex }) >=
					lengthFrom({ beforeIndex, afterIndex: afterIndex + 1 }))
		) {
			compared.push({ word: beforeWord, change: "removed" });
			beforeIndex += 1;
		} else {
			compared.push({ word: afterWord ?? "", change: "added" });
			afterIndex += 1;
		}
	}
	return compared;
}
