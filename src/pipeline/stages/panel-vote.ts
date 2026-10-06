/**
 * The vote of a panel's runs, and the distance of one run from it.
 * `choose-division` chooses the run nearest the vote. `group-into-topics` breaks
 * its ties with the distance from the vote (technical-design.md §5, `choose-division` and `group-into-topics`).
 *
 * Each run is given as the positions that it marks. For a splitting run, these
 * are the cut sites where it cuts. For a grouping run, these are the subtopics
 * where it starts a topic. A run must give each position only once, because a
 * repeated position counts twice.
 */

/**
 * The positions that the panel keeps: those that at least `bar` of its runs mark.
 *
 * @param args - The runs of the panel, and the bar.
 * @param args.runs - Each run, as the positions that it marks.
 * @param args.bar - The number of runs that must mark a position to keep it.
 * @returns The kept positions, in the order that they are first marked.
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
 * The distance of a run from the vote, or from another run. It is the number of
 * positions that one of the two marks and the other does not.
 *
 * @param args - The run, and the positions to measure it against.
 * @param args.run - The positions that the run marks.
 * @param args.vote - The positions to measure the run against.
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
