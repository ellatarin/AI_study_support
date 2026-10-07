import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	captureError,
	configuringStage,
	loggedAt,
	makeStageContext,
	openRouterReplyBody,
	stubbedCallCost,
	stubbedCallsCost,
	unspacedSends,
	useStubbedOpenRouter,
	useStubLogger,
} from "../fixtures.js";
import {
	type JsonReplyOutcome,
	type JsonReplyRequest,
	promptMessages,
	ResendsExhaustedError,
	sendWithResends,
	tryJsonReply,
	tryJsonReplyAs,
} from "./model-stage.js";

const STAGE_ID = "transcript-verification";

/** The documented reply of the tests: an object with a greeting. */
type Greeting = { readonly greeting: string };

const logged = useStubLogger();
const config = configuringStage({ stageId: STAGE_ID });
const { client, create } = useStubbedOpenRouter();

/** A request for a greeting. The model replies with `content`. */
function greetingRequest(content: string): JsonReplyRequest<Greeting> {
	create().mockResolvedValue(openRouterReplyBody({ content }));
	return {
		messages: promptMessages({ system: "Greet the user.", user: "Say hello." }),
		stageId: STAGE_ID,
		context: makeStageContext({ workspaceRoot: "/lecture", config }),
		isReply: (value: unknown): value is Greeting =>
			typeof (value as Greeting | null)?.greeting === "string",
		documentedShape: "greeting",
		logger: logged().logger,
		client: client(),
		sendGate: unspacedSends,
	};
}

describe("promptMessages", () => {
	it("should put the prompt first and the material second when the messages are built", () => {
		expect(promptMessages({ system: "Rules.", user: "Material." })).toEqual([
			{ role: "system", content: "Rules." },
			{ role: "user", content: "Material." },
		]);
	});
});

describe("tryJsonReplyAs", () => {
	/** Asks for a greeting and keeps its length. An empty greeting is unusable. */
	function askForLength(content: string): ReturnType<typeof tryJsonReplyAs<Greeting, number>> {
		return tryJsonReplyAs<Greeting, number>({
			...greetingRequest(content),
			use: ({ greeting }) =>
				greeting === "" ? { failure: "No greeting" } : { reply: greeting.length },
		});
	}

	it("should hand back what the stage keeps and the call's cost when the reply is usable", async () => {
		expect(await askForLength('{"greeting":"hello"}')).toEqual({
			reply: 5,
			cost: stubbedCallCost,
		});
	});

	it.each([
		{ label: "not the documented shape", content: '{"farewell":"bye"}' },
		{ label: "refused by the stage", content: '{"greeting":""}' },
	])("should give a failure and the call's cost when the reply is $label", async ({ content }) => {
		expect(await askForLength(content)).toEqual({
			failure: expect.any(String),
			cost: stubbedCallCost,
		});
	});
});

describe("tryJsonReply", () => {
	/** Asks for a greeting. The model replies with `content`. */
	function ask(content: string): ReturnType<typeof tryJsonReply<Greeting>> {
		return tryJsonReply(greetingRequest(content));
	}

	it("should hand back the reply and its cost when the reply is the documented shape", async () => {
		expect(await ask('{"greeting":"hello"}')).toEqual({
			reply: { greeting: "hello" },
			cost: stubbedCallCost,
		});
	});

	it.each([
		{ label: "empty", content: "", failure: "The model's reply was empty" },
		{
			label: "not JSON",
			content: "Hello there.",
			failure: expect.stringContaining("The model answered with something other than JSON"),
		},
		{
			label: "not the documented shape",
			content: '{"farewell":"bye"}',
			failure: "The model's reply is not the documented greeting",
		},
	])("should give the reason and the call's cost when the reply is $label", async ({
		content,
		failure,
	}) => {
		expect(await ask(content)).toEqual({ failure, cost: stubbedCallCost });
	});
});

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

/** A send that gives each outcome in turn, one for each call. */
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
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	/** Sends `send` with the name `what`, and logs to the stub logger of the test. */
	function resending({
		send,
		what = "run 1",
	}: {
		readonly send: () => Promise<JsonReplyOutcome<typeof REPLY>>;
		readonly what?: string;
	}): ReturnType<typeof sendWithResends<typeof REPLY>> {
		return sendWithResends({ send, what, logger: logged().logger });
	}

	/** Waits for the sends to end. The fake clock runs through the pauses. */
	async function settle<TResult>(pending: Promise<TResult>): Promise<TResult> {
		await vi.runAllTimersAsync();
		return pending;
	}

	/**
	 * The error that a send ends in. It is caught before the clock runs, because a
	 * rejection that nothing waits on is reported as unhandled.
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
