/**
 * Title and folder-name derivation for lecture files.
 *
 * User-supplied lecture filenames vary widely: the date is always present, but
 * a module-code prefix, day name, lecture-number token, trailing artefacts
 * (`copy`, `co`, `v2`), and a descriptive title may each be present or absent.
 * {@link extractProvisionalTitle} recovers a best-effort title by removing
 * whichever of those noise elements it finds; the result may be thin or empty,
 * and Stage 3's LLM later judges its adequacy against the transcript.
 * {@link lectureFolderName} builds the canonical workspace name, and
 * {@link filenameSafe} sanitises any title before it reaches the filesystem.
 *
 * See technical-design.md §3 (naming) and §4.4 (path validation).
 */

import { formatDateISO, stripDateTokens } from "./date.js";
import { NamedError } from "./errors.js";
import { collapseWhitespace } from "./text.js";

/**
 * Thrown when sanitising a title leaves nothing to name a file with — the whole
 * of the input was unsafe characters, traversal segments, or whitespace. The
 * caller falls back to a provisional title or a stage-defined default
 * (technical-design.md §3, §4.4).
 */
export class EmptyNameError extends NamedError {}

/**
 * Characters carrying meaning inside a pattern. Module codes come from the
 * config file, so each is escaped before it is built into one — a code is text
 * to match literally, never a pattern the user wrote.
 */
const PATTERN_METACHARACTERS = /[.*+?^${}()|[\]\\]/g;

/**
 * The pattern matching any configured module code where it prefixes a name
 * (`BOD_`, `BOD `), or `null` when no codes are configured and nothing is to be
 * stripped.
 *
 * @param moduleCodes - The codes the modules' filenames are prefixed with.
 * @returns The pattern, or `null` when the list is empty.
 */
function moduleCodePrefixes(moduleCodes: readonly string[]): RegExp | null {
	if (moduleCodes.length === 0) {
		return null;
	}
	const alternatives = moduleCodes
		.map((code) => code.replace(PATTERN_METACHARACTERS, "\\$&"))
		.join("|");
	return new RegExp(`\\b(?:${alternatives})[_ ]+`, "g");
}

/**
 * An embedded lecture-number token (`Lecture 1`, `Lectures 2`). Stripped so the
 * provisional title never duplicates the number Stage 0 assigns separately.
 */
const LECTURE_NUMBER_TOKEN = /\bLectures?\s*\d+\b/gi;

/**
 * Separator debris at either end, left where a stripped token used to be: a
 * canonical `Lecture 1 - Cell Injury - 2025-10-10` loses its number and date and
 * comes back as `- Cell Injury -`.
 */
const EDGE_SEPARATORS = /^[\s-]+|[\s-]+$/g;

/** Trailing artefacts appended by recording/export tools (`copy`, `co`, `v2`). */
const TRAILING_ARTEFACTS = /(?:[\s-]+(?:copy|co|v\d+))+$/i;

/** A file extension of 1–5 alphanumeric characters. */
const FILE_EXTENSION = /\.[A-Za-z0-9]{1,5}$/;

/** Underscores, which source filenames use where a title would use a space. */
const UNDERSCORES = /_/g;

/** Either platform's path separator, which no filename component may contain. */
const PATH_SEPARATORS = /[/\\]/g;

/**
 * Dots at either end of a name. A leading one hides the file on Unix and a
 * trailing one is refused on Windows, so neither survives sanitisation.
 */
const EDGE_DOTS = /^\.+|\.+$/g;

/** Upper bound (inclusive) of the ASCII C0 control range; DEL is `0x7f`. */
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
 * Derives a best-effort provisional lecture title from a source filename.
 *
 * Strips the file extension, all date and weekday tokens, any configured
 * module code, any embedded lecture-number token, underscores, separator debris
 * at either end, and trailing artefacts. Filenames vary: a rich filename yields
 * a full title, while a `date + Lecture N` filename yields an **empty string**.
 * Callers must fall back (e.g. to the bare `Lecture N` name) on an empty result;
 * Stage 3's LLM later judges whether the title is meaningful.
 *
 * **The lecturer's capitalisation is kept exactly as they typed it.** The title
 * becomes the workspace folder name and the final PDF name, so re-casing it
 * misspells the subject in both — and no rule can tell `mRNA` from an ordinary
 * word, since either may mix cases. The cost is that a filename typed in lower
 * case yields a lower-case title: names are exactly as consistent as the
 * filenames are, and this function never invents a spelling of its own.
 *
 * The separator strip is what lets a name this module built be read back: a
 * lecture whose sources were renamed by a run that then stopped before writing
 * its manifest is re-read from its canonical filename on the next run, and must
 * yield the title that name was built from (technical-design.md §3.2).
 *
 * @param args - The filename to read, and what counts as a module code.
 * @param args.filename - The user-supplied source filename.
 * @param args.moduleCodes - The configured module codes; a code is stripped only where it prefixes a name, and an empty list strips none.
 * @returns The cleaned provisional title, possibly empty.
 *
 * @example
 * extractProvisionalTitle({
 *   filename: "2025-10-10 BOD_Disease cell injury Fri co.mp4",
 *   moduleCodes: ["BOD"],
 * });
 * // → "Disease cell injury"
 * extractProvisionalTitle({
 *   filename: "2025-10-10 BOD_mRNA processing.mp4",
 *   moduleCodes: ["BOD"],
 * });
 * // → "mRNA processing"
 * extractProvisionalTitle({ filename: "2025-10-10 Lecture 5.mp4", moduleCodes: ["BOD"] });
 * // → ""
 */
export function extractProvisionalTitle({
	filename,
	moduleCodes,
}: {
	readonly filename: string;
	readonly moduleCodes: readonly string[];
}): string {
	const codePrefixes = moduleCodePrefixes(moduleCodes);
	const withoutExtension = filename.replace(FILE_EXTENSION, "");
	const withoutDates = stripDateTokens(withoutExtension);
	const withoutCodes =
		codePrefixes === null ? withoutDates : withoutDates.replace(codePrefixes, " ");
	const withoutNoise = withoutCodes.replace(LECTURE_NUMBER_TOKEN, " ").replace(UNDERSCORES, " ");
	const normalised = collapseWhitespace(withoutNoise);
	const withoutEdges = normalised.replace(EDGE_SEPARATORS, "");
	return withoutEdges.replace(TRAILING_ARTEFACTS, "").trim();
}

/**
 * Removes characters that are unsafe in a filesystem name.
 *
 * Titles reach the filesystem as workspace folder names, source-file renames,
 * and the final PDF name; they originate from untrusted user filenames or LLM
 * output. This strips null bytes and ASCII control characters, path separators,
 * and directory-traversal segments (`.`, `..`), collapses whitespace, and trims
 * surrounding whitespace and dots.
 *
 * @param title - The raw title to sanitise.
 * @returns The sanitised name, guaranteed non-empty.
 * @throws {EmptyNameError} When sanitisation leaves an empty string; the caller
 *   must fall back to a provisional title or a stage-defined default.
 *
 * @example
 * filenameSafe("../etc/passwd"); // → "etc passwd"
 * filenameSafe("..");            // → throws
 */
export function filenameSafe(title: string): string {
	const withoutSeparators = stripControlChars(title).replace(PATH_SEPARATORS, " ");
	// Collapsed first, so a segment is whatever sits between single spaces and
	// this reads what counts as whitespace off one definition rather than a
	// second pattern of its own.
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
 * The three things a lecture's canonical folder/file name is built from.
 *
 * Not the lecture's identity, which is what `types/pipeline.ts` records and is a
 * wider thing: a recorded identity carries an ISO date string and both a
 * provisional and a settled title, and a name is built from exactly one title
 * and a real `Date`. The two were both called `LectureIdentity`, which read as
 * one type declared twice.
 */
type LectureNameParts = {
	readonly lectureNumber: number;
	readonly title: string;
	/**
	 * `Readonly<Date>` rather than `Date`: the name builders only read the
	 * calendar day off it, and a bare `Date` carries mutating methods, so a
	 * parameter holding one is not the immutable input CLAUDE.md asks for. A
	 * real `Date` is assignable, so callers are unaffected.
	 */
	readonly date: Readonly<Date>;
};

/**
 * Builds the canonical `Lecture N - Title - YYYY-MM-DD` name.
 *
 * Used for both the workspace folder and the final PDF (which appends `.pdf`).
 * The title is passed through {@link filenameSafe} so the assembled name is
 * always filesystem-safe.
 *
 * @param parts - The lecture number, title, and date.
 * @returns The canonical folder/file name (without extension).
 * @throws Error when the title sanitises to empty (see {@link filenameSafe}).
 *
 * @example
 * lectureFolderName({ lectureNumber: 1, title: "Immune System", date });
 * // → "Lecture 1 - Immune System - 2025-10-10"
 */
export function lectureFolderName(parts: LectureNameParts): string {
	const { lectureNumber, title, date } = parts;
	return `Lecture ${lectureNumber} - ${filenameSafe(title)} - ${formatDateISO(date)}`;
}

/**
 * The canonical `Lecture N - Title - YYYY-MM-DD` base name, falling back to
 * `Lecture N - YYYY-MM-DD` when the provisional title is empty
 * (technical-design.md §3.2, §4.7).
 *
 * Lives here rather than in Stage 0, which is where it began: `lecture-files.ts`
 * needs it, and pipeline infrastructure importing from a stage inverts the
 * dependency the pipeline is built on. It is a naming rule and depends on
 * nothing but the other naming rules.
 *
 * @param parts - The lecture number, provisional title (may be empty), and date.
 * @returns The base name shared by the workspace folder and the renamed source files.
 *
 * @example
 * lectureBaseName({ lectureNumber: 2, title: "", date });
 * // → "Lecture 2 - 2025-10-17"
 */
export function lectureBaseName(parts: LectureNameParts): string {
	const { lectureNumber, title, date } = parts;
	if (title === "") {
		return `Lecture ${lectureNumber} - ${formatDateISO(date)}`;
	}
	return lectureFolderName(parts);
}
