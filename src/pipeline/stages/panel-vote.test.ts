import { describe, expect, it } from "vitest";
import { distanceFromVote, panelVote } from "./panel-vote.js";

describe("panelVote", () => {
	// Position 1 is marked by three runs, 2 by two, 3 by one.
	const runs = [[1, 2, 3], [1, 2], [1]];

	it.each([
		{ bar: 1, vote: [1, 2, 3] },
		{ bar: 2, vote: [1, 2] },
		{ bar: 3, vote: [1] },
	])("should keep only the positions at least $bar runs mark when the bar is $bar", ({
		bar,
		vote,
	}) => {
		expect(panelVote({ runs, bar })).toStrictEqual(vote);
	});
});

describe("distanceFromVote", () => {
	it("should count the positions where one of the run and the vote marks and the other does not when they differ", () => {
		expect(distanceFromVote({ run: [1, 2, 5], vote: [1, 3] })).toBe(3);
	});
});
