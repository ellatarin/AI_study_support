/* jscpd:ignore-start -- sibling stage suites import the same fixtures and mock the
   same module, so their preambles match line for line. Neither half can move:
   imports cannot be shared and barrel files are forbidden (CLAUDE.md, File
   Organisation), and vi.mock is hoisted, so it must sit in the file that mocks.
   Only the preamble is exempt; the suite below is checked as normal. */
import { join } from "node:path";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	captureError,
	configuringStage,
	driveModelStage,
	earlierSavedRun,
	firstSavedRun,
	paddedTranscriptText,
	readSavedRunJson,
	seedStageOutput,
	sentUserMessage,
	stubbedCallCost,
	transcriptDivision,
	transcriptSecondStartWords,
	transcriptText,
	unusableTranscripts,
	useStubLogger,
	useTranscribedWorkspace,
} from "../../fixtures.js";
import { callModel } from "../../openrouter.js";
import {
	createInitialSubtopicSplittingStage,
	InitialSubtopicSplittingError,
} from "./initial-subtopic-splitting.js";

// Only the call is stubbed; everything else the module exports stays real.
vi.mock(import("../../openrouter.js"), async (importOriginal) => ({
	...(await importOriginal()),
	callModel: vi.fn(),
}));

const modelCallMock = callModel as unknown as Mock;
/* jscpd:ignore-end */

const STAGE_ID = "initial-subtopic-splitting";

/**
 * A reply dividing the fixture transcript as {@link transcriptDivision} does,
 * the second subtopic starting at `secondStartWords`.
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

/** Every run's model reply, when the model divides the transcript as intended. */
const GOOD_REPLY = splitReply({ secondStartWords: transcriptSecondStartWords });

/** How many runs the example config's panel holds. */
const PANEL_SIZE = configuringStage({ stageId: STAGE_ID }).subtopicSplitting.panelSize;

describe("createInitialSubtopicSplittingStage", () => {
	const workspace = useTranscribedWorkspace({ prefix: "initial-splitting-" });
	const logged = useStubLogger();
	const config = configuringStage({ stageId: STAGE_ID });

	/** The lecture workspace the current test is running against. */
	const workspaceRoot = (): string => workspace().workspaceRoot;

	beforeEach(() => {
		vi.clearAllMocks();
		modelCallMock.mockResolvedValue({ content: GOOD_REPLY, cost: stubbedCallCost });
	});

	/** Runs the stage against the prepared workspace, the way the runner would. */
	function run(): ReturnType<typeof driveModelStage> {
		return driveModelStage({
			factory: createInitialSubtopicSplittingStage,
			config,
			workspaceRoot: workspaceRoot(),
			logger: logged().logger,
		});
	}

	/** The saved run the stage wrote for run `runNumber`, parsed back off disk. */
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
		expect(sentUserMessage(modelCallMock.mock.calls)).toBe(`Transcript:\n${transcriptText}`);
	});

	it("should save every run of the panel with each subtopic's span, title and reason when the stage completes", async () => {
		await run();
		expect(modelCallMock).toHaveBeenCalledTimes(PANEL_SIZE);
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
		modelCallMock.mockResolvedValueOnce({ content, cost: stubbedCallCost });
		await run();
		expect(modelCallMock).toHaveBeenCalledTimes(PANEL_SIZE + 1);
		expect(await savedRun(1)).toHaveLength(2);
	});

	it("should make only the missing runs when an earlier invocation saved some", async () => {
		await leaveFirstRun(earlierSavedRun);
		await run();
		expect(modelCallMock).toHaveBeenCalledTimes(PANEL_SIZE - 1);
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
		expect(modelCallMock).not.toHaveBeenCalled();
	});
});
