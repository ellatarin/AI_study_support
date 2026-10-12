import { describe, expect, it } from "vitest";
import { buildCheckerMessages, CHECKER_PROMPT_VERSION } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/pipeline/stages/check-rewrite-attempts/check-rewrite-attempts.prompt.js";
import { OUTPUT_LANGUAGES } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/types/pipeline.js";
import { checkerSystemPrompt } from "./checker-prompts.mts";

describe("the checker prompt registry", () => {
	it.each(Object.keys(OUTPUT_LANGUAGES) as (keyof typeof OUTPUT_LANGUAGES)[])(
		"should hold the pipeline's checker prompt word for word when the notes are in %s",
		(language) => {
			const pipelineMessages = buildCheckerMessages({
				material: { text: "", corrections: [], rewrite: [] },
				language,
			});

			expect(checkerSystemPrompt({ version: CHECKER_PROMPT_VERSION, language })).toBe(
				pipelineMessages[0]?.content,
			);
		},
	);
});
