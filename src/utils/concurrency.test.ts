import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./concurrency.js";

/** Resolves on the next turn of the event loop, so tasks genuinely overlap. */
function tick(): Promise<void> {
	return new Promise((resolve) => {
		setImmediate(resolve);
	});
}

/**
 * Work that records how many tasks are in flight at once, finishing later items
 * sooner so that completion order differs from input order.
 */
function trackedWork(): {
	readonly work: (args: { readonly item: number }) => Promise<number>;
	readonly peak: () => number;
} {
	let inFlight = 0;
	let peak = 0;
	return {
		work: async ({ item }) => {
			inFlight += 1;
			peak = Math.max(peak, inFlight);
			for (let turn = 0; turn < 10 - item; turn += 1) {
				await tick();
			}
			inFlight -= 1;
			return item * 10;
		},
		peak: () => peak,
	};
}

const ITEMS = [1, 2, 3, 4, 5, 6, 7];

describe("mapWithConcurrency", () => {
	it("should return every result in input order when items finish out of order", async () => {
		const { work } = trackedWork();
		expect(await mapWithConcurrency({ items: ITEMS, limit: 3, work })).toEqual([
			10, 20, 30, 40, 50, 60, 70,
		]);
	});

	it.each([
		{ limit: 3, expected: 3 },
		{ limit: 1, expected: 1 },
		{ limit: 0, expected: 1 },
		{ limit: 20, expected: ITEMS.length },
	])("should have at most $expected in flight when the limit is $limit", async ({
		limit,
		expected,
	}) => {
		const tracked = trackedWork();
		await mapWithConcurrency({ items: ITEMS, limit, work: tracked.work });
		expect(tracked.peak()).toBe(expected);
	});

	it("should return no results when given no items", async () => {
		const { work } = trackedWork();
		expect(await mapWithConcurrency({ items: [], limit: 3, work })).toEqual([]);
	});
});
