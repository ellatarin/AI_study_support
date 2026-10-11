import { describe, expect, it } from "vitest";
import { makeConfig, transcriptSubtopicTexts } from "../fixtures.js";
import { buildCheckerMessages } from "./check-rewrite-attempts/check-rewrite-attempts.prompt.js";
import { buildWriterMessages } from "./rewrite-subtopics/rewrite-subtopics.prompt.js";

/**
 * The system message of a list of messages: the prompt.
 *
 * @param messages - The messages that a prompt module builds.
 * @returns The text of the first message.
 */
function systemPrompt(messages: readonly { readonly content?: unknown }[]): string {
	return String(messages[0]?.content);
}

describe("the writer's rules R2 to R9", () => {
	it("should be in the checker prompt in the words of the writer prompt when both prompts are built", () => {
		const text = transcriptSubtopicTexts[0];
		const { language } = makeConfig().finalOutput;
		const writerPrompt = systemPrompt(buildWriterMessages({ text, language }));
		const writerRules = writerPrompt.slice(
			writerPrompt.indexOf("## R2 "),
			writerPrompt.indexOf("## R10 "),
		);

		const checkerPrompt = systemPrompt(
			buildCheckerMessages({ material: { text, corrections: [], rewrite: [] }, language }),
		);

		expect(writerRules).toContain("## R9 ");
		expect(checkerPrompt).toContain(writerRules);
	});
});
