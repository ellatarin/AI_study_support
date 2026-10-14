/**
 * The word comparison of the notes page (CONTEXT.md, "Word comparison", and
 * technical-design.md §5, `build-notes-page`, "The word comparison").
 */

import { PUNCTUATION } from "../../../utils/text.js";
import { BRACKETED_FIGURE_LABEL, FIGURE_MARK, type TextPoint } from "../slide-relocations.js";

/**
 * A word of a text: the characters between whitespace. A figure label in
 * brackets is one word, with the punctuation next to it.
 */
const WORD = new RegExp(String.raw`\S*${BRACKETED_FIGURE_LABEL}\S*|\S+`, "gu");

/** A word that holds a figure label in brackets. */
const LABEL_WORD = new RegExp(BRACKETED_FIGURE_LABEL, "u");

/**
 * One word of a word comparison, as its text writes it, with its point in each
 * text that has it.
 */
export type ComparedWord =
	| {
			readonly word: string;
			readonly change: "unchanged";
			readonly before: TextPoint;
			readonly after: TextPoint;
	  }
	| { readonly word: string; readonly change: "removed"; readonly before: TextPoint }
	| { readonly word: string; readonly change: "added"; readonly after: TextPoint };

/** The mark of one word of a word comparison. */
export type WordChange = ComparedWord["change"];

/** The two lists of a word comparison: the list of the earlier text and the list of the later text. */
type BeforeAndAfter<TList> = { readonly before: TList; readonly after: TList };

/** One word of a text, and its point in the paragraphs of the text. */
type PlacedWord = { readonly word: string; readonly point: TextPoint };

/**
 * Splits the paragraphs of a text into the words that the comparison compares.
 *
 * @param paragraphs - The paragraphs of the text.
 * @returns The words, in order, each with its point.
 */
function placedWords(paragraphs: readonly string[]): readonly PlacedWord[] {
	return [...paragraphs.entries()].flatMap(([paragraphIndex, paragraph]) =>
		[...paragraph.matchAll(WORD)].map((match) => ({
			word: match[0],
			point: { paragraphIndex, characterOffset: match.index },
		})),
	);
}

/**
 * Gives the form of a word that the comparison matches: lower case, with no
 * punctuation. Each word at a figure has the same form, so a figure label in
 * brackets matches a figure mark.
 *
 * @param placed - The word and its point.
 * @param placed.word - The word as its text writes it.
 * @returns The form that the comparison matches.
 */
function comparisonKey({ word }: PlacedWord): string {
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
}: BeforeAndAfter<readonly string[]>): (indexes: {
	readonly beforeIndex: number;
	readonly afterIndex: number;
}) => number {
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
 * @param texts - The paragraphs of the two texts.
 * @param texts.before - The paragraphs of the earlier text, such as the rewrite.
 * @param texts.after - The paragraphs of the later text, such as the notes.
 * @returns Each word of both texts in reading order, with its mark and its point in each text that has it.
 * @example
 * compareWords({ before: ["Some injury"], after: ["Some damage"] }).map(({ change }) => change);
 * // ["unchanged", "removed", "added"]
 */
export function compareWords({
	before,
	after,
}: BeforeAndAfter<readonly string[]>): readonly ComparedWord[] {
	const beforeWords = placedWords(before);
	const afterWords = placedWords(after);
	const beforeKeys = beforeWords.map(comparisonKey);
	const afterKeys = afterWords.map(comparisonKey);
	const lengthFrom = sharedRunLengths({ before: beforeKeys, after: afterKeys });
	const compared: ComparedWord[] = [];
	let beforeIndex = 0;
	let afterIndex = 0;
	while (beforeIndex < beforeWords.length || afterIndex < afterWords.length) {
		const beforeWord = beforeWords[beforeIndex];
		const afterWord = afterWords[afterIndex];
		if (
			beforeWord !== undefined &&
			afterWord !== undefined &&
			beforeKeys[beforeIndex] === afterKeys[afterIndex]
		) {
			compared.push({
				word: afterWord.word,
				change: "unchanged",
				before: beforeWord.point,
				after: afterWord.point,
			});
			beforeIndex += 1;
			afterIndex += 1;
		} else if (
			beforeWord !== undefined &&
			(afterWord === undefined ||
				lengthFrom({ beforeIndex: beforeIndex + 1, afterIndex }) >=
					lengthFrom({ beforeIndex, afterIndex: afterIndex + 1 }))
		) {
			compared.push({ word: beforeWord.word, change: "removed", before: beforeWord.point });
			beforeIndex += 1;
		} else if (afterWord !== undefined) {
			compared.push({ word: afterWord.word, change: "added", after: afterWord.point });
			afterIndex += 1;
		}
	}
	return compared;
}
