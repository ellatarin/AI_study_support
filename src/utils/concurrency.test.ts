import { describe, expect, it } from "vitest";
import { trackingInFlight, waitTurns } from "../pipeline/fixtures.js";
import { mapWithConcurrency } from "./concurrency.js";

/**
 * Work that records how many tasks are in flight at once, finishing later items
 * sooner so that completion order differs from input order.
 */
function trackedWork(): {
	readonly work: (args: { readonly item: number }) => Promise<number>;
	readonly peak: () => number;
} {
	const { tracked, peak } = trackingInFlight(async ({ item }: { readonly item: number }) => {
		await waitTurns({ turns: 10 - item });
		return item * 10;
	});
	return { work: tracked, peak };
}

const ITEMS = [1, 2, 3, 4, 5, 6, 7];

/** The error the first item's task fails with in the failure tests. */
const FIRST_ITEM_FAILURE = new Error("the first item failed");

/**
 * Work whose task for the first item fails at once while every other task takes
 * a few turns, recording which tasks started and which finished.
 */
function failingWork(): {
	readonly work: (args: { readonly item: number }) => Promise<number>;
	readonly started: readonly number[];
	readonly finished: readonly number[];
} {
	const started: number[] = [];
	const finished: number[] = [];
	return {
		work: async ({ item }) => {
			started.push(item);
			await waitTurns({ turns: 1 });
			if (item === ITEMS[0]) {
				throw FIRST_ITEM_FAILURE;
			}
			await waitTurns({ turns: 3 });
			finished.push(item);
			return item;
		},
		started,
		finished,
	};
}

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
		{ limit: undefined, expected: 1 },
		{ limit: 20, expected: ITEMS.length },
	])("should have at most $expected in flight when the limit is $limit", async ({
		limit,
		expected,
	}) => {
		const tracked = trackedWork();
		await mapWithConcurrency({ items: ITEMS, limit, work: tracked.work });
		expect(tracked.peak()).toBe(expected);
	});

	it("should start no further task when one fails", async () => {
		const failing = failingWork();
		await expect(mapWithConcurrency({ items: ITEMS, limit: 2, work: failing.work })).rejects.toBe(
			FIRST_ITEM_FAILURE,
		);
		// Long enough for a worker left running to have started every other item.
		await waitTurns({ turns: ITEMS.length * 4 });
		expect(failing.started).toEqual([1, 2]);
	});

	it("should let the tasks in flight finish before failing when one fails", async () => {
		const failing = failingWork();
		await expect(mapWithConcurrency({ items: ITEMS, limit: 3, work: failing.work })).rejects.toBe(
			FIRST_ITEM_FAILURE,
		);
		expect(failing.finished).toEqual([2, 3]);
	});

	it("should return no results when given no items", async () => {
		const { work } = trackedWork();
		expect(await mapWithConcurrency({ items: [], limit: 3, work })).toEqual([]);
	});
});
