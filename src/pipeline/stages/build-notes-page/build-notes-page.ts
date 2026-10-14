/**
 * The `build-notes-page` stage. It writes the page and the slide images of one
 * lecture into the lecture's folder in the final output folder. It makes no model
 * call (technical-design.md §5, "After the fact correction").
 *
 * The stage is not yet in `STAGE_IDS`. So this module gives the work of the stage,
 * and a later change builds the pipeline stage around it.
 */

import { copyFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { StageContext } from "../../../types/pipeline.js";
import { NamedError } from "../../../utils/errors.js";
import { writeFileAtomic } from "../../../utils/files.js";
import {
	lectureNotesDirPath,
	NOTES_PAGE_FILE,
	NOTES_SLIDES_DIR,
	notesSlideImageEntry,
} from "../../layout.js";
import { readSlideRelocations } from "../slide-relocations.js";
import { checkSlideImagesExist, readSlideReadings, slideImagePath } from "../slides.js";
import { readStageStructuredTranscript } from "../stage-input.js";
import { notesPageHtml } from "./notes-page-html.js";

/** The error of the stage when an input file is missing or unreadable. */
export class BuildNotesPageError extends NamedError {}

/**
 * Builds the error of the stage from a message.
 *
 * @param message - The message of the error.
 * @returns The error.
 */
const fail = (message: string): BuildNotesPageError => new BuildNotesPageError(message);

/**
 * Writes the notes of one lecture into the lecture's folder in the final output
 * folder. The folder holds `notes.html`, and `slides/` holds a copy of each slide
 * image of the notes.
 * The stage first deletes the folder of an earlier build. A missing input stops
 * the stage before the delete.
 *
 * @param context - The stage context of the lecture.
 * @returns A promise that resolves when the folder is written.
 * @throws {BuildNotesPageError} If an input file or a slide image is missing, unreadable or the wrong shape.
 */
export async function buildNotesPage(context: StageContext): Promise<void> {
	const { topics } = await readStageStructuredTranscript({
		context,
		purpose: "build the notes page of",
		fail,
	});
	const { slideRelocations } = await readSlideRelocations({ context, fail });
	const slideNumbers = slideRelocations.flatMap(({ slides }) =>
		slides.map(({ slideNumber }) => slideNumber),
	);
	const slideReadings = await readSlideReadings({ context, slideNumbers, fail });
	const { workspaceRoot } = context;
	await checkSlideImagesExist({ context, slideNumbers, fail });
	const notesDir = lectureNotesDirPath({
		moduleRoot: context.moduleRoot,
		baseName: context.manifest.baseName,
	});
	await rm(notesDir, { recursive: true, force: true });
	await mkdir(join(notesDir, NOTES_SLIDES_DIR), { recursive: true });
	for (const slideNumber of slideNumbers) {
		await copyFile(
			slideImagePath({ workspaceRoot, slideNumber }),
			join(notesDir, notesSlideImageEntry(slideNumber)),
		);
	}
	await writeFileAtomic({
		path: join(notesDir, NOTES_PAGE_FILE),
		content: notesPageHtml({
			lectureTitle: context.lectureTitle,
			lectureDate: context.lectureDate,
			topics,
			slideRelocations,
			slideReadings,
		}),
	});
}
