/**
 * Saying what a run is doing, while it does it.
 *
 * The runner reports what happens to each stage as it happens; this turns those
 * facts into the lines a user reads. The wording lives here rather than in the
 * runner for the same reason every other block of user-facing text does: showing
 * things to a user is the CLI's job, and the CLI is the layer that owns the
 * stream they go to (technical-design.md §8, §10).
 */

import { lectureHeading, type MoneyFormatter, stageLabel } from "../pipeline/reports.js";
import type { RunEvent, RunReporter, StageCost } from "../types/pipeline.js";
import { pluralise } from "../utils/text.js";
import type { WriteText } from "./commands.js";

/** Marks the line that says a stage has begun. */
const STARTED = "▶";

/** Marks the line that says a stage finished the work. */
const COMPLETED = "✔";

/** Marks the line that says a stage had nothing to do. */
const SKIPPED = "−";

/** Marks the line that says a stage failed. */
const FAILED = "✖";

/**
 * What a completed stage spent, as the tail of its notice — the calls it made
 * and what they cost. A stage that makes no billable call has no tail at all,
 * rather than one reading zero: audio extraction and PDF generation buy nothing,
 * and saying so every run would be noise (technical-design.md §7).
 *
 * @param args - The stage's recorded cost and the report's money formatter.
 * @param args.cost - What the stage recorded, or `null` if it charged nothing.
 * @param args.formatMoney - The formatter converting stored dollars for display.
 * @returns The tail, empty when there is nothing to report.
 */
function spendTail({
	cost,
	formatMoney,
}: {
	readonly cost: StageCost | null;
	readonly formatMoney: MoneyFormatter;
}): string {
	if (cost === null) {
		return "";
	}
	return ` — ${pluralise({ count: cost.callCount, noun: "call" })}, ${formatMoney(cost.costUsd)}`;
}

/**
 * The line one event is written as.
 *
 * @param args - The event and the report's money formatter.
 * @param args.event - What happened.
 * @param args.formatMoney - The formatter converting stored dollars for display.
 * @returns The line, newline included.
 */
function noticeFor({
	event,
	formatMoney,
}: {
	readonly event: RunEvent;
	readonly formatMoney: MoneyFormatter;
}): string {
	if (event.event === "lecture-started") {
		// A blank line above, because a batch writes one of these between lectures
		// and the eye needs the break to see where one lecture's run ends.
		return `\n${lectureHeading({ manifest: event.manifest })}\n`;
	}
	const label = stageLabel({ stageId: event.stageId });
	if (event.event === "stage-started") {
		return `${STARTED} ${label}…\n`;
	}
	if (event.event === "stage-skipped") {
		return `${SKIPPED} ${label} — output already present, skipping\n`;
	}
	if (event.event === "stage-completed") {
		return `${COMPLETED} ${label}${spendTail({ cost: event.cost, formatMoney })}\n`;
	}
	// The message and the pointer to the debug log follow the run summary (§8).
	// This line exists so a stage announced as started is not left hanging.
	return `${FAILED} ${label} — failed\n`;
}

/**
 * Builds the reporter the runner tells its events to, writing each as a line to
 * the CLI's own output stream.
 *
 * @param args - Where the notices go, and how their money is shown.
 * @param args.write - The CLI's output stream.
 * @param args.formatMoney - Renders a stored dollar figure; the same one the summaries use.
 * @returns The reporter to hand the runner.
 */
export function createRunReporter({
	write,
	formatMoney,
}: {
	readonly write: WriteText;
	readonly formatMoney: MoneyFormatter;
}): RunReporter {
	return (event) => {
		write(noticeFor({ event, formatMoney }));
	};
}
