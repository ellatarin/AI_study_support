/**
 * The slide images that `render-slides` writes and the slide readings that
 * `read-slides` writes, for the stages that read them (technical-design.md §5,
 * `read-slides`, `place-slides` and `correct-terms`).
 */

import { join } from "node:path";
import { listFileNames, pathExists } from "../../utils/files.js";
import { isRecord, isStringList, readerFromCheck } from "../../utils/record.js";
import { slideFileName, slideImageFileName, stageDirectoryPath } from "../layout.js";
import { missingInputMessage, type ReadingStage, readInputJson } from "./stage-input.js";

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

const SUBJECT_MATTER: SlideKind = "subject-matter";

/**
 * Checks that a slide is a subject-matter slide. A model gets only these slides.
 *
 * @param slide - The slide reading.
 * @returns `true` when the slide's kind is subject matter.
 */
export function isSubjectMatter(slide: SlideReading): boolean {
	return slide.kind === SUBJECT_MATTER;
}

const REFERENCES: SlideKind = "references";

/**
 * Checks that a slide is a references slide. The code places it at the end of the
 * lecture, and it gets no figure number.
 *
 * @param slide - The slide reading.
 * @returns `true` when the slide's kind is references.
 */
export function isReferences(slide: SlideReading): boolean {
	return slide.kind === REFERENCES;
}

/**
 * Checks that a value is a figure: a `type` and a `description`, both strings.
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
 * Finds the reading of one slide by its slide number.
 *
 * @param args - The readings, and the slide.
 * @param args.slideReadings - The slide readings to search.
 * @param args.slideNumber - The number of the slide in the deck, from 1.
 * @returns The reading, or `undefined` when no reading has the slide number.
 */
export function findSlideReading({
	slideReadings,
	slideNumber,
}: {
	readonly slideReadings: readonly SlideReading[];
	readonly slideNumber: number;
}): SlideReading | undefined {
	return slideReadings.find((reading) => reading.slideNumber === slideNumber);
}

const SLIDE_IMAGES_STAGE = "render-slides";

/**
 * Gives the folder of the slide images in a workspace.
 *
 * @param workspaceRoot - The absolute path to the lecture workspace.
 * @returns The absolute path of the folder of `render-slides`.
 */
function slideImagesDir(workspaceRoot: string): string {
	return stageDirectoryPath({ workspaceRoot, stageId: SLIDE_IMAGES_STAGE });
}

type SlideInWorkspace = { readonly workspaceRoot: string; readonly slideNumber: number };

/**
 * Gives the path of the image of one slide, as `render-slides` writes it.
 *
 * @param args - The workspace, and the slide.
 * @param args.workspaceRoot - The absolute path to the lecture workspace.
 * @param args.slideNumber - The number of the slide in the deck, from 1.
 * @returns The absolute path of the slide image.
 */
export function slideImagePath({ workspaceRoot, slideNumber }: SlideInWorkspace): string {
	return join(slideImagesDir(workspaceRoot), slideImageFileName(slideNumber));
}

/**
 * Gives the path of the reading of one slide.
 *
 * @param args - The workspace, and the slide.
 * @param args.workspaceRoot - The absolute path to the lecture workspace.
 * @param args.slideNumber - The number of the slide in the deck, from 1.
 * @returns The absolute path of the slide reading.
 */
export function slideReadingPath({ workspaceRoot, slideNumber }: SlideInWorkspace): string {
	return join(
		stageDirectoryPath({ workspaceRoot, stageId: "read-slides" }),
		slideFileName({ slideNumber, extension: "json" }),
	);
}

/**
 * Reads the reading of one slide.
 *
 * @param args - The stage context, the slide, and the error to raise.
 * @param args.context - The stage context.
 * @param args.slideNumber - The number of the slide in the deck, from 1.
 * @param args.fail - Builds the reading stage's error from a message.
 * @returns The slide reading.
 * @throws The error that `fail` builds, if the file is missing, not JSON or not a slide reading.
 */
function readSlideReading({
	context,
	slideNumber,
	fail,
}: ReadingStage & { readonly slideNumber: number }): Promise<SlideReading> {
	return readInputJson({
		path: slideReadingPath({ workspaceRoot: context.workspaceRoot, slideNumber }),
		stageId: "read-slides",
		fail,
		read: readerFromCheck(isSlideReading),
		shape: "a slide reading",
	});
}

/** The reading stage, and the number of each slide that it needs. */
type ReadingSlides = ReadingStage & { readonly slideNumbers: readonly number[] };

/**
 * Reads the reading of each given slide.
 *
 * @param args - The stage context, the slides, and the error to raise.
 * @param args.context - The stage context.
 * @param args.slideNumbers - The number of each slide to read.
 * @param args.fail - Builds the reading stage's own error from a message.
 * @returns The slide readings, in the order of `slideNumbers`.
 * @throws The error that `fail` builds, if a file is missing, not JSON or not a slide reading.
 */
export function readSlideReadings({
	slideNumbers,
	...reading
}: ReadingSlides): Promise<readonly SlideReading[]> {
	return Promise.all(
		slideNumbers.map((slideNumber) => readSlideReading({ ...reading, slideNumber })),
	);
}

/**
 * Checks that the image of each given slide is on disk.
 *
 * @param args - The stage context, the slides, and the error to raise.
 * @param args.context - The stage context.
 * @param args.slideNumbers - The number of each slide to check.
 * @param args.fail - Builds the reading stage's own error from a message.
 * @returns A promise that resolves when each image is found.
 * @throws The error that `fail` builds, if an image is missing. The message names the image.
 */
export async function checkSlideImagesExist({
	context,
	slideNumbers,
	fail,
}: ReadingSlides): Promise<void> {
	for (const slideNumber of slideNumbers) {
		const path = slideImagePath({ workspaceRoot: context.workspaceRoot, slideNumber });
		if (!(await pathExists(path))) {
			throw fail(missingInputMessage({ path, stageId: SLIDE_IMAGES_STAGE }));
		}
	}
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
export async function findSlideImages({ context, fail }: ReadingStage): Promise<readonly string[]> {
	const imagesDir = slideImagesDir(context.workspaceRoot);
	const names = [...(await listFileNames(imagesDir))].sort();
	if (names.length === 0) {
		throw fail(missingInputMessage({ path: imagesDir, stageId: SLIDE_IMAGES_STAGE }));
	}
	return names.map((name) => join(imagesDir, name));
}
