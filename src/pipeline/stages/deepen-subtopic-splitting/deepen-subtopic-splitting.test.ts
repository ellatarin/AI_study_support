/* jscpd:ignore-start -- sibling stage suites import the same fixtures and mock the
   same module, so their preambles match line for line. Neither half can move:
   imports cannot be shared and barrel files are forbidden (CLAUDE.md, File
   Organisation), and vi.mock is hoisted, so it must sit in the file that mocks.
   Only the preamble is exempt; the suite below is checked as normal. */
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StageConfig, StageCost } from "../../../types/pipeline.js";
import {
	captureError,
	configuringStage,
	driveModelStage,
	earlierSavedRun,
	joinedSubtopics,
	openRouterStageConfig,
	paddedTranscriptText,
	readSavedRunJson,
	savedRunPath,
	seedSavedRun,
	seedSavedRuns,
	seedStageOutput,
	stubbedCallCost,
	trackingInFlight,
	transcriptDivision,
	transcriptText,
	unusableTranscripts,
	useStubLogger,
	useTranscribedWorkspace,
	waitTurns,
} from "../../fixtures.js";
import { callModel } from "../../openrouter.js";
import { type Subtopic, subtopicText } from "../division.js";
import { ResendsExhaustedError } from "../panel-runs.js";
import {
	createDeepenSubtopicSplittingStage,
	DeepenSubtopicSplittingError,
} from "./deepen-subtopic-splitting.js";

// Only the call is stubbed; everything else the module exports stays real.
vi.mock(import("../../openrouter.js"), async (importOriginal) => ({
	...(await importOriginal()),
	callModel: vi.fn(),
}));

const modelCallMock = callModel as unknown as Mock;
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
 * A reply dividing the section at each of `startWords`.
 *
 * @param startWords - Where each new subtopic begins.
 * @returns The reply's JSON.
 */
function cutsAt(...startWords: readonly string[]): string {
	return JSON.stringify({
		verdict: "divides",
		cuts: startWords.map((words) => ({
			label: `From ${words}`,
			groupedBecause: "Its own step.",
			startsWith: words,
		})),
	});
}

/** Replies that cut the second subtopic in the first round and its head piece in the second. */
const CUTTING_BOTH_ROUNDS = { [SECOND]: cutsAt(SECOND_CUT), [SECOND_HEAD]: cutsAt(HEAD_CUT) };

/** What a call to the model is handed, as far as these tests read it. */
type SentRequest = { readonly messages: readonly { readonly content: string }[] };

/** The user message of every call made, in the order made. */
function sentMessages(): readonly string[] {
	return (modelCallMock.mock.calls as [SentRequest][]).map(
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

/**
 * Answers a call by the subtopic it sent: with the reply `replies` holds for
 * that subtopic, or "one step" when it holds none.
 *
 * @param replies - The reply for each subtopic, keyed by its text.
 * @returns The stand-in for the model call.
 */
function answerFrom(
	replies: Readonly<Record<string, string>>,
): (request: SentRequest) => Promise<{ readonly content: string; readonly cost: StageCost }> {
	return ({ messages }) =>
		Promise.resolve({
			content: replies[passageOf(messages[1]?.content ?? "")] ?? ONE_STEP,
			cost: stubbedCallCost,
		});
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

	/** Leaves the whole initial splitting panel on disk, every run holding `run`. */
	function seedSplittingRunsBeforeDeepening(run: unknown): Promise<void> {
		return seedSavedRuns({
			workspaceRoot: workspaceRoot(),
			stageId: "initial-subtopic-splitting",
			count: PANEL_SIZE,
			contents: () => run,
		});
	}

	beforeEach(async () => {
		vi.clearAllMocks();
		answering({});
		await seedSplittingRunsBeforeDeepening(transcriptDivision);
	});

	/** Answers every call as {@link answerFrom} does for `replies`. */
	function answering(replies: Readonly<Record<string, string>>): void {
		modelCallMock.mockImplementation(answerFrom(replies));
	}

	/**
	 * Runs the stage with a size gate of `sizeGateWords`, the way the runner
	 * would, with the example's tuning for the stage but for what `tuning` sets.
	 */
	function run({
		sizeGateWords,
		tuning = {},
	}: {
		readonly sizeGateWords: number;
		readonly tuning?: Partial<Pick<StageConfig, "concurrency" | "callConcurrency">>;
	}): ReturnType<typeof driveModelStage> {
		const configured = configuringStage({ stageId: STAGE_ID });
		return driveModelStage({
			factory: createDeepenSubtopicSplittingStage,
			config: {
				...configured,
				division: { ...configured.division, sizeGateWords },
				stages: { [STAGE_ID]: { ...openRouterStageConfig({ stageId: STAGE_ID }), ...tuning } },
			},
			workspaceRoot: workspaceRoot(),
			logger: logged().logger,
		});
	}

	/** The deepened splitting run the stage saved as run `runNumber`, parsed back off disk. */
	async function savedRun(runNumber: number): Promise<readonly Subtopic[]> {
		return (await readSavedRunJson({
			workspaceRoot: workspaceRoot(),
			stageId: STAGE_ID,
			runNumber,
		})) as readonly Subtopic[];
	}

	/** Where each subtopic of deepened splitting run `runNumber` starts. */
	async function savedStarts(runNumber: number): Promise<readonly number[]> {
		return (await savedRun(runNumber)).map((subtopic) => subtopic.start);
	}

	/** Where the subtopics start once {@link CUTTING_BOTH_ROUNDS} has cut in both rounds. */
	const CUT_IN_BOTH_ROUNDS = [0, at(SECOND), at(HEAD_CUT), at(SECOND_CUT)];

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
		expect(await savedRun(1)).toStrictEqual([
			opening,
			{ ...second, end: at(SECOND_CUT) },
			{
				start: at(SECOND_CUT),
				end: transcriptText.length,
				title: `From ${SECOND_CUT}`,
				why: "Its own step.",
			},
		]);
	});

	// Splitting runs saved while deepening marked inherited titles carry the mark.
	// They are still read, and the mark goes no further.
	it("should write no inherited-title mark when the splitting runs it reads carry one", async () => {
		await seedSplittingRunsBeforeDeepening(
			transcriptDivision.map((subtopic) => ({ ...subtopic, titleInherited: false })),
		);
		answering({ [SECOND]: cutsAt(SECOND_CUT) });
		await run(SECOND_ONLY);
		expect((await savedRun(1)).some((subtopic) => "titleInherited" in subtopic)).toBe(false);
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
		expect(modelCallMock).toHaveBeenCalledTimes(2 * PANEL_SIZE);
	});

	it("should stop after two rounds when a piece stays over the gate", async () => {
		answering(CUTTING_BOTH_ROUNDS);
		await run(ALMOST_EVERYTHING);
		expect(modelCallMock).toHaveBeenCalledTimes(5 * PANEL_SIZE);
		expect(await savedStarts(1)).toEqual(CUT_IN_BOTH_ROUNDS);
	});

	// One run at a time, so every call in flight is the same run's. The second
	// round of CUTTING_BOTH_ROUNDS sends three subtopics, the most sent together.
	it.each([
		{ setting: "unset", callConcurrency: undefined, expected: 1 },
		{ setting: "2", callConcurrency: 2, expected: 2 },
		{ setting: "above a round's subtopics", callConcurrency: 10, expected: 3 },
	])("should have at most $expected calls in flight in one run when callConcurrency is $setting", async ({
		callConcurrency,
		expected,
	}) => {
		const { tracked, peak } = trackingInFlight(answerFrom(CUTTING_BOTH_ROUNDS));
		modelCallMock.mockImplementation(tracked);
		await run({ ...ALMOST_EVERYTHING, tuning: { concurrency: 1, callConcurrency } });
		expect(peak()).toBe(expected);
	});

	it("should give the same deepened splitting run when the replies arrive out of order", async () => {
		const answer = answerFrom(CUTTING_BOTH_ROUNDS);
		let callsMade = 0;
		// Each call waits fewer turns than the one before it, so later calls answer first.
		modelCallMock.mockImplementation(async (request: SentRequest) => {
			callsMade += 1;
			await waitTurns({ turns: 100 - callsMade });
			return answer(request);
		});
		await run({ ...ALMOST_EVERYTHING, tuning: { concurrency: 1, callConcurrency: 10 } });
		expect(await savedStarts(1)).toEqual(CUT_IN_BOTH_ROUNDS);
	});

	it("should reproduce the transcript exactly when a deepened splitting run is joined", async () => {
		answering(CUTTING_BOTH_ROUNDS);
		await run(ALMOST_EVERYTHING);
		expect(joinedSubtopics({ text: transcriptText, subtopics: await savedRun(1) })).toBe(
			transcriptText,
		);
	});

	it("should record every saved deepened splitting run as written when the stage completes", async () => {
		const { filesWritten } = await run(SECOND_ONLY);
		expect(filesWritten).toHaveLength(PANEL_SIZE);
		expect(filesWritten[0]).toBe(join("Deepened subtopics", "run-01.json"));
	});

	it.each([
		{ problem: "is not an object", content: JSON.stringify("cuts") },
		{ problem: "holds no list of cuts", content: JSON.stringify({ cuts: "one" }) },
		{
			problem: "gives a cut without its start words",
			content: JSON.stringify({ cuts: [{ label: "Piece", groupedBecause: "Why." }] }),
		},
	])("should resend a subtopic when the reply $problem", async ({ content }) => {
		modelCallMock.mockResolvedValueOnce({ content, cost: stubbedCallCost });
		await run(SECOND_ONLY);
		expect(modelCallMock).toHaveBeenCalledTimes(PANEL_SIZE + 1);
	});

	it("should fail the stage without saving the run when a subtopic fails every send", {
		// Two real pauses, of two seconds and then four, come before the third send fails.
		timeout: 10_000,
	}, async () => {
		modelCallMock.mockResolvedValue({ content: "", cost: stubbedCallCost });
		expect(await captureError(run(SECOND_ONLY))).toBeInstanceOf(ResendsExhaustedError);
		await expect(
			readSavedRunJson({ workspaceRoot: workspaceRoot(), stageId: STAGE_ID, runNumber: 1 }),
		).rejects.toThrow();
	});

	it("should make only the missing runs when an earlier invocation saved some", async () => {
		await seedSavedRun({
			workspaceRoot: workspaceRoot(),
			stageId: STAGE_ID,
			runNumber: 1,
			contents: earlierSavedRun,
		});
		await run(SECOND_ONLY);
		expect(modelCallMock).toHaveBeenCalledTimes(PANEL_SIZE - 1);
		expect(await savedRun(1)).toEqual(earlierSavedRun);
	});

	it("should fail when a splitting run before deepening is missing", async () => {
		await rm(
			savedRunPath({
				workspaceRoot: workspaceRoot(),
				stageId: "initial-subtopic-splitting",
				runNumber: PANEL_SIZE,
			}),
		);
		expect(await captureError(run(SECOND_ONLY))).toBeInstanceOf(DeepenSubtopicSplittingError);
		expect(modelCallMock).not.toHaveBeenCalled();
	});

	it.each(unusableTranscripts)("should fail when the transcript is $state", async ({ spoil }) => {
		await spoil(workspaceRoot());
		expect(await captureError(run(SECOND_ONLY))).toBeInstanceOf(DeepenSubtopicSplittingError);
		expect(modelCallMock).not.toHaveBeenCalled();
	});
});
