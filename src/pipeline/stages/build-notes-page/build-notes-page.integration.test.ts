import { readdir, readFile, rm } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PipelineConfig, StageContext } from "../../../types/pipeline.js";
import { pathExists } from "../../../utils/files.js";
import {
	captureError,
	correctedSubtopicText,
	driveStage,
	eachUnusableJsonFile,
	makeConfig,
	makeStageContext,
	makeStubLogger,
	makeStubNotesPdfPrinter,
	makeWorkspaceTree,
	otherLecture,
	pageViewsIn,
	rewriteInput,
	rewrittenParagraphs,
	STUB_NOTES_PDF,
	type StubNotesPdfPrinter,
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
	type LectureInModule,
	lectureNotesDirPath,
	NOTES_SLIDES_DIR,
	notesPagePath,
	notesPdfPath,
	notesSlideImageEntry,
	slideImageFileName,
} from "../../layout.js";
import { type SlideRelocation, slideRelocationsPath } from "../slide-relocations.js";
import { slideImagePath } from "../slides.js";
import { BuildNotesPageError, createBuildNotesPageStage } from "./build-notes-page.js";
import { PRINT_TIMEOUT_MS, readPdfLayout } from "./fixtures.js";
import { type NotesPdfPrinter, printNotesPdf } from "./print-notes-pdf.js";

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
	const lecture = (): LectureInModule => ({
		moduleRoot: tree.moduleRoot,
		baseName: testLecture.baseName,
	});
	const readNotesPage = (): Promise<string> => readFile(notesPagePath(lecture()), "utf8");
	const imageOf = (slideNumber: number): string =>
		slideImagePath({ workspaceRoot: tree.workspaceRoot, slideNumber });
	let printer: StubNotesPdfPrinter;
	/**
	 * Builds the stage with a printer that starts no Chrome.
	 *
	 * @param printNotesPdf - The printer. The default is the stub printer of the test.
	 * @returns The stage.
	 */
	const stage = (
		printNotesPdf: NotesPdfPrinter = printer.printNotesPdf,
	): ReturnType<typeof createBuildNotesPageStage> =>
		createBuildNotesPageStage({ logger: makeStubLogger().logger, printNotesPdf });
	const context = (): StageContext => makeStageContext({ workspaceRoot: tree.workspaceRoot });
	const build = (): ReturnType<typeof driveStage> =>
		driveStage({ stage: stage(), context: context() });
	const seedSlideRelocations = (entries: readonly SlideRelocation[]): Promise<void> =>
		seedJsonFile({
			path: slideRelocationsPath(tree.workspaceRoot),
			contents: { slideRelocations: entries },
		});

	beforeEach(async () => {
		printer = makeStubNotesPdfPrinter();
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

	it("should write notes.pdf beside notes.html in the lecture's folder when the inputs are on disk", async () => {
		await build();

		expect(await readFile(notesPdfPath(lecture()), "utf8")).toBe(STUB_NOTES_PDF);
	});

	it("should give the printer HTML that holds each slide image of the notes as data when the stage prints the PDF", async () => {
		await build();

		const [print] = printer.prints;
		for (const slideNumber of slideNumbersInNotes) {
			const png = await readFile(imageOf(slideNumber), "base64");
			expect(print?.html).toContain(`src="data:image/png;base64,${png}"`);
		}
	});

	it("should report the paths of notes.pdf and notes.html as the files written when the stage completes", async () => {
		const { filesWritten } = await build();

		expect(filesWritten).toStrictEqual(
			[notesPdfPath(lecture()), notesPagePath(lecture())].map((path) =>
				relative(tree.workspaceRoot, path),
			),
		);
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
		expect(await pathExists(notesPagePath(lecture()))).toBe(true);
	});

	/**
	 * Builds the page with some settings of the `finalOutput` section replaced.
	 *
	 * @param args - The settings, and the printer.
	 * @param args.finalOutput - The settings to replace.
	 * @param args.printNotesPdf - The printer. The default is the stub printer of the test.
	 * @returns The notes page.
	 */
	async function buildWithFinalOutput({
		finalOutput,
		printNotesPdf = printer.printNotesPdf,
	}: {
		readonly finalOutput: Partial<PipelineConfig["finalOutput"]>;
		readonly printNotesPdf?: NotesPdfPrinter;
	}): Promise<string> {
		const config = makeConfig();
		await driveStage({
			stage: stage(printNotesPdf),
			context: makeStageContext({
				workspaceRoot: tree.workspaceRoot,
				config: { ...config, finalOutput: { ...config.finalOutput, ...finalOutput } },
			}),
		});
		return readNotesPage();
	}

	it("should build the page with only the page views of the config when the config lists two views", async () => {
		const page = await buildWithFinalOutput({
			finalOutput: { pageViews: ["notes", "transcript"] },
		});

		expect(pageViewsIn(page)).toStrictEqual(["notes", "transcript"]);
	});

	it("should build the page with no highlight when the highlight switch of the config is off", async () => {
		const page = await buildWithFinalOutput({ finalOutput: { highlightSlideSentences: false } });

		expect(page).not.toContain("<mark>");
	});

	it(
		"should print the text of the Notes PDF at the size of finalOutput.pdf.fontSizePt when the stage prints with Chrome",
		async () => {
			const fontSizePt = 9;
			await buildWithFinalOutput({
				finalOutput: { pdf: { ...makeConfig().finalOutput.pdf, fontSizePt } },
				printNotesPdf,
			});

			const lines = (await readPdfLayout(notesPdfPath(lecture()))).flatMap(({ lines }) => lines);
			const paragraphLine = lines.find(({ text }) => text.includes(rewrittenParagraphs[0]));
			expect(paragraphLine?.fontSize).toBeCloseTo(fontSizePt, 0);
		},
		PRINT_TIMEOUT_MS,
	);

	it.each([
		{
			state: "and the Notes PDF are on disk",
			complete: true,
			afterBuild: async (): Promise<void> => {},
		},
		{
			state: "is missing",
			complete: false,
			afterBuild: (): Promise<void> => rm(notesPagePath(lecture())),
		},
		{
			state: "is on disk and the Notes PDF is missing",
			complete: false,
			afterBuild: (): Promise<void> => rm(notesPdfPath(lecture())),
		},
	])("should count the stage as complete only when the notes page under the current base name $state", async ({
		complete,
		afterBuild,
	}) => {
		await build();
		await afterBuild();

		expect(await stage().isComplete(context())).toBe(complete);
	});

	it("should count the stage as not complete, and then write notes.pdf and notes.html, when a notes folder from before the Notes PDF has only notes.html", async () => {
		const oldPage = "a notes page from before the Notes PDF";
		await seedTextFile({ path: notesPagePath(lecture()), contents: oldPage });
		const completeBefore = await stage().isComplete(context());

		await build();

		expect(completeBefore).toBe(false);
		expect(await readFile(notesPdfPath(lecture()), "utf8")).toBe(STUB_NOTES_PDF);
		expect(await readNotesPage()).not.toBe(oldPage);
	});

	it("should fail with BuildNotesPageError that names the path of notes.pdf and the cause, and write no notes.html, when the PDF cannot be printed", async () => {
		const cause = "Chrome did not start";
		const failingPrinter: NotesPdfPrinter = () => Promise.reject(new Error(cause));

		const error = await captureError(
			driveStage({ stage: stage(failingPrinter), context: context() }),
		);

		expect(error).toBeInstanceOf(BuildNotesPageError);
		expect(error.message).toContain(notesPdfPath(lecture()));
		expect(error.message).toContain(cause);
		expect(await pathExists(notesPagePath(lecture()))).toBe(false);
	});

	it("should fail with BuildNotesPageError that names the slide when the PNG of a slide in the notes is missing", async () => {
		await rm(imageOf(2));

		const error = await captureError(build());

		expect(error).toBeInstanceOf(BuildNotesPageError);
		expect(error.message).toContain(basename(imageOf(2)));
	});
});
