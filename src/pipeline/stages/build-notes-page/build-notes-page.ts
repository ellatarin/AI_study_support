/**
 * The `build-notes-page` stage. It writes the page and the slide images of one
 * lecture into the lecture's folder in the final output folder. It makes no model
 * call (technical-design.md §5, "After the fact correction").
 */

import { copyFile, mkdir, rm } from "node:fs/promises";
import { join, relative } from "node:path";
/* jscpd:ignore-start -- jscpd matches these imports with the first imports of choose-division.ts.
   Both modules build a stage with a logger and a named error. An import is not logic, so nothing here can be extracted.
   The duplication floor stays where it is for code that can be extracted. */
import type { Logger } from "pino";
import type { PipelineStage, StageContext } from "../../../types/pipeline.js";
/* jscpd:ignore-end */
import { allInOrder } from "../../../utils/concurrency.js";
import { errorMessage, NamedError } from "../../../utils/errors.js";
import { pathExists, writeFileAtomic } from "../../../utils/files.js";
import {
	type LectureInModule,
	lectureNotesDirPath,
	NOTES_SLIDES_DIR,
	notesPagePath,
	notesPdfPath,
	notesSlideImageEntry,
} from "../../layout.js";
import { readFactCorrections } from "../fact-corrections.js";
import { createPipelineStage } from "../pipeline-stage.js";
import { readSlideRelocations, slideRelocationsPath } from "../slide-relocations.js";
import { checkSlideImagesExist, readSlideReadings, slideImagePath } from "../slides.js";
import { readStageSlidePlacements, readStageStructuredTranscript } from "../stage-input.js";
import { readSubtopicRewrite } from "../subtopic-rewrites.js";
import { readTermCorrectionResult } from "../term-corrections.js";
import { type NotesPageContent, notesPageHtml } from "./notes-page-html.js";
import { notesPdfHtml, readPngDataUrl } from "./notes-pdf-html.js";
import type { NotesPdfPrinter } from "./print-notes-pdf.js";

const STAGE_ID = "build-notes-page";

/** The error of the stage when an input file is missing or unreadable, or when the Notes PDF cannot be printed. */
export class BuildNotesPageError extends NamedError {}

/**
 * Builds the error of the stage from a message.
 *
 * @param message - The message of the error.
 * @returns The error.
 */
const fail = (message: string): BuildNotesPageError => new BuildNotesPageError(message);

/**
 * Gives the slide number of each slide in the notes.
 *
 * @param slideRelocations - The entry of each subtopic in `slide-relocations.json`.
 * @returns The slide numbers, in lecture order.
 */
function slideNumbersIn(slideRelocations: NotesPageContent["slideRelocations"]): readonly number[] {
	return slideRelocations.flatMap(({ slides }) => slides.map(({ slideNumber }) => slideNumber));
}

/**
 * Checks that each subtopic of the lecture has an entry in the slide relocations.
 * A subtopic with no entry has no notes text, so the page cannot show it.
 *
 * @param args - The lecture, its subtopics and its slide relocations.
 * @param args.context - The stage context of the lecture.
 * @param args.subtopicIds - The id of each subtopic, in lecture order.
 * @param args.slideRelocations - The entry of each subtopic in `slide-relocations.json`.
 * @throws {BuildNotesPageError} If a subtopic has no entry. The error names the subtopic.
 */
function checkEachSubtopicRelocated({
	context,
	subtopicIds,
	slideRelocations,
}: {
	readonly context: StageContext;
	readonly subtopicIds: readonly number[];
	readonly slideRelocations: NotesPageContent["slideRelocations"];
}): void {
	const relocated = new Set(slideRelocations.map(({ subtopicId }) => subtopicId));
	const missing = subtopicIds.find((subtopicId) => !relocated.has(subtopicId));
	if (missing !== undefined) {
		throw fail(
			`${slideRelocationsPath(context.workspaceRoot)} has no entry for subtopic ${missing}`,
		);
	}
}

/**
 * Gives a notice for each placed slide that no subtopic's relocation entry has.
 * The page leaves such a slide out. The slide has no reading, or `place-slides`
 * gave it a subtopic that is not in the lecture.
 *
 * @param content - The content of the page.
 * @returns One notice for each such slide, in the order of the placements.
 */
function unrelocatedSlideNotices(content: NotesPageContent): readonly string[] {
	const relocated = new Set(slideNumbersIn(content.slideRelocations));
	return content.slidePlacements
		.map(({ slideNumber }) => slideNumber)
		.filter((slideNumber) => !relocated.has(slideNumber))
		.map(
			(slideNumber) =>
				`Slide ${slideNumber} is placed, but no subtopic's relocation entry has it, so the notes page leaves it out.`,
		);
}

/**
 * Reads the content of the notes page from the output of the earlier stages.
 *
 * @param context - The stage context of the lecture.
 * @returns The content of the page.
 * @throws {BuildNotesPageError} If an input file is missing, unreadable or the wrong shape.
 */
async function readPageContent(context: StageContext): Promise<NotesPageContent> {
	const reading = { context, purpose: "build the notes page of", fail };
	const [{ topics }, { placements }, { factCorrectedSubtopics }, { slideRelocations }] =
		await Promise.all([
			readStageStructuredTranscript(reading),
			readStageSlidePlacements(reading),
			readFactCorrections(reading),
			readSlideRelocations(reading),
		]);
	const subtopicIds = topics.flatMap(({ subtopics }) =>
		subtopics.map(({ subtopicId }) => subtopicId),
	);
	checkEachSubtopicRelocated({ context, subtopicIds, slideRelocations });
	const [subtopicRewrites, termCorrections, slideReadings] = await Promise.all([
		Promise.all(subtopicIds.map((subtopicId) => readSubtopicRewrite({ ...reading, subtopicId }))),
		Promise.all(
			subtopicIds.map((subtopicId) => readTermCorrectionResult({ ...reading, subtopicId })),
		),
		readSlideReadings({ ...reading, slideNumbers: slideNumbersIn(slideRelocations) }),
	]);
	return {
		lectureTitle: context.lectureTitle,
		lectureDate: context.lectureDate,
		topics,
		slideRelocations,
		slideReadings,
		subtopicRewrites,
		termCorrections,
		slidePlacements: placements,
		factCorrections: factCorrectedSubtopics,
		pageViews: context.config.finalOutput.pageViews,
		highlightSlideSentences: context.config.finalOutput.highlightSlideSentences,
	};
}

/**
 * Gives the lecture of a stage context as the layout module names it: its module
 * and its current base name.
 *
 * @param context - The stage context of the lecture.
 * @returns The module root and the base name.
 */
function lectureOf(context: StageContext): LectureInModule {
	return { moduleRoot: context.moduleRoot, baseName: context.manifest.baseName };
}

/**
 * Reads the content of the page and checks that each slide image of the notes
 * exists. So a missing input stops the stage before it deletes anything.
 *
 * @param context - The stage context of the lecture.
 * @returns The content of the page.
 * @throws {BuildNotesPageError} If an input file or a slide image is missing, unreadable or the wrong shape.
 */
async function readCheckedPageContent(context: StageContext): Promise<NotesPageContent> {
	const content = await readPageContent(context);
	await checkSlideImagesExist({
		context,
		slideNumbers: slideNumbersIn(content.slideRelocations),
		fail,
	});
	return content;
}

/**
 * Gives the path of the copy of a slide image in the lecture's notes folder.
 *
 * @param args - The lecture, and the slide.
 * @param args.lecture - The module and the lecture.
 * @param args.slideNumber - The number of the slide in the deck.
 * @returns The absolute path of the copy.
 */
function slideCopyPath({
	lecture,
	slideNumber,
}: {
	readonly lecture: LectureInModule;
	readonly slideNumber: number;
}): string {
	return join(lectureNotesDirPath(lecture), notesSlideImageEntry(slideNumber));
}

/** The content of the notes, the stage context of the lecture, and the printer of the Notes PDF. */
type NotesWriting = {
	readonly content: NotesPageContent;
	readonly context: StageContext;
	readonly printNotesPdf: NotesPdfPrinter;
};

/**
 * Prints the Notes PDF of one lecture beside the notes page. The HTML holds each
 * slide image as data, read from its copy in the lecture's notes folder.
 *
 * @param args - The content of the page, the stage context and the printer of the Notes PDF.
 * @param args.content - The content of the page.
 * @param args.context - The stage context of the lecture.
 * @param args.printNotesPdf - Prints the Notes PDF.
 * @returns The absolute path of the Notes PDF.
 * @throws {BuildNotesPageError} If the PDF cannot be printed. The error names the path of the PDF and the cause.
 */
async function printPdf({ content, context, printNotesPdf }: NotesWriting): Promise<string> {
	const lecture = lectureOf(context);
	const slideNumbers = slideNumbersIn(content.slideRelocations);
	const imageUrls = await allInOrder({
		items: slideNumbers,
		work: (slideNumber) => readPngDataUrl(slideCopyPath({ lecture, slideNumber })),
	});
	const notesPdf = notesPdfPath(lecture);
	try {
		await printNotesPdf({
			html: notesPdfHtml({
				content,
				settings: context.config.finalOutput.pdf,
				slideImageUrl: (slideNumber) => imageUrls[slideNumbers.indexOf(slideNumber)] ?? "",
			}),
			path: notesPdf,
		});
	} catch (error: unknown) {
		throw fail(`The Notes PDF at ${notesPdf} could not be printed (${errorMessage(error)})`);
	}
	return notesPdf;
}

/**
 * Writes the notes of one lecture into the lecture's folder in the final output
 * folder. The folder holds `notes.html` and `notes.pdf`, and `slides/` holds a
 * copy of each slide image of the notes. The stage first deletes the folder of an
 * earlier build. The page is written last, so a stage that stops part of the way
 * leaves no page.
 *
 * @param args - The content of the page, the stage context and the printer of the Notes PDF.
 * @param args.content - The content of the page.
 * @param args.context - The stage context of the lecture.
 * @param args.printNotesPdf - Prints the Notes PDF.
 * @returns The paths of the Notes PDF and the notes page, relative to the workspace.
 */
async function writeNotes({
	content,
	context,
	printNotesPdf,
}: NotesWriting): Promise<readonly string[]> {
	const lecture = lectureOf(context);
	const notesDir = lectureNotesDirPath(lecture);
	await rm(notesDir, { recursive: true, force: true });
	await mkdir(join(notesDir, NOTES_SLIDES_DIR), { recursive: true });
	for (const slideNumber of slideNumbersIn(content.slideRelocations)) {
		await copyFile(
			slideImagePath({ workspaceRoot: context.workspaceRoot, slideNumber }),
			slideCopyPath({ lecture, slideNumber }),
		);
	}
	const notesPdf = await printPdf({ content, context, printNotesPdf });
	const notesPage = notesPagePath(lecture);
	await writeFileAtomic({ path: notesPage, content: notesPageHtml(content) });
	return [notesPdf, notesPage].map((path) => relative(context.workspaceRoot, path));
}

/**
 * Builds the `build-notes-page` stage. The stage counts as complete when the
 * notes page and the Notes PDF are both on disk under the lecture's current base
 * name. When either one is missing, the next pipeline run builds both again. To
 * build them again, the user deletes `notes.html` (technical-design.md §5,
 * `build-notes-page`).
 *
 * @param args - The dependencies of the stage.
 * @param args.logger - The logger of the invocation.
 * @param args.printNotesPdf - Prints the Notes PDF. The CLI gives the printer that uses Chrome.
 * @returns The stage.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger has mutable properties that the rule cannot ignore. This function only gives the logger to the stage.
export function createBuildNotesPageStage({
	logger,
	printNotesPdf,
}: {
	readonly logger: Logger;
	readonly printNotesPdf: NotesPdfPrinter;
}): PipelineStage<NotesPageContent, null> {
	return {
		...createPipelineStage({
			stageId: STAGE_ID,
			logger,
			getInput: readCheckedPageContent,
			run: async ({ input, context }) => ({
				output: null,
				filesWritten: await writeNotes({ content: input, context, printNotesPdf }),
				notices: unrelocatedSlideNotices(input),
			}),
		}),
		isComplete: async (context) => {
			const lecture = lectureOf(context);
			return (await pathExists(notesPagePath(lecture))) && pathExists(notesPdfPath(lecture));
		},
	};
}
