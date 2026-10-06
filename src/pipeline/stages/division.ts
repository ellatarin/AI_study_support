/**
 * The cutting of a transcript into subtopics at the start words that a model
 * gives. The division stages and `retitle-subtopics` use it
 * (technical-design.md §5, "Dividing the transcript").
 *
 * The model never returns text. Each subtopic is sliced from the transcript, so a
 * division always reproduces the transcript. {@link assertLossless} checks that the
 * division reproduces the transcript before the division is saved.
 */

import type { StageContext } from "../../types/pipeline.js";
import { NamedError } from "../../utils/errors.js";
import { isRecord } from "../../utils/record.js";

/** One subtopic: its span of the transcript, and the model's title and reason for it. */
export type Subtopic = {
	readonly start: number;
	readonly end: number;
	readonly title: string;
	readonly reason: string;
};

type TitleAndReason = Pick<Subtopic, "title" | "reason">;

/**
 * The text of one subtopic: its span of the transcript.
 *
 * @param args - The transcript, and the subtopic.
 * @param args.text - The transcript that the span indexes into.
 * @param args.subtopic - The subtopic, or anything with its span.
 * @returns The text of the subtopic.
 */
export function subtopicText({
	text,
	subtopic,
}: {
	readonly text: string;
	readonly subtopic: Pick<Subtopic, "start" | "end">;
}): string {
	return text.slice(subtopic.start, subtopic.end);
}

/**
 * One part of a model's reply: a subtopic in a splitting reply, or a topic in a
 * grouping reply. The prompts call the title `label` and the reason
 * `groupedBecause`. The prompts are copied from the prototype without change, so
 * the reply uses these keys.
 */
export type TitledReplyPart = {
	readonly label: string;
	readonly groupedBecause: string;
};

/**
 * Tells whether a value in a parsed reply has a title and a reason.
 *
 * @param value - One entry of the list in the reply.
 * @returns `true` when the value is an object whose `label` and `groupedBecause` are strings.
 */
export function isTitledReplyPart(
	value: unknown,
): value is Readonly<Record<string, unknown>> & TitledReplyPart {
	return (
		isRecord(value) && typeof value.label === "string" && typeof value.groupedBecause === "string"
	);
}

/**
 * One subtopic in a model's reply. It holds a title, a reason and start words.
 * The start words show where to cut.
 */
export type ReplySubtopic = TitledReplyPart & { readonly startsWith: string };

/**
 * Tells whether a value in a parsed reply is a reply subtopic.
 *
 * @param value - One entry of the list in the reply.
 * @returns `true` when the value has `label`, `groupedBecause` and `startsWith` as strings.
 */
export function isReplySubtopic(value: unknown): value is ReplySubtopic {
	return isTitledReplyPart(value) && typeof value.startsWith === "string";
}

/**
 * Takes the title and reason from a reply subtopic. `label` becomes `title`,
 * and `groupedBecause` becomes `reason`.
 * The code uses `title` and `reason` because they are easier to read. The prompt
 * keeps `label` and `groupedBecause`.
 *
 * @param reply - One subtopic or cut in the model's reply.
 * @param reply.label - The title.
 * @param reply.groupedBecause - The reason.
 * @returns The title and the reason.
 */
export function replyTitleAndReason({ label, groupedBecause }: ReplySubtopic): TitleAndReason {
	return { title: label, reason: groupedBecause };
}

/**
 * Reads one entry of a saved division as a subtopic, and keeps only what a
 * subtopic holds.
 *
 * @param value - One entry of the parsed division.
 * @returns The subtopic, or `null` when the entry does not have its span, title or reason.
 */
function readSubtopic(value: unknown): Subtopic | null {
	if (
		!isRecord(value) ||
		typeof value.start !== "number" ||
		typeof value.end !== "number" ||
		typeof value.title !== "string" ||
		typeof value.reason !== "string"
	) {
		return null;
	}
	return { start: value.start, end: value.end, title: value.title, reason: value.reason };
}

/**
 * Reads a parsed value as a division: a list of subtopics. A saved run, and a
 * division that a stage wrote as its output, are both read with it.
 *
 * @param value - The parsed file.
 * @returns The subtopics, or `null` when the value is not a list or an entry is not a subtopic.
 */
export function readDivision(value: unknown): readonly Subtopic[] | null {
	if (!Array.isArray(value)) {
		return null;
	}
	const subtopics = value.map(readSubtopic);
	return subtopics.every((subtopic) => subtopic !== null) ? subtopics : null;
}

/**
 * The size of a splitting panel, and the reader of its saved runs. The stages
 * that make a splitting panel and the stages that read one all use it, so they
 * agree about what a splitting panel holds.
 *
 * @param context - The stage context. Its `subtopicSplitting` section sets the panel size.
 * @returns The panel size, and the reader of its saved runs.
 */
export function splittingPanel(context: StageContext): {
	readonly panelSize: number;
	readonly readRun: typeof readDivision;
} {
	return { panelSize: context.config.subtopicSplitting.panelSize, readRun: readDivision };
}

/** A division whose subtopics do not join back into the transcript. Such a division always comes from a bug. */
export class DivisionNotLosslessError extends NamedError {}

/**
 * Words that join one subtopic to the next at the start of a sentence. The model
 * sometimes leaves them off the start words. In the prototype's `d7` runs, a
 * dropped connective occurred at 12 of 565 cuts, each a bare "So"
 * (docs/quality/segmentation-prototype/cut-blocks.mts).
 */
const CONNECTIVES: ReadonlySet<string> = new Set([
	"so",
	"and",
	"but",
	"now",
	"well",
	"right",
	"okay",
	"ok",
	"then",
]);

/** The most connectives in a row that a cut can move back over. */
const MAX_CONNECTIVE_WORDS = 2;

/**
 * Tells whether a character is whitespace. A position past either end of the
 * text has no character. A missing character counts as not whitespace.
 *
 * @param character - The character, or `undefined` past either end of the text.
 * @returns `true` when it is whitespace.
 */
function isSpace(character: string | undefined): boolean {
	return /\s/u.test(character ?? "");
}

/**
 * A view of the text in lower case and without whitespace, with a map from each
 * position in it back to the original. A search of this view finds start words
 * whose case or spacing the model changed. The cut is then made in the original
 * (technical-design.md §5, "Finding the start words").
 *
 * @param args - The text to index.
 * @param args.text - The transcript.
 * @returns The folded text, and the original position of each folded position.
 */
function foldedIndex({ text }: { readonly text: string }): {
	readonly folded: string;
	readonly origin: readonly number[];
} {
	const characters: string[] = [];
	const origin: number[] = [];
	for (let index = 0; index < text.length; index += 1) {
		const character = text[index];
		if (character !== undefined && !isSpace(character)) {
			characters.push(character.toLowerCase());
			origin.push(index);
		}
	}
	return { folded: characters.join(""), origin };
}

/**
 * Moves a cut back to the start of its sentence, when the model dropped one or two
 * connectives there. The cut moves only when the text before the connectives ends
 * a sentence. So "lipids and proteins" keeps its cut at "proteins". The cut does
 * not move when only connectives are between it and the previous cut, because
 * the previous subtopic would then have no text.
 *
 * @param args - The text, the cut, and the limit.
 * @param args.text - The transcript.
 * @param args.cut - The position where the start words were found.
 * @param args.notBefore - The previous cut. The cut never moves back onto it.
 * @returns The cut, moved back over any connectives at the start of its sentence.
 */
function overLeadingConnectives({
	text,
	cut,
	notBefore,
}: {
	readonly text: string;
	readonly cut: number;
	readonly notBefore: number;
}): number {
	let position = cut;
	for (let taken = 0; taken < MAX_CONNECTIVE_WORDS; taken += 1) {
		let end = position;
		while (end > notBefore && isSpace(text[end - 1])) {
			end -= 1;
		}
		let begin = end;
		while (begin > notBefore && !isSpace(text[begin - 1])) {
			begin -= 1;
		}
		const word = text
			.slice(begin, end)
			.replace(/[,;:]$/u, "")
			.toLowerCase();
		if (begin === end || !CONNECTIVES.has(word)) {
			return cut;
		}
		position = begin;
		const before = text.slice(notBefore, begin).trimEnd();
		if (before === "") {
			return cut;
		}
		if (/[.?!]["')\]]?$/u.test(before)) {
			return position;
		}
	}
	return cut;
}

/**
 * Finds the start of each subtopic. The first subtopic always starts at the start
 * of the text, whatever its start words. The start words of each later subtopic
 * are searched for forward from the previous cut, with case and whitespace
 * ignored. Start words that are not found are reported, never guessed.
 *
 * @param args - The text, and the start words of each subtopic in order.
 * @param args.text - The transcript to divide.
 * @param args.startWords - The start words of every subtopic, the first included.
 * @returns The start position of each subtopic, or the first start words that were not found.
 */
export function placeCuts({
	text,
	startWords,
}: {
	readonly text: string;
	readonly startWords: readonly string[];
}): { readonly cuts: readonly number[] } | { readonly unplaced: string } {
	const { folded, origin } = foldedIndex({ text });
	const cuts: number[] = [0];
	let searchFrom = 0;
	for (const words of startWords.slice(1)) {
		const needle = words.replace(/\s+/gu, "").toLowerCase();
		const found = needle === "" ? -1 : folded.indexOf(needle, searchFrom);
		const position = origin[found];
		if (found === -1 || position === undefined) {
			return { unplaced: words };
		}
		cuts.push(overLeadingConnectives({ text, cut: position, notBefore: cuts.at(-1) ?? 0 }));
		searchFrom = found + 1;
	}
	return { cuts };
}

/**
 * Cuts the text at the given positions into subtopics, in order, with the titles
 * and reasons from the model.
 *
 * @param args - The text, the start of each subtopic, and the title and reason of each subtopic.
 * @param args.text - The transcript to divide.
 * @param args.cuts - The start position of each subtopic, as {@link placeCuts} gave them.
 * @param args.titled - The title and reason of each subtopic, in the same order.
 * @returns The subtopics. The last one runs to the end of the text.
 */
export function sliceSubtopics({
	text,
	cuts,
	titled,
}: {
	readonly text: string;
	readonly cuts: readonly number[];
	readonly titled: readonly TitleAndReason[];
}): readonly Subtopic[] {
	return [...cuts.entries()].map(([index, start]) => ({
		start,
		end: cuts[index + 1] ?? text.length,
		title: titled[index]?.title ?? "",
		reason: titled[index]?.reason ?? "",
	}));
}

/**
 * Checks that the subtopics, joined in order, are the text character for
 * character. The first starts at 0, each starts where the one before ended, and
 * the last ends at the end of the text.
 *
 * @param args - The text, and its division.
 * @param args.text - The transcript that was divided.
 * @param args.subtopics - The division to check.
 * @throws {DivisionNotLosslessError} When a character is missing or repeated.
 */
export function assertLossless({
	text,
	subtopics,
}: {
	readonly text: string;
	readonly subtopics: readonly Subtopic[];
}): void {
	let expectedStart = 0;
	for (const [index, subtopic] of subtopics.entries()) {
		if (subtopic.start !== expectedStart || subtopic.end < subtopic.start) {
			throw new DivisionNotLosslessError(
				`Subtopic ${index + 1} starts at ${subtopic.start} where ${expectedStart} was expected: the division does not reproduce the transcript`,
			);
		}
		expectedStart = subtopic.end;
	}
	if (expectedStart !== text.length) {
		throw new DivisionNotLosslessError(
			`The division ends at ${expectedStart} of ${text.length} characters: it does not reproduce the transcript`,
		);
	}
}
