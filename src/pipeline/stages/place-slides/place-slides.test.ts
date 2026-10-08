import { describe, expect, it } from "vitest";
import { isRecord } from "../../../utils/record.js";
import {
	itFailsNamingEachSpoiledFile,
	openRouterReplyBody,
	readJsonFile,
	resendPausesTimeoutMs,
	slideDeckReadings,
	slideReadingInput,
	structuredTranscriptInput,
	stubbedPlacedBecause,
	transcriptSubtopicsWithIdAndText,
	transcriptSubtopicTexts,
	useStageReadingDivision,
} from "../../fixtures.js";
import { stageOutputPath } from "../../layout.js";
import { createPlaceSlidesStage, PlaceSlidesError } from "./place-slides.js";

const STAGE_ID = "place-slides";

/**
 * One reply entry with {@link stubbedPlacedBecause}. The default start words are the
 * whole text of the subtopic, so the slide goes at the start of the subtopic.
 */
function placement({
	slideNumber,
	subtopicId,
	startsWith = transcriptSubtopicTexts[subtopicId - 1] ?? "",
}: {
	readonly slideNumber: number;
	readonly subtopicId: number;
	readonly startsWith?: string;
}): Record<string, unknown> {
	return { slideNumber, subtopicId, startsWith, placedBecause: stubbedPlacedBecause };
}

/** A usable reply for {@link slideDeckReadings}: slide 1 in subtopic 1, and slide 2 in subtopic 2. */
const usablePlacements = {
	placements: [
		placement({ slideNumber: 1, subtopicId: 1 }),
		placement({ slideNumber: 2, subtopicId: 2 }),
	],
};

describe("createPlaceSlidesStage", () => {
	const { workspaceRoot, create, run, expectOneCallSending, expectResendsExhausted } =
		useStageReadingDivision({
			stageId: STAGE_ID,
			readsFrom: ["structure-transcript", "render-slides", "read-slides"],
			factory: createPlaceSlidesStage,
			reply: JSON.stringify(usablePlacements),
		});

	/** The placements file that the stage wrote, parsed from disk. */
	function writtenFile(): Promise<unknown> {
		return readJsonFile(stageOutputPath({ workspaceRoot: workspaceRoot(), stageId: STAGE_ID }));
	}

	/** The placements that the stage wrote, parsed from disk. */
	async function writtenPlacements(): Promise<unknown> {
		const written = await writtenFile();
		return isRecord(written) ? written.placements : written;
	}

	it("should send every subtopic's id, title and trimmed text, and each subject-matter slide's whole reading in deck order, when the stage calls the model", async () => {
		await expectOneCallSending({
			subtopics: transcriptSubtopicsWithIdAndText,
			slides: [slideDeckReadings[0], slideDeckReadings[1]],
		});
	});

	it.each([
		{
			problem: "is not the documented shape",
			reply: {
				placements: [
					{ slideNumber: 1, placedBecause: stubbedPlacedBecause },
					placement({ slideNumber: 2, subtopicId: 2 }),
				],
			},
		},
		{
			problem: "gives a blank reason",
			reply: {
				placements: [
					placement({ slideNumber: 1, subtopicId: 1 }),
					{ ...placement({ slideNumber: 2, subtopicId: 2 }), placedBecause: " " },
				],
			},
		},
		{
			problem: "gives a subject-matter slide no place",
			reply: { placements: [placement({ slideNumber: 1, subtopicId: 1 })] },
		},
		{
			problem: "gives a subject-matter slide more than one place",
			reply: {
				placements: [...usablePlacements.placements, placement({ slideNumber: 2, subtopicId: 2 })],
			},
		},
		{
			problem: "names a slide that does not exist",
			reply: {
				placements: [...usablePlacements.placements, placement({ slideNumber: 5, subtopicId: 2 })],
			},
		},
		{
			problem: "names a subtopic that does not exist",
			reply: {
				placements: [
					placement({ slideNumber: 1, subtopicId: 1 }),
					placement({ slideNumber: 2, subtopicId: 3 }),
				],
			},
		},
		{
			problem: "gives start words that are not in the slide's subtopic",
			reply: {
				placements: [
					placement({ slideNumber: 1, subtopicId: 1, startsWith: "the immune system" }),
					placement({ slideNumber: 2, subtopicId: 2 }),
				],
			},
		},
		{
			problem: "puts a slide before the slide before it in the same subtopic",
			reply: {
				placements: [
					placement({ slideNumber: 1, subtopicId: 2, startsWith: "the immune system" }),
					placement({ slideNumber: 2, subtopicId: 2 }),
				],
			},
		},
		{
			problem: "puts a slide in an earlier subtopic than the slide before it",
			reply: {
				placements: [
					placement({ slideNumber: 1, subtopicId: 2 }),
					placement({ slideNumber: 2, subtopicId: 1 }),
				],
			},
		},
	])("should resend the call when the reply $problem", async ({ reply }) => {
		create().mockResolvedValueOnce(openRouterReplyBody({ content: JSON.stringify(reply) }));

		await run();

		expect(create()).toHaveBeenCalledTimes(2);
	});

	it.each([
		{ kind: "content-free", slideNumber: 3 },
		{ kind: "references", slideNumber: 4 },
	])("should ignore an entry for a $kind slide when the reply is otherwise usable", async ({
		slideNumber,
	}) => {
		const ignored = placement({ slideNumber, subtopicId: 9 });
		create().mockResolvedValue(
			openRouterReplyBody({
				content: JSON.stringify({ placements: [ignored, ...usablePlacements.placements, ignored] }),
			}),
		);

		await run();

		expect(create()).toHaveBeenCalledTimes(1);
	});

	it("should put each references slide with the last subtopic when the stage completes", async () => {
		await run();

		expect(await writtenPlacements()).toContainEqual(
			expect.objectContaining({ slideNumber: 4, subtopicId: 2 }),
		);
	});

	it("should write each subject-matter slide and each references slide with its subtopic id, start words, position in its subtopic and reason in deck order, and no content-free slide, when the stage completes", async () => {
		const midSubtopicWords = "the immune system";
		create().mockResolvedValue(
			openRouterReplyBody({
				content: JSON.stringify({
					placements: [
						placement({ slideNumber: 2, subtopicId: 2, startsWith: midSubtopicWords }),
						placement({ slideNumber: 1, subtopicId: 1 }),
					],
				}),
			}),
		);

		await run();

		expect(await writtenPlacements()).toStrictEqual([
			{
				slideNumber: 1,
				subtopicId: 1,
				startWords: transcriptSubtopicTexts[0],
				positionInSubtopic: 0,
				placedBecause: stubbedPlacedBecause,
			},
			{
				slideNumber: 2,
				subtopicId: 2,
				startWords: midSubtopicWords,
				positionInSubtopic: transcriptSubtopicTexts[1].indexOf(midSubtopicWords),
				placedBecause: stubbedPlacedBecause,
			},
			{
				slideNumber: 4,
				subtopicId: 2,
				startWords: null,
				positionInSubtopic: transcriptSubtopicTexts[1].length,
				placedBecause: "A references slide goes at the end of the last subtopic.",
			},
		]);
	});

	it("should record the prompt version beside the placements when the stage completes", async () => {
		await run();

		expect(await writtenFile()).toMatchObject({ promptVersion: "p2" });
	});

	itFailsNamingEachSpoiledFile({
		files: [structuredTranscriptInput, slideReadingInput(2)],
		workspaceRoot,
		run,
		errorType: PlaceSlidesError,
		create,
	});

	it("should fail without writing the placements when the third send is still unusable", {
		timeout: resendPausesTimeoutMs,
	}, async () => {
		create().mockResolvedValue(
			openRouterReplyBody({ content: JSON.stringify({ placements: [] }) }),
		);

		await expectResendsExhausted({ calls: 1 });
	});
});
