/**
 * This module writes the stage notices: one line for each event that the runner
 * reports while a pipeline run continues. The runner gives only the event and its data. The
 * CLI owns the words and the output stream (technical-design.md §10, "Stage Notices").
 */

import { lectureHeading, type MoneyFormatter, stageLabel } from "../pipeline/reports.js";
import type { PipelineRunEvent, PipelineRunReporter, StageCost } from "../types/pipeline.js";
import { pluralise } from "../utils/text.js";
import type { WriteText } from "./commands.js";

/** The mark of the notice for a stage that started. */
const STARTED = "▶";

/** The mark of the notice for a stage that completed. */
const COMPLETED = "✔";

/** The mark of the notice for a stage that was skipped, because its output already stands. */
const SKIPPED = "−";

/** The mark of the notice for a stage that failed. */
const FAILED = "✖";

/**
 * Writes the end of a completed stage's notice: the number of calls and their
 * cost. A stage with no cost says that it made no model call, and does not show
 * a zero (technical-design.md §10, "Stage Notices").
 *
 * @param args - The cost and the money formatter.
 * @param args.cost - The stage's cost, or `null` when the stage records no cost.
 * @param args.formatMoney - Shows a stored dollar figure.
 * @returns The end of the notice.
 */
function spendTail({
	cost,
	formatMoney,
}: {
	readonly cost: StageCost | null;
	readonly formatMoney: MoneyFormatter;
}): string {
	if (cost === null) {
		return " — no model call";
	}
	return ` — ${pluralise({ count: cost.callCount, noun: "call" })}, ${formatMoney(cost.costUsd)}`;
}

/**
 * Writes the notice for one event.
 *
 * @param args - The event and the money formatter.
 * @param args.event - The event from the runner.
 * @param args.formatMoney - Shows a stored dollar figure.
 * @returns The notice, with its line end.
 */
function noticeFor({
	event,
	formatMoney,
}: {
	readonly event: PipelineRunEvent;
	readonly formatMoney: MoneyFormatter;
}): string {
	if (event.event === "lecture-started") {
		// The blank line above the heading shows where one lecture's notices stop
		// and the next lecture's start, in a batch.
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
	// The error message comes after the run summary (technical-design.md §10). This
	// line only closes the "started" notice.
	return `${FAILED} ${label} — failed\n`;
}

/**
 * Makes the reporter that the runner gives its events to. The reporter writes
 * one notice for each event.
 *
 * @param args - The output stream and the money formatter.
 * @param args.write - The CLI's output stream.
 * @param args.formatMoney - Shows a stored dollar figure. The run summaries use the same formatter.
 * @returns The reporter for the runner.
 */
export function createPipelineRunReporter({
	write,
	formatMoney,
}: {
	readonly write: WriteText;
	readonly formatMoney: MoneyFormatter;
}): PipelineRunReporter {
	return (event) => {
		write(noticeFor({ event, formatMoney }));
	};
}
