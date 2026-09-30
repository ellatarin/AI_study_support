/**
 * Cutting a transcript into subtopics at the places a model named, shared by
 * the three division stages (technical-design.md §5, "Dividing the transcript").
 *
 * The model never returns text, only the opening words of each subtopic. Every
 * subtopic is sliced from the transcript itself, so a division reproduces the
 * transcript exactly whatever the model wrote — and {@link assertLossless}
 * checks that it does before anything is saved.
 */

import { NamedError } from "../../utils/errors.js";
import { isRecord } from "../../utils/record.js";

/** One subtopic: its span of the transcript, and the model's title and reason for it. */
export type Subtopic = {
	readonly start: number;
	readonly end: number;
	readonly title: string;
	readonly why: string;
};

/** What a subtopic is called and why it is one thing, as it is saved. */
type SubtopicNaming = Pick<Subtopic, "title" | "why">;

/**
 * The text of one subtopic: its span of the transcript.
 *
 * @param args - The transcript, and the subtopic.
 * @param args.text - The transcript the subtopic's span indexes into.
 * @param args.subtopic - The subtopic, or anything carrying its span.
 * @returns The subtopic's text.
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
 * One subtopic as a model's reply names it: what to call it, why it is one
 * thing, and the words it opens with, which say where to cut. The prompts ask
 * for the title as `label`, and are carried over from the prototype word for
 * word, so the word survives here and nowhere past it.
 */
export type ReplySubtopic = {
	readonly label: string;
	readonly groupedBecause: string;
	readonly startsWith: string;
};

/**
 * Whether a value in a parsed reply is a subtopic as the model names one.
 *
 * @param value - One entry of the reply's list.
 * @returns `true` when it carries its three strings.
 */
export function isReplySubtopic(value: unknown): value is ReplySubtopic {
	return (
		isRecord(value) &&
		typeof value.label === "string" &&
		typeof value.groupedBecause === "string" &&
		typeof value.startsWith === "string"
	);
}

/**
 * A reply subtopic's title and reason, as a subtopic carries them.
 *
 * @param reply - One subtopic or cut as the model's reply names it.
 * @param reply.label - What the model called it: the title.
 * @param reply.groupedBecause - Why the model holds it to be one thing: the reason.
 * @returns Its `label` as the title and its `groupedBecause` as the reason.
 */
export function replyNaming({ label, groupedBecause }: ReplySubtopic): SubtopicNaming {
	return { title: label, why: groupedBecause };
}

/**
 * One entry of a run file read as a subtopic, keeping only what a subtopic
 * holds: a run saved while deepening marked inherited titles carries a mark
 * that nothing reads now, and it goes no further (technical-design.md §5,
 * `deepen-subtopic-splitting`, "Inherited titles are not marked").
 *
 * @param value - One entry of the parsed run file.
 * @returns The subtopic, or `null` when the entry lacks its span, title or reason.
 */
function readSubtopic(value: unknown): Subtopic | null {
	if (
		!isRecord(value) ||
		typeof value.start !== "number" ||
		typeof value.end !== "number" ||
		typeof value.title !== "string" ||
		typeof value.why !== "string"
	) {
		return null;
	}
	return { start: value.start, end: value.end, title: value.title, why: value.why };
}

/**
 * Reads a value parsed back from a run file as a division: a list of subtopics.
 *
 * @param value - The parsed run file.
 * @returns The subtopics, or `null` when it is not a list or any entry is not a subtopic.
 */
export function readDivision(value: unknown): readonly Subtopic[] | null {
	if (!Array.isArray(value)) {
		return null;
	}
	const subtopics = value.map(readSubtopic);
	return subtopics.every((subtopic) => subtopic !== null) ? subtopics : null;
}

/** A division whose subtopics do not join back into the transcript. Always a bug. */
export class DivisionNotLosslessError extends NamedError {}

/**
 * Words the lecturer hinges one subtopic to the next with, and which the model
 * sometimes leaves off the opening it quotes. Measured in the prototype: 12 of
 * 565 cuts, every one a bare "So".
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

/** How many connectives in a row may be taken back into the subtopic they open. */
const MAX_CONNECTIVE_WORDS = 2;

/**
 * Whether a character is whitespace. Past either end of the text there is no
 * character, which counts as not whitespace.
 *
 * @param character - The character, or `undefined` past either end of the text.
 * @returns Whether it is whitespace.
 */
function isSpace(character: string | undefined): boolean {
	return /\s/u.test(character ?? "");
}

/**
 * A whitespace-free, lower-cased view of the text, with a map from each position
 * in it back to the original. Searching this view finds a quote whose case or
 * spacing the model tidied; the cut is then made in the original.
 *
 * @param args - The text to index.
 * @param args.text - The transcript.
 * @returns The folded text, and each folded position's origin.
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
 * Where the sentence a cut lands inside begins, when the model dropped one or
 * two connectives that open it. Only connectives that open a sentence are taken
 * back — the text before them must end a sentence — so "lipids and proteins"
 * keeps its cut at "proteins".
 *
 * @param args - The text, the cut, and how far back it may go.
 * @param args.text - The transcript.
 * @param args.cut - Where the located quote begins.
 * @param args.notBefore - The previous cut, which this one may never reach.
 * @returns The cut, moved back over any connectives that open its sentence.
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
		if (before === "" || /[.?!]["')\]]?$/u.test(before)) {
			return position;
		}
	}
	return cut;
}

/**
 * Finds where each subtopic begins. The first always begins at the start of the
 * text, whatever its quote; each later quote is searched for with case and
 * whitespace ignored, forward from the previous cut. A quote that cannot be
 * found is reported, never guessed at.
 *
 * @param args - The text, and each subtopic's opening words in order.
 * @param args.text - The transcript being divided.
 * @param args.quotes - Every subtopic's opening words, the first included.
 * @returns Each subtopic's start position, or the first quote that could not be placed.
 */
export function placeCuts({
	text,
	quotes,
}: {
	readonly text: string;
	readonly quotes: readonly string[];
}): { readonly cuts: readonly number[] } | { readonly unplaced: string } {
	const { folded, origin } = foldedIndex({ text });
	const cuts: number[] = [0];
	let searchFrom = 0;
	for (const quote of quotes.slice(1)) {
		const needle = quote.replace(/\s+/gu, "").toLowerCase();
		const found = needle === "" ? -1 : folded.indexOf(needle, searchFrom);
		const position = origin[found];
		if (found === -1 || position === undefined) {
			return { unplaced: quote };
		}
		cuts.push(overLeadingConnectives({ text, cut: position, notBefore: cuts.at(-1) ?? 0 }));
		searchFrom = found + 1;
	}
	return { cuts };
}

/**
 * Cuts the text at the given positions into subtopics carrying the model's
 * titles and reasons, in order.
 *
 * @param args - The text, where each subtopic starts, and what the model called each.
 * @param args.text - The transcript being divided.
 * @param args.cuts - Each subtopic's start position, as {@link placeCuts} returned them.
 * @param args.named - Each subtopic's title and reason, in the same order.
 * @returns The subtopics, the last running to the end of the text.
 */
export function sliceSubtopics({
	text,
	cuts,
	named,
}: {
	readonly text: string;
	readonly cuts: readonly number[];
	readonly named: readonly SubtopicNaming[];
}): readonly Subtopic[] {
	return [...cuts.entries()].map(([index, start]) => ({
		start,
		end: cuts[index + 1] ?? text.length,
		title: named[index]?.title ?? "",
		why: named[index]?.why ?? "",
	}));
}

/**
 * Checks that the subtopics, joined in order, are the text character for
 * character: they start at 0, each starts where the one before ended, and the
 * last ends at the end.
 *
 * @param args - The text, and its division.
 * @param args.text - The transcript that was divided.
 * @param args.subtopics - The division to check.
 * @throws {DivisionNotLosslessError} When any character is missing or repeated.
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
