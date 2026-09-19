import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { type DeepenResult, deepenDivision, type Section } from "./deepen-division.mts";
import type { TrialMessage, TrialReply } from "./trial-model.mts";

/** Small enough that a sentence or two crosses it, so the passages stay readable. */
const GATE_WORDS = 5;

/** The prompt text is not under test; only that a call carries the section. */
const SYSTEM_PROMPT = "divide this section";

/** Tokens every faked reply reports, so the tally has something to add up. */
const PROMPT_TOKENS = 100;
const COMPLETION_TOKENS = 20;

/** Eight words: over the gate whole, under it once divided at `SECOND_HALF`. */
const EIGHT_WORDS = "Cells divide quickly here. Then tumours invade tissue. ";
const SECOND_HALF = "Then tumours invade tissue";

/** Three words, never sent. */
const SHORT = "A brief aside. ";

/** A reply as the model call reports one. */
function replyWith(content: string): TrialReply {
	return {
		content,
		promptTokens: PROMPT_TOKENS,
		completionTokens: COMPLETION_TOKENS,
		finishReason: "stop",
		nativeFinishReason: "stop",
		provider: "fake",
	};
}

/** A reply proposing cuts at each quoted opening. */
function cutsAt(...openings: readonly string[]): TrialReply {
	return replyWith(
		JSON.stringify({
			cuts: openings.map((opening) => ({
				label: `from ${opening}`,
				groupedBecause: `why ${opening}`,
				startsWith: opening,
			})),
		}),
	);
}

/** A reply saying the section is one step. */
const ONE_STEP = replyWith(JSON.stringify({ verdict: "one step", cuts: [] }));

/**
 * The transcript made by joining the passages, and one section per passage.
 *
 * @param passages - The sections' texts, in transcript order.
 * @returns The transcript and its division.
 */
function divisionOf(passages: readonly string[]): {
	readonly transcriptText: string;
	readonly sections: readonly Section[];
} {
	let offset = 0;
	const sections = passages.map((passage, index) => {
		const from = offset;
		offset += passage.length;
		return { label: `section ${index}`, why: `because ${index}`, from, to: offset };
	});
	return { transcriptText: passages.join(""), sections };
}

/** The text each section of a completed result covers. */
function textsOf({
	result,
	transcriptText,
}: {
	readonly result: DeepenResult;
	readonly transcriptText: string;
}): readonly string[] {
	if (result.state !== "completed") {
		throw new Error(`expected a completed run, got ${result.state}`);
	}
	return result.sections.map((section) => transcriptText.slice(section.from, section.to));
}

/** The section text a call was about, read back out of its user message. */
function passageSent(messages: readonly TrialMessage[]): string {
	return messages.find((message) => message.role === "user")?.content ?? "";
}

describe("deepenDivision", () => {
	let callModel: ReturnType<
		typeof vi.fn<(messages: readonly TrialMessage[]) => Promise<TrialReply>>
	>;

	beforeEach(() => {
		vi.useFakeTimers();
		callModel = vi.fn<(messages: readonly TrialMessage[]) => Promise<TrialReply>>();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	/** Runs the division to its end, letting the back-off between attempts pass at once. */
	async function deepen(passages: readonly string[]): Promise<{
		readonly result: DeepenResult;
		readonly transcriptText: string;
		readonly sections: readonly Section[];
	}> {
		const { transcriptText, sections } = divisionOf(passages);
		const pending = deepenDivision({
			transcriptText,
			sections,
			gateWords: GATE_WORDS,
			systemPrompt: SYSTEM_PROMPT,
			callModel,
		});
		await vi.runAllTimersAsync();
		return { result: await pending, transcriptText, sections };
	}

	test("should leave every section untouched and send none when all are under the gate", async () => {
		const { result, sections } = await deepen([SHORT, SHORT]);

		expect(callModel).not.toHaveBeenCalled();
		expect(result).toEqual({
			state: "completed",
			sections,
			tally: expect.objectContaining({ sectionsSent: 0 }),
		});
	});

	test("should divide a section where the model says when it is over the gate", async () => {
		callModel.mockResolvedValue(cutsAt(SECOND_HALF));

		const { result, transcriptText } = await deepen([SHORT, EIGHT_WORDS]);

		expect(textsOf({ result, transcriptText })).toEqual([
			SHORT,
			"Cells divide quickly here. ",
			"Then tumours invade tissue. ",
		]);
		expect(result).toMatchObject({
			sections: [
				{ label: "section 0" },
				{ label: "section 1", why: "because 1" },
				{ label: `from ${SECOND_HALF}`, why: `why ${SECOND_HALF}` },
			],
			tally: {
				sectionsSent: 1,
				heldAsOneStep: 0,
				promptTokens: PROMPT_TOKENS,
				completionTokens: COMPLETION_TOKENS,
			},
		});
		expect(passageSent(callModel.mock.calls[0]?.[0] ?? [])).toContain(EIGHT_WORDS);
	});

	test("should keep a section whole and count it held when the model calls it one step", async () => {
		callModel.mockResolvedValue(ONE_STEP);

		const { result, transcriptText } = await deepen([EIGHT_WORDS]);

		expect(textsOf({ result, transcriptText })).toEqual([EIGHT_WORDS]);
		expect(result).toMatchObject({ tally: { sectionsSent: 1, heldAsOneStep: 1 } });
	});

	test("should use the reply and count a retry when a call fails once then succeeds", async () => {
		callModel.mockRejectedValueOnce(new Error("rate limited")).mockResolvedValue(cutsAt(SECOND_HALF));

		const { result, transcriptText } = await deepen([EIGHT_WORDS]);

		expect(textsOf({ result, transcriptText })).toHaveLength(2);
		expect(result).toMatchObject({ tally: { sectionsSent: 1, retries: 1 } });
	});

	test.each([
		["threw", () => callModel.mockRejectedValue(new Error("402 out of credit")), /^THREW: .*402 out of credit/u],
		["came back empty", () => callModel.mockResolvedValue(replyWith("")), /^EMPTY$/u],
		["came back unreadable", () => callModel.mockResolvedValue(replyWith("not json")), /^PARSE-FAIL$/u],
	])("should refuse the whole run and name the reason when a section's call %s on every attempt", async (_name, arrange, reason) => {
		arrange();

		const { result } = await deepen([SHORT, EIGHT_WORDS]);

		expect(callModel).toHaveBeenCalledTimes(3);
		expect(result).toEqual({
			state: "refused",
			failures: [{ label: "section 1", reason: expect.stringMatching(reason) }],
		});
	});

	test("should refuse the run when one section fails even though another succeeds", async () => {
		callModel.mockImplementation(async (messages) =>
			passageSent(messages).includes("Alpha") ? cutsAt(SECOND_HALF) : replyWith(""),
		);

		const { result } = await deepen([`Alpha ${EIGHT_WORDS}`, `Beta ${EIGHT_WORDS}`]);

		expect(result).toEqual({
			state: "refused",
			failures: [{ label: "section 1", reason: "EMPTY" }],
		});
	});

	test("should drop and count a cut whose quote is not in the section", async () => {
		callModel.mockResolvedValue(cutsAt("words the lecturer never said"));

		const { result, transcriptText } = await deepen([EIGHT_WORDS]);

		expect(textsOf({ result, transcriptText })).toEqual([EIGHT_WORDS]);
		expect(result).toMatchObject({ tally: { cutsUnplaced: 1, heldAsOneStep: 0 } });
	});

	test("should send a piece again in a second round when it is still over the gate", async () => {
		const opening = "Growth signals switch on. ";
		callModel.mockImplementation(async (messages) =>
			passageSent(messages).includes(opening)
				? cutsAt("Cells divide quickly")
				: cutsAt(SECOND_HALF),
		);

		const { result, transcriptText } = await deepen([`${opening}${EIGHT_WORDS}`]);

		expect(textsOf({ result, transcriptText })).toEqual([
			opening,
			"Cells divide quickly here. ",
			"Then tumours invade tissue. ",
		]);
		expect(result).toMatchObject({ tally: { sectionsSent: 2 } });
	});
});
