/**
 * The cuts of a subtopic's text into parts, one for each rewrite paragraph or
 * for paragraphs that no clean cut can separate. A cuts file in `splits/` gives,
 * for each part, its paragraphs and the words where it starts in the text.
 */

/** One part as a cuts file gives it. The first part starts at the start of the text, so it has no start words. */
export type SplitPart = { readonly paragraphs: readonly number[]; readonly startWords: string | null };

/** One part of a subtopic: its paragraphs, its lecture text and its rewrite paragraphs. */
export type ParagraphPart = {
	readonly paragraphs: readonly number[];
	readonly text: string;
	readonly rewrite: readonly string[];
};

/**
 * Finds where a part starts in the text.
 *
 * @param args - The text, the part and its position in the list of parts.
 * @param args.text - The subtopic's text.
 * @param args.part - The part.
 * @param args.index - The position of the part in the list, from 0.
 * @returns The offset of the part's start words, or 0 for the first part.
 * @throws Error when the first part has start words, a later part has none, or the start words do not occur exactly once.
 */
function partStart({
	text,
	part,
	index,
}: {
	readonly text: string;
	readonly part: SplitPart;
	readonly index: number;
}): number {
	if (index === 0 || part.startWords === null) {
		if (index !== 0 || part.startWords !== null) {
			throw new Error(`Only the first part has no start words, but part ${index + 1} differs`);
		}
		return 0;
	}
	const at = text.indexOf(part.startWords);
	if (at < 0 || text.indexOf(part.startWords, at + 1) >= 0) {
		throw new Error(`The start words "${part.startWords}" do not occur exactly once in the text`);
	}
	return at;
}

/**
 * Cuts a subtopic's text into its parts and gives each part its rewrite paragraphs.
 *
 * @param args - The text, the rewrite and the parts.
 * @param args.text - The subtopic's text.
 * @param args.rewrite - The rewrite paragraphs of the subtopic.
 * @param args.parts - The parts, in the order of the text.
 * @returns Each part with its text and its rewrite paragraphs.
 * @throws Error when a part's start words do not occur exactly once, the parts are out of order, or the parts do not hold each paragraph once, in order.
 */
export function cutIntoParts({
	text,
	rewrite,
	parts,
}: {
	readonly text: string;
	readonly rewrite: readonly string[];
	readonly parts: readonly SplitPart[];
}): readonly ParagraphPart[] {
	const paragraphs = parts.flatMap((part) => part.paragraphs);
	if (paragraphs.length !== rewrite.length || paragraphs.some((paragraph, index) => paragraph !== index + 1)) {
		throw new Error(`The parts hold paragraphs ${paragraphs.join(", ")}, not 1 to ${rewrite.length} in order`);
	}
	const starts = parts.map((part, index) => partStart({ text, part, index }));
	if (starts.some((start, index) => index > 0 && start <= (starts[index - 1] ?? 0))) {
		throw new Error("The parts are not in the order of the text");
	}
	return parts.map((part, index) => ({
		paragraphs: part.paragraphs,
		text: text.slice(starts[index], starts[index + 1]).trim(),
		rewrite: part.paragraphs.map((paragraph) => rewrite[paragraph - 1] ?? ""),
	}));
}
