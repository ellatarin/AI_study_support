import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	captureError,
	loggedAt,
	stubbedCallCost,
	stubbedCallsCost,
	useStubLogger,
} from "../fixtures.js";
import type { JsonReplyOutcome } from "./model-stage.js";
import { ResendsExhaustedError, sendWithResends } from "./panel-runs.js";

// Every send costs one stubbed call, whether its reply was usable or not.
const REPLY = { answer: 42 } as const;
const GOOD: JsonReplyOutcome<typeof REPLY> = { reply: REPLY, cost: stubbedCallCost };
const EMPTY: JsonReplyOutcome<typeof REPLY> = {
	failure: "The model's reply was empty",
	cost: stubbedCallCost,
};
const PROSE: JsonReplyOutcome<typeof REPLY> = {
	failure: "The model answered with something other than JSON",
	cost: stubbedCallCost,
};

/** A send that answers with each outcome in turn, one per call. */
function sendAnswering(
	...outcomes: readonly JsonReplyOutcome<typeof REPLY>[]
): ReturnType<typeof vi.fn<() => Promise<JsonReplyOutcome<typeof REPLY>>>> {
	const send = vi.fn<() => Promise<JsonReplyOutcome<typeof REPLY>>>();
	for (const outcome of outcomes) {
		send.mockResolvedValueOnce(outcome);
	}
	return send;
}

describe("sendWithResends", () => {
	const logged = useStubLogger();

	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	/** Sends `send` as `what`, logging to the test's stub logger. */
	function resending({
		send,
		what = "run 1",
	}: {
		readonly send: () => Promise<JsonReplyOutcome<typeof REPLY>>;
		readonly what?: string;
	}): ReturnType<typeof sendWithResends<typeof REPLY>> {
		return sendWithResends({ send, what, logger: logged().logger });
	}

	/** Sends through the pauses, which the fake clock runs straight through. */
	async function settle<TResult>(pending: Promise<TResult>): Promise<TResult> {
		await vi.runAllTimersAsync();
		return pending;
	}

	/**
	 * The error a send ends in, caught before the clock runs: a rejection that
	 * happens while nothing is yet waiting on it is reported as unhandled.
	 */
	async function failureOf(pending: Promise<unknown>): Promise<Error> {
		const caught = captureError(pending);
		await vi.runAllTimersAsync();
		return caught;
	}

	it("should return the reply and one send's cost when the first send succeeds", async () => {
		const send = sendAnswering(GOOD);
		expect(await settle(resending({ send }))).toEqual({
			reply: REPLY,
			cost: stubbedCallsCost({ calls: 1 }),
		});
		expect(send).toHaveBeenCalledTimes(1);
	});

	it("should keep the reply and count every send's cost when two sends fail first", async () => {
		const send = sendAnswering(EMPTY, PROSE, GOOD);
		expect(await settle(resending({ send }))).toEqual({
			reply: REPLY,
			cost: stubbedCallsCost({ calls: 3 }),
		});
	});

	it("should log each unusable reply with what was sent, which send it was and why when sends fail", async () => {
		await settle(resending({ send: sendAnswering(EMPTY, PROSE, GOOD), what: "run 2" }));
		expect(
			loggedAt({ entries: logged().entries, level: "warn" }).map((entry) => entry.payload),
		).toEqual([
			{ what: "run 2", send: 1, reason: EMPTY.failure },
			{ what: "run 2", send: 2, reason: PROSE.failure },
		]);
	});

	it("should fail naming what was sent and the last reason when all three sends fail", async () => {
		const send = sendAnswering(EMPTY, EMPTY, PROSE);
		const error = await failureOf(resending({ send, what: "run 4" }));
		expect(error).toBeInstanceOf(ResendsExhaustedError);
		expect(error.message).toBe(
			"run 4 failed after 3 sends: The model answered with something other than JSON",
		);
	});

	it("should wait two seconds and then four before the second and third sends when sends keep failing", async () => {
		const send = sendAnswering(EMPTY, EMPTY, GOOD);
		const pending = resending({ send });

		await vi.advanceTimersByTimeAsync(1999);
		expect(send).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(send).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(3999);
		expect(send).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(1);
		expect(send).toHaveBeenCalledTimes(3);
		await pending;
	});

	it("should let an error from the call itself through without resending when the call throws", async () => {
		const refused = new Error("context length exceeded");
		const send = vi.fn<() => Promise<JsonReplyOutcome<typeof REPLY>>>().mockRejectedValue(refused);
		expect(await failureOf(resending({ send }))).toBe(refused);
		expect(send).toHaveBeenCalledTimes(1);
	});
});
