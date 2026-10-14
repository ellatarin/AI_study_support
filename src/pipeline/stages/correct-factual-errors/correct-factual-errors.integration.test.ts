import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
	captureError,
	factCheckedSubtopics,
	factCheckModelIds,
	factCorrectedSubtopicsFile,
	factCorrectionFile,
	factualErrorsFile,
	itReadsSavedSubtopicFiles,
	makeStageContext,
	openingSubtopic,
	resendPausesTimeoutMs,
	seedEarlierOutputs,
	seededTitledRewrites,
	seedJsonFile,
	snuffFactualError,
	stubbedCallCost,
	stubbedCallsCost,
	tobaccoSubtopic,
	useTempDir,
	useUnlistedStageRun,
} from "../../fixtures.js";
import type { MergedFactualError } from "../factual-errors.js";
import type { TitledSubtopicRewrite } from "../subtopic-rewrites.js";
import {
	CorrectFactualErrorsError,
	type CorrectionSubtopic,
	correctFactualErrors,
	readFactCorrectionInput,
} from "./correct-factual-errors.js";
import { FACT_CORRECTION_PROMPT_VERSION } from "./correct-factual-errors.prompt.js";

/** {@link snuffFactualError} as the merged file holds it: both models report it. */
const snuffError: MergedFactualError = {
	...snuffFactualError,
	foundBy: factCheckModelIds,
	wordsFound: true,
};

/**
 * Gives each subtopic with its factual errors: {@link snuffError} in its subtopic,
 * and none in the others.
 *
 * @param rewrites - The rewrite of each subtopic, in lecture order.
 * @returns Each subtopic with its factual errors.
 */
function withSnuffError(rewrites: readonly TitledSubtopicRewrite[]): readonly CorrectionSubtopic[] {
	return rewrites.map((rewrite) => ({
		...rewrite,
		factualErrors: rewrite.subtopicId === snuffError.subtopicId ? [snuffError] : [],
	}));
}

/** The paragraphs of {@link tobaccoSubtopic} after the fact correction of {@link snuffError}. */
const correctedTobaccoParagraphs = tobaccoSubtopic.rewrittenSubtopic.map((paragraph) =>
	paragraph === snuffError.passage ? snuffError.correctStatement : paragraph,
);

/** One change of a reply, in the words of prompt k3. */
const snuffReplyChange = {
	error: 1,
	before: snuffError.passage,
	after: snuffError.correctStatement,
	note: "",
};

/** The usable reply for {@link tobaccoSubtopic}, in the shape that prompt k3 asks for. */
const usableReply = { paragraphs: correctedTobaccoParagraphs, changes: [snuffReplyChange] };

describe("correctFactualErrors", () => {
	const { workspaceRoot, stubLogger, costTally, sendToModel, readFile, stageRun } =
		useUnlistedStageRun({ prefix: "correct-factual-errors-", reply: usableReply });

	/**
	 * Runs the fact correction of the test subtopics.
	 *
	 * @returns The result of the fact correction.
	 */
	function run(): ReturnType<typeof correctFactualErrors> {
		return correctFactualErrors({
			subtopics: withSnuffError(factCheckedSubtopics),
			checkedBy: factCheckModelIds,
			...stageRun(),
		});
	}

	it("should write the fact-corrected subtopic, the changes with factualError in place of the reply's error, the factual errors, checkedBy and both paragraph counts when a subtopic has factual errors", async () => {
		await run();

		expect(await readFile(factCorrectionFile(tobaccoSubtopic.subtopicId))).toStrictEqual({
			subtopicId: tobaccoSubtopic.subtopicId,
			factCorrectionPromptVersion: FACT_CORRECTION_PROMPT_VERSION,
			factualErrors: [snuffError],
			factCorrectedSubtopic: correctedTobaccoParagraphs,
			changes: [
				{
					factualError: 1,
					before: snuffReplyChange.before,
					after: snuffReplyChange.after,
					note: "",
				},
			],
			checkedBy: factCheckModelIds,
			paragraphCountBefore: 2,
			paragraphCountAfter: 2,
		});
	});

	it("should make no call, and write the rewrite unchanged with an empty factualErrors list and the full checkedBy list, when a subtopic has no factual errors", async () => {
		await run();

		expect(sendToModel()).toHaveBeenCalledTimes(1);
		expect(await readFile(factCorrectionFile(openingSubtopic.subtopicId))).toStrictEqual({
			subtopicId: openingSubtopic.subtopicId,
			factCorrectionPromptVersion: FACT_CORRECTION_PROMPT_VERSION,
			factualErrors: [],
			factCorrectedSubtopic: openingSubtopic.rewrittenSubtopic,
			changes: [],
			checkedBy: factCheckModelIds,
			paragraphCountBefore: 1,
			paragraphCountAfter: 1,
		});
	});

	it("should keep the reply and give both paragraph counts, with no warning, when the reply has a different number of paragraphs", async () => {
		const joinedParagraph = correctedTobaccoParagraphs.join(" ");
		sendToModel().mockResolvedValue({
			content: JSON.stringify({ ...usableReply, paragraphs: [joinedParagraph] }),
		});

		await run();

		expect(sendToModel()).toHaveBeenCalledTimes(1);
		expect(await readFile(factCorrectionFile(tobaccoSubtopic.subtopicId))).toMatchObject({
			factCorrectedSubtopic: [joinedParagraph],
			paragraphCountBefore: 2,
			paragraphCountAfter: 1,
		});
		expect(stubLogger().entries.filter(({ level }) => level === "warn")).toStrictEqual([]);
	});

	it("should write fact-corrected-subtopics.json with the entry of each subtopic in lecture order when each subtopic has its file", async () => {
		const { output, filesWritten } = await run();

		expect(await readFile(factCorrectedSubtopicsFile)).toStrictEqual({
			factCorrectedSubtopics: [
				await readFile(factCorrectionFile(openingSubtopic.subtopicId)),
				await readFile(factCorrectionFile(tobaccoSubtopic.subtopicId)),
			],
		});
		expect(output.factCorrectedSubtopics.map(({ subtopicId }) => subtopicId)).toStrictEqual([
			openingSubtopic.subtopicId,
			tobaccoSubtopic.subtopicId,
		]);
		expect(filesWritten).toStrictEqual([
			factCorrectionFile(openingSubtopic.subtopicId),
			factCorrectionFile(tobaccoSubtopic.subtopicId),
			factCorrectedSubtopicsFile,
		]);
	});

	itReadsSavedSubtopicFiles({
		run,
		sendToModel,
		savedFilePath: () => join(workspaceRoot(), factCorrectionFile(tobaccoSubtopic.subtopicId)),
		stageError: CorrectFactualErrorsError,
	});

	it("should add the cost of each send to the stage's cost tally when the stage calls the model", async () => {
		sendToModel().mockImplementation(({ costTally: stageCostTally }) => {
			stageCostTally.add(stubbedCallCost);
			return Promise.resolve({ content: JSON.stringify(usableReply) });
		});

		await run();

		expect(costTally().total()).toStrictEqual(stubbedCallsCost({ calls: 1 }));
	});

	it.each([
		{
			condition: "has a blank paragraph",
			reply: { ...usableReply, paragraphs: [...correctedTobaccoParagraphs.slice(0, 1), " "] },
		},
		{
			condition: "names a factual error number that is not in the list",
			reply: { ...usableReply, changes: [{ ...snuffReplyChange, error: 2 }] },
		},
	])(
		"should resend the call when the reply $condition",
		async ({ reply }) => {
			sendToModel().mockResolvedValueOnce({ content: JSON.stringify(reply) });

			await run();

			expect(sendToModel()).toHaveBeenCalledTimes(2);
		},
		resendPausesTimeoutMs,
	);
});

/** The prompt version of the seeded merged file. The stage does not read it, so any text serves. */
const SEEDED_FACT_CHECK_PROMPT_VERSION = "f-seeded";

describe("readFactCorrectionInput", () => {
	const workspaceRoot = useTempDir({ prefix: "correct-factual-errors-input-" });

	beforeEach(async () => {
		await seedEarlierOutputs({
			workspaceRoot: workspaceRoot(),
			readsFrom: ["structure-transcript", "rewrite-subtopics"],
		});
	});

	/**
	 * Reads the input of the stage from the test workspace.
	 *
	 * @returns What {@link readFactCorrectionInput} gives.
	 */
	function readInput(): ReturnType<typeof readFactCorrectionInput> {
		return readFactCorrectionInput(makeStageContext({ workspaceRoot: workspaceRoot() }));
	}

	it("should give each subtopic in lecture order with its title, its rewrite and its factual errors when the structured transcript, the rewrites and factual-errors.json are on disk", async () => {
		await seedJsonFile({
			path: join(workspaceRoot(), factualErrorsFile),
			contents: {
				factCheckPromptVersion: SEEDED_FACT_CHECK_PROMPT_VERSION,
				checkedBy: factCheckModelIds,
				factualErrors: [snuffError],
			},
		});

		const input = await readInput();

		expect(input).toStrictEqual({
			checkedBy: factCheckModelIds,
			subtopics: withSnuffError(seededTitledRewrites),
		});
	});

	it("should fail with CorrectFactualErrorsError that names the file when factual-errors.json is missing", async () => {
		const error = await captureError(readInput());

		expect(error).toBeInstanceOf(CorrectFactualErrorsError);
		expect(error.message).toContain(join(workspaceRoot(), factualErrorsFile));
	});
});
