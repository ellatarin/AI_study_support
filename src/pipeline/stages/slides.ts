/**
 * The slide images that `render-slides` writes and the slide readings that
 * `read-slides` writes, for the stages that read them (technical-design.md §5,
 * `read-slides` and `place-slides`).
 */

import { join } from "node:path";
import type { StageContext } from "../../types/pipeline.js";
import { listFileNames } from "../../utils/files.js";
import { isRecord } from "../../utils/record.js";
import { slideFileName, stageDirectoryPath } from "../layout.js";

/** The kind of a slide (CONTEXT.md, "Content-free slide"), as the `read-slides` reply gives it. */
export type SlideKind = "content-free" | "references" | "subject-matter";

/** One figure of a slide (CONTEXT.md, "Figure"). */
type Figure = { readonly type: string; readonly description: string };

/** The reply that the `read-slides` prompt asks for. */
export type SlideReadingReply = {
	readonly title: string;
	readonly body: string;
	readonly tables: readonly string[];
	readonly figures: readonly Figure[];
	readonly caption: string;
	readonly kind: string;
};

/** One slide reading, as `read-slides` writes it (technical-design.md §5, `read-slides`). */
export type SlideReading = { readonly slideNumber: number } & SlideReadingReply;

/**
 * Tells if a value is a list of strings.
 *
 * @param value - The value to test.
 * @returns `true` when every entry is a string.
 */
function isStringList(value: unknown): value is readonly string[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/**
 * Tells if a value is a figure: a `type` and a `description`, both strings.
 *
 * @param value - The value to test.
 * @returns `true` when the value is a {@link Figure}.
 */
function isFigure(value: unknown): value is Figure {
	return isRecord(value) && typeof value.type === "string" && typeof value.description === "string";
}

/**
 * Checks that a parsed reply has the six fields of the `read-slides` prompt, with
 * the right types.
 *
 * @param value - The parsed reply.
 * @returns `true` when the value is a {@link SlideReadingReply}.
 */
export function isSlideReadingReply(value: unknown): value is SlideReadingReply {
	return (
		isRecord(value) &&
		typeof value.title === "string" &&
		typeof value.body === "string" &&
		isStringList(value.tables) &&
		Array.isArray(value.figures) &&
		value.figures.every(isFigure) &&
		typeof value.caption === "string" &&
		typeof value.kind === "string"
	);
}

/**
 * Checks that a parsed saved reading has its slide number and the six fields of
 * the reply.
 *
 * @param value - The parsed saved reading.
 * @returns `true` when the value is a {@link SlideReading}.
 */
export function isSlideReading(value: unknown): value is SlideReading {
	return isRecord(value) && typeof value.slideNumber === "number" && isSlideReadingReply(value);
}

/**
 * Gives the path of the reading of one slide.
 *
 * @param args - The workspace, and the slide.
 * @param args.workspaceRoot - The absolute path to the lecture workspace.
 * @param args.slideNumber - The number of the slide in the deck, from 1.
 * @returns The absolute path of the slide reading.
 */
export function slideReadingPath({
	workspaceRoot,
	slideNumber,
}: {
	readonly workspaceRoot: string;
	readonly slideNumber: number;
}): string {
	return join(
		stageDirectoryPath({ workspaceRoot, stageId: "read-slides" }),
		slideFileName({ slideNumber, extension: "json" }),
	);
}

/**
 * Finds the slide images that `render-slides` wrote.
 *
 * @param args - The stage context, and the error to raise.
 * @param args.context - The stage context.
 * @param args.fail - Builds the reading stage's own error from a message.
 * @returns The absolute path of each slide image, in deck order.
 * @throws The error that `fail` builds, if the directory holds no slide image.
 */
export async function findSlideImages({
	context,
	fail,
}: {
	readonly context: StageContext;
	readonly fail: (message: string) => Error;
}): Promise<readonly string[]> {
	const slideImagesDir = stageDirectoryPath({
		workspaceRoot: context.workspaceRoot,
		stageId: "render-slides",
	});
	const names = [...(await listFileNames(slideImagesDir))].sort();
	if (names.length === 0) {
		throw fail(`${slideImagesDir} holds no slide image. Run render-slides first.`);
	}
	return names.map((name) => join(slideImagesDir, name));
}
