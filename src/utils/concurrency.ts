/**
 * This module runs the same asynchronous work on each entry of a list, a few
 * entries at a time. The batch runner uses it to run lectures at the same time.
 * The panel stages use it to make their runs at the same time
 * (technical-design.md §4.7; §5, "Dividing the transcript", Panel runs).
 */

/**
 * Runs `work` once for each entry in `items`. At most `limit` of these runs
 * happen at the same time. Returns the results in the order of `items`,
 * whatever order the runs finish in.
 *
 * When a run fails, no further run starts. The failure is thrown only after the
 * runs that already started have finished. So nothing is left running, unseen,
 * after the caller is told that the work failed.
 *
 * @param args - The items, the limit, and the work.
 * @param args.items - The entries to run `work` on.
 * @param args.limit - The most runs at the same time. Unset means one at a time,
 *   as an unset concurrency setting does. A value below 1 counts as 1, because
 *   callers are held only to the type, and 0 would start no run.
 * @param args.work - The work for one entry, given the entry and its position.
 * @returns The result for each entry, in the order of `items`.
 * @throws The first run's failure, after the runs that already started have finished.
 * @typeParam TItem - One entry of `items`.
 * @typeParam TResult - What one run produces.
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
	// In the order the runs failed. Any failure stops every worker from claiming more.
	const failures: unknown[] = [];
	// The claimed position decides whether there was work, so the bound is read
	// once rather than checked against the length and then read again.
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
