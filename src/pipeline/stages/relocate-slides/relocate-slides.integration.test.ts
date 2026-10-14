import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
	captureError,
	factCorrectedSubtopicsFile,
	factCorrectedSubtopicsOf,
	itFailsAfterTheThirdUnusableSend,
	itFailsNamingEachSpoiledFile,
	itReadsSavedSubtopicFiles,
	readJsonFile,
	seedJsonFile,
	sentSystemMessage,
	sentUserMessage,
	slideDeckReadings,
	slideReadingInput,
	slideRelocationFile,
	stageOutputInput,
	useStageReadingEarlierOutputs,
} from "../../fixtures.js";
import { createRelocateSlidesStage, RelocateSlidesError } from "./relocate-slides.js";
import { SLIDE_RELOCATION_PROMPT_VERSION } from "./relocate-slides.prompt.js";

const STAGE_ID = "relocate-slides";

/** The workspace-relative path of the stage's output file, stated in full here. */
const slideRelocationsFile = "Slide relocations/slide-relocations.json";

/** The fact-corrected paragraphs of one subtopic. */
type FactCorrectedParagraphs = {
	readonly subtopicId: number;
	readonly paragraphs: readonly string[];
};

/**
 * The fact-corrected paragraphs of each subtopic. The seeded placements place
 * slides 1, 2 and the references slide 4 in subtopic 2.
 */
const subtopics: readonly FactCorrectedParagraphs[] = [
	{ subtopicId: 1, paragraphs: ["Cancer is a disease of cells. [FIGURE]"] },
	{
		subtopicId: 2,
		paragraphs: ["Cell injury can be reversible. [FIGURE] Severe injury kills the cell."],
	},
];

/** A usable reply for subtopic 2: slide 1 at the figure mark, and slide 2 at the second sentence. */
const usableReply = {
	slides: [
		{ slide: 1, startWords: "Cell injury can be reversible" },
		{ slide: 2, startWords: "Severe injury kills the cell" },
	],
	figureMarks: [{ mark: 1, slide: 1 }],
};

describe("createRelocateSlidesStage", () => {
	const { workspaceRoot, create, run } = useStageReadingEarlierOutputs({
		stageId: STAGE_ID,
		readsFrom: ["place-slides", "read-slides", "correct-factual-errors"],
		factory: createRelocateSlidesStage,
		reply: JSON.stringify(usableReply),
	});

	/**
	 * Writes the fact-corrected subtopics of the lecture over the seeded ones.
	 *
	 * @param lectureSubtopics - The fact-corrected paragraphs of each subtopic.
	 * @returns A promise that resolves when the file is written.
	 */
	function seedFactCorrected(lectureSubtopics: readonly FactCorrectedParagraphs[]): Promise<void> {
		return seedJsonFile({
			path: join(workspaceRoot(), factCorrectedSubtopicsFile),
			contents: factCorrectedSubtopicsOf(lectureSubtopics),
		});
	}

	/**
	 * Reads a JSON file of the workspace of the current test.
	 *
	 * @param file - The path relative to the workspace.
	 * @returns The parsed file.
	 */
	function readFile(file: string): Promise<unknown> {
		return readJsonFile(join(workspaceRoot(), file));
	}

	beforeEach(async () => {
		await seedFactCorrected(subtopics);
	});

	it("should write one file for each subtopic, and slide-relocations.json with each entry in lecture order, when each reply is usable", async () => {
		const { filesWritten } = await run();

		expect(await readFile(slideRelocationFile(2))).toStrictEqual({
			subtopicId: 2,
			slideRelocationPromptVersion: SLIDE_RELOCATION_PROMPT_VERSION,
			paragraphs: ["Cell injury can be reversible. (Figure 1) Severe injury kills the cell."],
			slides: [
				{ slideNumber: 1, paragraphIndex: 0, characterOffset: 31, figureNumber: 1 },
				{ slideNumber: 2, paragraphIndex: 0, characterOffset: 42, figureNumber: 2 },
				{ slideNumber: 4, paragraphIndex: 0, characterOffset: 71, figureNumber: null },
			],
			figureMarksWithNoSlide: [],
		});
		expect(await readFile(slideRelocationsFile)).toStrictEqual({
			slideRelocations: [
				await readFile(slideRelocationFile(1)),
				await readFile(slideRelocationFile(2)),
			],
		});
		expect(filesWritten).toStrictEqual([
			slideRelocationFile(1),
			slideRelocationFile(2),
			slideRelocationsFile,
		]);
	});

	it("should send prompt r4, the fact-corrected paragraphs with numbered figure marks and the whole reading of each slide but the references slide, when a subtopic has slides", async () => {
		await run();

		expect(sentSystemMessage(create().mock.calls)).toContain(
			'Each slide has its "slideNumber" and what a model read from the slide',
		);
		expect(JSON.parse(String(sentUserMessage(create().mock.calls)))).toStrictEqual({
			paragraphs: ["Cell injury can be reversible. [FIGURE 1] Severe injury kills the cell."],
			slides: [slideDeckReadings[0], slideDeckReadings[1]],
		});
	});

	it("should make no call, and keep [FIGURE] as a mark with no slide, when a subtopic has no slides", async () => {
		await run();

		expect(create()).toHaveBeenCalledTimes(1);
		expect(await readFile(slideRelocationFile(1))).toStrictEqual({
			subtopicId: 1,
			slideRelocationPromptVersion: SLIDE_RELOCATION_PROMPT_VERSION,
			paragraphs: subtopics[0]?.paragraphs,
			slides: [],
			figureMarksWithNoSlide: [{ paragraphIndex: 0, characterOffset: 30 }],
		});
	});

	it("should make no call, and show the slides of the last subtopic at the end of the subtopic before it, when the last subtopic has no paragraph", async () => {
		const [firstSubtopic] = subtopics as [FactCorrectedParagraphs];
		const firstParagraph = firstSubtopic.paragraphs[0] as string;
		const atEnd = { paragraphIndex: 0, characterOffset: firstParagraph.length };
		await seedFactCorrected([firstSubtopic, { subtopicId: 2, paragraphs: [] }]);

		await run();

		expect(create()).not.toHaveBeenCalled();
		expect(await readFile(slideRelocationFile(1))).toMatchObject({
			slides: [
				{ slideNumber: 1, ...atEnd, figureNumber: 1 },
				{ slideNumber: 2, ...atEnd, figureNumber: 2 },
				{ slideNumber: 4, ...atEnd, figureNumber: null },
			],
		});
		expect(await readFile(slideRelocationFile(2))).toMatchObject({ paragraphs: [], slides: [] });
	});

	it("should fail with RelocateSlidesError that says so when no subtopic has a paragraph", async () => {
		await seedFactCorrected(subtopics.map(({ subtopicId }) => ({ subtopicId, paragraphs: [] })));

		const error = await captureError(run());

		expect(error).toBeInstanceOf(RelocateSlidesError);
		expect(error).toHaveProperty(
			"message",
			"No subtopic of the lecture has a paragraph, so the notes have no place for the slides",
		);
		expect(create()).not.toHaveBeenCalled();
	});

	itReadsSavedSubtopicFiles({
		run,
		sendToModel: create,
		savedFilePath: () => join(workspaceRoot(), slideRelocationFile(2)),
		stageError: RelocateSlidesError,
	});

	itFailsAfterTheThirdUnusableSend({
		run,
		create,
		calls: 1,
		outputPath: () => join(workspaceRoot(), slideRelocationFile(2)),
	});

	itFailsNamingEachSpoiledFile({
		files: [
			stageOutputInput({
				file: "fact-corrected subtopics file",
				stageId: "correct-factual-errors",
			}),
			stageOutputInput({ file: "slide placements file", stageId: "place-slides" }),
			slideReadingInput(1),
		],
		workspaceRoot,
		run,
		errorType: RelocateSlidesError,
		create,
	});
});
