import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
	captureError,
	itFailsAfterTheThirdUnusableStageModelSend,
	itReadsSavedSubtopicFiles,
	readJsonFile,
	slideDeckPlacements,
	slideDeckReadings,
	slideRelocationFile,
	useUnlistedStageRun,
} from "../../fixtures.js";
import { slideRelocationsPath } from "../slide-relocations.js";
import { isSlideReading } from "../slides.js";
import { RelocateSlidesError, relocateSlides } from "./relocate-slides.js";
import { SLIDE_RELOCATION_PROMPT_VERSION } from "./relocate-slides.prompt.js";

/**
 * The fact-corrected paragraphs of each subtopic. `slideDeckPlacements` places
 * slides 1, 2 and the references slide 4 in subtopic 2.
 */
const subtopics = [
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

describe("relocateSlides", () => {
	const { workspaceRoot, sendToModel, readFile, stageRun } = useUnlistedStageRun({
		prefix: "relocate-slides-",
		reply: usableReply,
	});

	/**
	 * Relocates the slides of the test lecture.
	 *
	 * @param lectureSubtopics - The fact-corrected subtopics of the lecture.
	 * @returns The result of the slide relocation.
	 */
	function run(
		lectureSubtopics: readonly (typeof subtopics)[number][] = subtopics,
	): ReturnType<typeof relocateSlides> {
		return relocateSlides({
			subtopics: lectureSubtopics,
			placements: slideDeckPlacements.placements,
			readings: slideDeckReadings.filter(isSlideReading),
			...stageRun(),
		});
	}

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
		expect(await readJsonFile(slideRelocationsPath(workspaceRoot()))).toStrictEqual({
			slideRelocations: [
				await readFile(slideRelocationFile(1)),
				await readFile(slideRelocationFile(2)),
			],
		});
		expect(filesWritten).toStrictEqual([
			slideRelocationFile(1),
			slideRelocationFile(2),
			relative(workspaceRoot(), slideRelocationsPath(workspaceRoot())),
		]);
	});

	it("should send prompt r4, the paragraphs with numbered figure marks and the whole reading of each slide but the references slide, when a subtopic has slides", async () => {
		await run();

		const [system, user] = sendToModel().mock.calls[0]?.[0].messages ?? [];
		expect(system?.content).toContain(
			'Each slide has its "slideNumber" and what a model read from the slide',
		);
		expect(JSON.parse(String(user?.content))).toStrictEqual({
			paragraphs: ["Cell injury can be reversible. [FIGURE 1] Severe injury kills the cell."],
			slides: [slideDeckReadings[0], slideDeckReadings[1]],
		});
	});

	it("should make no call, and keep [FIGURE] as a mark with no slide, when a subtopic has no slides", async () => {
		await run();

		expect(sendToModel()).toHaveBeenCalledTimes(1);
		expect(await readFile(slideRelocationFile(1))).toStrictEqual({
			subtopicId: 1,
			slideRelocationPromptVersion: SLIDE_RELOCATION_PROMPT_VERSION,
			paragraphs: subtopics[0]?.paragraphs,
			slides: [],
			figureMarksWithNoSlide: [{ paragraphIndex: 0, characterOffset: 30 }],
		});
	});

	it("should make no call, and show the slides of the last subtopic at the end of the subtopic before it, when the last subtopic has no paragraph", async () => {
		const [firstSubtopic] = subtopics as [(typeof subtopics)[number]];
		const firstParagraph = firstSubtopic.paragraphs[0] as string;
		const atEnd = { paragraphIndex: 0, characterOffset: firstParagraph.length };

		await run([firstSubtopic, { subtopicId: 2, paragraphs: [] }]);

		expect(sendToModel()).not.toHaveBeenCalled();
		expect(await readFile(slideRelocationFile(1))).toMatchObject({
			slides: [
				{ slideNumber: 1, ...atEnd, figureNumber: 1 },
				{ slideNumber: 2, ...atEnd, figureNumber: 2 },
				{ slideNumber: 4, ...atEnd, figureNumber: null },
			],
		});
		expect(await readFile(slideRelocationFile(2))).toMatchObject({
			paragraphs: [],
			slides: [],
		});
	});

	it("should fail with RelocateSlidesError that says so when no subtopic has a paragraph", async () => {
		const error = await captureError(
			run(subtopics.map(({ subtopicId }) => ({ subtopicId, paragraphs: [] }))),
		);

		expect(error).toBeInstanceOf(RelocateSlidesError);
		expect(error).toHaveProperty(
			"message",
			"No subtopic of the lecture has a paragraph, so the notes have no place for the slides",
		);
		expect(sendToModel()).not.toHaveBeenCalled();
	});

	itReadsSavedSubtopicFiles({
		run: () => run(),
		sendToModel,
		savedFilePath: () => join(workspaceRoot(), slideRelocationFile(2)),
		stageError: RelocateSlidesError,
	});

	itFailsAfterTheThirdUnusableStageModelSend({
		run: () => run(),
		sendToModel,
		unusableContent: JSON.stringify({ ...usableReply, slides: usableReply.slides.slice(1) }),
		calls: 1,
	});
});
