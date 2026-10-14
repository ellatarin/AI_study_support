/**
 * The term-correction files that `correct-terms` writes, for the stages that
 * write and read them (technical-design.md §5, `correct-terms` and
 * `rewrite-subtopics`).
 */

/* jscpd:ignore-start -- the modules of the subtopic files import the same
   readers. So their import blocks are the same line for line. Imports cannot be
   shared, and CLAUDE.md (File Organisation) forbids barrel files. Only the
   imports are exempt. jscpd checks the code below. */
import { isRecord } from "../../utils/record.js";
import type { ReadingStage } from "./stage-input.js";
import { hasSubtopicId, readSubtopicFile, type SubtopicFileFields } from "./subtopic-files.js";

/* jscpd:ignore-end */

const STAGE_ID = "correct-terms";

/** One correction as the reply gives it (CONTEXT.md, "Correction"). */
export type ReplyCorrection = {
	readonly wrongForm: string;
	readonly rightForm: string;
	readonly reason: string;
};

/** The check that a correction failed, in the order that code checks it. */
export type IgnoredBecause = "form-too-long" | "right-form-not-on-slide" | "wrong-form-not-in-text";

/** A correction that passed each check, and the number of places where it changed the text. */
export type Correction = ReplyCorrection & { readonly occurrencesChanged: number };

/** A correction that failed a check, and the first check that it failed. */
type IgnoredCorrection = ReplyCorrection & { readonly ignoredBecause: IgnoredBecause };

/**
 * The term-correction result of one subtopic, as `correct-terms` writes it
 * (technical-design.md §5, `correct-terms`).
 */
export type TermCorrectionResult = {
	readonly subtopicId: number;
	readonly termCorrectionPromptVersion: string;
	/** The slides placed in the subtopic. An empty list means that term correction made no call. */
	readonly slideNumbers: readonly number[];
	readonly corrections: readonly Correction[];
	readonly ignoredCorrections: readonly IgnoredCorrection[];
	readonly correctedText: string;
};

/**
 * Checks that a value is one correction of a reply: a `wrongForm`, a `rightForm`
 * and a `reason`, all strings.
 *
 * @param value - The value to test.
 * @returns `true` when the value is a {@link ReplyCorrection}.
 */
export function isReplyCorrection(value: unknown): value is ReplyCorrection {
	return (
		isRecord(value) &&
		typeof value.wrongForm === "string" &&
		typeof value.rightForm === "string" &&
		typeof value.reason === "string"
	);
}

/**
 * Checks that a parsed file is a term-correction result.
 *
 * @param value - The parsed file.
 * @returns `true` when the value is a {@link TermCorrectionResult}.
 */
export function isTermCorrectionResult(value: unknown): value is TermCorrectionResult {
	return (
		hasSubtopicId(value) &&
		typeof value.termCorrectionPromptVersion === "string" &&
		Array.isArray(value.slideNumbers) &&
		value.slideNumbers.every((slideNumber) => typeof slideNumber === "number") &&
		Array.isArray(value.corrections) &&
		value.corrections.every(
			(entry) =>
				isRecord(entry) && typeof entry.occurrencesChanged === "number" && isReplyCorrection(entry),
		) &&
		Array.isArray(value.ignoredCorrections) &&
		value.ignoredCorrections.every(
			(entry) =>
				isRecord(entry) && typeof entry.ignoredBecause === "string" && isReplyCorrection(entry),
		) &&
		typeof value.correctedText === "string"
	);
}

/**
 * Reads the term-correction file of one subtopic.
 *
 * @param file - The stage context, the subtopic, and the error to raise.
 * @returns The term-correction result.
 * @throws The error that `fail` builds, if the file is missing, not JSON or not a term-correction result.
 */
export function readTermCorrectionResult(
	file: SubtopicFileFields & ReadingStage,
): Promise<TermCorrectionResult> {
	return readSubtopicFile({
		...file,
		stageId: STAGE_ID,
		isFile: isTermCorrectionResult,
		shape: "a term-correction result",
	});
}
