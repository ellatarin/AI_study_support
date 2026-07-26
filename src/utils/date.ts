/**
 * Date extraction and formatting for lecture filenames.
 *
 * Lecture source files are named by the user with the recording date embedded
 * in a variety of formats (`2025-10-10 ...`, `10 Oct 2025 ...`, `Fri 10th Oct
 * ...`). {@link extractDate} recovers the date; {@link stripDateTokens} removes
 * every date-like span so the naming utilities can derive a clean title.
 * `chrono-node` is invoked in exactly one place here so both consumers share a
 * single detection policy.
 *
 * See technical-design.md §3 (naming) and implementation-plan.md Phase 2.
 */

import type { ParsedResult } from "chrono-node";
import { parse } from "chrono-node";

/**
 * Runs `chrono-node` over the text and returns every parsed span.
 *
 * @param text - Arbitrary text, typically a filename.
 * @returns The parsed results in the order chrono discovered them.
 */
function parseDateSpans(text: string): readonly ParsedResult[] {
	return parse(text);
}

/**
 * Extracts a recording date from a filename.
 *
 * A span is accepted only when chrono is certain of both the day and the month,
 * which rules out bare years, standalone weekdays, and incidental numbers that
 * would otherwise resolve to a spurious date. The year may be inferred (e.g.
 * `Fri 10th Oct`); chrono anchors it to the reference date.
 *
 * @param filename - The filename to inspect (extension optional).
 * @returns The extracted {@link Date}, or `null` when no sufficiently confident
 *   date is present.
 *
 * @example
 * extractDate("2025-10-10 BOD_Cell Injury.mp4"); // → Date for 2025-10-10
 * extractDate("Lecture 5 chapter 3.mp4");        // → null
 */
export function extractDate(filename: string): Date | null {
	const confident = parseDateSpans(filename).find(
		(result) => result.start.isCertain("day") && result.start.isCertain("month"),
	);
	return confident ? confident.date() : null;
}

/**
 * Removes every date-like span from the text.
 *
 * Unlike {@link extractDate}, this strips all chrono-detected spans regardless
 * of confidence — including standalone weekdays such as `Fri` — so that title
 * extraction is left with only the descriptive portion of the filename.
 * Surrounding whitespace left by the removals is collapsed and trimmed.
 *
 * @param text - The text to clean.
 * @returns The text with all date tokens removed.
 *
 * @example
 * stripDateTokens("2025-10-10 Immune System Fri"); // → "Immune System"
 */
export function stripDateTokens(text: string): string {
	const spans = parseDateSpans(text);
	let withoutDates = text;
	// chrono returns spans in ascending index order; splice from the last span
	// backwards so earlier indices remain valid as the string shrinks.
	for (const span of [...spans].reverse()) {
		withoutDates = `${withoutDates.slice(0, span.index)} ${withoutDates.slice(span.index + span.text.length)}`;
	}
	return withoutDates.replace(/\s+/g, " ").trim();
}

/**
 * Formats a date as `YYYY-MM-DD` using its local calendar components.
 *
 * Local components are used deliberately: chrono anchors parsed dates to local
 * midday, so reading them back with the local getters reproduces the calendar
 * day the user intended regardless of the host timezone.
 *
 * @param date - The date to format.
 * @returns The ISO `YYYY-MM-DD` date string.
 */
export function formatDateISO(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}
