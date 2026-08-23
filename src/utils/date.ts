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
import { collapseWhitespace } from "./text.js";

/**
 * Where a span sits in the text. Ordering spans and testing them for overlap
 * are the whole of what {@link byIndex} and {@link overlaps} do, and neither
 * looks at the date, so this is what they ask for.
 */
type TextSpan = {
	readonly index: number;
	readonly length: number;
};

/**
 * A span of text read as a date. `date` is `null` where the span has a date's
 * shape but names no real day: the span is still claimed, so chrono cannot
 * reinterpret it — left to chrono, `2025-13-10` comes back as a valid date with
 * the month quietly corrected.
 */
type DateSpan = TextSpan & {
	readonly date: Date | null;
	/**
	 * Whether the span names a day of the year. A bare weekday does not, yet is
	 * still stripped from a title — so what a date is read from is narrower than
	 * what is removed, and the two must not be conflated.
	 */
	readonly confident: boolean;
};

/**
 * A numeric date, in either order the British convention writes it: day first,
 * or year first when the leading component is four digits. Month-first is never
 * read — the separators are the same ones chrono would take as American, which
 * is why these are matched here rather than left to it.
 *
 * The boundaries are "not a digit" rather than word boundaries, so a date jammed
 * against an underscore, bracket or anything else is still found; `\b` would
 * fail against `_`, which is a word character.
 */
const SEPARATED_DATE = /(?<!\d)(\d{1,4})([-./])(\d{1,2})\2(\d{1,4})(?!\d)/g;

/** The same, written with no separators at all: `DDMMYYYY` or `YYYYMMDD`. */
const COMPACT_DATE = /(?<!\d)(\d{8})(?!\d)/g;

/**
 * `DDMMYY`, tried only when the filename yields no date any other way. Six bare
 * digits are a common shape for something that is not a date at all, so this
 * cannot compete with a date written unambiguously.
 */
const COMPACT_SHORT_DATE = /(?<!\d)(\d{6})(?!\d)/g;

/** A two-digit year is always this century — `26` is 2026, never 1926. */
const SHORT_YEAR_BASE = 2000;

/**
 * The years a bare eight-digit run may carry. Without a bound, any eight-digit
 * identifier in a filename would read as a date; with it, the four digits that
 * look like a plausible year are what decide which end the year sits at.
 */
const EARLIEST_YEAR = 2000;
const LATEST_YEAR = 2099;

/** Chrono anchors parsed dates to local midday, so ours are built to match. */
const ANCHOR_HOUR = 12;

/**
 * Builds a date from calendar parts, rejecting any combination that is not a
 * real day — `31022025` names no date, and a rolled-over `Date` would silently
 * turn it into the third of March.
 *
 * @param args - The calendar parts.
 * @param args.day - Day of the month.
 * @param args.month - Month number, 1-12.
 * @param args.year - Four-digit year.
 * @returns The date, or `null` when the parts name no real day.
 */
function toDate({
	day,
	month,
	year,
}: {
	readonly day: number;
	readonly month: number;
	readonly year: number;
}): Date | null {
	const date = new Date(year, month - 1, day, ANCHOR_HOUR);
	const isReal =
		date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
	return isReal ? date : null;
}

/**
 * Reads a separated numeric date, deciding the order from which end carries the
 * four-digit year. Position alone settles it, so no year range is needed here.
 *
 * @param parts - The three numeric components as written, in order.
 * @returns The date, or `null` when neither end is a four-digit year.
 */
function fromSeparated(parts: readonly [string, string, string]): Date | null {
	const [first, middle, last] = parts;
	if (first.length === 4) {
		return toDate({ year: Number(first), month: Number(middle), day: Number(last) });
	}
	if (last.length === 4) {
		return toDate({ day: Number(first), month: Number(middle), year: Number(last) });
	}
	// A two-digit year is read only here, at the end. A leading two-digit
	// component is the day: nothing in `26-11-10` distinguishes `YY-MM-DD` from
	// `DD-MM-YY`, and year-first is written with four digits because it sorts.
	if (last.length === 2) {
		return toDate({
			day: Number(first),
			month: Number(middle),
			year: SHORT_YEAR_BASE + Number(last),
		});
	}
	return null;
}

/**
 * Orders spans by where they appear, which is the order every consumer wants:
 * the first date in a filename is the one it is about, and stripping runs from
 * the last backwards.
 *
 * @param left - The span to order first.
 * @param right - The span to order against it.
 * @returns Negative, zero or positive, as `Array.prototype.sort` expects.
 */
// eslint-disable-next-line max-params -- Array.prototype.sort's comparator is spec-defined
function byIndex(left: TextSpan, right: TextSpan): number {
	return left.index - right.index;
}

/**
 * Whether a span of text overlaps any already claimed.
 *
 * @param args - The claimed spans and the candidate's position.
 * @param args.spans - The spans already claimed.
 * @param args.index - Where the candidate starts.
 * @param args.length - How long the candidate is.
 * @returns `true` when the candidate overlaps a claimed span.
 */
function overlaps({
	spans,
	index,
	length,
}: {
	readonly spans: readonly TextSpan[];
	readonly index: number;
	readonly length: number;
}): boolean {
	return spans.some((span) => index < span.index + span.length && span.index < index + length);
}

/**
 * Reads a compact run day first, taking the year from the caller — the two
 * compact forms differ only in where their year comes from and how wide it is,
 * so the day and month are read in one place.
 *
 * @param args - The digits and the year already resolved from them.
 * @param args.digits - The run as written; the day and month are its first four.
 * @param args.year - The four-digit year the caller resolved.
 * @returns The date, or `null` when the parts name no real day.
 */
function fromDayFirstDigits({
	digits,
	year,
}: {
	readonly digits: string;
	readonly year: number;
}): Date | null {
	return toDate({
		day: Number(digits.slice(0, 2)),
		month: Number(digits.slice(2, 4)),
		year,
	});
}

/**
 * Reads six bare digits as `DDMMYY`.
 *
 * @param digits - The six digits as written.
 * @returns The date, or `null` when they name no real day.
 */
function fromCompactShort(digits: string): Date | null {
	return fromDayFirstDigits({ digits, year: SHORT_YEAR_BASE + Number(digits.slice(4, 6)) });
}

/**
 * Reads an eight-digit run as `YYYYMMDD` when it opens with a plausible year,
 * and otherwise as `DDMMYYYY`. Both readings are validated, so an identifier
 * that is neither yields nothing.
 *
 * @param digits - The eight digits as written.
 * @returns The date, or `null` when the digits name no real day either way.
 */
function fromCompact(digits: string): Date | null {
	const plausibleYear = (value: number): boolean => value >= EARLIEST_YEAR && value <= LATEST_YEAR;

	const leadingYear = Number(digits.slice(0, 4));
	if (plausibleYear(leadingYear)) {
		const asYearFirst = toDate({
			year: leadingYear,
			month: Number(digits.slice(4, 6)),
			day: Number(digits.slice(6, 8)),
		});
		if (asYearFirst !== null) {
			return asYearFirst;
		}
	}
	const trailingYear = Number(digits.slice(4, 8));
	if (!plausibleYear(trailingYear)) {
		return null;
	}
	return fromDayFirstDigits({ digits, year: trailingYear });
}

/**
 * Every match of one numeric pattern, as spans claimed against the text.
 *
 * The claim is made whether or not the digits resolve, so a shape that names no
 * real day still keeps chrono off it.
 *
 * @param args - The text, the pattern, and how to read a match.
 * @param args.text - The text to scan.
 * @param args.pattern - The global pattern to scan it with.
 * @param args.read - Turns one match into a date, or `null` where it names none.
 * @returns One span per match, in the order they appear.
 */
function claimedSpans({
	text,
	pattern,
	read,
}: {
	readonly text: string;
	readonly pattern: Readonly<RegExp>;
	readonly read: (match: readonly string[]) => Date | null;
}): readonly DateSpan[] {
	return [...text.matchAll(pattern)].map((match) => ({
		index: match.index,
		length: match[0].length,
		date: read(match),
		confident: true,
	}));
}

/**
 * Every numeric date in the text, in the order it appears.
 *
 * @param text - Arbitrary text, typically a filename.
 * @returns The spans each numeric date occupied, with the date it resolved to.
 */
function numericDateSpans(text: string): readonly DateSpan[] {
	return [
		...claimedSpans({
			text,
			pattern: SEPARATED_DATE,
			read: (match) => fromSeparated([match[1] as string, match[3] as string, match[4] as string]),
		}),
		...claimedSpans({
			text,
			pattern: COMPACT_DATE,
			read: (match) => fromCompact(match[1] as string),
		}),
	].sort(byIndex);
}

/**
 * Runs `chrono-node` over the text for the dates written in words, which are
 * unambiguous and so are left to it.
 *
 * Underscores are replaced with spaces first: chrono treats `_` as a word
 * character, so `BOD_13 Oct 2025` hides the date from it. The substitution is
 * one character for one, so every span index it reports still addresses the
 * original text.
 *
 * @param text - Arbitrary text, typically a filename.
 * @returns The parsed results in the order chrono discovered them.
 */
function parseDateSpans(text: string): readonly ParsedResult[] {
	return parse(text.replace(/_/g, " "));
}

/**
 * Every date in the text, in precedence order: the numeric forms read here, then
 * chrono's for the dates written in words, and only if neither yielded a date,
 * the six-digit `DDMMYY` fallback.
 *
 * A chrono span overlapping a numeric one is dropped — chrono reads `10/11/2025`
 * as the eleventh of October, and the numeric reading is the one that carries
 * the British convention. The fallback is last because six bare digits are as
 * likely to be an identifier as a date; where one does slip through, Stage 0's
 * 1:1 video-to-slide date match is what catches it (technical-design.md §3.2).
 *
 * @param text - Arbitrary text, typically a filename.
 * @returns Every date span found, in the order it appears in the text.
 */
function allDateSpans(text: string): readonly DateSpan[] {
	const numeric = numericDateSpans(text);
	const chrono = parseDateSpans(text)
		.filter(
			(result) => !overlaps({ spans: numeric, index: result.index, length: result.text.length }),
		)
		.map((result) => ({
			index: result.index,
			length: result.text.length,
			date: result.date(),
			confident: result.start.isCertain("day") && result.start.isCertain("month"),
		}));

	const found = [...numeric, ...chrono];
	if (found.some((span) => span.date !== null && span.confident)) {
		return found.sort(byIndex);
	}

	const fallback = claimedSpans({
		text,
		pattern: COMPACT_SHORT_DATE,
		read: (match) => fromCompactShort(match[1] as string),
	}).filter(
		(span) =>
			span.date !== null && !overlaps({ spans: found, index: span.index, length: span.length }),
	);
	return [...found, ...fallback].sort(byIndex);
}

/**
 * Extracts a recording date from a filename.
 *
 * A span is accepted only when it is confident, and the two kinds of span earn
 * that differently. A numeric span is confident by its form: the
 * British-convention patterns in this module identify day, month and year by
 * position, so a match needs no further judgement. A span chrono found — a date
 * written in words — is confident only when chrono is certain of both the day
 * and the month, which rules out bare years, standalone weekdays, and incidental
 * numbers that would otherwise resolve to a spurious date. The year may be
 * inferred (e.g. `Fri 10th Oct`); chrono anchors it to the reference date.
 *
 * The bare six-digit `DDMMYY` form is the exception at both ends: it is tried
 * only when nothing else yielded a confident span, and it is confident whenever
 * it names a real day (technical-design.md §3.2).
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
	return extractDates(filename)[0] ?? null;
}

/**
 * Extracts every date a filename carries, in the order they appear.
 *
 * A filename can name more than one: a canonical lecture name puts its title
 * before its date, and titles come from lecturer filenames or from Stage 3's
 * model, either of which may name a date of its own. A caller that must know
 * *which* date it is looking at needs them all rather than the first
 * (technical-design.md §3.2, §4.7).
 *
 * Confidence is judged exactly as {@link extractDate} judges it — the two read
 * the same spans, and `extractDate` is the first of these.
 *
 * @param filename - The filename to inspect (extension optional).
 * @returns Every sufficiently confident {@link Date}, in the order they appear.
 *
 * @example
 * extractDates("Lecture 4 - Cohort 01-02-2019 - 2025-12-05.mp4");
 * // → [Date for 2019-02-01, Date for 2025-12-05]
 */
export function extractDates(filename: string): readonly Date[] {
	return allDateSpans(filename).flatMap((span) =>
		span.date !== null && span.confident ? [span.date] : [],
	);
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
	const spans = allDateSpans(text);
	let withoutDates = text;
	// Spans arrive in ascending index order; splice from the last backwards so
	// earlier indices remain valid as the string shrinks.
	for (const span of [...spans].reverse()) {
		withoutDates = `${withoutDates.slice(0, span.index)} ${withoutDates.slice(span.index + span.length)}`;
	}
	return collapseWhitespace(withoutDates);
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
export function formatDateISO(date: Readonly<Date>): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}
