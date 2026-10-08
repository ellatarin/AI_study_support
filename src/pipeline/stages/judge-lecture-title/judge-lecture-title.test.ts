import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	aiDerivedLecture,
	captureError,
	eachUnusableJsonFile,
	loggedAt,
	openRouterReplyBody,
	readJsonFile,
	resendPausesTimeoutMs,
	sentSystemMessage,
	sentUserMessage,
	spoilJsonFile,
	stubbedJudgedBecause,
	testLecture,
	titleJudgementReply,
	titleKept,
	titleRejected,
	transcriptSubtopicTexts,
	unusableTranscripts,
	useStageReadingDivision,
	withUserTitle,
} from "../../fixtures.js";
import { stageOutputPath } from "../../layout.js";
import { createJudgeLectureTitleStage, JudgeLectureTitleError } from "./judge-lecture-title.js";

const STAGE_ID = "judge-lecture-title";

/** {@link titleJudgementReply} as the content of a model reply. */
function judgementReply(overrides: Readonly<Record<string, unknown>> = {}): string {
	return JSON.stringify(titleJudgementReply(overrides));
}

describe("createJudgeLectureTitleStage", () => {
	const { workspaceRoot, logged, create, run, expectOneCallSending, expectResendsExhausted } =
		useStageReadingDivision({
			stageId: STAGE_ID,
			readsFrom: ["retitle-subtopics", "group-into-topics"],
			factory: createJudgeLectureTitleStage,
			reply: judgementReply(),
		});

	/** Stubs every model call with `content`. */
	function stubContent(content: string): void {
		create().mockResolvedValue(openRouterReplyBody({ content }));
	}

	/** The judgement that the stage wrote into the workspace with `baseName`, parsed from disk. */
	function writtenJudgement(baseName: string = testLecture.baseName): Promise<unknown> {
		return readJsonFile(
			stageOutputPath({
				workspaceRoot: join(dirname(workspaceRoot()), baseName),
				stageId: STAGE_ID,
			}),
		);
	}

	it("should send each topic's title with its subtopics' titles and trimmed text in order when the stage calls the model", async () => {
		await expectOneCallSending({
			topics: [
				{
					title: "The lecture's opening",
					subtopics: [{ title: "Opening", text: transcriptSubtopicTexts[0] }],
				},
				{
					title: "Cell injury",
					subtopics: [{ title: "Cell injury", text: transcriptSubtopicTexts[1] }],
				},
			],
		});
	});

	it.each([
		{ title: testLecture.title, sent: `Working title: "${testLecture.title}"` },
		{ title: "", sent: "Working title: (none — the filename carried no title)" },
	])("should send the working title $sent when the provisional title is '$title'", async ({
		title,
		sent,
	}) => {
		// A model may not judge an empty title meaningful, so the reply rejects both titles.
		stubContent(judgementReply(titleRejected));

		await run({ provisionalTitle: title });

		expect(sentUserMessage(create().mock.calls)).toContain(sent);
	});

	it("should include the language rule in the prompt when the stage calls the model", async () => {
		await run();

		expect(sentSystemMessage(create().mock.calls)).toContain("Write in British English.");
	});

	it.each([
		{
			outcome: "kept-provisional",
			case: "the model judges the provisional title meaningful",
			reply: titleKept,
			manifest: {},
			aiDerivedTitle: null,
			identityChanges: {},
			baseName: testLecture.baseName,
		},
		{
			outcome: "adopted-derived",
			case: "the model judges it not meaningful and no user title is set",
			reply: titleRejected,
			manifest: {},
			aiDerivedTitle: aiDerivedLecture.title,
			identityChanges: {
				aiDerivedTitle: aiDerivedLecture.title,
				lectureTitle: aiDerivedLecture.title,
				baseName: aiDerivedLecture.baseName,
			},
			baseName: aiDerivedLecture.baseName,
		},
		{
			outcome: "kept-user-title",
			case: "the model judges it not meaningful and a user title is set",
			reply: titleRejected,
			manifest: withUserTitle,
			aiDerivedTitle: aiDerivedLecture.title,
			identityChanges: { aiDerivedTitle: aiDerivedLecture.title },
			baseName: testLecture.baseName,
		},
	])("should write the judgement with outcome $outcome when $case", async (judged) => {
		stubContent(judgementReply(judged.reply));

		const result = await run(judged.manifest);

		expect(await writtenJudgement(judged.baseName)).toStrictEqual({
			provisionalTitle: testLecture.title,
			provisionalTitleMeaningful: judged.reply.provisionalTitleMeaningful,
			aiDerivedTitle: judged.aiDerivedTitle,
			judgedBecause: stubbedJudgedBecause,
			outcome: judged.outcome,
		});
		expect(result.identityChanges ?? {}).toStrictEqual(judged.identityChanges);
		expect(result.filesWritten).toStrictEqual(["Title judgement/judgement.json"]);
	});

	// Every later stage names its output from the lecture title. So the debug log
	// must record the outcome (technical-design.md §10).
	it.each([
		{ outcome: "kept-provisional", reply: titleKept, manifest: {} },
		{ outcome: "adopted-derived", reply: titleRejected, manifest: {} },
		{ outcome: "kept-user-title", reply: titleRejected, manifest: withUserTitle },
	])("should record $outcome in the debug log when that is how the title was decided", async (decided) => {
		stubContent(judgementReply(decided.reply));

		await run(decided.manifest);

		const [entry] = loggedAt({ entries: logged().entries, level: "debug" }).filter(
			(logEntry) => logEntry.message === "Decided lecture title",
		);
		expect(entry?.payload.outcome).toBe(decided.outcome);
	});

	it.each([
		{
			problem: "is not the documented JSON object",
			content: '{"judgedBecause":"x"}',
			manifest: {},
		},
		{
			problem: "gives a blank judgedBecause",
			content: judgementReply({ judgedBecause: " " }),
			manifest: {},
		},
		{
			problem: "judges the title not meaningful and proposes no title",
			content: judgementReply({ ...titleRejected, suggestedTitle: " " }),
			manifest: {},
		},
		{
			problem: "proposes a title that a filename cannot use",
			content: judgementReply({ ...titleRejected, suggestedTitle: ".." }),
			manifest: {},
		},
		{
			problem: "judges an empty provisional title meaningful",
			content: judgementReply(),
			manifest: { provisionalTitle: "" },
		},
	])("should resend the call and use the next reply when the reply $problem", async ({
		content,
		manifest,
	}) => {
		create().mockResolvedValueOnce(openRouterReplyBody({ content }));
		// A user title keeps the workspace where it is, whatever the next reply proposes.
		stubContent(judgementReply(titleRejected));

		await run({ ...manifest, ...withUserTitle });

		expect(create()).toHaveBeenCalledTimes(2);
		expect(await writtenJudgement()).toMatchObject({ outcome: "kept-user-title" });
	});

	it("should fail without writing the judgement when the third send is still unusable", {
		timeout: resendPausesTimeoutMs,
	}, async () => {
		stubContent(judgementReply({ judgedBecause: "" }));

		await expectResendsExhausted({ calls: 1 });
	});

	it.each(
		eachUnusableJsonFile([
			{ file: "retitled subtopics file", stageId: "retitle-subtopics" },
			{ file: "topics file", stageId: "group-into-topics" },
		] as const),
	)("should fail naming the file, without calling the model, when the $file is $state", async ({
		stageId,
		contents,
	}) => {
		const path = stageOutputPath({ workspaceRoot: workspaceRoot(), stageId });
		await spoilJsonFile({ path, contents });

		const error = await captureError(run());

		expect(error).toBeInstanceOf(JudgeLectureTitleError);
		expect(error.message).toContain(path);
		expect(create()).not.toHaveBeenCalled();
	});

	it.each(
		unusableTranscripts,
	)("should fail, without calling the model, when the transcript $state", async ({
		spoil,
		says,
	}) => {
		await spoil(workspaceRoot());

		const error = await captureError(run());

		expect(error).toBeInstanceOf(JudgeLectureTitleError);
		expect(error.message).toContain(says);
		expect(create()).not.toHaveBeenCalled();
	});

	it.each([
		{
			case: "an earlier run adopted a derived title",
			manifest: {
				aiDerivedTitle: aiDerivedLecture.title,
				lectureTitle: aiDerivedLecture.title,
				baseName: aiDerivedLecture.baseName,
			},
			identityChanges: {
				aiDerivedTitle: null,
				lectureTitle: testLecture.title,
				baseName: testLecture.baseName,
			},
		},
		{
			case: "a user title is set",
			manifest: { ...withUserTitle, aiDerivedTitle: aiDerivedLecture.title },
			identityChanges: { aiDerivedTitle: null },
		},
	])("should return the changes back to the provisional title when the outcome is kept-provisional and $case", async (earlier) => {
		const result = await run(earlier.manifest);

		expect(result.identityChanges).toStrictEqual(earlier.identityChanges);
	});

	it("should record no AI-derived title when the model judges the provisional title meaningful and still proposes one", async () => {
		stubContent(judgementReply({ suggestedTitle: aiDerivedLecture.title }));

		await run();

		expect(await writtenJudgement()).toMatchObject({
			aiDerivedTitle: null,
			outcome: "kept-provisional",
		});
	});
});
