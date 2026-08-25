import { describe, expect, it } from "vitest";
import { accumulateCost } from "./cost.js";

// The two operands every fold below is made of, and what they come to. Only
// their prices vary from test to test, so the tokens and call counts are stated
// here and each test supplies its own CostResolution.
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

	// One call's price unknown leaves the stage's own figure unknown, whichever
	// operand it was: reporting the calls that did resolve would name a price the
	// stage was not charged. Two unknowns carry both reasons, joined.
	it.each([
		{
			name: "the incoming call is unresolved",
			current: { ...RUNNING_TOTAL, costUsd: 0.02 },
			incoming: {
				...INCOMING_CALL,
				costUsd: null,
				costResolutionError: "cost lookup timed out",
			},
			expectedError: "cost lookup timed out",
		},
		{
			name: "the running total is unresolved",
			current: {
				...RUNNING_TOTAL,
				costUsd: null,
				costResolutionError: "generation lookup returned 503",
			},
			incoming: { ...INCOMING_CALL, costUsd: 0.03 },
			expectedError: "generation lookup returned 503",
		},
		{
			name: "both the running total and the incoming call are unresolved",
			current: {
				...RUNNING_TOTAL,
				costUsd: null,
				costResolutionError: "slide 3 lookup failed",
			},
			incoming: {
				...INCOMING_CALL,
				costUsd: null,
				costResolutionError: "slide 7 lookup failed",
			},
			expectedError: "slide 3 lookup failed; slide 7 lookup failed",
		},
	])("should carry the error and null the cost when $name", ({
		current,
		incoming,
		expectedError,
	}) => {
		const result = accumulateCost({ current, incoming });

		expect(result).toEqual({ ...FOLDED, costUsd: null, costResolutionError: expectedError });
	});
});
