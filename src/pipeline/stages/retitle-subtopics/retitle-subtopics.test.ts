/* jscpd:ignore-start -- the suites of sibling stages import the same fixtures
   and mock the same module. So their preambles are the same line for line.
   Imports cannot be shared, and CLAUDE.md (File Organisation) forbids barrel
   files. vi.mock is hoisted, so it must be in the file that mocks. Only the
   preamble is exempt. jscpd checks the suite below. */
import { rm, writeFile } from "node:fs/promises";
import type { Mock } from "vitest";
import { describe, expect, it, vi } from "vitest";
import { pathExists } from "../../../utils/files.js";
import {
	captureError,
	readJsonFile,
	sentUserMessage,
	stubbedCallCost,
	transcriptDivision,
	useStageReadingDivision,
} from "../../fixtures.js";
import { stageOutputPath, stageRecordPath } from "../../layout.js";
import { callModel } from "../../openrouter.js";
import { ResendsExhaustedError } from "../model-stage.js";
import { createRetitleSubtopicsStage, RetitleSubtopicsError } from "./retitle-subtopics.js";

// Only the model call is a stub. The other exports of the module stay real.
vi.mock(import("../../openrouter.js"), async (importOriginal) => ({
	...(await importOriginal()),
	callModel: vi.fn(),
}));

const modelCallMock = callModel as unknown as Mock;
/* jscpd:ignore-end */

const STAGE_ID = "retitle-subtopics";

/** The titles that the stub model gives the subtopics of {@link transcriptDivision}, in order. */
const NEW_TITLES = ["Introduction to the lecture", "Cell injury and immunity"];

/** A reply that gives each subtopic the title at the same place in `titles`, by subtopic id. */
function titlesReply(titles: readonly string[]): string {
	return JSON.stringify({ titles: titles.map((title, index) => ({ id: index + 1, title })) });
}

/** A reply that gives each subtopic its new title. */
const GOOD_REPLY = titlesReply(NEW_TITLES);

/** {@link transcriptDivision} as the stage must write it after {@link GOOD_REPLY}. */
const RETITLED_DIVISION = [
	{ ...transcriptDivision[0], title: NEW_TITLES[0] },
	{ ...transcriptDivision[1], title: NEW_TITLES[1] },
];

describe("createRetitleSubtopicsStage", () => {
	const { workspaceRoot, run } = useStageReadingDivision({
		stageId: STAGE_ID,
		readsFrom: "choose-division",
		factory: createRetitleSubtopicsStage,
		stubReply: () =>
			modelCallMock.mockResolvedValue({ content: GOOD_REPLY, cost: stubbedCallCost }),
	});

	/** The retitled division that the stage wrote, parsed from disk. */
	function writtenDivision(): Promise<unknown> {
		return readJsonFile(stageOutputPath({ workspaceRoot: workspaceRoot(), stageId: STAGE_ID }));
	}

	it("should send every subtopic as its subtopic id and trimmed text, without its title, in one call when the stage runs", async () => {
		await run();

		expect(modelCallMock).toHaveBeenCalledTimes(1);
		expect(sentUserMessage(modelCallMock.mock.calls)).toBe(
			JSON.stringify({
				subtopics: [
					{ id: 1, text: "Today we are covering" },
					{ id: 2, text: "cell injury and the immune system." },
				],
			}),
		);
	});

	it("should write the chosen division with every title replaced and spans and reasons unchanged when the stage completes", async () => {
		await run();

		expect(await writtenDivision()).toStrictEqual(RETITLED_DIVISION);
	});

	it.each([
		{ problem: "is empty", content: "" },
		{ problem: "is not JSON", content: "Here are the titles." },
		{ problem: "is not an object", content: JSON.stringify("titles") },
		{ problem: "misses a subtopic", content: titlesReply(NEW_TITLES.slice(0, 1)) },
		{
			problem: "repeats a subtopic id",
			content: JSON.stringify({
				titles: [
					{ id: 1, title: "First" },
					{ id: 1, title: "Again" },
				],
			}),
		},
		{
			problem: "names a subtopic id out of range",
			content: JSON.stringify({
				titles: [
					{ id: 1, title: "First" },
					{ id: 3, title: "Third" },
				],
			}),
		},
		{
			problem: "gives the subtopic ids out of order",
			content: JSON.stringify({
				titles: [
					{ id: 2, title: "Second" },
					{ id: 1, title: "First" },
				],
			}),
		},
		{ problem: "gives a blank title", content: titlesReply(["First", "  "]) },
		{
			problem: "titles a subtopic past the last",
			content: titlesReply([...NEW_TITLES, "Third"]),
		},
	])("should resend the call and use the next reply when the reply $problem", async ({
		content,
	}) => {
		modelCallMock.mockResolvedValueOnce({ content, cost: stubbedCallCost });

		await run();

		expect(modelCallMock).toHaveBeenCalledTimes(2);
		expect(await writtenDivision()).toStrictEqual(RETITLED_DIVISION);
	});

	it("should fail without writing the division when the third send's reply is still unusable", {
		// Two real pauses, of two seconds and then four seconds, come before the third send.
		timeout: 10_000,
	}, async () => {
		modelCallMock.mockResolvedValue({ content: "", cost: stubbedCallCost });

		const error = await captureError(run());

		expect(error).toBeInstanceOf(ResendsExhaustedError);
		expect(modelCallMock).toHaveBeenCalledTimes(3);
		expect(
			await pathExists(stageOutputPath({ workspaceRoot: workspaceRoot(), stageId: STAGE_ID })),
		).toBe(false);
	});

	it.each([
		{ problem: "is missing", contents: null },
		{ problem: "is not JSON", contents: "Opening, then cell injury." },
		{ problem: "is not a list of subtopics", contents: JSON.stringify({ subtopics: [] }) },
	])("should fail without calling the model when the chosen division $problem", async ({
		contents,
	}) => {
		const chosen = stageOutputPath({ workspaceRoot: workspaceRoot(), stageId: "choose-division" });
		await (contents === null ? rm(chosen) : writeFile(chosen, contents));

		const error = await captureError(run());

		expect(error).toBeInstanceOf(RetitleSubtopicsError);
		expect(error.message).toContain(chosen);
		expect(modelCallMock).not.toHaveBeenCalled();
	});

	it("should leave the chosen division's subtopics as they were when the stage completes", async () => {
		await run();

		expect(
			await readJsonFile(
				stageOutputPath({ workspaceRoot: workspaceRoot(), stageId: "choose-division" }),
			),
		).toStrictEqual(transcriptDivision);
	});

	it("should record beside the division each title that changed, and not one returned unchanged, when the stage completes", async () => {
		const [opening, second] = transcriptDivision;
		modelCallMock.mockResolvedValue({
			content: titlesReply([opening?.title ?? "", NEW_TITLES[1] ?? ""]),
			cost: stubbedCallCost,
		});

		const result = await run();

		expect(
			await readJsonFile(stageRecordPath({ workspaceRoot: workspaceRoot(), stageId: STAGE_ID })),
		).toStrictEqual({
			subtopics: 2,
			titlesChanged: 1,
			changed: [{ subtopicId: 2, oldTitle: second?.title, newTitle: NEW_TITLES[1] }],
		});
		expect(result.filesWritten).toStrictEqual([
			"Retitled subtopics/subtopics.json",
			"Retitled subtopics/changes.json",
		]);
	});
});
