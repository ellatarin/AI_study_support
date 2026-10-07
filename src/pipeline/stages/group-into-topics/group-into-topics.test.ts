import { rm, writeFile } from "node:fs/promises";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
	captureError,
	firstSavedRun,
	openingTopic,
	openRouterReplyBody,
	readJsonFile,
	resendPausesTimeoutMs,
	savedRunPath,
	sentUserMessage,
	subjectTopic,
	transcriptTopics,
	useStageReadingDivision,
} from "../../fixtures.js";
import {
	stageOutputEntry,
	stageOutputPath,
	stageRecordEntry,
	stageRecordPath,
} from "../../layout.js";
import type { Topic } from "../topics.js";
import { GroupIntoTopicsError } from "./choose-grouping.js";
import { createGroupIntoTopicsStage } from "./group-into-topics.js";

const STAGE_ID = "group-into-topics";

/** A grouping reply that holds `topics`, each in the shape that the prompt asks for. */
function replyOf(...topics: readonly Readonly<Record<string, unknown>>[]): string {
	return JSON.stringify({ topics });
}

/** A topic as the grouping prompt asks for it. The prompt calls the title a `label`. */
function asReplyTopic({ title, groupedBecause, firstSubtopicId }: Topic): {
	readonly label: string;
	readonly groupedBecause: string;
	readonly firstSubtopicId: number;
} {
	return { label: title, groupedBecause, firstSubtopicId };
}

const OPENING_TOPIC = asReplyTopic(openingTopic);

const SUBJECT_TOPIC = asReplyTopic(subjectTopic);

/** A grouping reply that gives {@link transcriptTopics}. */
const GOOD_REPLY = replyOf(OPENING_TOPIC, SUBJECT_TOPIC);

describe("createGroupIntoTopicsStage", () => {
	const { config, workspaceRoot, create, run, expectResendsExhausted } = useStageReadingDivision({
		stageId: STAGE_ID,
		readsFrom: ["retitle-subtopics"],
		factory: createGroupIntoTopicsStage,
		reply: GOOD_REPLY,
		// The gap between sends is tested with a fake clock in the integration suite.
		tuning: { sendGapSeconds: undefined },
	});

	/** The path of the saved grouping run with the number `runNumber`, counting from 1. */
	const runPath = (runNumber: number): string =>
		savedRunPath({ workspaceRoot: workspaceRoot(), stageId: STAGE_ID, runNumber });

	it("should send every retitled subtopic as its subtopic id, title as label, and text with the blank space at each end removed when each grouping run is made", async () => {
		await run();

		const sent = create().mock.calls.map((call) => sentUserMessage([call]));
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
		create().mockResolvedValueOnce(openRouterReplyBody({ content }));

		await run();

		expect(create()).toHaveBeenCalledTimes(config.grouping.panelSize + 1);
	});

	it("should write each topic's title, groupedBecause and first subtopic from the chosen run when the stage completes", async () => {
		await run();

		expect(
			await readJsonFile(stageOutputPath({ workspaceRoot: workspaceRoot(), stageId: STAGE_ID })),
		).toStrictEqual(transcriptTopics);
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
		expect(create()).not.toHaveBeenCalled();
	});

	it("should fail without writing the topics when a run's third send is still unusable", {
		timeout: resendPausesTimeoutMs,
	}, async () => {
		create().mockResolvedValue(openRouterReplyBody({ content: replyOf() }));

		// Every run that is in flight is sent three times before the stage fails.
		await expectResendsExhausted({
			calls: Math.min(config.grouping.panelSize, config.stages[STAGE_ID]?.concurrency ?? 1),
		});
	});

	it("should save each grouping run with each topic's title, groupedBecause and first subtopic when the run completes", async () => {
		await run();

		expect(await readJsonFile(runPath(1))).toStrictEqual({ topics: transcriptTopics });
	});

	const { leaveFirstRun, expectUnreadableFirstRun } = firstSavedRun({
		workspaceRoot,
		stageId: STAGE_ID,
		run,
	});

	it("should make only the missing runs when an earlier invocation saved some", async () => {
		await leaveFirstRun({ topics: transcriptTopics });

		await run();

		expect(create()).toHaveBeenCalledTimes(config.grouping.panelSize - 1);
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
