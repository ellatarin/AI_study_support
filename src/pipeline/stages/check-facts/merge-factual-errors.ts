/**
 * The merge of the factual errors of two models (technical-design.md §5,
 * `check-facts`, "The merge", and CONTEXT.md, "Merged factual error").
 */

import { splitWords } from "../../../utils/text.js";

/** The severities that a fact check gives a factual error. */
export const SEVERITIES = ["serious", "minor"] as const;

/** One statement that a fact check reports as wrong or doubtful (CONTEXT.md, "Factual error"). */
export type FactualError = {
	readonly subtopicId: number;
	readonly passage: string;
	readonly problem: string;
	readonly correctStatement: string;
	readonly severity: (typeof SEVERITIES)[number];
};

/** The factual errors of one model. */
export type ModelFactualErrors = {
	readonly modelId: string;
	readonly factualErrors: readonly FactualError[];
};

/** A factual error after the merge, with the model ids that report it. */
export type FactualErrorFoundBy = FactualError & { readonly foundBy: readonly string[] };

/** The number of words in a run. Two passages that share a run of this length are the same passage. */
const RUN_LENGTH = 3;

/** A character that is not a letter, a digit, an underscore or whitespace. The merge reads it as a space. */
const PUNCTUATION = /[^\p{L}\p{N}_\s]/gu;

/**
 * Gives the runs of three words of a passage, in lower case, with each
 * punctuation mark read as a space. A passage of three words or fewer is one run.
 *
 * @param passage - The passage of a factual error.
 * @returns The runs, each as its words joined by one space.
 */
function wordRuns(passage: string): ReadonlySet<string> {
	const words = splitWords(passage.toLowerCase().replace(PUNCTUATION, " "));
	if (words.length <= RUN_LENGTH) {
		return new Set([words.join(" ")]);
	}
	const starts = [...words.slice(0, words.length - RUN_LENGTH + 1).keys()];
	return new Set(starts.map((start) => words.slice(start, start + RUN_LENGTH).join(" ")));
}

/**
 * Counts the runs of three words that two passages share.
 *
 * @param args - The two passages.
 * @param args.first - One passage.
 * @param args.second - The other passage.
 * @returns The number of shared runs.
 */
function sharedRunCount({
	first,
	second,
}: {
	readonly first: string;
	readonly second: string;
}): number {
	const secondRuns = wordRuns(second);
	return [...wordRuns(first)].filter((run) => secondRuns.has(run)).length;
}

/** A primary and a secondary factual error in one subtopic, by their indexes in each reply, with their shared runs. */
type CandidatePair = {
	readonly primaryIndex: number;
	readonly secondaryIndex: number;
	readonly sharedRuns: number;
};

/**
 * Pairs each secondary factual error with a primary factual error. A secondary
 * error joins the primary error in the same subtopic that shares the most runs
 * with it. On a tie, the earlier primary error wins, then the earlier secondary
 * error. A primary error takes no more than one secondary error.
 *
 * @param args - The factual errors of the two models.
 * @param args.primary - The factual errors of the primary model.
 * @param args.secondary - The factual errors of the secondary model.
 * @returns The index of the primary error for the index of each paired secondary error.
 */
function pairSecondaryErrors({
	primary,
	secondary,
}: {
	readonly primary: readonly FactualError[];
	readonly secondary: readonly FactualError[];
}): ReadonlyMap<number, number> {
	const candidates: readonly CandidatePair[] = [...primary.entries()].flatMap(
		([primaryIndex, primaryError]) =>
			[...secondary.entries()].flatMap(([secondaryIndex, secondaryError]) => {
				if (primaryError.subtopicId !== secondaryError.subtopicId) {
					return [];
				}
				const sharedRuns = sharedRunCount({
					first: primaryError.passage,
					second: secondaryError.passage,
				});
				return sharedRuns > 0 ? [{ primaryIndex, secondaryIndex, sharedRuns }] : [];
			}),
	);
	const ranked = [...candidates].sort(
		// eslint-disable-next-line max-params -- the specification sets the parameters of the comparator of Array.prototype.sort.
		(first, second) =>
			second.sharedRuns - first.sharedRuns ||
			first.primaryIndex - second.primaryIndex ||
			first.secondaryIndex - second.secondaryIndex,
	);
	const primaryOfSecondary = new Map<number, number>();
	const pairedPrimaries = new Set<number>();
	for (const { primaryIndex, secondaryIndex } of ranked) {
		if (primaryOfSecondary.has(secondaryIndex) || pairedPrimaries.has(primaryIndex)) {
			continue;
		}
		primaryOfSecondary.set(secondaryIndex, primaryIndex);
		pairedPrimaries.add(primaryIndex);
	}
	return primaryOfSecondary;
}

/**
 * Merges the factual errors of the primary model and the secondary model. Two
 * factual errors become one merged factual error when they are in the same
 * subtopic and their passages share a run of three words. A merged factual error
 * takes the primary model's text. With no secondary model, nothing merges.
 *
 * @param args - The subtopics in lecture order, and the factual errors of each model.
 * @param args.subtopicIds - The subtopic ids, in lecture order.
 * @param args.primary - The factual errors of the primary model.
 * @param args.secondary - The factual errors of the secondary model, or `undefined` when the stage calls one model.
 * @returns Each factual error with the model ids that report it, in lecture order
 *   of its subtopic. Within a subtopic, the primary model's errors come first, in
 *   the order of its reply, and then the secondary model's other errors.
 */
export function mergeFactualErrors({
	subtopicIds,
	primary,
	secondary,
}: {
	readonly subtopicIds: readonly number[];
	readonly primary: ModelFactualErrors;
	readonly secondary: ModelFactualErrors | undefined;
}): readonly FactualErrorFoundBy[] {
	const secondaryErrors = secondary?.factualErrors ?? [];
	const primaryOfSecondary = pairSecondaryErrors({
		primary: primary.factualErrors,
		secondary: secondaryErrors,
	});
	const pairedPrimaries = new Set(primaryOfSecondary.values());
	const fromPrimary = [...primary.factualErrors.entries()].map(([index, error]) => ({
		...error,
		foundBy:
			secondary !== undefined && pairedPrimaries.has(index)
				? [primary.modelId, secondary.modelId]
				: [primary.modelId],
	}));
	const fromSecondaryOnly =
		secondary === undefined
			? []
			: [...secondaryErrors.entries()]
					.filter(([index]) => !primaryOfSecondary.has(index))
					.map(([, error]) => ({ ...error, foundBy: [secondary.modelId] }));
	return subtopicIds.flatMap((subtopicId) =>
		[...fromPrimary, ...fromSecondaryOnly].filter((error) => error.subtopicId === subtopicId),
	);
}
