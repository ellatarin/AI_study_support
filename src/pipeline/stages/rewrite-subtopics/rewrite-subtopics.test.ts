import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	correctedSubtopicText,
	itFailsAfterTheThirdUnusableSend,
	itFailsNamingEachSpoiledFile,
	openRouterReplyBody,
	readJsonFile,
	sentUserContents,
	structuredTranscriptInput,
	termCorrectionInput,
	transcriptSubtopicTexts,
	useStageReadingEarlierOutputs,
} from "../../fixtures.js";
import { createRewriteSubtopicsStage, RewriteSubtopicsError } from "./rewrite-subtopics.js";

const STAGE_ID = "rewrite-subtopics";

const usableParagraph = "Cell injury involves the immune system.";

/** The content of a usable reply: one paragraph. */
const usableReply = JSON.stringify({ paragraphs: [usableParagraph] });

/**
 * The workspace-relative path of the rewrite of a subtopic in round 1. The name
 * is stated in full here, and not taken from the production code.
 *
 * @param subtopicId - The subtopic.
 * @returns The path, relative to the workspace.
 */
function rewriteFile(subtopicId: number): string {
	return `Rewrites/subtopic-${subtopicId}-attempt-1.json`;
}

describe("createRewriteSubtopicsStage", () => {
	const { workspaceRoot, create, run } = useStageReadingEarlierOutputs({
		stageId: STAGE_ID,
		readsFrom: ["structure-transcript", "correct-terms"],
		factory: createRewriteSubtopicsStage,
		reply: usableReply,
	});

	/**
	 * The absolute path of the rewrite of a subtopic in round 1.
	 *
	 * @param subtopicId - The subtopic.
	 * @returns The path in the workspace of the current test.
	 */
	function rewritePath(subtopicId: number): string {
		return join(workspaceRoot(), rewriteFile(subtopicId));
	}

	it("should send the corrected text of one subtopic, and nothing else, when the stage rewrites each subtopic", async () => {
		await run();

		const sent = sentUserContents(create().mock.calls);
		expect(sent).toHaveLength(2);
		expect(sent).toStrictEqual(
			expect.arrayContaining([
				`Subtopic:\n${JSON.stringify({ text: transcriptSubtopicTexts[0] })}`,
				`Subtopic:\n${JSON.stringify({ text: correctedSubtopicText })}`,
			]),
		);
	});

	it("should write the rewritten subtopic and the writer prompt version in the file of each subtopic when the stage completes", async () => {
		const result = await run();

		expect(result.filesWritten).toStrictEqual([rewriteFile(1), rewriteFile(2)]);
		expect(await readJsonFile(rewritePath(2))).toStrictEqual({
			subtopicId: 2,
			attemptNumber: 1,
			writerPromptVersion: "w1",
			rewrittenSubtopic: [usableParagraph],
		});
	});

	it.each([
		{ problem: "has no paragraph", paragraphs: [] },
		{ problem: "has a blank paragraph", paragraphs: [usableParagraph, " "] },
	])("should resend the call when the reply $problem", async ({ paragraphs }) => {
		create().mockResolvedValueOnce(
			openRouterReplyBody({ content: JSON.stringify({ paragraphs }) }),
		);

		await run();

		expect(create()).toHaveBeenCalledTimes(3);
	});

	it("should keep a saved rewrite and make no call for its subtopic when the stage runs again", async () => {
		const savedRewrite = (): Promise<string> => readFile(rewritePath(2), "utf8");
		await run();
		const saved = await savedRewrite();

		await run();

		expect(create()).toHaveBeenCalledTimes(2);
		expect(await savedRewrite()).toBe(saved);
	});

	itFailsAfterTheThirdUnusableSend({ run, create, calls: 2, outputPath: () => rewritePath(2) });

	itFailsNamingEachSpoiledFile({
		files: [structuredTranscriptInput, termCorrectionInput(2)],
		workspaceRoot,
		run,
		errorType: RewriteSubtopicsError,
		create,
	});
});
