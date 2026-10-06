/**
 * This module reads the provisional title from a source filename and builds the
 * base name of a lecture. {@link extractProvisionalTitle} removes the date, the
 * module prefix and other noise from a filename. The provisional title can be empty.
 * {@link filenameSafe} makes a title safe for the filesystem.
 *
 * See technical-design.md §3.2 and §4.4.
 */

import { formatDateISO, stripDateTokens } from "./date.js";
import { NamedError } from "./errors.js";
import { collapseWhitespace } from "./text.js";

/**
 * The error for a title that has no characters that are safe in a filename, such as
 * `..` or only spaces.
 */
export class EmptyNameError extends NamedError {}

/**
 * The characters that have a special meaning in a pattern. The config file gives
 * the module prefixes, so each prefix is escaped. A prefix is text to match, not
 * a pattern.
 */
const PATTERN_METACHARACTERS = /[.*+?^${}()|[\]\\]/g;

/**
 * Builds the pattern for a module prefix and the separator after it, such as
 * `BOD_`, `BOD ` or `Biology of Disease_`. The case is ignored, because
 * lecturers do not write their module prefix in one case.
 *
 * @param modulePrefixes - The module prefixes from the config file.
 * @returns The pattern, or `null` when the list is empty.
 */
function modulePrefixPattern(modulePrefixes: readonly string[]): RegExp | null {
	if (modulePrefixes.length === 0) {
		return null;
	}
	const alternatives = modulePrefixes
		.map((prefix) => prefix.replace(PATTERN_METACHARACTERS, "\\$&"))
		.join("|");
	return new RegExp(`\\b(?:${alternatives})[_ ]+`, "gi");
}

/**
 * A lecture number in a filename, such as `Lecture 1`. It is removed, because the
 * lecture number that `source-normalisation` gives is already in the base name.
 */
const LECTURE_NUMBER_TOKEN = /\bLectures?\s*\d+\b/gi;

/**
 * Separators left at either end after the removals. The base name
 * `Lecture 1 - Cell Injury - 2025-10-10` loses its number and date and becomes
 * `- Cell Injury -`.
 */
const EDGE_SEPARATORS = /^[\s-]+|[\s-]+$/g;

/** Words at the end that recording or export tools add, such as `copy`, `co` or `v2`. */
const TRAILING_ARTEFACTS = /(?:[\s-]+(?:copy|co|v\d+))+$/i;

const FILE_EXTENSION = /\.[A-Za-z0-9]{1,5}$/;

/** Underscores. A source filename uses them where a title uses a space. */
const UNDERSCORES = /_/g;

/** The path separators of Unix and Windows. A filename cannot contain them. */
const PATH_SEPARATORS = /[/\\]/g;

/**
 * Dots at either end of a name. A dot at the start hides the file on Unix, and
 * Windows refuses a dot at the end.
 */
const EDGE_DOTS = /^\.+|\.+$/g;

/** The last code of the ASCII C0 control characters, and the code of DEL. */
const LAST_C0_CONTROL_CODE = 0x1f;
const DELETE_CODE = 0x7f;

/**
 * Removes null bytes and ASCII control characters from text.
 *
 * @param text - The text to clean.
 * @returns The text with every C0 control character and DEL removed.
 */
function stripControlChars(text: string): string {
	return Array.from(text)
		.filter((character) => {
			const code = character.codePointAt(0) ?? 0;
			return code > LAST_C0_CONTROL_CODE && code !== DELETE_CODE;
		})
		.join("");
}

/**
 * Reads the provisional title from a source filename. It removes these parts:
 * - the extension, the dates and the weekdays
 * - the module prefixes, a lecture number and the underscores
 * - the separators at either end, and the words that tools add at the end.
 *
 * A filename with only a date and `Lecture N` gives an empty string. The capitals
 * stay as the lecturer typed them. So a lower-case filename gives a lower-case
 * title. When the filename is a base name that this module built, the
 * provisional title is the title in that base name (technical-design.md §3.2).
 *
 * @param args - The filename to read, and the module prefixes.
 * @param args.modulePrefixes - The module prefixes from the config file. An empty list removes none.
 * @param args.filename - The source filename.
 * @returns The provisional title, possibly empty.
 *
 * @example
 * extractProvisionalTitle({
 *   filename: "2025-10-10 BOD_mRNA processing.mp4",
 *   modulePrefixes: ["BOD"],
 * });
 * // → "mRNA processing"
 * extractProvisionalTitle({
 *   filename: "biology of disease - Cell injury 2025-10-10.mp4",
 *   modulePrefixes: ["Biology of Disease"],
 * });
 * // → "Cell injury"
 * extractProvisionalTitle({ filename: "2025-10-10 Lecture 5.mp4", modulePrefixes: ["BOD"] });
 * // → ""
 */
export function extractProvisionalTitle({
	filename,
	modulePrefixes,
}: {
	readonly filename: string;
	readonly modulePrefixes: readonly string[];
}): string {
	const prefixes = modulePrefixPattern(modulePrefixes);
	const withoutExtension = filename.replace(FILE_EXTENSION, "");
	const withoutDates = stripDateTokens(withoutExtension);
	const withoutPrefixes = prefixes === null ? withoutDates : withoutDates.replace(prefixes, " ");
	const withoutNoise = withoutPrefixes.replace(LECTURE_NUMBER_TOKEN, " ").replace(UNDERSCORES, " ");
	const normalised = collapseWhitespace(withoutNoise);
	const withoutEdges = normalised.replace(EDGE_SEPARATORS, "");
	return withoutEdges.replace(TRAILING_ARTEFACTS, "").trim();
}

/**
 * Removes the characters that are not safe in a filename. A title comes from a
 * user filename or from a model, so it is not trusted. This function removes null bytes,
 * control characters, path separators and `.` or `..` segments. It collapses the
 * whitespace, and trims spaces and dots from the ends (technical-design.md §4.4).
 *
 * @param title - The title to make safe.
 * @returns The safe name. It is never empty.
 * @throws {EmptyNameError} When no character of the title is left after the removals.
 *
 * @example
 * filenameSafe("../etc/passwd"); // → "etc passwd"
 * filenameSafe("..");            // → throws
 */
export function filenameSafe(title: string): string {
	const withoutSeparators = stripControlChars(title).replace(PATH_SEPARATORS, " ");
	// The whitespace is collapsed first, so a segment is the text between single
	// spaces. So this code needs no second pattern for whitespace.
	const result = collapseWhitespace(withoutSeparators)
		.split(" ")
		.filter((segment) => segment !== "." && segment !== "..")
		.join(" ")
		.replace(EDGE_DOTS, "")
		.trim();
	if (result === "") {
		throw new EmptyNameError(
			`filenameSafe produced an empty name from input: ${JSON.stringify(title)}`,
		);
	}
	return result;
}

/**
 * The parts of a base name. This is less than the lecture identity: one title,
 * and a `Date` in place of a date string.
 */
type BaseNameParts = {
	readonly lectureNumber: number;
	readonly title: string;
	/**
	 * A `Readonly<Date>`, because CLAUDE.md asks for immutable input and a `Date`
	 * has methods that change it. A plain `Date` can still be passed.
	 */
	readonly date: Readonly<Date>;
};

/**
 * Builds the base name `Lecture N - Title - YYYY-MM-DD`. {@link filenameSafe}
 * makes the title safe, so the name is safe for the filesystem.
 *
 * @param parts - The lecture number, title, and date.
 * @returns The base name, without an extension.
 * @throws {EmptyNameError} When the title has no safe characters.
 *
 * @example
 * titledBaseName({ lectureNumber: 1, title: "Immune System", date });
 * // → "Lecture 1 - Immune System - 2025-10-10"
 */
export function titledBaseName(parts: BaseNameParts): string {
	const { lectureNumber, title, date } = parts;
	return `Lecture ${lectureNumber} - ${filenameSafe(title)} - ${formatDateISO(date)}`;
}

/**
 * Builds the base name of a lecture. An empty title gives `Lecture N - YYYY-MM-DD`
 * (technical-design.md §3.2, §4.7). This is here and not in
 * `source-normalisation`, because `lecture-files.ts` uses it too, and pipeline
 * code does not import a stage (§9).
 *
 * @param parts - The lecture number, the title (possibly empty), and the date.
 * @returns The base name of the lecture files.
 * @throws {EmptyNameError} When the title is not empty but has no safe characters.
 *
 * @example
 * lectureBaseName({ lectureNumber: 2, title: "", date });
 * // → "Lecture 2 - 2025-10-17"
 */
export function lectureBaseName(parts: BaseNameParts): string {
	const { lectureNumber, title, date } = parts;
	if (title === "") {
		return `Lecture ${lectureNumber} - ${formatDateISO(date)}`;
	}
	return titledBaseName(parts);
}
