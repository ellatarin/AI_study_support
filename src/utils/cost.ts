/**
 * The arithmetic of what a stage spent.
 *
 * One operation, and it works entirely in stored US dollars: rounding, currency
 * and column widths are presentation, and live with the reports that do it
 * (`src/pipeline/reports.ts`). Keeping them apart is what lets a stage add up
 * what its calls cost without knowing anything about how a figure is shown
 * (technical-design.md §7).
 */

import type { StageCost } from "../types/pipeline.js";

/** What separates the reasons an unpriced stage cost gives, one per distinct reason. */
const REASON_SEPARATOR = "; ";

/**
 * Folds the calls a single stage made into that stage's one `StageCost`, summing
 * tokens, call counts and cost at full precision — rounding is a display concern
 * (technical-design.md §7).
 *
 * This stays inside one stage. Slide conversion issues a call per slide and
 * image extraction one per image, and each has a single figure to record; this
 * is how they reach it. Costs are never added across stages, runs, lectures or
 * modules (NFR-2.2).
 *
 * The merged cost is resolved only when both inputs resolved; if either is
 * `null` the result is `null` and the errors are joined, each distinct reason
 * once, so a stage that could not price one of its calls reports `n/a` rather
 * than the part that came back, and a stage whose many calls failed for one
 * reason states it once.
 *
 * A running accumulator of `null` means nothing has been counted yet, so a fold
 * can start from the first call's cost rather than from an invented zero.
 *
 * @param args - The two costs to combine.
 * @param args.current - The running accumulator, or `null` before the first call.
 * @param args.incoming - The call's cost to fold in.
 * @returns A `StageCost` carrying the combined counts and cost.
 */
export function accumulateCost({
	current,
	incoming,
}: {
	readonly current: StageCost | null;
	readonly incoming: StageCost;
}): StageCost {
	if (current === null) {
		return incoming;
	}
	const base = {
		promptTokens: current.promptTokens + incoming.promptTokens,
		completionTokens: current.completionTokens + incoming.completionTokens,
		callCount: current.callCount + incoming.callCount,
	};

	if (current.costUsd === null || incoming.costUsd === null) {
		const errors = [
			current.costUsd === null ? current.unknownCostReason : null,
			incoming.costUsd === null ? incoming.unknownCostReason : null,
		]
			.filter((message): message is string => message !== null)
			.flatMap((message) => message.split(REASON_SEPARATOR));
		return {
			...base,
			costUsd: null,
			unknownCostReason: [...new Set(errors)].join(REASON_SEPARATOR),
		};
	}
	return { ...base, costUsd: current.costUsd + incoming.costUsd };
}

/**
 * Folds the costs of a stage's parts — its runs, or a run's calls — into one,
 * passing over a part that made no call. Stays inside one stage, as
 * {@link accumulateCost} does.
 *
 * @param costs - Each part's cost, `null` for a part that made no call.
 * @returns What the parts cost together, or `null` when none of them made a call.
 */
export function totalCost(costs: readonly (StageCost | null)[]): StageCost | null {
	let total: StageCost | null = null;
	for (const cost of costs) {
		if (cost !== null) {
			total = accumulateCost({ current: total, incoming: cost });
		}
	}
	return total;
}
