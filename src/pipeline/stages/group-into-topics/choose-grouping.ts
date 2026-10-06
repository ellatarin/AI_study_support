/**
 * Choosing the lecture's topics from the grouping runs: the grouping the most
 * runs made, handed on whole from the earliest run that made it
 * (technical-design.md §5, `group-into-topics`, "The chosen grouping").
 */

import { NamedError } from "../../../utils/errors.js";
import { distanceFromVote, panelVote } from "../panel-vote.js";

/** The stage could not group the lecture's subtopics into topics. */
export class GroupIntoTopicsError extends NamedError {}

/** One topic of a grouping run: its title, why its subtopics belong together, and where it starts. */
export type Topic = {
	readonly title: string;
	readonly groupedBecause: string;
	/** The topic's first subtopic, counting from 1. */
	readonly firstSubtopicId: number;
};

/** One grouping run's topics, in order. */
export type GroupingRun = { readonly topics: readonly Topic[] };

/** A panel of grouping runs, in run order, and how many must start a topic at a subtopic for the vote to keep it. */
type GroupingPanel = { readonly runs: readonly GroupingRun[]; readonly bar: number };

/** The rule that set the chosen grouping above the rest. */
type DecidingRule = "most-runs" | "more-topics" | "closest-to-vote" | "earliest-run";

/** Which run was chosen, how many runs made its grouping, out of how many, and which rule decided. */
export type GroupingChoice = {
	/** The chosen run, counting from 1 as the run files are numbered. */
	readonly chosenRun: number;
	/** How many runs made the chosen grouping. */
	readonly support: number;
	readonly panelSize: number;
	readonly decidedBy: DecidingRule;
};

/**
 * One grouping the panel made: the earliest run that made it and that run's
 * topics, how many runs made it, and how far its topic starts stand from the vote.
 */
type Grouping = {
	readonly earliestRunIndex: number;
	readonly topics: readonly Topic[];
	readonly support: number;
	readonly fromVote: number;
};

/**
 * Where a run starts its topics, the first excepted: every run starts one at
 * subtopic 1, so only the later starts tell runs apart.
 *
 * @param run - The grouping run.
 * @returns The subtopics its later topics start at, in order.
 */
function laterStarts(run: GroupingRun): readonly number[] {
	return run.topics.slice(1).map((topic) => topic.firstSubtopicId);
}

/**
 * Sorts the runs into the groupings they made: two runs made the same grouping
 * when their topics start at the same subtopics, whatever they named them.
 *
 * @param args - The panel's runs, and the support a topic start needs in the vote.
 * @param args.runs - The grouping runs, in run order.
 * @param args.bar - How many runs must start a topic at a subtopic for the vote to keep it.
 * @returns The groupings, in the order first made.
 */
function groupingsMade({ runs, bar }: GroupingPanel): readonly Grouping[] {
	const vote = panelVote({ runs: runs.map(laterStarts), bar });
	const byKey = new Map<string, Grouping>();
	for (const [index, run] of runs.entries()) {
		const starts = laterStarts(run);
		const key = starts.join(",");
		const made = byKey.get(key);
		byKey.set(
			key,
			made === undefined
				? {
						earliestRunIndex: index,
						topics: run.topics,
						support: 1,
						fromVote: distanceFromVote({ run: starts, vote }),
					}
				: { ...made, support: made.support + 1 },
		);
	}
	return [...byKey.values()];
}

/** Two groupings to compare: negative when `one` comes first, positive when `another` does, zero when the rule cannot tell them apart. */
type GroupingPair = { readonly one: Grouping; readonly another: Grouping };

/**
 * The rules a grouping is chosen by, in the order they are asked: more runs;
 * then, between groupings each made by more than one run, more topics; then
 * the one whose topic starts stand closer to the vote; then the earlier run.
 * More topics is not asked of groupings made by one run, since it would then
 * favour the most finely divided run with nothing but that run behind it.
 */
const RULES: readonly {
	readonly name: DecidingRule;
	readonly compare: (pair: GroupingPair) => number;
}[] = [
	{ name: "most-runs", compare: ({ one, another }) => another.support - one.support },
	{
		name: "more-topics",
		compare: ({ one, another }) =>
			one.support > 1 ? another.topics.length - one.topics.length : 0,
	},
	{ name: "closest-to-vote", compare: ({ one, another }) => one.fromVote - another.fromVote },
	{
		name: "earliest-run",
		compare: ({ one, another }) => one.earliestRunIndex - another.earliestRunIndex,
	},
];

/**
 * Orders two groupings by the first rule that tells them apart.
 *
 * @param one - A grouping.
 * @param another - The grouping it is compared with.
 * @returns Negative when `one` comes first, positive when `another` does.
 */
// eslint-disable-next-line max-params -- Array.prototype.sort's comparator is spec-defined
function byPreference(one: Grouping, another: Grouping): number {
	let order = 0;
	for (const rule of RULES) {
		order ||= rule.compare({ one, another });
	}
	return order;
}

/**
 * The rule that set the chosen grouping above the next: the first that tells
 * them apart. Every distinct grouping has a different earliest run, so the
 * last rule always can; a panel that made one grouping was decided by its runs.
 *
 * @param args - The chosen grouping, and the one ranked after it, if any.
 * @param args.chosen - The chosen grouping.
 * @param args.runnerUp - The grouping ranked next, or `undefined` when there is none.
 * @returns The deciding rule.
 */
function decidingRule({
	chosen,
	runnerUp,
}: {
	readonly chosen: Grouping;
	readonly runnerUp: Grouping | undefined;
}): DecidingRule {
	if (runnerUp === undefined) {
		return "most-runs";
	}
	const decisive = RULES.slice(0, -1).find(
		(rule) => rule.compare({ one: chosen, another: runnerUp }) !== 0,
	);
	return decisive?.name ?? "earliest-run";
}

/**
 * Chooses the lecture's topics: the grouping the rules rank first, taken whole
 * from the earliest run that made it. The vote only breaks ties, and is never
 * handed on, since it could assemble a grouping no run made.
 *
 * @example
 * // Runs 2 and 3 start topics at subtopics 1 and 5, the others elsewhere:
 * // run 2's topics are handed on, with `{ chosenRun: 2, support: 2, panelSize: 5, decidedBy: "most-runs" }`.
 * chooseGrouping({ runs, bar: 3 });
 *
 * @param panel - The grouping runs, in run order, and the support a topic start needs in the vote.
 * @returns The chosen run's topics unchanged, and how it was chosen.
 * @throws {GroupIntoTopicsError} When there are no runs to choose from.
 */
export function chooseGrouping(panel: GroupingPanel): {
	readonly topics: readonly Topic[];
	readonly choice: GroupingChoice;
} {
	const [chosen, runnerUp] = [...groupingsMade(panel)].sort(byPreference);
	if (chosen === undefined) {
		throw new GroupIntoTopicsError("A grouping cannot be chosen from no runs");
	}
	return {
		topics: chosen.topics,
		choice: {
			chosenRun: chosen.earliestRunIndex + 1,
			support: chosen.support,
			panelSize: panel.runs.length,
			decidedBy: decidingRule({ chosen, runnerUp }),
		},
	};
}
