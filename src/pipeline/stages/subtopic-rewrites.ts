/**
 * The rewrite files that `rewrite-subtopics` writes, for the stages that write
 * and read them (technical-design.md §5, `rewrite-subtopics` and `check-facts`).
 */

/* jscpd:ignore-start -- the modules of the subtopic files import the same
   readers. So their import blocks are the same line for line. Imports cannot be
   shared, and CLAUDE.md (File Organisation) forbids barrel files. Only the
   imports are exempt. jscpd checks the code below. */
import { isStringList } from "../../utils/record.js";
import { type ReadingStage, readStageSubtopics } from "./stage-input.js";
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

/** The rewrite of one subtopic, with the subtopic id and the title from the structured transcript. */
export type TitledSubtopicRewrite = Pick<SubtopicRewrite, "subtopicId" | "rewrittenSubtopic"> & {
	readonly title: string;
};

/**
 * Reads the subtopics of the structured transcript, and the rewrite of each one.
 *
 * @param args - The reading stage, and its purpose.
 * @param args.context - The stage context.
 * @param args.purpose - The use that the reading stage makes of the subtopics, such as "check the facts".
 * @param args.fail - Builds the reading stage's own error from a message.
 * @returns The rewrite of each subtopic in lecture order, with its id and title.
 * @throws The error that `fail` builds, if an input file is missing, unreadable or the wrong shape.
 */
export async function readTitledRewrites({
	context,
	purpose,
	fail,
}: ReadingStage & { readonly purpose: string }): Promise<readonly TitledSubtopicRewrite[]> {
	const subtopics = await readStageSubtopics({ context, purpose, fail });
	return Promise.all(
		subtopics.map(async ({ subtopicId, title }) => ({
			subtopicId,
			title,
			rewrittenSubtopic: (await readSubtopicRewrite({ context, subtopicId, fail }))
				.rewrittenSubtopic,
		})),
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
