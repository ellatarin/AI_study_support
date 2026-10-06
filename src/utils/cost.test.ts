import { describe, expect, it } from "vitest";
import { accumulateCost, totalCost } from "./cost.js";

// The two costs that each test below adds, and their total. Only the prices
// change from test to test. So the tokens and call counts are here, and each
// test gives its own CostResolution.
const RUNNING_TOTAL = { promptTokens: 100, completionTokens: 50, callCount: 1 } as const;
const INCOMING_CALL = { promptTokens: 200, completionTokens: 80, callCount: 2 } as const;
const FOLDED = { promptTokens: 300, completionTokens: 130, callCount: 3 } as const;

describe("accumulateCost", () => {
	it.each([
		{
			name: "two resolved calls",
			current: { ...RUNNING_TOTAL, costUsd: 0.02 },
			incoming: { ...INCOMING_CALL, costUsd: 0.03 },
			expectedTokens: FOLDED,
			expectedCost: 0.05,
		},
		{
			name: "a zero accumulator and a resolved call",
			current: { promptTokens: 0, completionTokens: 0, callCount: 0, costUsd: 0 },
			incoming: { ...INCOMING_CALL, costUsd: 0.03 },
			expectedTokens: INCOMING_CALL,
			expectedCost: 0.03,
		},
	])("should sum tokens, calls, and cost when folding in $name", ({
		current,
		incoming,
		expectedTokens,
		expectedCost,
	}) => {
		const result = accumulateCost({ current, incoming });

		expect(result.promptTokens).toBe(expectedTokens.promptTokens);
		expect(result.completionTokens).toBe(expectedTokens.completionTokens);
		expect(result.callCount).toBe(expectedTokens.callCount);
		expect(result.costUsd).toBeCloseTo(expectedCost);
	});

	// One unknown price makes the total unknown, whichever cost it was in. A total
	// of only the known prices would name a price that the stage was not charged.
	// Two unknown costs give both reasons, each once, because the many calls of a
	// panel stage usually fail to price for one reason.
	it.each([
		{
			name: "the incoming call is unresolved",
			current: { ...RUNNING_TOTAL, costUsd: 0.02 },
			incoming: {
				...INCOMING_CALL,
				costUsd: null,
				unknownCostReason: "cost lookup timed out",
			},
			expectedError: "cost lookup timed out",
		},
		{
			name: "the running total is unresolved",
			current: {
				...RUNNING_TOTAL,
				costUsd: null,
				unknownCostReason: "generation lookup returned 503",
			},
			incoming: { ...INCOMING_CALL, costUsd: 0.03 },
			expectedError: "generation lookup returned 503",
		},
		{
			name: "both the running total and the incoming call are unresolved",
			current: {
				...RUNNING_TOTAL,
				costUsd: null,
				unknownCostReason: "slide 3 lookup failed",
			},
			incoming: {
				...INCOMING_CALL,
				costUsd: null,
				unknownCostReason: "slide 7 lookup failed",
			},
			expectedError: "slide 3 lookup failed; slide 7 lookup failed",
		},
		{
			name: "both are unresolved for the same reason",
			current: {
				...RUNNING_TOTAL,
				costUsd: null,
				unknownCostReason: "slide 3 lookup failed; reply carried no cost",
			},
			incoming: {
				...INCOMING_CALL,
				costUsd: null,
				unknownCostReason: "reply carried no cost",
			},
			expectedError: "slide 3 lookup failed; reply carried no cost",
		},
	])("should carry the error and null the cost when $name", ({
		current,
		incoming,
		expectedError,
	}) => {
		const result = accumulateCost({ current, incoming });

		expect(result).toEqual({ ...FOLDED, costUsd: null, unknownCostReason: expectedError });
	});

	it("should take the incoming cost as it is when nothing has been counted yet", () => {
		const incoming = { ...INCOMING_CALL, costUsd: 0.03 };
		expect(accumulateCost({ current: null, incoming })).toBe(incoming);
	});
});

describe("totalCost", () => {
	it.each([
		{ case: "there are no parts", costs: [] },
		{ case: "no part made a call", costs: [null, null] },
	])("should be null when $case", ({ costs }) => {
		expect(totalCost(costs)).toBeNull();
	});

	it("should add up the parts that made calls when some made none", () => {
		expect(
			totalCost([
				null,
				{ ...RUNNING_TOTAL, costUsd: 0.02 },
				null,
				{ ...INCOMING_CALL, costUsd: 0.03 },
			]),
		).toEqual({ ...FOLDED, costUsd: 0.05 });
	});
});
