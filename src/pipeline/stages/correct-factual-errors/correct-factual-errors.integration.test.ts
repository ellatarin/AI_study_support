import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	factCheckModelIds,
	factCorrectedSubtopicsFile,
	factCorrectionFile,
	factCorrectionReadsFrom,
	itFailsAfterTheThirdUnusableSend,
	itFailsNamingEachSpoiledFile,
	itReadsSavedSubtopicFiles,
	openRouterModelId,
	openRouterReplyBody,
	resendPausesTimeoutMs,
	rewriteInput,
	rewrittenParagraphs,
	seededFactualError,
	stageOutputInput,
	structuredTranscriptInput,
	useStageReadingEarlierOutputs,
	workspaceJsonReader,
} from "../../fixtures.js";
import {
	CorrectFactualErrorsError,
	createCorrectFactualErrorsStage,
} from "./correct-factual-errors.js";
import { FACT_CORRECTION_PROMPT_VERSION } from "./correct-factual-errors.prompt.js";

const STAGE_ID = "correct-factual-errors";

/** The seeded subtopic with {@link seededFactualError}, and the seeded subtopic with none. */
const corrected = { subtopicId: seededFactualError.subtopicId, rewrite: rewrittenParagraphs[1] };
const unchanged = { subtopicId: 1, rewrite: rewrittenParagraphs[0] };

/** One change of a reply, in the words of prompt k3. */
const replyChange = {
	error: 1,
	before: seededFactualError.passage,
	after: seededFactualError.correctStatement,
	note: "",
};

/** The usable reply for the subtopic with {@link seededFactualError}, in the shape that prompt k3 asks for. */
const usableReply = { paragraphs: [seededFactualError.correctStatement], changes: [replyChange] };

/**
 * Gives the content of a reply as the stubbed client returns it.
 *
 * @param reply - The reply, before it is written as JSON.
 * @returns The reply body.
 */
function replyBody(reply: unknown): ReturnType<typeof openRouterReplyBody> {
	return openRouterReplyBody({ content: JSON.stringify(reply) });
}

/** The stage, its earlier stages and its stubbed reply, for each suite of this file. */
const stageUnderTest = {
	stageId: STAGE_ID,
	readsFrom: factCorrectionReadsFrom,
	factory: createCorrectFactualErrorsStage,
	reply: JSON.stringify(usableReply),
} as const;

describe("createCorrectFactualErrorsStage", () => {
	const { workspaceRoot, create, run, logged } = useStageReadingEarlierOutputs(stageUnderTest);
	const readFile = workspaceJsonReader(workspaceRoot);

	afterEach(() => {
		vi.useRealTimers();
	});

	it("should write the fact-corrected subtopic, the changes with factualError in place of the reply's error, the factual errors, checkedBy and both paragraph counts when a subtopic has factual errors", async () => {
		await run();

		expect(await readFile(factCorrectionFile(corrected.subtopicId))).toStrictEqual({
			subtopicId: corrected.subtopicId,
			factCorrectionPromptVersion: FACT_CORRECTION_PROMPT_VERSION,
			bypassed: false,
			factualErrors: [seededFactualError],
			factCorrectedSubtopic: [seededFactualError.correctStatement],
			changes: [
				{ factualError: 1, before: replyChange.before, after: replyChange.after, note: "" },
			],
			checkedBy: factCheckModelIds,
			paragraphCountBefore: 1,
			paragraphCountAfter: 1,
		});
	});

	it("should make no call, and write the rewrite unchanged with an empty factualErrors list and the full checkedBy list, when a subtopic has no factual errors", async () => {
		await run();

		expect(create()).toHaveBeenCalledTimes(1);
		expect(await readFile(factCorrectionFile(unchanged.subtopicId))).toStrictEqual({
			subtopicId: unchanged.subtopicId,
			factCorrectionPromptVersion: FACT_CORRECTION_PROMPT_VERSION,
			bypassed: false,
			factualErrors: [],
			factCorrectedSubtopic: [unchanged.rewrite],
			changes: [],
			checkedBy: factCheckModelIds,
			paragraphCountBefore: 1,
			paragraphCountAfter: 1,
		});
	});

	it("should keep the reply and give both paragraph counts, with no warning, when the reply has a different number of paragraphs", async () => {
		const splitParagraphs = ["Cell injury can involve", "the immune system."];
		create().mockResolvedValue(replyBody({ ...usableReply, paragraphs: splitParagraphs }));

		await run();

		expect(create()).toHaveBeenCalledTimes(1);
		expect(await readFile(factCorrectionFile(corrected.subtopicId))).toMatchObject({
			factCorrectedSubtopic: splitParagraphs,
			paragraphCountBefore: 1,
			paragraphCountAfter: 2,
		});
		expect(logged().entries.filter(({ level }) => level === "warn")).toStrictEqual([]);
	});

	it("should write fact-corrected-subtopics.json with the model, the date and the entry of each subtopic in lecture order, and record each file, when the stage completes", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date(2026, 9, 15, 12));

		const { output, filesWritten } = await run();

		expect(await readFile(factCorrectedSubtopicsFile)).toStrictEqual({
			correctedBy: openRouterModelId,
			correctedOn: "2026-10-15",
			factCorrectedSubtopics: [
				await readFile(factCorrectionFile(unchanged.subtopicId)),
				await readFile(factCorrectionFile(corrected.subtopicId)),
			],
		});
		expect(output.factCorrectedSubtopics.map(({ subtopicId }) => subtopicId)).toStrictEqual([
			unchanged.subtopicId,
			corrected.subtopicId,
		]);
		expect(filesWritten).toStrictEqual([
			factCorrectionFile(unchanged.subtopicId),
			factCorrectionFile(corrected.subtopicId),
			factCorrectedSubtopicsFile,
		]);
	});

	itReadsSavedSubtopicFiles({
		run,
		create,
		savedFilePath: () => join(workspaceRoot(), factCorrectionFile(corrected.subtopicId)),
		stageError: CorrectFactualErrorsError,
	});

	it.each([
		{
			condition: "has a blank paragraph",
			reply: { ...usableReply, paragraphs: [seededFactualError.correctStatement, " "] },
		},
		{
			condition: "names a factual error number that is not in the list",
			reply: { ...usableReply, changes: [{ ...replyChange, error: 2 }] },
		},
	])(
		"should resend the call when the reply $condition",
		async ({ reply }) => {
			create().mockResolvedValueOnce(replyBody(reply));

			await run();

			expect(create()).toHaveBeenCalledTimes(2);
		},
		resendPausesTimeoutMs,
	);

	itFailsAfterTheThirdUnusableSend({
		run,
		create,
		calls: 1,
		outputPath: () => join(workspaceRoot(), factCorrectionFile(corrected.subtopicId)),
	});

	itFailsNamingEachSpoiledFile({
		files: [
			structuredTranscriptInput,
			rewriteInput(corrected.subtopicId),
			stageOutputInput({ file: "factual errors file", stageId: "check-facts" }),
		],
		workspaceRoot,
		run,
		errorType: CorrectFactualErrorsError,
		create,
	});
});

describe("createCorrectFactualErrorsStage with the bypass on", () => {
	const { workspaceRoot, create, run } = useStageReadingEarlierOutputs({
		...stageUnderTest,
		tuning: { bypass: true },
	});
	const readFile = workspaceJsonReader(workspaceRoot);

	it("should make no call, and write the rewrite unchanged with no changes and the factual errors that the check found, when a subtopic has factual errors", async () => {
		await run();

		expect(create()).not.toHaveBeenCalled();
		expect(await readFile(factCorrectionFile(corrected.subtopicId))).toMatchObject({
			bypassed: true,
			factualErrors: [seededFactualError],
			factCorrectedSubtopic: [corrected.rewrite],
			changes: [],
		});
	});

	it("should write fact-corrected-subtopics.json with no model and no date, and each entry bypassed, when the stage completes", async () => {
		await run();

		expect(await readFile(factCorrectedSubtopicsFile)).toMatchObject({
			correctedBy: null,
			correctedOn: null,
			factCorrectedSubtopics: [{ bypassed: true }, { bypassed: true }],
		});
	});
});
