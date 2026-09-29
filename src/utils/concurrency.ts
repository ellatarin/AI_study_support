/**
 * Doing a list of asynchronous tasks a few at a time. Shared by the batch
 * runner, which runs lectures concurrently, and the panel stages, which make
 * their runs concurrently (technical-design.md §4.7; §5, "Dividing the
 * transcript", Panel runs).
 */

/**
 * Applies `work` to every item with at most `limit` tasks in flight, and returns
 * the results in the items' order whatever order they finish in.
 *
 * Once a task fails, no further task is started, and the failure is thrown only
 * after the tasks in flight have finished — so nothing is left running, unseen,
 * after the caller has been told the work failed.
 *
 * @param args - The items, the bound, and the work.
 * @param args.items - What to work on.
 * @param args.limit - The most tasks in flight at once; unset means one at a time,
 *   as an unset concurrency setting does. Clamped to at least 1: callers are held
 *   only to the type, and 0 would start no task at all.
 * @param args.work - The task for one item, given the item and its position.
 * @returns Every item's result, in the items' order.
 * @throws The first task's failure, once the tasks in flight have finished.
 * @typeParam TItem - What each task works on.
 * @typeParam TResult - What each task produces.
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
	// In the order the tasks failed; any failure stops every worker claiming more.
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
