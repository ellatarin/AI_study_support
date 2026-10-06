import { describe, expect, it } from "vitest";
import {
	chooseGrouping,
	GroupIntoTopicsError,
	type GroupingChoice,
	type GroupingRun,
} from "./choose-grouping.js";

/** The support the vote asks of a topic start: more than half of a five-run panel. */
const BAR = 3;

/**
 * A grouping run starting a topic at subtopic 1 and at each of `laterStarts`,
 * each topic named after its run, so the run handed on can be told from the rest.
 */
function runStartingAt(runNumber: number, ...laterStarts: readonly number[]): GroupingRun {
	return {
		topics: [1, ...laterStarts].map((firstSubtopicId, index) => ({
			title: `Run ${runNumber}, topic ${index + 1}`,
			groupedBecause: `Reason ${index + 1}.`,
			firstSubtopicId,
		})),
	};
}

/** Chooses from runs each starting its later topics where its list says. */
function choosing(
	laterStartsPerRun: readonly (readonly number[])[],
): ReturnType<typeof chooseGrouping> {
	return chooseGrouping({
		runs: laterStartsPerRun.map((starts, index) => runStartingAt(index + 1, ...starts)),
		bar: BAR,
	});
}

/** A five-run panel, and how it is chosen from: each panel decided by a different rule. */
type DecidedPanel = {
	readonly laterStartsPerRun: readonly (readonly number[])[];
	readonly chosenRun: number;
	readonly support: number;
	readonly decidedBy: GroupingChoice["decidedBy"];
};

/** Runs 2 and 3 make the one grouping two runs made. */
const MOST_RUNS: DecidedPanel = {
	laterStartsPerRun: [[3], [5], [5], [5, 7], [3, 7]],
	chosenRun: 2,
	support: 2,
	decidedBy: "most-runs",
};

/** Every run makes the same grouping, so there is no other to set it above. */
const EVERY_RUN_AGREES: DecidedPanel = {
	laterStartsPerRun: [[5], [5], [5], [5], [5]],
	chosenRun: 1,
	support: 5,
	decidedBy: "most-runs",
};

/** Two groupings each made by two runs; runs 3 and 4's has more topics. */
const MORE_TOPICS: DecidedPanel = {
	laterStartsPerRun: [[3], [3], [3, 6], [3, 6], [7]],
	chosenRun: 3,
	support: 2,
	decidedBy: "more-topics",
};

/*
 * In both vote panels the vote keeps exactly run 3's starts, and run 3 is
 * neither the earliest candidate nor the one with the most topics.
 */
const CLOSEST_WHEN_EVERY_RUN_DIFFERS: DecidedPanel = {
	laterStartsPerRun: [[3], [3, 5, 7, 9], [3, 5], [5, 8], [3, 5, 2]],
	chosenRun: 3,
	support: 1,
	decidedBy: "closest-to-vote",
};

const CLOSEST_WHEN_TIED_ON_TOPICS: DecidedPanel = {
	laterStartsPerRun: [[3], [3], [5], [5], [5, 9]],
	chosenRun: 3,
	support: 2,
	decidedBy: "closest-to-vote",
};

/** Every run differs and no start reaches the bar, so every run is as far from the empty vote. */
const EARLIEST_RUN: DecidedPanel = {
	laterStartsPerRun: [[3], [5], [7], [9], [2]],
	chosenRun: 1,
	support: 1,
	decidedBy: "earliest-run",
};

describe("chooseGrouping", () => {
	it("should choose the grouping the most runs made when one leads", () => {
		const { choice } = choosing(MOST_RUNS.laterStartsPerRun);

		expect(choice.chosenRun).toBe(MOST_RUNS.chosenRun);
	});

	it("should treat runs as the same grouping when their starts match and their titles differ", () => {
		// Every run names its topics after itself, so runs 1 and 3 agree only on where topics start.
		const { choice } = choosing([[5], [3], [5]]);

		expect(choice).toMatchObject({ chosenRun: 1, support: 2 });
	});

	it("should choose the grouping with more topics when two groupings made by more than one run each tie on runs", () => {
		const { choice } = choosing(MORE_TOPICS.laterStartsPerRun);

		expect(choice.chosenRun).toBe(MORE_TOPICS.chosenRun);
	});

	it.each([
		{ panel: "every run differs", decided: CLOSEST_WHEN_EVERY_RUN_DIFFERS },
		{ panel: "the tied groupings have as many topics", decided: CLOSEST_WHEN_TIED_ON_TOPICS },
	])("should choose the run whose topic starts are closest to the vote when $panel", ({
		decided,
	}) => {
		const { choice } = choosing(decided.laterStartsPerRun);

		expect(choice.chosenRun).toBe(decided.chosenRun);
	});

	it("should choose the earliest run when closeness to the vote still ties", () => {
		const { choice } = choosing(EARLIEST_RUN.laterStartsPerRun);

		expect(choice.chosenRun).toBe(EARLIEST_RUN.chosenRun);
	});

	it("should hand on the earliest run's topics when several runs made the chosen grouping", () => {
		const { topics } = choosing([[3], [5], [5], [5], [7]]);

		expect(topics.map((topic) => topic.title)).toEqual(["Run 2, topic 1", "Run 2, topic 2"]);
	});

	it("should fail when there are no runs to choose from", () => {
		expect(() => chooseGrouping({ runs: [], bar: BAR })).toThrow(GroupIntoTopicsError);
	});

	it.each([
		MOST_RUNS,
		EVERY_RUN_AGREES,
		MORE_TOPICS,
		CLOSEST_WHEN_TIED_ON_TOPICS,
		EARLIEST_RUN,
	])("should report the chosen run, its support, the panel size and the rule that decided when $decidedBy decides", ({
		laterStartsPerRun,
		chosenRun,
		support,
		decidedBy,
	}) => {
		const { choice } = choosing(laterStartsPerRun);

		expect(choice).toEqual({ chosenRun, support, panelSize: 5, decidedBy });
	});
});
