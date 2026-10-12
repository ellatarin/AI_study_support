import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pathExists } from "../../../utils/files.js";
import {
	itFailsAfterTheThirdUnusableSend,
	itFailsNamingEachSpoiledFile,
	openRouterReplyBody,
	outputLanguageNames,
	readJsonFile,
	replyingWhenRequestHolds,
	rewriteInput,
	rewrittenParagraphs,
	sentSystemMessage,
	structuredTranscriptInput,
	termCorrectionInput,
	transcriptSubtopicTexts,
	usableTermCorrection,
	useStageReadingEarlierOutputs,
} from "../../fixtures.js";
import {
	CheckRewriteAttemptsError,
	createCheckRewriteAttemptsStage,
} from "./check-rewrite-attempts.js";

const STAGE_ID = "check-rewrite-attempts";

/** The content of a reply that finds no deficiency. */
const faithfulReply = JSON.stringify({ deficiencies: [], considerations: [] });

/** A deficiency in the documented shape: the rewrite leaves out a fact. */
const omission = {
	deficiencyType: "omission",
	rule: "R2",
	description: "The rewrite leaves out the immune system.",
	sourcePassage: "and the immune system",
	rewritePassage: null,
};

/** A consideration in the documented shape. */
const consideration = { sourcePassage: "Today we are covering", reason: "It is filler." };

const rewriteQuote = "Cell injury";

/**
 * Builds the content of a reply that finds one deficiency and gives {@link consideration}.
 *
 * @param deficiency - The deficiency that the reply finds.
 * @returns The content of the reply.
 */
function replyFinding(deficiency: Readonly<Record<string, unknown>>): string {
	return JSON.stringify({ deficiencies: [deficiency], considerations: [consideration] });
}

/** The content of a reply that finds {@link omission}. */
const unfaithfulReply = replyFinding(omission);

/**
 * The workspace-relative path of the check of a subtopic in round 1. The name is
 * stated in full here, and not taken from the production code.
 *
 * @param subtopicId - The subtopic.
 * @returns The path, relative to the workspace.
 */
function checkFile(subtopicId: number): string {
	return `Checks/subtopic-${subtopicId}-attempt-1.json`;
}

/** The workspace-relative path of the result file of round 1, stated in full. */
const roundFile = "Checks/round-1.json";

/** The stage under test, the earlier stages that it reads, and the reply that finds no deficiency. */
const checkerSuite = {
	stageId: STAGE_ID,
	readsFrom: ["structure-transcript", "correct-terms", "rewrite-subtopics"],
	factory: createCheckRewriteAttemptsStage,
	reply: faithfulReply,
} as const;

describe.each(outputLanguageNames)("the checker prompt when the notes are in $name", ({
	language,
	name,
}) => {
	const { create, run } = useStageReadingEarlierOutputs({ ...checkerSuite, language });

	it("should tell the checker the writer's language, and that a spelling of that language is not a deficiency, when the stage checks a subtopic", async () => {
		await run();

		const prompt = sentSystemMessage(create().mock.calls);
		expect(prompt).toContain(`The writer also had to write in ${name}.`);
		expect(prompt).toContain(
			`- A spelling of ${name} in place of another spelling of the same word, such as "colour" for "color". The text has the transcriber's spelling, which can differ.`,
		);
	});
});

describe("createCheckRewriteAttemptsStage", () => {
	const { workspaceRoot, create, run, expectCallsSending } =
		useStageReadingEarlierOutputs(checkerSuite);

	/**
	 * The absolute path of a file in the workspace of the current test.
	 *
	 * @param file - The path, relative to the workspace.
	 * @returns The absolute path.
	 */
	function inWorkspace(file: string): string {
		return join(workspaceRoot(), file);
	}

	it("should send the text before term correction, the kept corrections with their reasons and the rewrite, and no slide text, when the stage checks each subtopic", async () => {
		await expectCallsSending([
			{ text: transcriptSubtopicTexts[0], corrections: [], rewrite: [rewrittenParagraphs[0]] },
			{
				text: transcriptSubtopicTexts[1],
				corrections: [usableTermCorrection],
				rewrite: [rewrittenParagraphs[1]],
			},
		]);
	});

	it.each([
		{ passage: "no rewrite passage", deficiency: omission },
		{ passage: "a rewrite passage", deficiency: { ...omission, rewritePassage: rewriteQuote } },
	])("should write the deficiencies, the considerations and the checker prompt version in the check of each subtopic when an omission gives $passage", async ({
		deficiency,
	}) => {
		create().mockResolvedValue(openRouterReplyBody({ content: replyFinding(deficiency) }));

		await run();

		expect(await readJsonFile(inWorkspace(checkFile(2)))).toStrictEqual({
			subtopicId: 2,
			attemptNumber: 1,
			checkerPromptVersion: "c2",
			deficiencies: [deficiency],
			considerations: [consideration],
		});
	});

	it.each([
		{ condition: "each subtopic passes", secondReply: faithfulReply, failedSubtopicIds: [] },
		{
			condition: "the rewrite of subtopic 2 has a deficiency",
			secondReply: unfaithfulReply,
			failedSubtopicIds: [2],
		},
	])("should write the failed subtopics of the round in the round file when $condition", async ({
		secondReply,
		failedSubtopicIds,
	}) => {
		create().mockImplementation(
			replyingWhenRequestHolds({
				holds: rewrittenParagraphs[1],
				matching: openRouterReplyBody({ content: secondReply }),
				other: openRouterReplyBody({ content: faithfulReply }),
			}),
		);

		await run();

		expect(await readJsonFile(inWorkspace(roundFile))).toStrictEqual({
			round: 1,
			failedSubtopicIds,
		});
	});

	it.each([
		{ condition: "the check of subtopic 1 is missing", removed: checkFile(1), callsOnRerun: 1 },
		{
			condition: "each check is saved and the round file is missing",
			removed: roundFile,
			callsOnRerun: 0,
		},
	])("should make a call only for each missing check, and write the round file, when $condition", async ({
		removed,
		callsOnRerun,
	}) => {
		const savedCheck = (): Promise<string> => readFile(inWorkspace(checkFile(2)), "utf8");
		await run();
		const saved = await savedCheck();
		await rm(inWorkspace(removed));

		await run();

		expect(create()).toHaveBeenCalledTimes(2 + callsOnRerun);
		expect(await savedCheck()).toBe(saved);
		expect(await pathExists(inWorkspace(roundFile))).toBe(true);
	});

	it.each([
		{
			problem: "has an unknown deficiency type",
			reply: { deficiencies: [{ ...omission, deficiencyType: "underexplained" }] },
		},
		{
			problem: "names R1, which the checker does not check",
			reply: { deficiencies: [{ ...omission, rule: "R1" }] },
		},
		{
			problem: "names R10, which the checker does not check",
			reply: { deficiencies: [{ ...omission, rule: "R10" }] },
		},
		{
			problem: "gives a source passage for an unsourced addition",
			reply: {
				deficiencies: [
					{ ...omission, deficiencyType: "unsourced-addition", rewritePassage: rewriteQuote },
				],
			},
		},
		{
			problem: "gives no rewrite passage for a distortion",
			reply: { deficiencies: [{ ...omission, deficiencyType: "distortion" }] },
		},
		{
			problem: "has a deficiency with no description",
			reply: { deficiencies: [{ ...omission, description: null }] },
		},
		{
			problem: "has a consideration with no reason",
			reply: { considerations: [{ sourcePassage: consideration.sourcePassage }] },
		},
	])("should resend the call when the reply $problem", async ({ reply }) => {
		create().mockResolvedValueOnce(
			openRouterReplyBody({
				content: JSON.stringify({ deficiencies: [], considerations: [], ...reply }),
			}),
		);

		await run();

		expect(create()).toHaveBeenCalledTimes(3);
	});

	itFailsAfterTheThirdUnusableSend({
		run,
		create,
		calls: 2,
		outputPath: () => inWorkspace(checkFile(2)),
	});

	itFailsNamingEachSpoiledFile({
		files: [structuredTranscriptInput, termCorrectionInput(2), rewriteInput(2)],
		workspaceRoot,
		run,
		errorType: CheckRewriteAttemptsError,
		create,
	});
});
