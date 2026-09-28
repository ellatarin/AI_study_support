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
 * @param args - The items, the bound, and the work.
 * @param args.items - What to work on.
 * @param args.limit - The most tasks in flight at once. Clamped to at least 1:
 *   callers are held only to the type, and 0 would start no task at all.
 * @param args.work - The task for one item, given the item and its position.
 * @returns Every item's result, in the items' order.
 * @typeParam TItem - What each task works on.
 * @typeParam TResult - What each task produces.
 */
export async function mapWithConcurrency<TItem, TResult>({
	items,
	limit,
	work,
}: {
	readonly items: readonly TItem[];
	readonly limit: number;
	readonly work: (args: { readonly item: TItem; readonly index: number }) => Promise<TResult>;
}): Promise<readonly TResult[]> {
	const results: TResult[] = new Array(items.length);
	let next = 0;
	// The claimed position decides whether there was work, so the bound is read
	// once rather than checked against the length and then read again.
	const worker = async (): Promise<void> => {
		for (;;) {
			const index = next;
			next += 1;
			if (index >= items.length) {
				return;
			}
			results[index] = await work({ item: items[index] as TItem, index });
		}
	};
	const workers: Promise<void>[] = [];
	for (let count = 0; count < Math.min(Math.max(1, limit), items.length); count += 1) {
		workers.push(worker());
	}
	await Promise.all(workers);
	return results;
}
