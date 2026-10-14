/**
 * The rewrite files that `rewrite-subtopics` writes, for the stages that write
 * and read them (technical-design.md §5, `rewrite-subtopics` and `check-facts`).
 */

/* jscpd:ignore-start -- the modules of the subtopic files import the same
   readers. So their import blocks are the same line for line. Imports cannot be
   shared, and CLAUDE.md (File Organisation) forbids barrel files. Only the
   imports are exempt. jscpd checks the code below. */
import { isStringList } from "../../utils/record.js";
import type { ReadingStage } from "./stage-input.js";
import { hasSubtopicId, readSubtopicFile, type SubtopicFileFields } from "./subtopic-files.js";
/* jscpd:ignore-end */

/** The rewrite of one subtopic, as `rewrite-subtopics` writes it (technical-design.md §5, `rewrite-subtopics`). */
export type SubtopicRewrite = SubtopicFileFields & {
	readonly writerPromptVersion: string;
	readonly rewrittenSubtopic: readonly string[];
};

/**
 * Checks that a parsed file is a subtopic rewrite.
 *
 * @param value - The parsed file.
 * @returns `true` when the value is a {@link SubtopicRewrite}.
 */
export function isSubtopicRewrite(value: unknown): value is SubtopicRewrite {
	return (
		hasSubtopicId(value) &&
		typeof value.writerPromptVersion === "string" &&
		isStringList(value.rewrittenSubtopic)
	);
}

/**
 * Reads the rewrite file of one subtopic.
 *
 * @param file - The stage context, the subtopic, and the error to raise.
 * @returns The subtopic rewrite.
 * @throws The error that `fail` builds, if the file is missing, not JSON or not a subtopic rewrite.
 */
export function readSubtopicRewrite(
	file: SubtopicFileFields & ReadingStage,
): Promise<SubtopicRewrite> {
	return readSubtopicFile({
		...file,
		stageId: "rewrite-subtopics",
		isFile: isSubtopicRewrite,
		shape: "a subtopic rewrite",
	});
}
