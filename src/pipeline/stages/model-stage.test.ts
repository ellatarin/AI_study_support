/* jscpd:ignore-start -- the stage suites import the same fixtures and mock the
   same module, so their first lines are the same. The imports cannot be shared,
   because CLAUDE.md forbids barrel files (File Organisation). vi.mock is hoisted,
   so it must be in the file that mocks. Only these lines are exempt. jscpd checks
   the suite below as normal. */
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	configuringStage,
	makeStageContext,
	openRouterClientFor,
	stubbedCallCost,
	unspacedSends,
	useStubLogger,
} from "../fixtures.js";
import { callModel } from "../openrouter.js";
import {
	type JsonReplyRequest,
	promptMessages,
	tryJsonReply,
	tryJsonReplyAs,
} from "./model-stage.js";

// Only the model call is a stub. Everything else that the module exports is real.
vi.mock(import("../openrouter.js"), async (importOriginal) => ({
	...(await importOriginal()),
	callModel: vi.fn(),
}));

const modelCallMock = callModel as unknown as Mock;
/* jscpd:ignore-end */

const STAGE_ID = "transcript-verification";

/** The documented reply of the tests: an object with a greeting. */
type Greeting = { readonly greeting: string };

const logged = useStubLogger();
const config = configuringStage({ stageId: STAGE_ID });

beforeEach(() => {
	vi.clearAllMocks();
});

/** A request for a greeting. The model replies with `content`. */
function greetingRequest(content: string): JsonReplyRequest<Greeting> {
	modelCallMock.mockResolvedValue({ content, cost: stubbedCallCost });
	return {
		messages: promptMessages({ system: "Greet the user.", user: "Say hello." }),
		stageId: STAGE_ID,
		context: makeStageContext({ workspaceRoot: "/lecture", config }),
		isReply: (value: unknown): value is Greeting =>
			typeof (value as Greeting | null)?.greeting === "string",
		documentedShape: "greeting",
		logger: logged().logger,
		client: openRouterClientFor({ config }),
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
