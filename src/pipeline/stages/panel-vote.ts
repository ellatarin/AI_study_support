/**
 * The vote a panel's runs cast, and how far one run stands from it — shared by
 * `choose-division`, which chooses the run nearest the vote, and
 * `group-into-topics`, which breaks its ties by it (technical-design.md §5,
 * `choose-division` and `group-into-topics`).
 *
 * Each run is given as the positions it marks, each at most once: the cut sites
 * a splitting run cuts at, or the subtopics a grouping run starts a topic at.
 */

/**
 * The positions the panel keeps: those at least `bar` of its runs mark.
 *
 * @param args - The panel's runs, and the support a position needs.
 * @param args.runs - Each run as the positions it marks.
 * @param args.bar - How many runs must mark a position for it to be kept.
 * @returns The kept positions, in the order first marked.
 */
export function panelVote({
	runs,
	bar,
}: {
	readonly runs: readonly (readonly number[])[];
	readonly bar: number;
}): readonly number[] {
	const support = new Map<number, number>();
	for (const position of runs.flat()) {
		support.set(position, (support.get(position) ?? 0) + 1);
	}
	return [...support].filter(([, count]) => count >= bar).map(([position]) => position);
}

/**
 * How far a run stands from the vote, or from another run: the positions one of
 * the two marks and the other does not.
 *
 * @param args - The run, and what it is measured against.
 * @param args.run - The positions the run marks.
 * @param args.vote - The positions it is measured against.
 * @returns The number of positions where the two disagree.
 */
export function distanceFromVote({
	run,
	vote,
}: {
	readonly run: readonly number[];
	readonly vote: readonly number[];
}): number {
	const onlyInRun = run.filter((position) => !vote.includes(position)).length;
	const onlyInVote = vote.filter((position) => !run.includes(position)).length;
	return onlyInRun + onlyInVote;
}
