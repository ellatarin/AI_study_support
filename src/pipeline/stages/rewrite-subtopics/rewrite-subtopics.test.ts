import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pathExists } from "../../../utils/files.js";
import {
	arrivingTogether,
	captureError,
	itFailsNamingEachSpoiledFile,
	openRouterReplyBody,
	readJsonFile,
	resendPausesTimeoutMs,
	seedStageOutput,
	sentSystemMessage,
	slideDeckPlacements,
	slideDeckReadings,
	slideReadingInput,
	stageOutputInput,
	structuredTranscriptInput,
	trackingInFlight,
	transcriptStructuredTranscript,
	transcriptSubtopicTexts,
	useStageReadingEarlierOutputs,
} from "../../fixtures.js";
import { ResendsExhaustedError } from "../model-stage.js";
import { createRewriteSubtopicsStage, RewriteSubtopicsError } from "./rewrite-subtopics.js";

const STAGE_ID = "rewrite-subtopics";

/** The reason that each stubbed correction gives. */
const STUBBED_REASON = "The transcriber misheard the term on slide 1.";

/**
 * The workspace-relative path of the first rewrite attempt of a subtopic. The
 * name is stated in full here, and not taken from the production code.
 *
 * @param subtopicId - The subtopic.
 * @returns The path, relative to the workspace.
 */
function attemptFile(subtopicId: number): string {
	return `Rewrite attempts/subtopic-${subtopicId}-attempt-1.json`;
}

/**
 * One correction of a reply, with {@link STUBBED_REASON}.
 *
 * @param args - The two forms.
 * @param args.wrongForm - The misheard form.
 * @param args.rightForm - The form on a slide.
 * @returns The correction.
 */
function correction({
	wrongForm,
	rightForm,
}: {
	readonly wrongForm: string;
	readonly rightForm: string;
}): Record<string, unknown> {
	return { wrongForm, rightForm, reason: STUBBED_REASON };
}

/** A correction that passes each check: its wrong form is in subtopic 2, and its right form is the title of slide 1. */
const usableCorrection = correction({ wrongForm: "cell injury", rightForm: "Cell injury" });

/** The text of subtopic 2 after {@link usableCorrection}. */
const correctedSubtopicText = "Cell injury and the immune system.";

/**
 * The content of a reply with these corrections.
 *
 * @param corrections - The corrections, in reply order.
 * @returns The content, as JSON.
 */
function replyWith(corrections: readonly Record<string, unknown>[]): string {
	return JSON.stringify({ corrections });
}

/** The content of the reply with {@link usableCorrection} alone. */
const usableReply = replyWith([usableCorrection]);

describe("createRewriteSubtopicsStage", () => {
	const { workspaceRoot, create, run, expectOneCallSending } = useStageReadingEarlierOutputs({
		stageId: STAGE_ID,
		readsFrom: ["structure-transcript", "read-slides", "place-slides"],
		factory: createRewriteSubtopicsStage,
		reply: usableReply,
		tuning: { concurrency: 2 },
	});

	/**
	 * The first rewrite attempt of a subtopic, parsed from disk.
	 *
	 * @param subtopicId - The subtopic.
	 * @returns The parsed file.
	 */
	function writtenAttempt(subtopicId: number): Promise<unknown> {
		return readJsonFile(join(workspaceRoot(), attemptFile(subtopicId)));
	}

	/**
	 * Stubs every reply with these corrections, and runs the stage.
	 *
	 * @param corrections - The corrections of the reply.
	 * @returns The first rewrite attempt of subtopic 2, parsed from disk.
	 */
	async function attemptAfterReply(
		corrections: readonly Record<string, unknown>[],
	): Promise<unknown> {
		create().mockResolvedValue(openRouterReplyBody({ content: replyWith(corrections) }));
		await run();
		return writtenAttempt(2);
	}

	/**
	 * Replaces the text of subtopic 2 in the structured transcript.
	 *
	 * @param text - The new text.
	 * @returns A promise that resolves when the file is written.
	 */
	async function seedSecondSubtopicText(text: string): Promise<void> {
		const [opening, subject] = transcriptStructuredTranscript.topics;
		await seedStageOutput({
			workspaceRoot: workspaceRoot(),
			stageId: "structure-transcript",
			contents: JSON.stringify({
				...transcriptStructuredTranscript,
				topics: [opening, { ...subject, subtopics: [{ ...subject?.subtopics[0], text }] }],
			}),
		});
	}

	it("should send the subtopic text and the whole reading of each slide placed in it when the stage corrects a subtopic", async () => {
		await expectOneCallSending({
			text: transcriptSubtopicTexts[1],
			slides: [slideDeckReadings[0], slideDeckReadings[1], slideDeckReadings[3]],
		});
	});

	it("should state that each form has one to four words when the stage corrects a subtopic", async () => {
		await run();

		expect(sentSystemMessage(create().mock.calls)).toContain("Each form has one to four words.");
	});

	it("should make no call and keep the text unchanged when a subtopic has no placed slide", async () => {
		await run();

		expect(create()).toHaveBeenCalledTimes(1);
		expect(await writtenAttempt(1)).toStrictEqual({
			subtopicId: 1,
			attemptNumber: 1,
			termCorrectionPromptVersion: "t1",
			slideNumbers: [],
			corrections: [],
			ignoredCorrections: [],
			correctedText: transcriptSubtopicTexts[0],
		});
	});

	it("should write the corrections, the slides sent and the corrected text in the first rewrite attempt when the stage completes", async () => {
		const result = await run();

		expect(result.filesWritten).toStrictEqual([attemptFile(1), attemptFile(2)]);
		expect(await writtenAttempt(2)).toStrictEqual({
			subtopicId: 2,
			attemptNumber: 1,
			termCorrectionPromptVersion: "t1",
			slideNumbers: [1, 2, 4],
			corrections: [{ ...usableCorrection, occurrencesChanged: 1 }],
			ignoredCorrections: [],
			correctedText: correctedSubtopicText,
		});
	});

	it("should change each occurrence of the wrong form and count the changes when the wrong form occurs more than once", async () => {
		await seedSecondSubtopicText("cell injury, then more cell injury.");

		const attempt = await attemptAfterReply([usableCorrection]);

		expect(attempt).toMatchObject({
			corrections: [{ ...usableCorrection, occurrencesChanged: 2 }],
			correctedText: "Cell injury, then more Cell injury.",
		});
	});

	it("should change the longer wrong form first, and the shorter one only where it is left, when two wrong forms overlap", async () => {
		const shorter = correction({ wrongForm: "injury", rightForm: "Injury" });

		const attempt = await attemptAfterReply([shorter, usableCorrection]);

		expect(attempt).toMatchObject({
			corrections: [
				{ ...shorter, occurrencesChanged: 0 },
				{ ...usableCorrection, occurrencesChanged: 1 },
			],
			correctedText: correctedSubtopicText,
		});
	});

	it.each([
		{ field: "body", rightForm: "Injury" },
		{ field: "figure description", rightForm: "organelles" },
		{ field: "caption", rightForm: "outcomes" },
	])("should keep a correction when its right form is only in a slide's $field", async ({
		rightForm,
	}) => {
		const fromField = correction({ wrongForm: "immune", rightForm });

		const attempt = await attemptAfterReply([fromField]);

		expect(attempt).toMatchObject({ corrections: [fromField], ignoredCorrections: [] });
	});

	it.each([
		{
			ignoredBecause: "form-too-long",
			problem: "its wrong form has five words",
			ignored: correction({ wrongForm: "cell injury and the immune", rightForm: "Cell injury" }),
		},
		{
			ignoredBecause: "form-too-long",
			problem: "its right form has five words",
			ignored: correction({ wrongForm: "immune", rightForm: "A cell that swells, with" }),
		},
		{
			ignoredBecause: "right-form-not-on-slide",
			problem: "no placed slide prints its right form",
			ignored: correction({ wrongForm: "immune", rightForm: "Cell death" }),
		},
		{
			ignoredBecause: "right-form-not-on-slide",
			problem: "only a slide of another subtopic prints its right form",
			ignored: correction({ wrongForm: "immune", rightForm: "Questions?" }),
		},
		{
			ignoredBecause: "wrong-form-not-in-text",
			problem: "the subtopic text does not hold its wrong form",
			ignored: correction({ wrongForm: "sell injury", rightForm: "Cell injury" }),
		},
		{
			ignoredBecause: "wrong-form-not-in-text",
			problem: "its wrong form differs from the text only in capitals",
			ignored: correction({ wrongForm: "Immune", rightForm: "Cell injury" }),
		},
		{
			ignoredBecause: "right-form-not-on-slide",
			problem: "it fails the slide check and the text check",
			ignored: correction({ wrongForm: "sell injury", rightForm: "Cell death" }),
		},
	])("should ignore and record a correction as $ignoredBecause, and keep the others, when $problem", async ({
		ignored,
		ignoredBecause,
	}) => {
		const attempt = await attemptAfterReply([ignored, usableCorrection]);

		expect(attempt).toMatchObject({
			corrections: [{ ...usableCorrection, occurrencesChanged: 1 }],
			ignoredCorrections: [{ ...ignored, ignoredBecause }],
			correctedText: correctedSubtopicText,
		});
	});

	it.each([
		{ problem: "is not the documented shape", content: JSON.stringify({ corrections: [{}] }) },
		{
			problem: "gives a blank wrong form",
			content: replyWith([correction({ wrongForm: " ", rightForm: "Cell injury" })]),
		},
		{
			problem: "gives a blank right form",
			content: replyWith([correction({ wrongForm: "cell injury", rightForm: "" })]),
		},
	])("should resend the call when the reply $problem", async ({ content }) => {
		create().mockResolvedValueOnce(openRouterReplyBody({ content }));

		await run();

		expect(create()).toHaveBeenCalledTimes(2);
	});

	it("should correct up to the configured number of subtopics at the same time when several subtopics have placed slides", async () => {
		await seedStageOutput({
			workspaceRoot: workspaceRoot(),
			stageId: "place-slides",
			contents: JSON.stringify({
				...slideDeckPlacements,
				placements: slideDeckPlacements.placements.map((placement, index) => ({
					...placement,
					subtopicId: index === 0 ? 1 : 2,
				})),
			}),
		});
		const { tracked, peak } = trackingInFlight(
			arrivingTogether({
				count: 2,
				reply: () => openRouterReplyBody({ content: usableReply }),
			}),
		);
		create().mockImplementation(tracked);

		await run();

		expect(create()).toHaveBeenCalledTimes(2);
		expect(peak()).toBe(2);
	});

	it("should keep a saved first rewrite attempt and make no call for its subtopic when the stage runs again", async () => {
		await run();
		const saved = await readFile(join(workspaceRoot(), attemptFile(2)), "utf8");

		await run();

		expect(create()).toHaveBeenCalledTimes(1);
		expect(await readFile(join(workspaceRoot(), attemptFile(2)), "utf8")).toBe(saved);
	});

	it("should leave the files of the earlier stages unchanged when the stage completes", async () => {
		const structuredTranscriptPath = structuredTranscriptInput.path(workspaceRoot());
		const before = await readFile(structuredTranscriptPath, "utf8");

		await run();

		expect(await readFile(structuredTranscriptPath, "utf8")).toBe(before);
	});

	itFailsNamingEachSpoiledFile({
		files: [
			structuredTranscriptInput,
			stageOutputInput({ file: "slide placements file", stageId: "place-slides" }),
			slideReadingInput(2),
		],
		workspaceRoot,
		run,
		errorType: RewriteSubtopicsError,
		create,
	});

	it("should fail without writing the subtopic's rewrite attempt when the third send is still unusable", {
		timeout: resendPausesTimeoutMs,
	}, async () => {
		create().mockResolvedValue(openRouterReplyBody({ content: JSON.stringify({}) }));

		expect(await captureError(run())).toBeInstanceOf(ResendsExhaustedError);
		expect(create()).toHaveBeenCalledTimes(3);
		expect(await pathExists(join(workspaceRoot(), attemptFile(2)))).toBe(false);
	});
});
