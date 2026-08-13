/**
 * Reducing what happened during a run to a single {@link OverallStatus}.
 *
 * The same three-way rule applies at every level — a stage within a lecture, a
 * lecture within a module, a module within a batch — so it is stated once here
 * and applied by the runner (which summarises a lecture and a batch) and by the
 * cost reporting that prints those summaries (technical-design.md §4.7).
 */

import type { OverallStatus, RunLogStageEntry } from "../types/pipeline.js";

/**
 * The status one stage contributes to its run: a failure outright, a skipped or
 * unreached stage as `partial` (work the run did not do), and a completed stage
 * as `success`.
 *
 * @param entry - The stage's run-log entry.
 * @returns The status that stage contributes.
 */
export function stageOutcomeStatus(entry: RunLogStageEntry): OverallStatus {
	if (entry.action === "skipped" || entry.action === "not-reached") {
		return "partial";
	}
	return entry.status === "failed" ? "failed" : "success";
}

/**
 * Combines the statuses of a run's parts: any failure makes the whole failed,
 * any partial makes it partial, and everything else — including nothing at all —
 * is a success.
 *
 * @param args - The statuses to combine.
 * @param args.statuses - The parts' statuses, in any order.
 * @returns The combined status.
 */
export function summariseOverallStatus({
	statuses,
}: {
	readonly statuses: readonly OverallStatus[];
}): OverallStatus {
	if (statuses.includes("failed")) {
		return "failed";
	}
	if (statuses.includes("partial")) {
		return "partial";
	}
	return "success";
}
