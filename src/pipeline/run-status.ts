/**
 * The rule that gives one {@link OverallStatus} for a pipeline run, a module or a
 * batch (technical-design.md §4.7, "Reducing outcomes to a status").
 *
 * The rule reads the stages of a lecture, the lectures of a module or the
 * lectures of a batch. The runner and the batch summary use it.
 * {@link isCompletedEntry} is here too, because it also reads a status.
 */

import type {
	CompletedStageEntry,
	OverallStatus,
	QaStageEntry,
	RunLogStageEntry,
	StageEntry,
} from "../types/pipeline.js";

/**
 * Tells if a stage entry is `complete` or `skipped`. Either status means that the
 * stage's output was made (technical-design.md §4.2).
 *
 * Each pipeline run after the one that made the stage's output writes `skipped`.
 * If only `complete` counted, the second pipeline run would remove the record of
 * that stage run, and the third would pay for the stage again.
 *
 * @param entry - The stage entry, or `undefined` for a stage with no entry.
 * @returns `true` when the entry is `complete` or `skipped`.
 */
export function isCompletedEntry(
	entry: StageEntry | QaStageEntry | undefined,
): entry is CompletedStageEntry {
	return entry?.status === "complete" || entry?.status === "skipped";
}

/**
 * Gives the status that one stage adds to its pipeline run: `failed` when the
 * stage ran and failed, and `success` otherwise. A skipped or `not-reached` stage
 * adds `success`, because it makes nothing fail (technical-design.md §4.7).
 *
 * @param entry - The stage's run log entry.
 * @returns The status that the stage adds.
 */
export function stageOutcomeStatus(entry: RunLogStageEntry): OverallStatus {
	if (entry.action === "skipped" || entry.action === "not-reached") {
		return "success";
	}
	return entry.status === "failed" ? "failed" : "success";
}

/**
 * Combines statuses. One `failed` status makes the combined status `failed`.
 * Otherwise the combined status is `success`, also for an empty list.
 *
 * @param args - The statuses to combine.
 * @param args.statuses - The statuses, in any order.
 * @returns The combined status.
 */
export function summariseOverallStatus({
	statuses,
}: {
	readonly statuses: readonly OverallStatus[];
}): OverallStatus {
	return statuses.includes("failed") ? "failed" : "success";
}

/**
 * Combines the statuses of a set of lectures with the rule of
 * {@link summariseOverallStatus}. The runner uses
 * it for a batch, and the batch summary uses it for each module
 * (technical-design.md §4.7). A `PipelineRunSummary` fits the parameter.
 *
 * @param args - The lectures to combine.
 * @param args.lectures - The overall status of each lecture, in any order.
 * @returns The status of the set.
 */
export function summariseLectures({
	lectures,
}: {
	readonly lectures: readonly { readonly overallStatus: OverallStatus }[];
}): OverallStatus {
	return summariseOverallStatus({ statuses: lectures.map((lecture) => lecture.overallStatus) });
}
