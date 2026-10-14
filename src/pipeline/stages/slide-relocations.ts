/**
 * The files that `relocate-slides` writes, for the stages that write and read them
 * (technical-design.md §5, "After the fact correction").
 */

/* jscpd:ignore-start -- the modules of the whole-lecture files import the same
   readers and checks. So their import blocks are the same line for line. Imports
   cannot be shared, and CLAUDE.md (File Organisation) forbids barrel files. Only
   the imports are exempt. jscpd checks the code below. */
import { isNumberOrNull, isRecord, isStringList, readerFromCheck } from "../../utils/record.js";
import { stageDirectoryPath, stageOutputPath } from "../layout.js";
import { type ReadingStage, readInputJson } from "./stage-input.js";
import { hasSubtopicId } from "./subtopic-files.js";

/* jscpd:ignore-end */

/** The point of a slide or a figure mark in the paragraphs of one subtopic. */
export type TextPoint = {
	/** The paragraph, from 0. */
	readonly paragraphIndex: number;
	/** The number of characters in the paragraph before the point. */
	readonly characterOffset: number;
};

/** The references slide at its point in the notes. It has no figure number, so its `figureNumber` is null. */
type RelocatedReferencesSlide = TextPoint & {
	readonly slideNumber: number;
	readonly figureNumber: null;
};

/**
 * One slide at its point in the notes. The type is a union, so
 * {@link isRelocatedReferencesSlide} gives the figure number its type in both
 * branches.
 */
export type RelocatedSlide =
	| RelocatedReferencesSlide
	| (TextPoint & { readonly slideNumber: number; readonly figureNumber: number });

/** The figure mark that the writer puts in the notes (CONTEXT.md, "Figure mark"). */
export const FIGURE_MARK = "[FIGURE]";

/** The word that starts the label of a slide in the notes. */
const FIGURE_WORD = "Figure";

/**
 * The regular-expression source of a figure label in brackets, such as
 * "(Figure 3)". Slide relocation writes it in place of a figure mark.
 */
export const BRACKETED_FIGURE_LABEL = String.raw`\(${FIGURE_WORD} \d+\)`;

/**
 * Gives the label of a slide in the notes, such as "Figure 3" (CONTEXT.md, "Figure number").
 *
 * @param figureNumber - The figure number of the slide.
 * @returns The label.
 */
export function figureLabel(figureNumber: number): string {
	return `${FIGURE_WORD} ${figureNumber}`;
}

/**
 * Gives the figure label in brackets that slide relocation writes in place of a
 * figure mark, such as "(Figure 3)".
 *
 * @param figureNumber - The figure number of the slide.
 * @returns The label in brackets.
 */
export function bracketedFigureLabel(figureNumber: number): string {
	return `(${figureLabel(figureNumber)})`;
}

/**
 * Checks that a relocated slide is the references slide.
 *
 * @param slide - The relocated slide.
 * @returns `true` when the slide has no figure number.
 */
export function isRelocatedReferencesSlide(
	slide: RelocatedSlide,
): slide is RelocatedReferencesSlide {
	return slide.figureNumber === null;
}

/** The file of one subtopic in {@link SLIDE_RELOCATIONS_DIR}. */
export type SlideRelocation = {
	readonly subtopicId: number;
	readonly slideRelocationPromptVersion: string;
	/** The fact-corrected paragraphs, with "(Figure N)" in place of each figure mark that points at a slide. */
	readonly paragraphs: readonly string[];
	/** Each slide of the subtopic, in deck order. */
	readonly slides: readonly RelocatedSlide[];
	/** Each "[FIGURE]" mark that points at no slide. */
	readonly figureMarksWithNoSlide: readonly TextPoint[];
};

/** The file of the whole lecture, `slide-relocations.json`. */
export type SlideRelocations = { readonly slideRelocations: readonly SlideRelocation[] };

/**
 * Gives the absolute path of the stage's folder in a lecture's workspace.
 *
 * @param workspaceRoot - The absolute path of the lecture's workspace.
 * @returns The absolute path of the folder.
 */
export function slideRelocationsDirectory(workspaceRoot: string): string {
	return stageDirectoryPath({ workspaceRoot, stageId: "relocate-slides" });
}

/**
 * Gives the path of `slide-relocations.json` in a lecture's workspace.
 *
 * @param workspaceRoot - The absolute path of the lecture's workspace.
 * @returns The absolute path of the file.
 */
export function slideRelocationsPath(workspaceRoot: string): string {
	return stageOutputPath({ workspaceRoot, stageId: "relocate-slides" });
}

/**
 * Checks that a value is a point in the paragraphs of a subtopic.
 *
 * @param value - The value to test.
 * @returns `true` when the value is a {@link TextPoint}.
 */
function isTextPoint(value: unknown): value is TextPoint {
	return (
		isRecord(value) &&
		typeof value.paragraphIndex === "number" &&
		typeof value.characterOffset === "number"
	);
}

/**
 * Checks that a value is one slide at its point in the notes.
 *
 * @param value - The value to test.
 * @returns `true` when the value is a {@link RelocatedSlide}.
 */
function isRelocatedSlide(value: unknown): value is RelocatedSlide {
	return (
		isRecord(value) &&
		typeof value.slideNumber === "number" &&
		isNumberOrNull(value.figureNumber) &&
		isTextPoint(value)
	);
}

/**
 * Checks that a parsed file is the file of one subtopic.
 *
 * @param value - The parsed file.
 * @returns `true` when the value is a {@link SlideRelocation}.
 */
export function isSlideRelocation(value: unknown): value is SlideRelocation {
	return (
		hasSubtopicId(value) &&
		typeof value.slideRelocationPromptVersion === "string" &&
		isStringList(value.paragraphs) &&
		Array.isArray(value.slides) &&
		value.slides.every(isRelocatedSlide) &&
		Array.isArray(value.figureMarksWithNoSlide) &&
		value.figureMarksWithNoSlide.every(isTextPoint)
	);
}

/**
 * Checks that a parsed file is the file of the whole lecture.
 *
 * @param value - The parsed file.
 * @returns `true` when the value is {@link SlideRelocations}.
 */
function isSlideRelocations(value: unknown): value is SlideRelocations {
	return (
		isRecord(value) &&
		Array.isArray(value.slideRelocations) &&
		value.slideRelocations.every(isSlideRelocation)
	);
}

/**
 * Reads `slide-relocations.json`, the file of the whole lecture that
 * `relocate-slides` writes.
 *
 * @param reading - The stage context, and the error to raise.
 * @param reading.context - The stage context of the current lecture.
 * @param reading.fail - Builds the reading stage's own error from a message.
 * @returns The file of each subtopic, in lecture order.
 * @throws The error that `fail` builds, if the file is missing, not JSON or not the documented shape. The message names the file.
 */
export function readSlideRelocations({ context, fail }: ReadingStage): Promise<SlideRelocations> {
	return readInputJson({
		path: slideRelocationsPath(context.workspaceRoot),
		stageId: "relocate-slides",
		fail,
		read: readerFromCheck(isSlideRelocations),
		shape: "the slide relocations of a lecture",
	});
}
