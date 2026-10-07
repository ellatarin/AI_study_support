import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
	captureError,
	configuringStage,
	driveModelStage,
	earlierSavedRun,
	firstSavedRun,
	openRouterReplyBody,
	paddedTranscriptText,
	readSavedRunJson,
	seedStageOutput,
	sentUserMessage,
	transcriptDivision,
	transcriptSecondStartWords,
	transcriptText,
	unusableTranscripts,
	useStubbedOpenRouter,
	useStubLogger,
	useTranscribedWorkspace,
} from "../../fixtures.js";
import {
	createInitialSubtopicSplittingStage,
	InitialSubtopicSplittingError,
} from "./initial-subtopic-splitting.js";

const STAGE_ID = "initial-subtopic-splitting";

/**
 * A reply that divides the fixture transcript as {@link transcriptDivision} does.
 * The second subtopic starts at `secondStartWords`.
 */
function splitReply({ secondStartWords }: { readonly secondStartWords: string }): string {
	const startWords = ["Today we are covering", secondStartWords];
	return JSON.stringify({
		subtopics: transcriptDivision.map((subtopic, index) => ({
			id: index + 1,
			label: subtopic.title,
			groupedBecause: subtopic.reason,
			startsWith: startWords[index],
		})),
	});
}

/** The reply to every run when the model divides the transcript as {@link transcriptDivision} does. */
const GOOD_REPLY = splitReply({ secondStartWords: transcriptSecondStartWords });

/** The number of runs in the splitting panel of the example config. */
const PANEL_SIZE = configuringStage({ stageId: STAGE_ID }).subtopicSplitting.panelSize;

describe("createInitialSubtopicSplittingStage", () => {
	const workspace = useTranscribedWorkspace({ prefix: "initial-splitting-" });
	const logged = useStubLogger();
	const config = configuringStage({ stageId: STAGE_ID });
	const { client, create } = useStubbedOpenRouter();

	/** The workspace of the current test. */
	const workspaceRoot = (): string => workspace().workspaceRoot;

	beforeEach(() => {
		create().mockResolvedValue(openRouterReplyBody({ content: GOOD_REPLY }));
	});

	/** Runs the stage on the prepared workspace, as the runner does. */
	function run(): ReturnType<typeof driveModelStage> {
		return driveModelStage({
			factory: createInitialSubtopicSplittingStage,
			client: client(),
			config,
			workspaceRoot: workspaceRoot(),
			logger: logged().logger,
		});
	}

	/** The saved run with the number `runNumber`, parsed from disk. */
	function savedRun(runNumber: number): Promise<unknown> {
		return readSavedRunJson({ workspaceRoot: workspaceRoot(), stageId: STAGE_ID, runNumber });
	}

	const { leaveFirstRun, expectUnreadableFirstRun } = firstSavedRun({
		workspaceRoot,
		stageId: STAGE_ID,
		run,
	});

	it("should send the transcript without its surrounding whitespace when a run is made", async () => {
		await seedStageOutput({
			workspaceRoot: workspaceRoot(),
			stageId: "transcription",
			contents: paddedTranscriptText,
		});
		await run();
		expect(sentUserMessage(create().mock.calls)).toBe(`Transcript:\n${transcriptText}`);
	});

	it("should save every run of the panel with each subtopic's span, title and reason when the stage completes", async () => {
		await run();
		expect(create()).toHaveBeenCalledTimes(PANEL_SIZE);
		expect(await savedRun(1)).toEqual(transcriptDivision);
		expect(await savedRun(PANEL_SIZE)).toEqual(transcriptDivision);
	});

	it("should record every saved run in the manifest as one of the stage's recorded files when the stage completes", async () => {
		const { filesWritten } = await run();
		expect(filesWritten).toHaveLength(PANEL_SIZE);
		expect(filesWritten[0]).toBe(join("Initial subtopics", "run-01.json"));
	});

	it.each([
		{
			problem: "gives start words the transcript does not contain",
			content: splitReply({ secondStartWords: "mitochondria are the powerhouse" }),
		},
		{ problem: "is not an object", content: JSON.stringify("subtopics") },
		{ problem: "holds no list of subtopics", content: JSON.stringify({ subtopics: "one" }) },
		{ problem: "holds an empty list", content: JSON.stringify({ subtopics: [] }) },
		{
			problem: "gives a subtopic without its start words",
			content: JSON.stringify({ subtopics: [{ label: "Opening", groupedBecause: "Why." }] }),
		},
	])("should resend a run when the reply $problem", async ({ content }) => {
		create().mockResolvedValueOnce(openRouterReplyBody({ content }));
		await run();
		expect(create()).toHaveBeenCalledTimes(PANEL_SIZE + 1);
		expect(await savedRun(1)).toHaveLength(2);
	});

	it("should make only the missing runs when an earlier invocation saved some", async () => {
		await leaveFirstRun(earlierSavedRun);
		await run();
		expect(create()).toHaveBeenCalledTimes(PANEL_SIZE - 1);
		expect(await savedRun(1)).toEqual(earlierSavedRun);
	});

	it.each([
		{ problem: "not a list", contents: { start: 0 } },
		{ problem: "a subtopic without its reason", contents: [{ start: 0, end: 1, title: "T" }] },
		{
			problem: "a subtopic named by a label, as saved before titles",
			contents: [{ start: 0, end: 1, label: "L", reason: "W" }],
		},
	])("should fail when a saved run holds $problem", ({ contents }) =>
		expectUnreadableFirstRun(contents));

	it.each(unusableTranscripts)("should fail when the transcript is $state", async ({ spoil }) => {
		await spoil(workspaceRoot());
		expect(await captureError(run())).toBeInstanceOf(InitialSubtopicSplittingError);
		expect(create()).not.toHaveBeenCalled();
	});
});
