/* jscpd:ignore-start -- the suites of sibling stages import the same fixtures
   and mock the same module. So their preambles are the same line for line.
   Imports cannot be shared, and CLAUDE.md (File Organisation) forbids barrel
   files. vi.mock is hoisted, so it must be in the file that mocks. Only the
   preamble is exempt. jscpd checks the suite below. */
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

// Only the model call is a stub. The other exports of the module stay real.
vi.mock(import("../../openrouter.js"), async (importOriginal) => ({
	...(await importOriginal()),
	callModel: vi.fn(),
}));

const modelCallMock = callModel as unknown as Mock;
/* jscpd:ignore-end */

const STAGE_ID = "deepen-subtopic-splitting";

/** The number of runs in the splitting panel of the example config. */
const PANEL_SIZE = configuringStage({ stageId: STAGE_ID }).subtopicSplitting.panelSize;

/** The heading that the user message puts before the subtopic. */
const SECTION_HEADING = "Section:\n";

/** The text of each subtopic of the fixture division: "Today we are covering " and the rest. */
const [OPENING = "", SECOND = ""] = transcriptDivision.map((subtopic) =>
	subtopicText({ text: transcriptText, subtopic }),
);

/** The start words of a first-round cut in the second subtopic, and the two pieces that it makes. */
const SECOND_CUT = "the immune system";
const SECOND_HEAD = SECOND.slice(0, SECOND.indexOf(SECOND_CUT));
const SECOND_TAIL = SECOND.slice(SECOND.indexOf(SECOND_CUT));

/** The start words of a second-round cut in the head piece. The new piece is "injury and ", two words. */
const HEAD_CUT = "injury and";

/** A reply that says the section is one step. */
const ONE_STEP = JSON.stringify({ verdict: "one step", cuts: [], heldBecause: "One thing." });

/**
 * A reply that cuts the section at each of `startWords`.
 *
 * @param startWords - The start words of each new subtopic.
 * @returns The JSON of the reply.
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

/** Replies that cut the second subtopic in the first round, and its head piece in the second round. */
const CUTTING_BOTH_ROUNDS = { [SECOND]: cutsAt(SECOND_CUT), [SECOND_HEAD]: cutsAt(HEAD_CUT) };

/** The part of a model call request that these tests read. */
type SentRequest = { readonly messages: readonly { readonly content: string }[] };

/** The user message of every call, in the order of the calls. */
function sentMessages(): readonly string[] {
	return (modelCallMock.mock.calls as [SentRequest][]).map(
		([{ messages }]) => messages[1]?.content ?? "",
	);
}

/**
 * Gets the subtopic from a user message.
 *
 * @param message - The user message.
 * @returns The message without its heading.
 */
function passageOf(message: string): string {
	return message.slice(SECTION_HEADING.length);
}

/** The subtopic of each call, in the order of the calls. */
function sentPassages(): readonly string[] {
	return sentMessages().map(passageOf);
}

/**
 * Replies to a call with the reply in `replies` for the subtopic of the call.
 * If `replies` has no reply for the subtopic, the reply is "one step".
 *
 * @param replies - The reply for each subtopic, keyed by the text of the subtopic.
 * @returns The stub for the model call.
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

/** The position of `phrase` in the fixture transcript. */
function at(phrase: string): number {
	return transcriptText.indexOf(phrase);
}

describe("createDeepenSubtopicSplittingStage", () => {
	const workspace = useTranscribedWorkspace({ prefix: "deepen-splitting-" });
	const logged = useStubLogger();

	/** The workspace of the current test. */
	const workspaceRoot = (): string => workspace().workspaceRoot;

	/** Writes the whole initial splitting panel to disk. Each saved run holds `run`. */
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

	/** Replies to every call as {@link answerFrom} does for `replies`. */
	function answering(replies: Readonly<Record<string, string>>): void {
		modelCallMock.mockImplementation(answerFrom(replies));
	}

	/**
	 * Runs the stage as the runner does, with a size gate of `sizeGateWords`. The
	 * tuning of the stage is from the example config, except the fields that `tuning` sets.
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
				subtopicSplitting: { ...configured.subtopicSplitting, sizeGateWords },
				stages: { [STAGE_ID]: { ...openRouterStageConfig({ stageId: STAGE_ID }), ...tuning } },
			},
			workspaceRoot: workspaceRoot(),
			logger: logged().logger,
		});
	}

	/** The deepened splitting run with the number `runNumber`, parsed from disk. */
	async function savedRun(runNumber: number): Promise<readonly Subtopic[]> {
		return (await readSavedRunJson({
			workspaceRoot: workspaceRoot(),
			stageId: STAGE_ID,
			runNumber,
		})) as readonly Subtopic[];
	}

	/** The start of each subtopic of the deepened splitting run with the number `runNumber`. */
	async function savedStarts(runNumber: number): Promise<readonly number[]> {
		return (await savedRun(runNumber)).map((subtopic) => subtopic.start);
	}

	/** The start of each subtopic after {@link CUTTING_BOTH_ROUNDS} cuts in both deepening rounds. */
	const CUT_IN_BOTH_ROUNDS = [0, at(SECOND), at(HEAD_CUT), at(SECOND_CUT)];

	/** A size gate that only the second subtopic is above, with its six words. The pieces of the second subtopic are not above the size gate. */
	const SECOND_ONLY = { sizeGateWords: 4 };

	/** A size gate that each subtopic and piece of more than one word is above. */
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
				reason: "Its own step.",
			},
		]);
	});

	it("should ignore a cut proposed outside its subtopic when the reply places one there", async () => {
		answering({ [SECOND]: cutsAt(OPENING.trim()) });
		await run(SECOND_ONLY);
		expect(await savedRun(1)).toEqual(transcriptDivision);
	});

	it("should send every subtopic still over the size gate again when the first round cut anything", async () => {
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

	it("should stop after two rounds when a piece stays over the size gate", async () => {
		answering(CUTTING_BOTH_ROUNDS);
		await run(ALMOST_EVERYTHING);
		expect(modelCallMock).toHaveBeenCalledTimes(5 * PANEL_SIZE);
		expect(await savedStarts(1)).toEqual(CUT_IN_BOTH_ROUNDS);
	});

	// These tests set `concurrency` to 1, so the stage makes one splitting run at a
	// time and all calls in flight are from one run. The largest round is the second round of CUTTING_BOTH_ROUNDS, with three subtopics.
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
		// Each call waits fewer turns than the call before it, so later calls get their reply first.
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

	it("should record every saved deepened splitting run in the manifest as one of the stage's recorded files when the stage completes", async () => {
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
		// Two real pauses, of two seconds and then four seconds, come before the third send.
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
