import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pathExists } from "../../../utils/files.js";
import {
	captureError,
	makeStageContext,
	makeWorkspaceTree,
	otherLecture,
	rewrittenParagraphs,
	seedEarlierOutputs,
	seedJsonFile,
	seedTextFile,
	testLecture,
	type WorkspaceTree,
} from "../../fixtures.js";
import {
	lectureNotesDirPath,
	NOTES_PAGE_FILE,
	NOTES_SLIDES_DIR,
	notesSlideImageEntry,
	slideImageFileName,
} from "../../layout.js";
import { type SlideRelocation, slideRelocationsPath } from "../slide-relocations.js";
import { slideImagePath } from "../slides.js";
import { BuildNotesPageError, buildNotesPage } from "./build-notes-page.js";

const PROMPT_VERSION = "r4";

/** The paragraph of subtopic 2. Slides 1 and 2 are at its two sentences, and the references slide is at its end. */
const lastParagraph = "Cells meet stress. Some injury is reversible.";

/** The entry of each subtopic. Slide 3 of the seeded deck is content-free, so the notes leave it out. */
const slideRelocations: readonly SlideRelocation[] = [
	{
		subtopicId: 1,
		slideRelocationPromptVersion: PROMPT_VERSION,
		paragraphs: [rewrittenParagraphs[0]],
		slides: [],
		figureMarksWithNoSlide: [],
	},
	{
		subtopicId: 2,
		slideRelocationPromptVersion: PROMPT_VERSION,
		paragraphs: [lastParagraph],
		slides: [
			{ slideNumber: 1, paragraphIndex: 0, characterOffset: 0, figureNumber: 1 },
			{
				slideNumber: 2,
				paragraphIndex: 0,
				characterOffset: lastParagraph.indexOf("Some"),
				figureNumber: 2,
			},
			{
				slideNumber: 4,
				paragraphIndex: 0,
				characterOffset: lastParagraph.length,
				figureNumber: null,
			},
		],
		figureMarksWithNoSlide: [],
	},
];

const slideNumbersInNotes = slideRelocations.flatMap(({ slides }) =>
	slides.map(({ slideNumber }) => slideNumber),
);

describe("buildNotesPage", () => {
	let tree: WorkspaceTree;
	/**
	 * Gives the folder of a lecture's notes in the module of the test.
	 *
	 * @param baseName - The base name of the lecture.
	 * @returns The absolute path of the folder.
	 */
	const notesDirOf = (baseName: string): string =>
		lectureNotesDirPath({ moduleRoot: tree.moduleRoot, baseName });
	const notesDir = (): string => notesDirOf(testLecture.baseName);
	const imageOf = (slideNumber: number): string =>
		slideImagePath({ workspaceRoot: tree.workspaceRoot, slideNumber });
	const build = (): Promise<void> =>
		buildNotesPage(makeStageContext({ workspaceRoot: tree.workspaceRoot }));

	beforeEach(async () => {
		tree = await makeWorkspaceTree({ prefix: "build-notes-page-" });
		await seedEarlierOutputs({
			workspaceRoot: tree.workspaceRoot,
			readsFrom: ["structure-transcript", "render-slides", "read-slides"],
		});
		await seedJsonFile({
			path: slideRelocationsPath(tree.workspaceRoot),
			contents: { slideRelocations },
		});
	});

	afterEach(async () => {
		await rm(tree.moduleRoot, { recursive: true, force: true });
	});

	it("should write the notes page into the lecture's folder in the final output folder when the inputs are on disk", async () => {
		await build();

		const page = await readFile(join(notesDir(), NOTES_PAGE_FILE), "utf8");
		expect(page).toContain(rewrittenParagraphs[0]);
	});

	it("should copy the PNG of each slide in the notes beside the page byte for byte, and no other slide, when the page is built", async () => {
		await build();

		const copied = [...(await readdir(join(notesDir(), NOTES_SLIDES_DIR)))].sort();
		expect(copied).toStrictEqual(slideNumbersInNotes.map(slideImageFileName));
		for (const slideNumber of slideNumbersInNotes) {
			expect(await readFile(join(notesDir(), notesSlideImageEntry(slideNumber)))).toStrictEqual(
				await readFile(imageOf(slideNumber)),
			);
		}
	});

	it("should remove the files of an earlier build when the stage runs again", async () => {
		const earlierSlide = join(notesDir(), notesSlideImageEntry(9));
		await seedTextFile({ path: earlierSlide, contents: "an earlier build" });

		await build();

		expect(await pathExists(earlierSlide)).toBe(false);
	});

	it("should leave the folders of the other lectures in place when the stage builds the page", async () => {
		const otherPage = join(notesDirOf(otherLecture.baseName), NOTES_PAGE_FILE);
		const otherContents = "the other lecture";
		await seedTextFile({ path: otherPage, contents: otherContents });

		await build();

		expect(await readFile(otherPage, "utf8")).toBe(otherContents);
	});

	it.each([
		{ problem: "missing", spoil: (path: string) => rm(path) },
		{ problem: "the wrong shape", spoil: (path: string) => writeFile(path, "{}") },
	])("should fail with BuildNotesPageError that names the file when slide-relocations.json is $problem", async ({
		spoil,
	}) => {
		const path = slideRelocationsPath(tree.workspaceRoot);
		await spoil(path);

		const error = await captureError(build());

		expect(error).toBeInstanceOf(BuildNotesPageError);
		expect(error.message).toContain(basename(path));
	});

	it("should fail with BuildNotesPageError that names the slide when the PNG of a slide in the notes is missing", async () => {
		await rm(imageOf(2));

		const error = await captureError(build());

		expect(error).toBeInstanceOf(BuildNotesPageError);
		expect(error.message).toContain(basename(imageOf(2)));
	});
});
