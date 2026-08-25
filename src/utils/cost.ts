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
 * `null` the result is `null` and the errors are joined, so a stage that could
 * not price one of its calls reports `n/a` rather than the part that came back.
 *
 * @param args - The two costs to combine.
 * @param args.current - The running accumulator.
 * @param args.incoming - The call's cost to fold in.
 * @returns A new `StageCost` carrying the combined counts and cost.
 */
export function accumulateCost({
	current,
	incoming,
}: {
	readonly current: StageCost;
	readonly incoming: StageCost;
}): StageCost {
	const base = {
		promptTokens: current.promptTokens + incoming.promptTokens,
		completionTokens: current.completionTokens + incoming.completionTokens,
		callCount: current.callCount + incoming.callCount,
	};

	if (current.costUsd === null || incoming.costUsd === null) {
		const errors = [
			current.costUsd === null ? current.costResolutionError : null,
			incoming.costUsd === null ? incoming.costResolutionError : null,
		].filter((message): message is string => message !== null);
		return { ...base, costUsd: null, costResolutionError: errors.join("; ") };
	}
	return { ...base, costUsd: current.costUsd + incoming.costUsd };
}
