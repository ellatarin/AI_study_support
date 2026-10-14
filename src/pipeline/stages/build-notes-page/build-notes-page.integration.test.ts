import { readdir, readFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StageContext } from "../../../types/pipeline.js";
import { pathExists } from "../../../utils/files.js";
import {
	captureError,
	correctedSubtopicText,
	driveStage,
	eachUnusableJsonFile,
	makeStageContext,
	makeStubLogger,
	makeWorkspaceTree,
	otherLecture,
	rewriteInput,
	rewrittenParagraphs,
	seedEarlierOutputs,
	seedJsonFile,
	seedTextFile,
	spoilJsonFile,
	stageOutputInput,
	termCorrectionInput,
	testLecture,
	type WorkspaceTree,
} from "../../fixtures.js";
import {
	lectureNotesDirPath,
	NOTES_SLIDES_DIR,
	notesPagePath,
	notesSlideImageEntry,
	slideImageFileName,
} from "../../layout.js";
import { type SlideRelocation, slideRelocationsPath } from "../slide-relocations.js";
import { slideImagePath } from "../slides.js";
import { BuildNotesPageError, createBuildNotesPageStage } from "./build-notes-page.js";

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

describe("createBuildNotesPageStage", () => {
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
	const readNotesPage = (): Promise<string> =>
		readFile(
			notesPagePath({ moduleRoot: tree.moduleRoot, baseName: testLecture.baseName }),
			"utf8",
		);
	const imageOf = (slideNumber: number): string =>
		slideImagePath({ workspaceRoot: tree.workspaceRoot, slideNumber });
	const stage = (): ReturnType<typeof createBuildNotesPageStage> =>
		createBuildNotesPageStage({ logger: makeStubLogger().logger });
	const context = (): StageContext => makeStageContext({ workspaceRoot: tree.workspaceRoot });
	const build = (): ReturnType<typeof driveStage> =>
		driveStage({ stage: stage(), context: context() });
	const seedSlideRelocations = (entries: readonly SlideRelocation[]): Promise<void> =>
		seedJsonFile({
			path: slideRelocationsPath(tree.workspaceRoot),
			contents: { slideRelocations: entries },
		});

	beforeEach(async () => {
		tree = await makeWorkspaceTree({ prefix: "build-notes-page-" });
		await seedEarlierOutputs({
			workspaceRoot: tree.workspaceRoot,
			readsFrom: [
				"structure-transcript",
				"render-slides",
				"read-slides",
				"rewrite-subtopics",
				"correct-terms",
				"place-slides",
				"correct-factual-errors",
			],
		});
		await seedSlideRelocations(slideRelocations);
	});

	afterEach(async () => {
		await rm(tree.moduleRoot, { recursive: true, force: true });
	});

	it("should write the notes page into the lecture's folder in the final output folder when the inputs are on disk", async () => {
		await build();

		const page = await readNotesPage();
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
		const otherPage = notesPagePath({
			moduleRoot: tree.moduleRoot,
			baseName: otherLecture.baseName,
		});
		const otherContents = "the other lecture";
		await seedTextFile({ path: otherPage, contents: otherContents });

		await build();

		expect(await readFile(otherPage, "utf8")).toBe(otherContents);
	});

	it("should write the rewrite and the term-corrected text of a subtopic into the page when the inputs are on disk", async () => {
		// With no slide, no figure stands between the words of a text.
		await seedSlideRelocations(slideRelocations.map((entry) => ({ ...entry, slides: [] })));

		await build();

		const page = await readNotesPage();
		const text = page.replace(/<[^>]*>/gu, "");
		expect(text).toContain(rewrittenParagraphs[1]);
		expect(text).toContain(correctedSubtopicText);
	});

	it.each(
		eachUnusableJsonFile([
			{ file: "slide relocations file", path: slideRelocationsPath },
			rewriteInput(2),
			termCorrectionInput(2),
			stageOutputInput({ file: "slide placements file", stageId: "place-slides" }),
			stageOutputInput({
				file: "fact-corrected subtopics file",
				stageId: "correct-factual-errors",
			}),
		]),
	)("should fail with BuildNotesPageError that names the file when the $file is $state", async ({
		path,
		contents,
	}) => {
		const spoiled = path(tree.workspaceRoot);
		await spoilJsonFile({ path: spoiled, contents });

		const error = await captureError(build());

		expect(error).toBeInstanceOf(BuildNotesPageError);
		expect(error.message).toContain(spoiled);
	});

	it("should fail with BuildNotesPageError that names the subtopic when a subtopic has no slide relocation entry", async () => {
		await seedSlideRelocations(slideRelocations.slice(1));

		const error = await captureError(build());

		expect(error).toBeInstanceOf(BuildNotesPageError);
		expect(error.message).toContain("subtopic 1");
	});

	it("should write the page and give a notice that names the slide when a placed slide is in no slide relocation entry", async () => {
		await seedSlideRelocations(
			slideRelocations.map((entry) => ({
				...entry,
				slides: entry.slides.filter(({ slideNumber }) => slideNumber !== 2),
			})),
		);

		const { notices } = await build();

		expect(notices).toStrictEqual([
			"Slide 2 is placed, but no subtopic's relocation entry has it, so the notes page leaves it out.",
		]);
		expect(
			await pathExists(
				notesPagePath({ moduleRoot: tree.moduleRoot, baseName: testLecture.baseName }),
			),
		).toBe(true);
	});

	it.each([
		{ state: "is on disk", complete: true, afterBuild: async (): Promise<void> => {} },
		{
			state: "is missing",
			complete: false,
			afterBuild: (): Promise<void> =>
				rm(notesPagePath({ moduleRoot: tree.moduleRoot, baseName: testLecture.baseName })),
		},
	])("should count the stage as complete only when the notes page under the current base name $state", async ({
		complete,
		afterBuild,
	}) => {
		await build();
		await afterBuild();

		expect(await stage().isComplete(context())).toBe(complete);
	});

	it("should fail with BuildNotesPageError that names the slide when the PNG of a slide in the notes is missing", async () => {
		await rm(imageOf(2));

		const error = await captureError(build());

		expect(error).toBeInstanceOf(BuildNotesPageError);
		expect(error.message).toContain(basename(imageOf(2)));
	});
});
