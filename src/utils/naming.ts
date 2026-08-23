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

/** Words kept lowercase by {@link toTitleCase} unless they lead the title. */
const MINOR_WORDS: ReadonlySet<string> = new Set([
	"a",
	"an",
	"and",
	"as",
	"at",
	"but",
	"by",
	"for",
	"if",
	"in",
	"nor",
	"of",
	"on",
	"or",
	"per",
	"the",
	"to",
	"up",
	"via",
	"vs",
	"with",
]);

/** Leading module-code prefix (`BOD_`, `BOD `) attached to source filenames. */
const MODULE_CODE_PREFIX = /\bBOD[_ ]+/g;

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

/** Upper bound (inclusive) of the ASCII C0 control range; DEL is `0x7f`. */
const LAST_C0_CONTROL_CODE = 0x1f;
const DELETE_CODE = 0x7f;

/**
 * Title-cases a single word: first letter upper, remainder lower.
 *
 * @param word - The word to transform (may be empty).
 * @returns The title-cased word.
 */
function titleCaseWord(word: string): string {
	return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Title-cases text, keeping {@link MINOR_WORDS} lowercase unless first.
 *
 * @param text - Whitespace-separated words.
 * @returns The title-cased text.
 */
function toTitleCase(text: string): string {
	if (text.length === 0) {
		return text;
	}
	const [first = "", ...rest] = text.split(" ").map((word) => {
		const lower = word.toLowerCase();
		return MINOR_WORDS.has(lower) ? lower : titleCaseWord(word);
	});
	// The leading word is always capitalised, even when it is a minor word.
	return [titleCaseWord(first), ...rest].join(" ");
}

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
 * Strips the file extension, all date and weekday tokens, the module-code
 * prefix, any embedded lecture-number token, underscores, separator debris at
 * either end, and trailing artefacts, then title-cases what remains. Filenames
 * vary: a rich filename yields a full title, while a `date + Lecture N` filename
 * yields an **empty string**. Callers must fall back (e.g. to the bare
 * `Lecture N` name) on an empty result; Stage 3's LLM later judges whether the
 * title is meaningful.
 *
 * The separator strip is what lets a name this module built be read back: a
 * lecture whose sources were renamed by a run that then stopped before writing
 * its manifest is re-read from its canonical filename on the next run, and must
 * yield the title that name was built from (technical-design.md §3.2).
 *
 * @param filename - The user-supplied source filename.
 * @returns The cleaned, title-cased provisional title, possibly empty.
 *
 * @example
 * extractProvisionalTitle("2025-10-10 BOD_Disease cell injury Fri co.mp4");
 * // → "Disease Cell Injury"
 * extractProvisionalTitle("Lecture 1 - Cell Injury - 2025-10-10.mp4");
 * // → "Cell Injury"
 * extractProvisionalTitle("2025-10-10 Lecture 5.mp4");
 * // → ""
 */
export function extractProvisionalTitle(filename: string): string {
	const withoutExtension = filename.replace(FILE_EXTENSION, "");
	const withoutDates = stripDateTokens(withoutExtension);
	const withoutNoise = withoutDates
		.replace(MODULE_CODE_PREFIX, " ")
		.replace(LECTURE_NUMBER_TOKEN, " ")
		.replace(/_/g, " ");
	const normalised = withoutNoise.replace(/\s+/g, " ").trim();
	const withoutEdges = normalised.replace(EDGE_SEPARATORS, "");
	const withoutArtefacts = withoutEdges.replace(TRAILING_ARTEFACTS, "").trim();
	return toTitleCase(withoutArtefacts);
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
 * @throws Error when sanitisation leaves an empty string; the caller must fall
 *   back to a provisional title or a stage-defined default.
 *
 * @example
 * filenameSafe("../etc/passwd"); // → "etc passwd"
 * filenameSafe("..");            // → throws
 */
export function filenameSafe(title: string): string {
	const withoutSeparators = stripControlChars(title).replace(/[/\\]/g, " ");
	const withoutTraversal = withoutSeparators
		.split(/\s+/)
		.filter((segment) => segment !== "." && segment !== "..")
		.join(" ");
	const result = withoutTraversal
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^\.+|\.+$/g, "")
		.trim();
	if (result === "") {
		throw new Error(`filenameSafe produced an empty name from input: ${JSON.stringify(title)}`);
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
