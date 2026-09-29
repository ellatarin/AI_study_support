/* jscpd:ignore-start -- sibling stage suites import the same fixtures and mock the
   same module, so their preambles match line for line. Neither half can move:
   imports cannot be shared and barrel files are forbidden (CLAUDE.md, File
   Organisation), and vi.mock is hoisted, so it must sit in the file that mocks.
   Only the preamble is exempt; the suite below is checked as normal. */
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	captureError,
	configuringStage,
	driveModelStage,
	earlierLaunchRun,
	joinedSubtopics,
	paddedTranscriptText,
	panelRunPath,
	readPanelRun,
	seedPanelRun,
	seedStageOutput,
	stubbedCallCost,
	transcriptDivision,
	transcriptText,
	unusableTranscripts,
	useStubLogger,
	useTranscribedWorkspace,
} from "../../fixtures.js";
import { makeCompletionCall } from "../../openrouter.js";
import { type Subtopic, subtopicText } from "../division.js";
import { ResendsExhaustedError } from "../panel-runs.js";
import {
	createDeepenSubtopicSplittingStage,
	DeepenSubtopicSplittingError,
} from "./deepen-subtopic-splitting.js";

// Only the call is stubbed; everything else the module exports stays real.
vi.mock(import("../../openrouter.js"), async (importOriginal) => ({
	...(await importOriginal()),
	makeCompletionCall: vi.fn(),
}));

const completionMock = makeCompletionCall as unknown as Mock;
/* jscpd:ignore-end */

const STAGE_ID = "deepen-subtopic-splitting";

/** How many runs the example config's panel holds. */
const PANEL_SIZE = configuringStage({ stageId: STAGE_ID }).division.panelSize;

/** What the user message puts before the subtopic it sends. */
const SECTION_HEADING = "Section:\n";

/** The fixture division's subtopics, as text: "Today we are covering " and the rest. */
const [OPENING = "", SECOND = ""] = transcriptDivision.map((subtopic) =>
	subtopicText({ text: transcriptText, subtopic }),
);

/** Where a first-round cut divides the second subtopic, and the two pieces it leaves. */
const SECOND_CUT = "the immune system";
const SECOND_HEAD = SECOND.slice(0, SECOND.indexOf(SECOND_CUT));
const SECOND_TAIL = SECOND.slice(SECOND.indexOf(SECOND_CUT));

/** Where a second-round cut divides the head piece; it leaves "injury and ", two words. */
const HEAD_CUT = "injury and";

/** A reply saying the section is one step. */
const ONE_STEP = JSON.stringify({ verdict: "one step", cuts: [], heldBecause: "One thing." });

/**
 * A reply dividing the section at each of `quotes`.
 *
 * @param quotes - Where each new subtopic begins.
 * @returns The reply's JSON.
 */
function cutsAt(...quotes: readonly string[]): string {
	return JSON.stringify({
		verdict: "divides",
		cuts: quotes.map((quote) => ({
			label: `From ${quote}`,
			groupedBecause: "Its own step.",
			startsWith: quote,
		})),
	});
}

/** Replies that cut the second subtopic in the first round and its head piece in the second. */
const CUTTING_BOTH_ROUNDS = { [SECOND]: cutsAt(SECOND_CUT), [SECOND_HEAD]: cutsAt(HEAD_CUT) };

/** What a call to the model is handed, as far as these tests read it. */
type SentRequest = { readonly messages: readonly { readonly content: string }[] };

/** The user message of every call made, in the order made. */
function sentMessages(): readonly string[] {
	return (completionMock.mock.calls as [SentRequest][]).map(
		([{ messages }]) => messages[1]?.content ?? "",
	);
}

/**
 * The subtopic a user message sends.
 *
 * @param message - The user message.
 * @returns The message without its heading.
 */
function passageOf(message: string): string {
	return message.slice(SECTION_HEADING.length);
}

/** The subtopic each call sent, in the order sent. */
function sentPassages(): readonly string[] {
	return sentMessages().map(passageOf);
}

/** Where `phrase` begins in the fixture transcript. */
function at(phrase: string): number {
	return transcriptText.indexOf(phrase);
}

describe("createDeepenSubtopicSplittingStage", () => {
	const workspace = useTranscribedWorkspace({ prefix: "deepen-splitting-" });
	const logged = useStubLogger();

	/** The lecture workspace the current test is running against. */
	const workspaceRoot = (): string => workspace().workspaceRoot;

	beforeEach(async () => {
		vi.clearAllMocks();
		answering({});
		for (let runNumber = 1; runNumber <= PANEL_SIZE; runNumber += 1) {
			await seedPanelRun({
				workspaceRoot: workspaceRoot(),
				stageId: "initial-subtopic-splitting",
				runNumber,
				contents: transcriptDivision,
			});
		}
	});

	/**
	 * Answers each call by the subtopic it sent: with the reply `replies` holds
	 * for that subtopic, or "one step" when it holds none.
	 */
	function answering(replies: Readonly<Record<string, string>>): void {
		completionMock.mockImplementation(({ messages }: SentRequest) =>
			Promise.resolve({
				content: replies[passageOf(messages[1]?.content ?? "")] ?? ONE_STEP,
				cost: stubbedCallCost,
			}),
		);
	}

	/** Runs the stage with a size gate of `sizeGateWords`, the way the runner would. */
	function run({
		sizeGateWords,
	}: {
		readonly sizeGateWords: number;
	}): ReturnType<typeof driveModelStage> {
		const configured = configuringStage({ stageId: STAGE_ID });
		return driveModelStage({
			factory: createDeepenSubtopicSplittingStage,
			config: { ...configured, division: { ...configured.division, sizeGateWords } },
			workspaceRoot: workspaceRoot(),
			logger: logged().logger,
		});
	}

	/** The deepened run the stage saved for run `runNumber`, parsed back off disk. */
	async function savedRun(runNumber: number): Promise<readonly Subtopic[]> {
		return (await readPanelRun({
			workspaceRoot: workspaceRoot(),
			stageId: STAGE_ID,
			runNumber,
		})) as readonly Subtopic[];
	}

	/** A gate only the second subtopic's six words are over; its pieces are not. */
	const SECOND_ONLY = { sizeGateWords: 4 };

	/** A gate every subtopic and every piece of more than one word is over. */
	const ALMOST_EVERYTHING = { sizeGateWords: 1 };

	it("should send only the subtopics over the size gate when a run is deepened", async () => {
		await run(SECOND_ONLY);
		expect(sentMessages()).toEqual(Array(PANEL_SIZE).fill(`${SECTION_HEADING}${SECOND}`));
	});

	it("should cut the transcript without its surrounding whitespace when a run is deepened", async () => {
		await seedStageOutput({
			workspaceRoot: workspaceRoot(),
			stageId: "transcription",
			contents: paddedTranscriptText,
		});
		await run(SECOND_ONLY);
		expect(sentPassages()[0]).toBe(SECOND);
	});

	it("should leave a subtopic unchanged when the reply says it is one step", async () => {
		await run(SECOND_ONLY);
		expect(await savedRun(1)).toEqual(transcriptDivision);
	});

	it("should add the cuts inside the subtopic when the reply divides it", async () => {
		answering({ [SECOND]: cutsAt(SECOND_CUT) });
		await run(SECOND_ONLY);
		const [opening, second] = transcriptDivision;
		expect(await savedRun(1)).toEqual([
			opening,
			{ ...second, end: at(SECOND_CUT) },
			{
				start: at(SECOND_CUT),
				end: transcriptText.length,
				label: `From ${SECOND_CUT}`,
				why: "Its own step.",
			},
		]);
	});

	it("should ignore a cut proposed outside its subtopic when the reply places one there", async () => {
		answering({ [SECOND]: cutsAt(OPENING.trim()) });
		await run(SECOND_ONLY);
		expect(await savedRun(1)).toEqual(transcriptDivision);
	});

	it("should send every subtopic still over the gate again when the first round cut anything", async () => {
		answering({ [SECOND]: cutsAt(SECOND_CUT) });
		await run(ALMOST_EVERYTHING);
		expect(sentPassages().slice(0, 5)).toEqual([
			OPENING,
			SECOND,
			OPENING,
			SECOND_HEAD,
			SECOND_TAIL,
		]);
	});

	it("should make no second round when the first round cut nothing", async () => {
		await run(ALMOST_EVERYTHING);
		expect(completionMock).toHaveBeenCalledTimes(2 * PANEL_SIZE);
	});

	it("should stop after two rounds when a piece stays over the gate", async () => {
		answering(CUTTING_BOTH_ROUNDS);
		await run(ALMOST_EVERYTHING);
		expect(completionMock).toHaveBeenCalledTimes(5 * PANEL_SIZE);
		expect((await savedRun(1)).map((subtopic) => subtopic.start)).toEqual([
			0,
			at(SECOND),
			at(HEAD_CUT),
			at(SECOND_CUT),
		]);
	});

	it("should reproduce the transcript exactly when a deepened run is joined", async () => {
		answering(CUTTING_BOTH_ROUNDS);
		await run(ALMOST_EVERYTHING);
		expect(joinedSubtopics({ text: transcriptText, subtopics: await savedRun(1) })).toBe(
			transcriptText,
		);
	});

	it("should record every deepened run file as written when the stage completes", async () => {
		const { filesWritten } = await run(SECOND_ONLY);
		expect(filesWritten).toHaveLength(PANEL_SIZE);
		expect(filesWritten[0]).toBe(join("Deepened subtopics", "run-01.json"));
	});

	it.each([
		{ problem: "is not an object", content: JSON.stringify("cuts") },
		{ problem: "holds no list of cuts", content: JSON.stringify({ cuts: "one" }) },
		{
			problem: "gives a cut without its opening words",
			content: JSON.stringify({ cuts: [{ label: "Piece", groupedBecause: "Why." }] }),
		},
	])("should resend a subtopic when the reply $problem", async ({ content }) => {
		completionMock.mockResolvedValueOnce({ content, cost: stubbedCallCost });
		await run(SECOND_ONLY);
		expect(completionMock).toHaveBeenCalledTimes(PANEL_SIZE + 1);
	});

	it("should fail the stage without saving the run when a subtopic fails every send", {
		// Two real pauses, of two seconds and then four, come before the third send fails.
		timeout: 10_000,
	}, async () => {
		completionMock.mockResolvedValue({ content: "", cost: stubbedCallCost });
		expect(await captureError(run(SECOND_ONLY))).toBeInstanceOf(ResendsExhaustedError);
		await expect(
			readPanelRun({ workspaceRoot: workspaceRoot(), stageId: STAGE_ID, runNumber: 1 }),
		).rejects.toThrow();
	});

	it("should make only the missing runs when an earlier launch saved some", async () => {
		await seedPanelRun({
			workspaceRoot: workspaceRoot(),
			stageId: STAGE_ID,
			runNumber: 1,
			contents: earlierLaunchRun,
		});
		await run(SECOND_ONLY);
		expect(completionMock).toHaveBeenCalledTimes(PANEL_SIZE - 1);
		expect(await savedRun(1)).toEqual(earlierLaunchRun);
	});

	it("should fail when an initial splitting run is missing", async () => {
		await rm(
			panelRunPath({
				workspaceRoot: workspaceRoot(),
				stageId: "initial-subtopic-splitting",
				runNumber: PANEL_SIZE,
			}),
		);
		expect(await captureError(run(SECOND_ONLY))).toBeInstanceOf(DeepenSubtopicSplittingError);
		expect(completionMock).not.toHaveBeenCalled();
	});

	it.each(unusableTranscripts)("should fail when the transcript is $state", async ({ spoil }) => {
		await spoil(workspaceRoot());
		expect(await captureError(run(SECOND_ONLY))).toBeInstanceOf(DeepenSubtopicSplittingError);
		expect(completionMock).not.toHaveBeenCalled();
	});
});
