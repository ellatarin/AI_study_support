/**
 * The count of a panel of check runs. A run keeps each fault whose Jev score
 * reaches the bar. The panel keeps a fault that enough runs keep.
 */

import { type KeyFault, MATTERS } from "./check-results.mts";
import { matchesKeyFault } from "./fault-matching.mts";
import type { ScoredFault } from "./jev-scores.mts";

/** One check run of a panel. */
export type PanelRun = { readonly name: string; readonly faults: readonly ScoredFault[] };

/**
 * The faults that a run or a panel keeps: the key faults that matter, the key
 * faults that do not matter, each by its key id, and the faults outside the key.
 */
export type KeptFaults = {
	readonly realFaults: readonly string[];
	readonly falseFaults: readonly string[];
	readonly notMarked: readonly ScoredFault[];
};

/** The faults that each run of a panel keeps, and the faults that the panel keeps. */
export type PanelCount = {
	readonly runs: readonly (KeptFaults & { readonly name: string })[];
	readonly panel: KeptFaults;
};

/**
 * Sorts the faults of one run that reach the Jev bar by the answer key.
 *
 * @param args - The faults, the answer key and the Jev bar.
 * @param args.faults - The faults of the run.
 * @param args.answerKey - The faults of the answer key.
 * @param args.jevBar - The least Jev score of a kept fault.
 * @returns The faults that the run keeps.
 */
function keepRunFaults({
	faults,
	answerKey,
	jevBar,
}: {
	readonly faults: readonly ScoredFault[];
	readonly answerKey: readonly KeyFault[];
	readonly jevBar: number;
}): KeptFaults {
	const kept = faults
		.filter((fault) => fault.jevScore >= jevBar)
		.map((fault) => ({ fault, keyFault: answerKey.find((keyFault) => matchesKeyFault({ fault, keyFault })) }));
	const keyIds = (matters: boolean): readonly string[] => [
		...new Set(
			kept.flatMap(({ keyFault }) =>
				keyFault !== undefined && (keyFault.userVerdict === MATTERS) === matters ? [keyFault.fault] : [],
			),
		),
	];
	return {
		realFaults: keyIds(true),
		falseFaults: keyIds(false),
		notMarked: kept.flatMap(({ fault, keyFault }) => (keyFault === undefined ? [fault] : [])),
	};
}

/**
 * Gives the items that enough runs hold. The items that `isSame` joins count as
 * one item, and the first of them stands for the group.
 *
 * @param args - The items of each run, the test of sameness and the votes needed.
 * @param args.runItems - The items of each run.
 * @param args.isSame - Checks that two items are the same item.
 * @param args.votesNeeded - The least number of runs that hold a kept item.
 * @returns The first item of each kept group, in the order that the runs give them.
 * @typeParam TItem - A key id or a fault.
 */
function keepVoted<TItem>({
	runItems,
	isSame,
	votesNeeded,
}: {
	readonly runItems: readonly (readonly TItem[])[];
	readonly isSame: (item: TItem, first: TItem) => boolean;
	readonly votesNeeded: number;
}): readonly TItem[] {
	const groups: { readonly first: TItem; readonly runs: Set<number> }[] = [];
	for (const [run, items] of runItems.entries()) {
		for (const item of items) {
			const group = groups.find(({ first }) => isSame(item, first));
			if (group === undefined) {
				groups.push({ first: item, runs: new Set([run]) });
			} else {
				group.runs.add(run);
			}
		}
	}
	return groups.filter(({ runs }) => runs.size >= votesNeeded).map(({ first }) => first);
}

/**
 * Counts the faults that each run of a panel keeps.
 *
 * @param args - The runs, the answer key, the Jev bar and the votes needed.
 * @param args.runs - The runs of the panel.
 * @param args.answerKey - The faults of the answer key, with the user's marks.
 * @param args.jevBar - The least Jev score of a kept fault.
 * @param args.votesNeeded - The least number of runs that keep a fault that the panel keeps.
 * @returns The faults that each run keeps.
 */
export function keepPanelFaults({
	runs,
	answerKey,
	jevBar,
	votesNeeded,
}: {
	readonly runs: readonly PanelRun[];
	readonly answerKey: readonly KeyFault[];
	readonly jevBar: number;
	readonly votesNeeded: number;
}): PanelCount {
	const kept = runs.map(({ name, faults }) => ({ name, ...keepRunFaults({ faults, answerKey, jevBar }) }));
	const isSameId = (id: string, first: string): boolean => id === first;
	return {
		runs: kept,
		panel: {
			realFaults: keepVoted({ runItems: kept.map((run) => run.realFaults), isSame: isSameId, votesNeeded }),
			falseFaults: keepVoted({ runItems: kept.map((run) => run.falseFaults), isSame: isSameId, votesNeeded }),
			notMarked: keepVoted({
				runItems: kept.map((run) => run.notMarked),
				isSame: (fault, first) => matchesKeyFault({ fault, keyFault: first }),
				votesNeeded,
			}),
		},
	};
}
