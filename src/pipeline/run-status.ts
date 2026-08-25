/**
 * Reading what a run and its stages amount to.
 *
 * Reducing what happened during a run to a single {@link OverallStatus}: the
 * same rule applies at every level — a stage within a lecture, a lecture within
 * a module, a module within a batch — so it is stated once here and applied by
 * the runner (which summarises a lecture and a batch) and by the cost reporting
 * that prints those summaries (technical-design.md §4.7).
 *
 * And reading a manifest stage entry for the one question three unrelated
 * callers ask of it — {@link hasSettledOutput} — which belongs beside the above
 * for the same reason: interpreting a status is one job with one home.
 */

import type {
	ManifestStageEntry,
	OverallStatus,
	QaManifestStageEntry,
	RunLogStageEntry,
	SettledStageEntry,
} from "../types/pipeline.js";

/**
 * Whether a stage's manifest entry means its output is on disk.
 *
 * `complete` and `skipped` both say so: the first is the run that did the work,
 * the second is every run after it, which finds the output already there and
 * records that it did not repeat it (technical-design.md §4.2). Treating only
 * `complete` as finished makes the second run erase the record that the work was
 * done, and the third pay for it again.
 *
 * A type guard rather than a boolean, so a caller that has checked can read the
 * entry's `filesWritten` without asserting.
 *
 * @param entry - The manifest entry, or `undefined` for a stage with none.
 * @returns `true` when the entry is a completed or skipped one.
 */
export function hasSettledOutput(
	entry: ManifestStageEntry | QaManifestStageEntry | undefined,
): entry is SettledStageEntry {
	return entry?.status === "complete" || entry?.status === "skipped";
}

/**
 * The status one stage contributes to its run: `failed` where the stage ran and
 * failed, and `success` everywhere else.
 *
 * This is what a stage contributes to the fold below, not a verdict on the stage
 * in isolation — `success` here means "nothing about this stage makes the run a
 * failure", which is as true of a stage the run never reached as of one that
 * finished. A skipped stage reads the same way {@link hasSettledOutput} reads it:
 * its output is on disk, and the run declining to produce it a second time is
 * the pipeline working, not work left undone.
 *
 * @param entry - The stage's run-log entry.
 * @returns The status that stage contributes.
 */
export function stageOutcomeStatus(entry: RunLogStageEntry): OverallStatus {
	if (entry.action === "skipped" || entry.action === "not-reached") {
		return "success";
	}
	return entry.status === "failed" ? "failed" : "success";
}

/**
 * Combines the statuses of a run's parts: any failure makes the whole failed,
 * and everything else — including nothing at all — is a success.
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
	return statuses.includes("failed") ? "failed" : "success";
}

/**
 * The same rule applied to a set of lectures.
 *
 * A lecture already carries its own {@link OverallStatus}, so combining a set of
 * them is a projection and a fold — which two callers were each writing out: the
 * runner across a whole batch, and the batch table for each module's rows within
 * it. Written once, the two cannot come to disagree about what a module of
 * half-failed lectures amounts to.
 *
 * The parameter asks for the status alone rather than for a whole `RunSummary`,
 * because that is all the rule reads; a `RunSummary` satisfies it.
 *
 * @param args - The lectures to combine.
 * @param args.lectures - Each lecture's settled status, in any order.
 * @returns The status of the set.
 */
export function summariseLectures({
	lectures,
}: {
	readonly lectures: readonly { readonly overallStatus: OverallStatus }[];
}): OverallStatus {
	return summariseOverallStatus({ statuses: lectures.map((lecture) => lecture.overallStatus) });
}
