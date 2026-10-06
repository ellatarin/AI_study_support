/**
 * This module does the same asynchronous work on each item of a list, a few
 * items at a time. The batch runner runs lectures with it. A panel stage makes
 * its splitting runs or grouping runs with it. Deepening makes the calls of one splitting run with it
 * (technical-design.md §4.7, and §5, "Dividing the transcript", Panel runs).
 */

/**
 * Runs `work` once for each item. At most `limit` runs go at the same time. The
 * results are in the order of `items`, whatever order the runs finish in.
 *
 * When a run fails, no further run starts. The failure is thrown only after the
 * runs that already started finish. So nothing is left running, unseen, after
 * the caller learns that the work failed.
 *
 * @param args - The items, the limit, and the work.
 * @param args.items - The items to run `work` on.
 * @param args.limit - The most runs at the same time. Unset means one at a time.
 *   A value below 1 counts as 1, because the type does not stop a caller from
 *   giving 0, and 0 would start no run.
 * @param args.work - The work for one item. It gets the item and its index.
 * @returns The result for each item, in the order of `items`.
 * @throws The first run's failure, after the runs that already started have finished.
 * @typeParam TItem - One entry of `items`.
 * @typeParam TResult - The value that one run produces.
 */
export async function mapWithConcurrency<TItem, TResult>({
	items,
	limit,
	work,
}: {
	readonly items: readonly TItem[];
	readonly limit: number | undefined;
	readonly work: (args: { readonly item: TItem; readonly index: number }) => Promise<TResult>;
}): Promise<readonly TResult[]> {
	const results: TResult[] = new Array(items.length);
	let next = 0;
	// The failures, in the order the runs failed. One failure stops every worker
	// from claiming another item.
	const failures: unknown[] = [];
	// A worker claims an index first and then checks it against the length. So
	// the shared counter is read once for each claim.
	const worker = async (): Promise<void> => {
		while (failures.length === 0) {
			const index = next;
			next += 1;
			if (index >= items.length) {
				return;
			}
			try {
				results[index] = await work({ item: items[index] as TItem, index });
			} catch (error: unknown) {
				failures.push(error);
			}
		}
	};
	const workers: Promise<void>[] = [];
	for (let count = 0; count < Math.min(Math.max(1, limit ?? 1), items.length); count += 1) {
		workers.push(worker());
	}
	await Promise.all(workers);
	if (failures.length > 0) {
		throw failures[0];
	}
	return results;
}
