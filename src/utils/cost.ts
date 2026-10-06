/**
 * The arithmetic of what a stage spent. It works only in stored US dollars.
 * Rounding, currency and column widths belong to the reports in
 * `src/pipeline/reports.ts` (technical-design.md §7, "Cost and Reporting Modules").
 */

import type { StageCost } from "../types/pipeline.js";

/** The text between two reasons in the reason for an unknown cost. */
const REASON_SEPARATOR = "; ";

/**
 * Adds one cost of a stage to the running total of the same stage, at full
 * precision. Costs are never added across stages, pipeline runs, lectures or
 * modules (NFR-2.2).
 *
 * If either cost is unknown, the total is an unknown cost. The reason of the
 * unknown total gives each different reason of the two costs once. So a stage that could not price one call shows `n/a`,
 * not the part of the cost that the provider reported (technical-design.md §7).
 *
 * @param args - The two costs to add.
 * @param args.current - The running total, or `null` before anything is counted.
 *   So a total starts from the first cost and not from an invented zero.
 * @param args.incoming - The cost to add.
 * @returns The total of the two costs.
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
 * Adds up the costs of the parts of one stage: its splitting runs or grouping
 * runs, or the calls of one splitting run. A part that made no call is skipped.
 *
 * @param costs - The cost of each part, or `null` for a part that made no call.
 * @returns The total, or `null` when no part made a call.
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
