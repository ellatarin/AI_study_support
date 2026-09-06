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
 * Cuts the transcript at the positions the model named.
 *
 * Every block's text is sliced out of `sourceText`, so the result reproduces the
 * transcript exactly whatever the model returned. A quote that cannot be found
 * is reported rather than guessed at.
 */
export function applyCuts(
	sourceText: string,
	starts: readonly { id: number; label: string; startsWith: string }[],
): { readonly blocks: readonly { label: string; content: string }[]; readonly misses: readonly string[] } {
	const { folded, origin } = foldedIndex(sourceText);
	const misses: string[] = [];
	const cuts: number[] = [0];
	let searchFrom = 0;
	for (const start of starts.slice(1)) {
		const needle = start.startsWith.replace(/\s+/gu, "").toLowerCase();
		const found = needle === "" ? -1 : folded.indexOf(needle, searchFrom);
		if (found === -1) {
			misses.push(start.startsWith.slice(0, 40));
			continue;
		}
		cuts.push(origin[found] ?? 0);
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

