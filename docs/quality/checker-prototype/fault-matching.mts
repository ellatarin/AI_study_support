/**
 * The test that a checker's fault is a fault of the answer key. A script cannot
 * know that two faults are the same, so the test looks at the quoted passages.
 * Two faults match when they are in the same subtopic and a passage of one
 * shares {@link SHARED_WORDS} words in a row with the same passage of the other.
 * The comparison shows both descriptions, so that a reader sees a wrong match.
 */

/** The number of words in a row that two passages must share to match. */
const SHARED_WORDS = 4;

/** The parts of a fault that the test reads. */
export type QuotedFault = {
	readonly subtopicId: number;
	readonly sourcePassage: string | null;
	readonly rewritePassage: string | null;
};

/**
 * Splits a passage into lower-case words with no punctuation. A spelling such as
 * "tumour" for "tumor" stays a different word.
 *
 * @param passage - The passage.
 * @returns The words, in order.
 */
function words(passage: string): readonly string[] {
	return passage
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, " ")
		.split(/\s+/)
		.filter((word) => word !== "");
}

/**
 * Gives each run of {@link SHARED_WORDS} words in a passage, joined by spaces.
 *
 * @param passage - The passage.
 * @returns The runs. A passage shorter than the run gives itself as its only run.
 */
function wordRuns(passage: string): ReadonlySet<string> {
	const all = words(passage);
	if (all.length <= SHARED_WORDS) {
		return new Set([all.join(" ")]);
	}
	return new Set(
		all.slice(0, all.length - SHARED_WORDS + 1).map((_, start) =>
			all.slice(start, start + SHARED_WORDS).join(" "),
		),
	);
}

/**
 * Checks that two passages share a run of words. A null passage shares nothing.
 *
 * @param args - The two passages.
 * @param args.first - One passage.
 * @param args.second - The other passage.
 * @returns `true` when the passages share a run.
 */
function sharesWords({
	first,
	second,
}: {
	readonly first: string | null;
	readonly second: string | null;
}): boolean {
	if (first === null || second === null) {
		return false;
	}
	const secondRuns = wordRuns(second);
	return [...wordRuns(first)].some((run) => run !== "" && secondRuns.has(run));
}

/**
 * Checks that a checker's fault is the same fault as a fault of the answer key.
 *
 * @param args - The two faults.
 * @param args.fault - The checker's fault.
 * @param args.keyFault - The fault of the answer key.
 * @returns `true` when both are in one subtopic and their source or rewrite passages share a run of words.
 */
export function matchesKeyFault({
	fault,
	keyFault,
}: {
	readonly fault: QuotedFault;
	readonly keyFault: QuotedFault;
}): boolean {
	return (
		fault.subtopicId === keyFault.subtopicId &&
		(sharesWords({ first: fault.sourcePassage, second: keyFault.sourcePassage }) ||
			sharesWords({ first: fault.rewritePassage, second: keyFault.rewritePassage }))
	);
}
