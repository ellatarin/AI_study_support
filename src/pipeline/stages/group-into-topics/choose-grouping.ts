/**
 * The choice of the topics of a lecture from the grouping runs. The chosen
 * grouping is the grouping that the rules below rank first. It is handed on
 * whole from the earliest run that made it (technical-design.md §5,
 * `group-into-topics`, "The chosen grouping").
 */

import { NamedError } from "../../../utils/errors.js";
import { distanceFromVote, panelVote } from "../panel-vote.js";
import type { Topic } from "../topics.js";

/**
 * The error when `group-into-topics` cannot read the transcript or the retitled
 * division, or has no grouping runs to choose from.
 */
export class GroupIntoTopicsError extends NamedError {}

/** The topics of one grouping run, in order. */
export type GroupingRun = { readonly topics: readonly Topic[] };

/** The grouping runs of a panel in run order, and the bar of the vote. */
type GroupingPanel = { readonly runs: readonly GroupingRun[]; readonly bar: number };

/** The rule that put the chosen grouping above the other groupings. */
type DecidingRule = "most-runs" | "more-topics" | "closest-to-vote" | "earliest-run";

/**
 * The stage record of `group-into-topics`: the chosen run, its support, the panel
 * size and the deciding rule.
 */
export type GroupingChoice = {
	/** The chosen run, counting from 1, as the saved runs are numbered. */
	readonly chosenRun: number;
	/** The number of runs that made the chosen grouping. */
	readonly support: number;
	readonly panelSize: number;
	readonly decidedBy: DecidingRule;
};

/**
 * One grouping that the panel made. It holds the earliest run that made it and
 * the topics of that run. It also holds its support, and the distance of its
 * topic starts from the vote.
 */
type Grouping = {
	readonly earliestRunIndex: number;
	readonly topics: readonly Topic[];
	readonly support: number;
	readonly fromVote: number;
};

/**
 * Gives the topic starts of a run, without the first. Every run starts a topic
 * at subtopic 1, so only the later starts tell runs apart.
 *
 * @param run - The grouping run.
 * @returns The subtopic ids where its later topics start, in order.
 */
function laterStarts(run: GroupingRun): readonly number[] {
	return run.topics.slice(1).map((topic) => topic.firstSubtopicId);
}

/**
 * Sorts the runs into the groupings that they made. Two runs made the same
 * grouping when their topics start at the same subtopics, whatever their titles.
 *
 * @param args - The runs of the panel, and the bar of the vote.
 * @param args.runs - The grouping runs, in run order.
 * @param args.bar - The number of runs that must start a topic at a subtopic for the vote to keep it.
 * @returns The groupings, in the order that they were first made.
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

/**
 * Two groupings that a rule compares. The rule gives a negative number when
 * `one` comes first, and a positive number when `another` comes first. It gives
 * zero when it cannot tell them apart.
 */
type GroupingPair = { readonly one: Grouping; readonly another: Grouping };

/**
 * The rules that choose a grouping, in the order that they apply:
 * 1. More runs.
 * 2. More topics, between groupings that more than one run made.
 * 3. Topic starts nearer the vote.
 * 4. The earlier run.
 *
 * Rule 2 applies only to groupings that more than one run made. Otherwise rule 2
 * would choose the most finely divided run, even when only that run made its
 * grouping (technical-design.md §5, `group-into-topics`, "The chosen grouping").
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
 * @returns A negative number when `one` comes first, and a positive number when `another` comes first.
 */
// eslint-disable-next-line max-params -- the specification sets the parameters of the comparator of Array.prototype.sort.
function byPreference(one: Grouping, another: Grouping): number {
	let order = 0;
	for (const rule of RULES) {
		order ||= rule.compare({ one, another });
	}
	return order;
}

/**
 * Gives the rule that put the chosen grouping above the next grouping: the first
 * rule that tells them apart. Each grouping has a different earliest run, so the
 * last rule can always tell two groupings apart. When the panel made only one
 * grouping, the deciding rule is `most-runs`.
 *
 * @param args - The chosen grouping, and the grouping after it, if there is one.
 * @param args.chosen - The chosen grouping.
 * @param args.runnerUp - The next grouping, or `undefined` when there is none.
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
 * Chooses the topics of the lecture. It takes the grouping that the rules rank
 * first, whole, from the earliest run that made it. The vote only breaks ties.
 * It is never handed on, because it could make a grouping that no run made.
 *
 * @example
 * // Runs 2 and 3 start topics at subtopics 1 and 5. Runs 1, 4 and 5 each make a
 * // different grouping. The topics of run 2 are handed on, with
 * // `{ chosenRun: 2, support: 2, panelSize: 5, decidedBy: "most-runs" }`.
 * chooseGrouping({ runs, bar: 3 });
 *
 * @param panel - The grouping runs in run order, and the bar of the vote.
 * @returns The topics of the chosen run, unchanged, and the stage record of the choice.
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
