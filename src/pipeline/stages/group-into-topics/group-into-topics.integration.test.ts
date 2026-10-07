import nock from "nock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineConfig } from "../../../types/pipeline.js";
import {
	driveModelStage,
	exampleStageConfig,
	makeStubLogger,
	openRouterReplyBody,
	openRouterUrls,
	resetStubbedApi,
	SETTLE_STEP_MS,
	settleThroughPauses,
	stubOpenRouterApi,
	useStageReadingDivision,
} from "../../fixtures.js";
import { createGroupIntoTopicsStage } from "./group-into-topics.js";

const STAGE_ID = "group-into-topics";

/** A usable grouping of the division of two subtopics: the whole lecture as one topic. */
const USABLE_ANSWER = JSON.stringify({
	topics: [{ label: "The lecture", groupedBecause: "It is one subject.", firstSubtopicId: 1 }],
});

/**
 * The reply to each send, in the order that the sends arrive. The first send
 * gets a provider error. The second send gets an answer with no topics. The
 * other sends get a usable answer. So the stage resends after the provider
 * error and after the answer with no topics.
 */
const REPLIES_BY_ARRIVAL: readonly Readonly<Record<string, unknown>>[] = [
	{ error: { message: "Upstream rate limit reached.", code: 429 } },
	openRouterReplyBody({ content: JSON.stringify({ topics: [] }) }),
];

/**
 * Stubs OpenRouter to reply to every send, and records the time of the fake
 * clock when each send arrives. The first sends get `firstReplies` in turn. The
 * other sends get a usable answer.
 *
 * @param firstReplies - The replies to the first sends, in the order that they arrive.
 * @returns The arrival times. The list fills as the sends arrive.
 */
function stubSendsArrivingAt(
	firstReplies: readonly Readonly<Record<string, unknown>>[],
): readonly number[] {
	const arrivals: number[] = [];
	nock(openRouterUrls.origin)
		.post(openRouterUrls.completions)
		.times(Number.POSITIVE_INFINITY)
		.reply(() => {
			arrivals.push(Date.now());
			return [
				200,
				firstReplies[arrivals.length - 1] ?? openRouterReplyBody({ content: USABLE_ANSWER }),
			];
		});
	return arrivals;
}

describe("group-into-topics sending", () => {
	const { config, workspaceRoot } = useStageReadingDivision({
		stageId: STAGE_ID,
		readsFrom: ["retitle-subtopics"],
		factory: createGroupIntoTopicsStage,
		// Each test stubs the network, not the model call.
		stubReply: () => undefined,
	});

	beforeEach(() => {
		stubOpenRouterApi();
		vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
	});

	afterEach(() => {
		vi.useRealTimers();
		resetStubbedApi();
	});

	/** Runs the stage with `stageConfig`, and moves the fake clock through every pause. */
	function runWith(stageConfig: PipelineConfig): ReturnType<typeof driveModelStage> {
		return settleThroughPauses(
			driveModelStage({
				factory: createGroupIntoTopicsStage,
				config: stageConfig,
				workspaceRoot: workspaceRoot(),
				logger: makeStubLogger().logger,
			}),
		);
	}

	it("should start no send until the gap has passed since the stage's previous send when sendGapSeconds is set", async () => {
		const arrivals = stubSendsArrivingAt(REPLIES_BY_ARRIVAL);
		const gapMs = (exampleStageConfig(STAGE_ID).sendGapSeconds ?? 0) * 1000;

		await runWith(config);

		expect(arrivals).toHaveLength(config.grouping.panelSize + REPLIES_BY_ARRIVAL.length);
		const gaps = arrivals.slice(1).map((arrival, index) => arrival - (arrivals[index] ?? 0));
		// The test records an arrival up to one clock step after its send starts.
		expect(Math.min(...gaps)).toBeGreaterThanOrEqual(gapMs - SETTLE_STEP_MS);
	});

	it("should not space sends when sendGapSeconds is unset", async () => {
		const arrivals = stubSendsArrivingAt([]);
		const unspaced: PipelineConfig = {
			...config,
			stages: {
				...config.stages,
				[STAGE_ID]: { ...exampleStageConfig(STAGE_ID), sendGapSeconds: undefined },
			},
		};

		await runWith(unspaced);

		expect(arrivals).toHaveLength(config.grouping.panelSize);
		// The stage releases the sends together, so they arrive within one clock step of each other.
		expect(Math.max(...arrivals) - Math.min(...arrivals)).toBeLessThanOrEqual(SETTLE_STEP_MS);
	});
});
