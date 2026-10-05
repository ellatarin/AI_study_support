/* jscpd:ignore-start -- sibling stage suites import the same fixtures and mock the
   same module, so their preambles match line for line. Neither half can move:
   imports cannot be shared and barrel files are forbidden (CLAUDE.md, File
   Organisation), and vi.mock is hoisted, so it must sit in the file that mocks.
   Only the preamble is exempt; the suite below is checked as normal. */
import { rm, writeFile } from "node:fs/promises";
import { relative } from "node:path";
import type { Mock } from "vitest";
import { describe, expect, it, vi } from "vitest";
import { pathExists } from "../../../utils/files.js";
import {
	captureError,
	readJsonFile,
	savedRunPath,
	sentUserMessage,
	stubbedCallCost,
	useStageReadingDivision,
} from "../../fixtures.js";
import {
	stageOutputEntry,
	stageOutputPath,
	stageRecordEntry,
	stageRecordPath,
} from "../../layout.js";
import { callModel } from "../../openrouter.js";
import { ResendsExhaustedError } from "../panel-runs.js";
import { DefineTopicsError } from "./choose-grouping.js";
import { createDefineTopicsStage } from "./define-topics.js";

// Only the call is stubbed; everything else the module exports stays real.
vi.mock(import("../../openrouter.js"), async (importOriginal) => ({
	...(await importOriginal()),
	callModel: vi.fn(),
}));

const modelCallMock = callModel as unknown as Mock;
/* jscpd:ignore-end */

const STAGE_ID = "define-topics";

/** A grouping reply holding `topics`, each as the prompt asks for it. */
function replyOf(...topics: readonly Readonly<Record<string, unknown>>[]): string {
	return JSON.stringify({ topics });
}

/** The first topic of {@link GOOD_REPLY}, starting at subtopic 1. */
const OPENING_TOPIC = {
	label: "The lecture's opening",
	groupedBecause: "It frames the lecture.",
	firstSubtopicId: 1,
};

/** The second topic of {@link GOOD_REPLY}, starting at the last subtopic. */
const SUBJECT_TOPIC = {
	label: "Cell injury",
	groupedBecause: "It is the lecture's subject.",
	firstSubtopicId: 2,
};

/** A grouping reply putting each subtopic of {@link transcriptDivision} in a topic of its own. */
const GOOD_REPLY = replyOf(OPENING_TOPIC, SUBJECT_TOPIC);

describe("createDefineTopicsStage", () => {
	const { config, workspaceRoot, run } = useStageReadingDivision({
		stageId: STAGE_ID,
		readsFrom: "retitle-subtopics",
		factory: createDefineTopicsStage,
		stubReply: () =>
			modelCallMock.mockResolvedValue({ content: GOOD_REPLY, cost: stubbedCallCost }),
	});

	/** Where a grouping run is saved, counting from 1. */
	const runPath = (runNumber: number): string =>
		savedRunPath({ workspaceRoot: workspaceRoot(), stageId: STAGE_ID, runNumber });

	it("should send every retitled subtopic as its position, title as label, and text with the blank space at each end removed when each grouping run is made", async () => {
		await run();

		const sent = modelCallMock.mock.calls.map((call) => sentUserMessage([call]));
		expect(sent).toStrictEqual(
			Array(config.grouping.panelSize).fill(
				JSON.stringify({
					subtopics: [
						{ id: 1, label: "Opening", text: "Today we are covering" },
						{ id: 2, label: "Cell injury", text: "cell injury and the immune system." },
					],
				}),
			),
		);
	});

	it.each([
		{ problem: "holds no topics", content: replyOf() },
		{ problem: "gives a topic a blank title", content: replyOf({ ...OPENING_TOPIC, label: " " }) },
		{
			problem: "gives a topic a blank groupedBecause",
			content: replyOf({ ...OPENING_TOPIC, groupedBecause: "" }),
		},
		{
			problem: "gives a topic no first subtopic",
			content: replyOf({
				label: OPENING_TOPIC.label,
				groupedBecause: OPENING_TOPIC.groupedBecause,
			}),
		},
		{
			problem: "does not start its first topic at subtopic 1",
			content: replyOf({ ...OPENING_TOPIC, firstSubtopicId: 2 }),
		},
		{
			problem: "starts a topic no later than the one before",
			content: replyOf(OPENING_TOPIC, { ...SUBJECT_TOPIC, firstSubtopicId: 1 }),
		},
		{
			problem: "starts a topic past the last subtopic",
			content: replyOf(OPENING_TOPIC, { ...SUBJECT_TOPIC, firstSubtopicId: 3 }),
		},
	])("should resend a grouping run's call when its reply $problem", async ({ content }) => {
		modelCallMock.mockResolvedValueOnce({ content, cost: stubbedCallCost });

		await run();

		expect(modelCallMock).toHaveBeenCalledTimes(config.grouping.panelSize + 1);
	});

	it("should write each topic's title, groupedBecause and first subtopic from the chosen run when the stage completes", async () => {
		await run();

		expect(
			await readJsonFile(stageOutputPath({ workspaceRoot: workspaceRoot(), stageId: STAGE_ID })),
		).toStrictEqual(
			[OPENING_TOPIC, SUBJECT_TOPIC].map(({ label, groupedBecause, firstSubtopicId }) => ({
				title: label,
				groupedBecause,
				firstSubtopicId,
			})),
		);
	});

	it("should record beside the topics the chosen run, its support and the deciding rule when the stage completes", async () => {
		const { panelSize } = config.grouping;

		const result = await run();

		expect(
			await readJsonFile(stageRecordPath({ workspaceRoot: workspaceRoot(), stageId: STAGE_ID })),
		).toStrictEqual({ chosenRun: 1, support: panelSize, panelSize, decidedBy: "most-runs" });
		expect(result.filesWritten).toStrictEqual([
			...Array.from({ length: panelSize }, (_unused, index) =>
				relative(workspaceRoot(), runPath(index + 1)),
			),
			stageOutputEntry(STAGE_ID),
			stageRecordEntry(STAGE_ID),
		]);
	});

	it.each([
		{ problem: "are missing", contents: null },
		{ problem: "are not JSON", contents: "Opening, then cell injury." },
		{ problem: "are not a list of subtopics", contents: JSON.stringify({ topics: [] }) },
	])("should fail naming the file, without calling the model, when the retitled subtopics $problem", async ({
		contents,
	}) => {
		const retitled = stageOutputPath({
			workspaceRoot: workspaceRoot(),
			stageId: "retitle-subtopics",
		});
		await (contents === null ? rm(retitled) : writeFile(retitled, contents));

		const error = await captureError(run());

		expect(error).toBeInstanceOf(DefineTopicsError);
		expect(error.message).toContain(retitled);
		expect(modelCallMock).not.toHaveBeenCalled();
	});

	it("should fail without writing the topics when a run's third send is still unusable", {
		// Two real pauses, of two seconds and then four, come before the third send fails.
		timeout: 10_000,
	}, async () => {
		modelCallMock.mockResolvedValue({ content: replyOf(), cost: stubbedCallCost });

		const error = await captureError(run());

		expect(error).toBeInstanceOf(ResendsExhaustedError);
		expect(
			await pathExists(stageOutputPath({ workspaceRoot: workspaceRoot(), stageId: STAGE_ID })),
		).toBe(false);
	});

	it("should save each grouping run as the model replied when the run completes", async () => {
		await run();

		expect(await readJsonFile(runPath(1))).toStrictEqual(JSON.parse(GOOD_REPLY));
	});
});
