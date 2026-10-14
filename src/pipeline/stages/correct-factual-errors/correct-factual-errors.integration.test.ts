import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	factCheckModelIds,
	factCorrectedSubtopicsFile,
	factCorrectionFile,
	itFailsAfterTheThirdUnusableSend,
	itFailsNamingEachSpoiledFile,
	itReadsSavedSubtopicFiles,
	openRouterReplyBody,
	readJsonFile,
	resendPausesTimeoutMs,
	rewriteInput,
	rewrittenParagraphs,
	seededFactualError,
	stageOutputInput,
	structuredTranscriptInput,
	useStageReadingEarlierOutputs,
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

describe("createCorrectFactualErrorsStage", () => {
	const { workspaceRoot, create, run, logged } = useStageReadingEarlierOutputs({
		stageId: STAGE_ID,
		readsFrom: ["structure-transcript", "rewrite-subtopics", "check-facts"],
		factory: createCorrectFactualErrorsStage,
		reply: JSON.stringify(usableReply),
	});

	/**
	 * Reads a JSON file of the workspace of the current test.
	 *
	 * @param file - The path relative to the workspace.
	 * @returns The parsed file.
	 */
	function readFile(file: string): Promise<unknown> {
		return readJsonFile(join(workspaceRoot(), file));
	}

	it("should write the fact-corrected subtopic, the changes with factualError in place of the reply's error, the factual errors, checkedBy and both paragraph counts when a subtopic has factual errors", async () => {
		await run();

		expect(await readFile(factCorrectionFile(corrected.subtopicId))).toStrictEqual({
			subtopicId: corrected.subtopicId,
			factCorrectionPromptVersion: FACT_CORRECTION_PROMPT_VERSION,
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

	it("should write fact-corrected-subtopics.json with the entry of each subtopic in lecture order, and record each file, when the stage completes", async () => {
		const { output, filesWritten } = await run();

		expect(await readFile(factCorrectedSubtopicsFile)).toStrictEqual({
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
