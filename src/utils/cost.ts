/**
 * The arithmetic of what a stage spent. It works only in stored US dollars.
 * Rounding, currency and column widths belong to the reports in
 * `src/pipeline/reports.ts` (technical-design.md §7, "Cost and Reporting Modules").
 */

import type { CostTally, StageCost } from "../types/pipeline.js";

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
 * Adds up costs of one stage, such as the spend of its earlier runs and of this
 * run. A `null` cost is skipped.
 *
 * @param costs - Each cost, or `null` where nothing was spent.
 * @returns The total, or `null` when every cost is `null`.
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

/**
 * Makes an empty {@link CostTally} for one stage run.
 *
 * @returns The tally. Its total is `null` until a cost is added.
 */
export function createCostTally(): CostTally {
	let total: StageCost | null = null;
	return {
		add: (cost) => {
			total = accumulateCost({ current: total, incoming: cost });
		},
		total: () => total,
	};
}

/**
 * The cost tally of each model of one stage run, for a stage with a list of
 * models. The caller owns it, so each model's cost is still there when the stage
 * fails, as the stage's own {@link CostTally} is (technical-design.md §4.5, §7).
 */
export type CostTallyByModel = {
	/** Gives the tally of one model. The first call for a model makes it. */
	readonly tallyOf: (modelId: string) => CostTally;
	/** Gives the total of each model that has a cost, in the order of the first `tallyOf` call for each model. */
	readonly costByModel: () => readonly { readonly modelId: string; readonly cost: StageCost }[];
};

/**
 * Makes an empty {@link CostTallyByModel} for one stage run.
 *
 * @returns The tally of each model. It has no model until `tallyOf` is called.
 */
export function createCostTallyByModel(): CostTallyByModel {
	const tallies = new Map<string, CostTally>();
	return {
		tallyOf: (modelId) => {
			const tally = tallies.get(modelId) ?? createCostTally();
			tallies.set(modelId, tally);
			return tally;
		},
		costByModel: () =>
			[...tallies].flatMap(([modelId, tally]) => {
				const cost = tally.total();
				return cost === null ? [] : [{ modelId, cost }];
			}),
	};
}
