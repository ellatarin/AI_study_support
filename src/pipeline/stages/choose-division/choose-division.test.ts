import { describe, expect, it } from "vitest";
import type { Subtopic } from "../division.js";
import { ChooseDivisionError, chooseDivision } from "./choose-division.js";

/** A transcript of 1,000 characters, so one percent of it is 10 characters. */
const TEXT = "x".repeat(1000);

/** Positions of cut sites far enough apart never to be one site. */
const A = 100;
const B = 300;
const C = 500;

/**
 * A splitting run cutting the transcript at `cuts`, each subtopic titled by
 * the run it belongs to, so the run handed on can be told from the rest.
 */
function runCuttingAt(runNumber: number, ...cuts: readonly number[]): readonly Subtopic[] {
	const starts = [0, ...cuts];
	return starts.map((start, index) => ({
		start,
		end: starts[index + 1] ?? TEXT.length,
		title: `Run ${runNumber}, subtopic ${index + 1}`,
		reason: `Reason ${index + 1}.`,
	}));
}

/** Chooses from runs each cutting where its list says, at `bar`. */
function choosing({
	cutsPerRun,
	bar,
}: {
	readonly cutsPerRun: readonly (readonly number[])[];
	readonly bar: number;
}): ReturnType<typeof chooseDivision> {
	return chooseDivision({
		text: TEXT,
		runs: cutsPerRun.map((cuts, index) => runCuttingAt(index + 1, ...cuts)),
		bar,
	});
}

/** A panel whose vote keeps A and B, which run 2 cuts at exactly and run 1 does not. */
const RUN_2_MATCHES_THE_VOTE = {
	cutsPerRun: [
		[A, C],
		[A, B],
		[A, B],
	],
	bar: 2,
} as const;

describe("chooseDivision", () => {
	it("should count cuts as one site when they lie within one percent of the site's first cut", () => {
		// As one site, 100 and 109 are cut by two runs and kept; as two, neither is.
		const { choice } = choosing({ cutsPerRun: [[100], [109], [200]], bar: 2 });
		expect(choice).toMatchObject({ chosenRun: 1, distanceFromVote: 0 });
	});

	it("should open a new site when a cut lies beyond one percent of the site's first cut even within one percent of the previous cut", () => {
		// 116 is within 1% of 108 but not of 100, so it is a site of its own and
		// the run cutting only there is two sites from the vote.
		const { choice } = choosing({ cutsPerRun: [[116], [100], [108]], bar: 2 });
		expect(choice).toMatchObject({ chosenRun: 2, distanceFromVote: 0 });
	});

	it("should credit a run with a site when its cut lies within half a percent beyond the site even in a site of its own", () => {
		// 100 and 109 form one site; 112 opens its own, yet lies within 114, the
		// first site's end widened by half a percent, so all three runs cut there.
		const { choice } = choosing({ cutsPerRun: [[112], [109], [100]], bar: 3 });
		expect(choice).toMatchObject({ chosenRun: 3, distanceFromVote: 0 });
	});

	it("should choose the run whose cut sites differ least from the vote's when runs differ", () => {
		const { choice } = choosing(RUN_2_MATCHES_THE_VOTE);
		expect(choice).toMatchObject({ chosenRun: 2, distanceFromVote: 0 });
	});

	it("should break a tie for the vote to the run closest to the others when two runs are equally near", () => {
		// The vote keeps A alone. Every run is one site from it, but runs 2 and 3
		// agree with each other where run 1 agrees with neither.
		const { choice } = choosing({
			cutsPerRun: [
				[A, B],
				[A, C],
				[A, C],
			],
			bar: 3,
		});
		expect(choice).toMatchObject({ chosenRun: 2, distanceFromVote: 1 });
	});

	it("should break a remaining tie to the earliest run when runs are equally near the vote and the others", () => {
		const { choice } = choosing({
			cutsPerRun: [
				[A, B],
				[A, C],
			],
			bar: 2,
		});
		expect(choice).toMatchObject({ chosenRun: 1, distanceFromVote: 1 });
	});

	it("should report the chosen run counting from 1 with its distance from the vote and the panel size when a run is chosen", () => {
		const { choice } = choosing(RUN_2_MATCHES_THE_VOTE);
		expect(choice).toStrictEqual({ chosenRun: 2, distanceFromVote: 0, panelSize: 3 });
	});

	it("should fail when there are no runs to choose from", () => {
		expect(() => choosing({ cutsPerRun: [], bar: 1 })).toThrow(ChooseDivisionError);
	});

	it("should hand on the chosen run's subtopics unchanged, titles and reasons included, when a run is chosen", () => {
		const { subtopics } = choosing(RUN_2_MATCHES_THE_VOTE);
		expect(subtopics).toStrictEqual(runCuttingAt(2, A, B));
	});
});
