/**
 * Cutting a transcript at the positions a model named, and judging whether what
 * came back is still the transcript.
 *
 * Both pass-one harnesses need this — `failure-trial.mts` for the archived modes
 * and `split-trial.mts` for the versioned splitting prompts — so it lives here
 * rather than in either of them. Nothing in it talks to a model or to the disk.
 */

/** How many characters may be deleted before a run is rejected. */
const DELETION_TOLERANCE = 6;

function stripWhitespace(text: string): string {
	return text.replace(/\s+/gu, "");
}

/**
 * Whether `candidate` can be produced from `source` by deleting characters only.
 *
 * This is the acceptance rule expressed exactly: "every change is a deletion" is
 * the same statement as "the result is a subsequence of the source". A
 * substitution — the lecturer's "50 mils" rewritten as "50 mm" — breaks
 * subsequence order and so can never pass, however few characters it moves.
 */
function isSubsequence(source: string, candidate: string): boolean {
	// Case-folded: the model's tidying is "drop the leading So and capitalise the
	// next word", so a case-sensitive test rejects that on one transcript and
	// accepts it on another purely by accident of spelling. Folding case does not
	// weaken the rule — "50 mils" to "50 mm" is still not a subsequence.
	const folded = source.toLowerCase();
	const wanted = candidate.toLowerCase();
	let index = 0;
	for (const character of folded) {
		if (index < wanted.length && wanted[index] === character) {
			index += 1;
		}
	}
	return index === wanted.length;
}

/** The changed span, found by trimming the common prefix and suffix. */
function changedSpan(source: string, candidate: string): { from: string; to: string } {
	let start = 0;
	while (start < source.length && start < candidate.length && source[start] === candidate[start]) {
		start += 1;
	}
	let end = 0;
	while (
		end < source.length - start &&
		end < candidate.length - start &&
		source[source.length - 1 - end] === candidate[candidate.length - 1 - end]
	) {
		end += 1;
	}
	return {
		from: source.slice(start, source.length - end),
		to: candidate.slice(start, candidate.length - end),
	};
}

/**
 * A whitespace-free, case-folded view of the text, alongside a map from each
 * position in that view back to its position in the original.
 *
 * Searching the folded view is what lets a quote still be located when the model
 * has tidied its capitalisation or spacing — the cut is then made in the
 * original, so nothing the model wrote ever reaches the output.
 */
function foldedIndex(text: string): { readonly folded: string; readonly origin: readonly number[] } {
	const characters: string[] = [];
	const origin: number[] = [];
	for (let index = 0; index < text.length; index += 1) {
		const character = text[index] ?? "";
		if (!/\s/u.test(character)) {
			characters.push(character.toLowerCase());
			origin.push(index);
		}
	}
	return { folded: characters.join(""), origin };
}

/**
 * Words the lecturer hinges one subtopic to the next with, and which the model
 * sometimes leaves out of the quote it hands back.
 *
 * The prompt tells it to copy the opening words verbatim, a leading "So"
 * included, and it usually does. Where it does not, the located cut falls one
 * word late and the connective is stranded at the foot of the block before —
 * which reads, in the finished notes, as a sentence that stops halfway.
 * Measured over the d7 runs: 12 such cuts in 565, every one of them a bare "So".
 */
const CONNECTIVES = new Set(["so", "and", "but", "now", "well", "right", "okay", "ok", "then"]);

/** How many connectives in a row may be taken back into the block they open. */
const MAX_CONNECTIVE_WORDS = 2;

/**
 * Where the sentence the cut lands inside actually begins.
 *
 * Only a connective that OPENS a sentence is taken back, which is why the run
 * has to be preceded by the end of the one before. "and so can the others." ends
 * a sentence with a connective in it and is left alone.
 *
 * @param options - Options object.
 * @param options.sourceText - The transcript being cut.
 * @param options.cut - Where the located quote begins.
 * @param options.notBefore - The previous cut, which this one may never reach.
 * @returns The cut, moved back over any connectives that open its sentence.
 */
function overLeadingConnectives({
	sourceText,
	cut,
	notBefore,
}: {
	readonly sourceText: string;
	readonly cut: number;
	readonly notBefore: number;
}): number {
	let at = cut;
	for (let taken = 0; taken < MAX_CONNECTIVE_WORDS; taken += 1) {
		let end = at;
		while (end > notBefore && /\s/u.test(sourceText[end - 1] ?? "")) {
			end -= 1;
		}
		let begin = end;
		while (begin > notBefore && !/\s/u.test(sourceText[begin - 1] ?? "")) {
			begin -= 1;
		}
		const word = sourceText.slice(begin, end).replace(/[,;:]$/u, "").toLowerCase();
		if (begin === end || !CONNECTIVES.has(word)) {
			return cut;
		}
		at = begin;
		const before = sourceText.slice(notBefore, begin).trimEnd();
		if (before === "" || /[.?!]["')\]]?$/u.test(before)) {
			return at;
		}
	}
	return cut;
}

/**
 * What was wrong with a quote the forward search could not find.
 *
 * Asked only once the search has failed, so the work of looking through the
 * whole transcript is paid for by the rare run that needs it.
 *
 * @param options - Options object.
 * @param options.folded - The whitespace-free, case-folded transcript.
 * @param options.needle - The quote in the same form.
 * @param options.used - The quotes earlier sections were placed by.
 * @returns Which of the three things went wrong.
 */
function missCause({
	folded,
	needle,
	used,
}: {
	readonly folded: string;
	readonly needle: string;
	readonly used: ReadonlySet<string>;
}): MissCause {
	if (used.has(needle)) {
		return "already-used";
	}
	return folded.includes(needle) ? "earlier-than-previous" : "absent";
}

/**
 * Why a quote could not be turned into a cut.
 *
 * Three different things go wrong and only one of them means the model invented
 * text, so a run that reports them as one cannot be acted on: `absent` is a
 * quote the lecture does not contain, `already-used` is the same opening given
 * to two sections, and `earlier-than-previous` is a section claiming to begin
 * before the one before it ended.
 */
export type MissCause = "absent" | "already-used" | "earlier-than-previous";

/** A quote that could not be placed, and what was wrong with it. */
export type Miss = { readonly quote: string; readonly cause: MissCause };

/** How much of an unplaceable quote is worth keeping to recognise it by. */
const MISS_QUOTE_LENGTH = 40;

/**
 * Cuts the transcript at the positions the model named.
 *
 * Every block's text is sliced out of `sourceText`, so the result reproduces the
 * transcript exactly whatever the model returned. A quote that cannot be found
 * is reported rather than guessed at. A quote that begins one or two words into
 * its sentence — the model having dropped the lecturer's "So" — is cut at the
 * start of that sentence instead, so no block ends mid-sentence.
 */
export function applyCuts(
	sourceText: string,
	starts: readonly { id: number; label: string; startsWith: string }[],
): { readonly blocks: readonly { label: string; content: string }[]; readonly misses: readonly Miss[] } {
	const { folded, origin } = foldedIndex(sourceText);
	const misses: Miss[] = [];
	const used = new Set<string>();
	const cuts: number[] = [0];
	let searchFrom = 0;
	for (const start of starts.slice(1)) {
		const needle = start.startsWith.replace(/\s+/gu, "").toLowerCase();
		const found = needle === "" ? -1 : folded.indexOf(needle, searchFrom);
		if (found === -1) {
			misses.push({
				quote: start.startsWith.slice(0, MISS_QUOTE_LENGTH),
				cause: missCause({ folded, needle, used }),
			});
			continue;
		}
		used.add(needle);
		cuts.push(
			overLeadingConnectives({
				sourceText,
				cut: origin[found] ?? 0,
				notBefore: cuts[cuts.length - 1] ?? 0,
			}),
		);
		searchFrom = found + 1;
	}
	cuts.push(sourceText.length);
	const blocks = cuts.slice(0, -1).map((from, position) => ({
		label: starts[position]?.label ?? "",
		content: sourceText.slice(from, cuts[position + 1]),
	}));
	return { blocks, misses };
}

/** Applies the agreed rule: deletions up to the tolerance pass; anything else does not. */
export function judgeFidelity(sourceText: string, blocks: readonly { content: string }[]): string {
	const source = stripWhitespace(sourceText);
	const joined = stripWhitespace(blocks.map((block) => block.content).join(" "));
	if (source === joined) {
		return "EXACT";
	}
	const span = changedSpan(source, joined);
	const detail = `${JSON.stringify(span.from)}->${JSON.stringify(span.to)}`;
	if (!isSubsequence(source, joined)) {
		return `REJECT/altered ${detail}`;
	}
	const deleted = source.length - joined.length;
	return deleted <= DELETION_TOLERANCE
		? `ACCEPT/-${deleted} ${detail}`
		: `REJECT/-${deleted} ${detail}`;
}

