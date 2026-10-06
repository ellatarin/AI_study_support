/* jscpd:ignore-start -- the suites of sibling stages import the same fixtures
   and mock the same module. So their preambles are the same line for line.
   Imports cannot be shared, and CLAUDE.md (File Organisation) forbids barrel
   files. vi.mock is hoisted, so it must be in the file that mocks. Only the
   preamble is exempt. jscpd checks the suite below. */
import { rm, writeFile } from "node:fs/promises";
import { relative } from "node:path";
import type { Mock } from "vitest";
import { describe, expect, it, vi } from "vitest";
import { pathExists } from "../../../utils/files.js";
import {
	captureError,
	firstSavedRun,
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
import { GroupIntoTopicsError } from "./choose-grouping.js";
import { createGroupIntoTopicsStage } from "./group-into-topics.js";

// Only the model call is a stub. The other exports of the module stay real.
vi.mock(import("../../openrouter.js"), async (importOriginal) => ({
	...(await importOriginal()),
	callModel: vi.fn(),
}));

const modelCallMock = callModel as unknown as Mock;
/* jscpd:ignore-end */

const STAGE_ID = "group-into-topics";

/** A grouping reply that holds `topics`, each in the shape that the prompt asks for. */
function replyOf(...topics: readonly Readonly<Record<string, unknown>>[]): string {
	return JSON.stringify({ topics });
}

/** The first topic of {@link GOOD_REPLY}. It starts at subtopic 1. */
const OPENING_TOPIC = {
	label: "The lecture's opening",
	groupedBecause: "It frames the lecture.",
	firstSubtopicId: 1,
};

/** The second topic of {@link GOOD_REPLY}. It starts at the last subtopic. */
const SUBJECT_TOPIC = {
	label: "Cell injury",
	groupedBecause: "It is the lecture's subject.",
	firstSubtopicId: 2,
};

/** A grouping reply that puts each subtopic of {@link transcriptDivision} in a topic of its own. */
const GOOD_REPLY = replyOf(OPENING_TOPIC, SUBJECT_TOPIC);

/** The topics of {@link GOOD_REPLY} as the stage saves and writes them. Each `label` becomes a `title`. */
const GOOD_TOPICS = [OPENING_TOPIC, SUBJECT_TOPIC].map(
	({ label, groupedBecause, firstSubtopicId }) => ({
		title: label,
		groupedBecause,
		firstSubtopicId,
	}),
);

describe("createGroupIntoTopicsStage", () => {
	const { config, workspaceRoot, run } = useStageReadingDivision({
		stageId: STAGE_ID,
		readsFrom: "retitle-subtopics",
		factory: createGroupIntoTopicsStage,
		stubReply: () =>
			modelCallMock.mockResolvedValue({ content: GOOD_REPLY, cost: stubbedCallCost }),
	});

	/** The path of the saved grouping run with the number `runNumber`, counting from 1. */
	const runPath = (runNumber: number): string =>
		savedRunPath({ workspaceRoot: workspaceRoot(), stageId: STAGE_ID, runNumber });

	it("should send every retitled subtopic as its subtopic id, title as label, and text with the blank space at each end removed when each grouping run is made", async () => {
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
		).toStrictEqual(GOOD_TOPICS);
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

		expect(error).toBeInstanceOf(GroupIntoTopicsError);
		expect(error.message).toContain(retitled);
		expect(modelCallMock).not.toHaveBeenCalled();
	});

	it("should fail without writing the topics when a run's third send is still unusable", {
		// Two real pauses, of two seconds and then four seconds, come before the third send.
		timeout: 10_000,
	}, async () => {
		modelCallMock.mockResolvedValue({ content: replyOf(), cost: stubbedCallCost });

		const error = await captureError(run());

		expect(error).toBeInstanceOf(ResendsExhaustedError);
		expect(
			await pathExists(stageOutputPath({ workspaceRoot: workspaceRoot(), stageId: STAGE_ID })),
		).toBe(false);
	});

	it("should save each grouping run with each topic's title, groupedBecause and first subtopic when the run completes", async () => {
		await run();

		expect(await readJsonFile(runPath(1))).toStrictEqual({ topics: GOOD_TOPICS });
	});

	const { leaveFirstRun, expectUnreadableFirstRun } = firstSavedRun({
		workspaceRoot,
		stageId: STAGE_ID,
		run,
	});

	it("should make only the missing runs when an earlier invocation saved some", async () => {
		await leaveFirstRun({ topics: GOOD_TOPICS });

		await run();

		expect(modelCallMock).toHaveBeenCalledTimes(config.grouping.panelSize - 1);
	});

	it.each([
		{ problem: "no list of topics", contents: { topics: "one" } },
		{
			problem: "a topic named by a label, as saved before titles",
			contents: JSON.parse(GOOD_REPLY),
		},
	])("should fail when a saved run holds $problem", ({ contents }) =>
		expectUnreadableFirstRun(contents));
});
