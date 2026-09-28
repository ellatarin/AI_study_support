/* jscpd:ignore-start -- sibling stage suites import the same fixtures and mock the
   same module, so their preambles match line for line. Neither half can move:
   imports cannot be shared and barrel files are forbidden (CLAUDE.md, File
   Organisation), and vi.mock is hoisted, so it must sit in the file that mocks.
   Only the preamble is exempt; the suite below is checked as normal. */
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StageCost } from "../../types/pipeline.js";
import {
	configuringStage,
	makeStageContext,
	openRouterClientFor,
	stubbedCostUsd,
	useStubLogger,
} from "../fixtures.js";
import { makeCompletionCall } from "../openrouter.js";
import { tryJsonReply } from "./model-stage.js";

// Only the call is stubbed; everything else the module exports stays real.
vi.mock(import("../openrouter.js"), async (importOriginal) => ({
	...(await importOriginal()),
	makeCompletionCall: vi.fn(),
}));

const completionMock = makeCompletionCall as unknown as Mock;
/* jscpd:ignore-end */

const STAGE_ID = "transcript-verification";

const COST: StageCost = {
	promptTokens: 1200,
	completionTokens: 300,
	callCount: 1,
	costUsd: stubbedCostUsd,
};

/** The reply the tests document: an object carrying a greeting. */
type Greeting = { readonly greeting: string };

describe("tryJsonReply", () => {
	const logged = useStubLogger();
	const config = configuringStage({ stageId: STAGE_ID });

	beforeEach(() => {
		vi.clearAllMocks();
	});

	/** Asks for a greeting, with the model answering `content`. */
	function ask(content: string): ReturnType<typeof tryJsonReply<Greeting>> {
		completionMock.mockResolvedValue({ content, cost: COST });
		return tryJsonReply<Greeting>({
			messages: [{ role: "user", content: "Say hello." }],
			stageId: STAGE_ID,
			context: makeStageContext({ workspaceRoot: "/lecture", config }),
			isReply: (value: unknown): value is Greeting =>
				typeof (value as Greeting | null)?.greeting === "string",
			documentedShape: "greeting",
			logger: logged().logger,
			client: openRouterClientFor({ config }),
		});
	}

	it("should hand back the reply and its cost when the reply is the documented shape", async () => {
		expect(await ask('{"greeting":"hello"}')).toEqual({ reply: { greeting: "hello" }, cost: COST });
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
		expect(await ask(content)).toEqual({ failure, cost: COST });
	});
});
