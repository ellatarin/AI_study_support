import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isRecord } from "../../../utils/record.js";
import {
	captureError,
	eachUnusableJsonFile,
	openRouterReplyBody,
	readingFile,
	readJsonFile,
	resendPausesTimeoutMs,
	slideDeckReadings,
	spoilJsonFile,
	transcriptDivision,
	transcriptSubtopicTexts,
	unusableTranscripts,
	useStageReadingDivision,
} from "../../fixtures.js";
import { stageOutputPath } from "../../layout.js";
import { createPlaceSlidesStage, PlaceSlidesError } from "./place-slides.js";

const STAGE_ID = "place-slides";

/** A usable reply for {@link slideDeckReadings}: slide 1 in subtopic 1, and slide 2 in subtopic 2. */
const usablePlacements = {
	placements: [
		{ slideNumber: 1, subtopicId: 1 },
		{ slideNumber: 2, subtopicId: 2 },
	],
};

describe("createPlaceSlidesStage", () => {
	const { workspaceRoot, create, run, expectOneCallSending, expectResendsExhausted } =
		useStageReadingDivision({
			stageId: STAGE_ID,
			readsFrom: ["retitle-subtopics", "render-slides", "read-slides"],
			factory: createPlaceSlidesStage,
			reply: JSON.stringify(usablePlacements),
		});

	/** The placements that the stage wrote, parsed from disk. */
	async function writtenPlacements(): Promise<unknown> {
		const written = await readJsonFile(
			stageOutputPath({ workspaceRoot: workspaceRoot(), stageId: STAGE_ID }),
		);
		return isRecord(written) ? written.placements : written;
	}

	it("should send every subtopic's id, title and trimmed text, and each subject-matter slide's whole reading in deck order, when the stage calls the model", async () => {
		await expectOneCallSending({
			subtopics: transcriptDivision.map((subtopic, index) => ({
				subtopicId: index + 1,
				title: subtopic.title,
				text: transcriptSubtopicTexts[index],
			})),
			slides: [slideDeckReadings[0], slideDeckReadings[1]],
		});
	});

	it.each([
		{
			problem: "is not the documented shape",
			reply: { placements: [{ slideNumber: 1 }, { slideNumber: 2, subtopicId: 2 }] },
		},
		{
			problem: "gives a subject-matter slide no place",
			reply: { placements: [{ slideNumber: 1, subtopicId: 1 }] },
		},
		{
			problem: "gives a subject-matter slide more than one place",
			reply: { placements: [...usablePlacements.placements, { slideNumber: 2, subtopicId: 2 }] },
		},
		{
			problem: "names a slide that does not exist",
			reply: { placements: [...usablePlacements.placements, { slideNumber: 5, subtopicId: 2 }] },
		},
		{
			problem: "names a subtopic that does not exist",
			reply: {
				placements: [
					{ slideNumber: 1, subtopicId: 1 },
					{ slideNumber: 2, subtopicId: 3 },
				],
			},
		},
		{
			problem: "puts a slide in an earlier subtopic than the slide before it",
			reply: {
				placements: [
					{ slideNumber: 1, subtopicId: 2 },
					{ slideNumber: 2, subtopicId: 1 },
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
		const ignored = { slideNumber, subtopicId: 9 };
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

		expect(await writtenPlacements()).toContainEqual({ slideNumber: 4, subtopicId: 2 });
	});

	it("should write each subject-matter slide and each references slide with its subtopic id in deck order, and no content-free slide, when the stage completes", async () => {
		create().mockResolvedValue(
			openRouterReplyBody({
				content: JSON.stringify({ placements: [...usablePlacements.placements].reverse() }),
			}),
		);

		await run();

		expect(await writtenPlacements()).toStrictEqual([
			{ slideNumber: 1, subtopicId: 1 },
			{ slideNumber: 2, subtopicId: 2 },
			{ slideNumber: 4, subtopicId: 2 },
		]);
	});

	it.each(
		eachUnusableJsonFile([
			{
				file: "retitled subtopics file",
				path: () =>
					stageOutputPath({ workspaceRoot: workspaceRoot(), stageId: "retitle-subtopics" }),
			},
			{ file: "slide reading of a slide image", path: () => join(workspaceRoot(), readingFile(2)) },
		]),
	)("should fail naming the file, without calling the model, when the $file is $state", async ({
		path,
		contents,
	}) => {
		await spoilJsonFile({ path: path(), contents });

		const error = await captureError(run());

		expect(error).toBeInstanceOf(PlaceSlidesError);
		expect(error.message).toContain(path());
		expect(create()).not.toHaveBeenCalled();
	});

	it.each(
		unusableTranscripts,
	)("should fail, without calling the model, when the transcript is $state", async ({
		spoil,
		says,
	}) => {
		await spoil(workspaceRoot());

		const error = await captureError(run());

		expect(error).toBeInstanceOf(PlaceSlidesError);
		expect(error.message).toContain(says);
		expect(create()).not.toHaveBeenCalled();
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
