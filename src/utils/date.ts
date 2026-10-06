/**
 * This module reads lecture dates from filenames and writes them as `YYYY-MM-DD`.
 * A source file carries its lecture date in one of many forms, such as
 * `2025-10-10`, `10 Oct 2025` or `Fri 10th Oct`. {@link extractDate} reads the
 * date. {@link stripDateTokens} removes every date from a filename, so that the
 * provisional title can be read from what is left. Both find dates through
 * `allDateMatches`, so they agree on what a date is.
 *
 * See technical-design.md §3.2, "Video recordings", and implementation-plan.md Phase 2.
 */

import type { ParsedResult } from "chrono-node";
import { parse } from "chrono-node";
import { collapseWhitespace } from "./text.js";

type TextMatch = {
	readonly index: number;
	readonly length: number;
};

/**
 * A match read as a date. `date` is `null` when the match has the shape of a
 * date but names no real day. The match still stops chrono from reading that text,
 * because chrono reads `2025-13-10` as a valid date with a changed month (technical-design.md §3.2).
 */
type DateMatch = TextMatch & {
	readonly date: Date | null;
	/**
	 * `true` when the match names a day of the year. A weekday alone does not, but
	 * it is still removed from a title. So the matches that give a date are fewer
	 * than the matches that are removed.
	 */
	readonly confident: boolean;
};

/**
 * A date in digits with separators, day first or year first. Month first is
 * never read. This module reads these dates, and not chrono, because chrono reads
 * them month first (technical-design.md §3.2).
 *
 * The boundary is "not a digit" and not `\b`. So a date next to `_` is found,
 * although `_` is a word character.
 */
const SEPARATED_DATE = /(?<!\d)(\d{1,4})([-./])(\d{1,2})\2(\d{1,4})(?!\d)/g;

/** A date in eight digits with no separators: `DDMMYYYY` or `YYYYMMDD`. */
const EIGHT_DIGIT_DATE = /(?<!\d)(\d{8})(?!\d)/g;

/**
 * A date in six digits, `DDMMYY`. It is read only when the filename gives no
 * date in another form, because six digits are often not a date
 * (technical-design.md §3.2).
 */
const SIX_DIGIT_DATE = /(?<!\d)(\d{6})(?!\d)/g;

/** The century of a two-digit year. `26` is 2026, never 1926. */
const SHORT_YEAR_BASE = 2000;

/**
 * The years that eight digits can carry. Without this range, any eight-digit
 * number in a filename would read as a date (technical-design.md §3.2).
 */
const EARLIEST_YEAR = 2000;
const LATEST_YEAR = 2099;

/**
 * The hour of a built date. Chrono gives its dates local midday. So a built date
 * and a chrono date have the same hour.
 */
const ANCHOR_HOUR = 12;

/**
 * Builds a date from its parts. Parts that name no real day give `null`. A plain
 * `Date` would change `31022025` to a day in March.
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
 * Reads a date in digits with separators. The end that has four digits is the
 * year. So this reading needs no range of years.
 *
 * @param parts - The three numbers as written, in order.
 * @returns The date, or `null` when the parts name no real day or no end is a year.
 */
function fromSeparated(parts: readonly [string, string, string]): Date | null {
	const [first, middle, last] = parts;
	if (first.length === 4) {
		return toDate({ year: Number(first), month: Number(middle), day: Number(last) });
	}
	if (last.length === 4) {
		return toDate({ day: Number(first), month: Number(middle), year: Number(last) });
	}
	// A two-digit year is read only at the end. Two digits at the start are the
	// day, because `26-11-10` can be `YY-MM-DD` or `DD-MM-YY` (technical-design.md §3.2).
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
 * Orders matches by their place in the text. Every caller needs this order. The
 * first date in a filename is the date that {@link extractDate} gives, and
 * {@link stripDateTokens} removes the matches from the last one back.
 *
 * @param left - The match to order first.
 * @param right - The match to order against it.
 * @returns Negative, zero or positive, as `Array.prototype.sort` expects.
 */
// eslint-disable-next-line max-params -- The ECMAScript specification sets the parameters of the comparator for Array.prototype.sort.
function byIndex(left: TextMatch, right: TextMatch): number {
	return left.index - right.index;
}

/**
 * Tells if a piece of text overlaps a match that is already claimed.
 *
 * @param args - The claimed matches and the place of the new match.
 * @param args.matches - The matches already claimed.
 * @param args.index - The start of the new match.
 * @param args.length - The length of the new match.
 * @returns `true` when the new match overlaps a claimed match.
 */
function overlaps({
	matches,
	index,
	length,
}: {
	readonly matches: readonly TextMatch[];
	readonly index: number;
	readonly length: number;
}): boolean {
	return matches.some(
		(match) => index < match.index + match.length && match.index < index + length,
	);
}

/**
 * Reads digits day first, with a year that the caller read. The six-digit and
 * eight-digit forms differ only in their year.
 *
 * @param args - The digits and their year.
 * @param args.digits - The digits as written. The first four are the day and the month.
 * @param args.year - The four-digit year that the caller read.
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
function fromSixDigits(digits: string): Date | null {
	return fromDayFirstDigits({ digits, year: SHORT_YEAR_BASE + Number(digits.slice(4, 6)) });
}

/**
 * Reads eight digits as `YYYYMMDD` when they start with a year in range and name
 * a real day. Otherwise it reads them as `DDMMYYYY`.
 *
 * @param digits - The eight digits as written.
 * @returns The date, or `null` when the digits name no real day either way.
 */
function fromEightDigits(digits: string): Date | null {
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

/** A form of date in digits: its global pattern, and the reader for one match. */
type DigitDateFormat = {
	readonly pattern: Readonly<RegExp>;
	/** Reads one match as a date. It gives `null` when the match names no real day. */
	readonly read: (match: readonly string[]) => Date | null;
};

/** Day, month and year with separators, in either order: `10-10-2025`, `2025.10.10`. */
const SEPARATED_DATE_FORMAT: DigitDateFormat = {
	pattern: SEPARATED_DATE,
	read: (match) => fromSeparated([match[1] as string, match[3] as string, match[4] as string]),
};

/** Eight digits, in either order: `10102025`, `20251010`. */
const EIGHT_DIGIT_DATE_FORMAT: DigitDateFormat = {
	pattern: EIGHT_DIGIT_DATE,
	read: (match) => fromEightDigits(match[1] as string),
};

/** Six digits, day first: `101025`. */
const SIX_DIGIT_DATE_FORMAT: DigitDateFormat = {
	pattern: SIX_DIGIT_DATE,
	read: (match) => fromSixDigits(match[1] as string),
};

/**
 * Finds every date in the given digit forms, in text order. A match is kept
 * also when it names no real day, so that it stops chrono from reading that text.
 *
 * @param args - The text, and the digit forms to find.
 * @param args.text - The text to search.
 * @param args.formats - The digit forms to find.
 * @returns One match for each place that a form matched, in text order.
 */
function digitDateMatches({
	text,
	formats,
}: {
	readonly text: string;
	readonly formats: readonly DigitDateFormat[];
}): readonly DateMatch[] {
	return formats
		.flatMap(({ pattern, read }) =>
			[...text.matchAll(pattern)].map((match) => ({
				index: match.index,
				length: match[0].length,
				date: read(match),
				confident: true,
			})),
		)
		.sort(byIndex);
}

/**
 * Finds the dates in words, such as `13 Oct 2025`, with `chrono-node`.
 *
 * Each underscore becomes a space first, because chrono does not find the date
 * in `BOD_13 Oct 2025`. One character replaces one character, so each index that
 * chrono gives is also an index in the original text.
 *
 * @param text - Any text, usually a filename.
 * @returns The results, in the order that chrono found them.
 */
function chronoDateMatches(text: string): readonly ParsedResult[] {
	return parse(text.replace(/_/g, " "));
}

/**
 * Finds every date in the text. The forms are tried in this order:
 * 1. the dates in digits with separators, and in eight digits
 * 2. the dates in words, from chrono
 * 3. the dates in six digits, only when no confident date was found.
 *
 * A chrono match that overlaps a digit match is dropped, because chrono reads
 * `10/11/2025` month first (technical-design.md §3.2).
 *
 * @param text - Any text, usually a filename.
 * @returns Every date match, in text order.
 */
function allDateMatches(text: string): readonly DateMatch[] {
	const numeric = digitDateMatches({
		text,
		formats: [SEPARATED_DATE_FORMAT, EIGHT_DIGIT_DATE_FORMAT],
	});
	const chrono = chronoDateMatches(text)
		.filter(
			(result) => !overlaps({ matches: numeric, index: result.index, length: result.text.length }),
		)
		.map((result) => ({
			index: result.index,
			length: result.text.length,
			date: result.date(),
			confident: result.start.isCertain("day") && result.start.isCertain("month"),
		}));

	const found = [...numeric, ...chrono];
	if (found.some((match) => match.date !== null && match.confident)) {
		return found.sort(byIndex);
	}

	const fallback = digitDateMatches({
		text,
		formats: [SIX_DIGIT_DATE_FORMAT],
	}).filter(
		(match) =>
			match.date !== null &&
			!overlaps({ matches: found, index: match.index, length: match.length }),
	);
	return [...found, ...fallback].sort(byIndex);
}

/**
 * Reads the lecture date from a filename. It is the first confident date.
 *
 * A match in digits is always confident, because its form gives the day, the
 * month and the year. A chrono match is confident only when chrono is certain of
 * the day and the month. So a year alone, a weekday alone or a stray number gives
 * no date. Chrono can supply a missing year, as in `Fri 10th Oct`, from the
 * current date (technical-design.md §3.2).
 *
 * @param filename - The filename to read. The extension is optional.
 * @returns The date, or `null` when the filename has no confident date.
 *
 * @example
 * extractDate("2025-10-10 BOD_Cell Injury.mp4"); // → Date for 2025-10-10
 * extractDate("Lecture 5 chapter 3.mp4");        // → null
 */
export function extractDate(filename: string): Date | null {
	return extractDates(filename)[0] ?? null;
}

/**
 * Reads every confident date in a filename, in text order. {@link extractDate}
 * gives the first of them.
 *
 * A base name puts the title before the date, and a title can name a date of its
 * own. So a caller that must find the lecture date needs every date
 * (technical-design.md §3.2, §4.7).
 *
 * @param filename - The filename to read. The extension is optional.
 * @returns Every confident date, in text order.
 *
 * @example
 * extractDates("Lecture 4 - Cohort 01-02-2019 - 2025-12-05.mp4");
 * // → [Date for 2019-02-01, Date for 2025-12-05]
 */
export function extractDates(filename: string): readonly Date[] {
	return allDateMatches(filename).flatMap((match) =>
		match.date !== null && match.confident ? [match.date] : [],
	);
}

/**
 * Removes every date match from the text, confident or not. So a weekday alone,
 * such as `Fri`, is also removed, and the provisional title keeps only the words
 * of the filename. The whitespace is then collapsed and trimmed.
 *
 * @param text - The text to clean.
 * @returns The text without its dates.
 *
 * @example
 * stripDateTokens("2025-10-10 Immune System Fri"); // → "Immune System"
 */
export function stripDateTokens(text: string): string {
	const matches = allDateMatches(text);
	let withoutDates = text;
	// The matches are in text order. The loop removes the last match first, so
	// the index of each earlier match stays correct.
	for (const match of [...matches].reverse()) {
		withoutDates = `${withoutDates.slice(0, match.index)} ${withoutDates.slice(match.index + match.length)}`;
	}
	return collapseWhitespace(withoutDates);
}

/**
 * Writes a date as `YYYY-MM-DD` from its local calendar day. Each date that it
 * gets is built in local time. This module builds a digit date at local midday.
 * Chrono builds a date in words at local midday. A base name date is built at
 * local midnight. So the local day is the intended day, in every time zone.
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

/** The written form of an ISO date. A match can still name no real day. */
const ISO_DATE_FORM = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Tells if text is an ISO `YYYY-MM-DD` date that exists. So `2025-02-30` fails
 * as `yesterday` does. The command line and the manifest reader check each
 * lecture date with it (technical-design.md §3.2).
 *
 * @param value - The text to test.
 * @returns `true` when the text names a real date.
 */
export function isCalendarDate(value: string): boolean {
	if (!ISO_DATE_FORM.test(value)) {
		return false;
	}
	const parsed = new Date(`${value}T00:00:00Z`);
	if (Number.isNaN(parsed.getTime())) {
		return false;
	}
	// The ISO text of a date that exists starts with `value`. `2025-02-30` becomes a day in March.
	return parsed.toISOString().startsWith(value);
}
