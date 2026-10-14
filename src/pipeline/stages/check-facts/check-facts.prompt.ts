/** The messages that `check-facts` sends (technical-design.md §5, `check-facts`). */

import { type PromptMessages, promptMessages } from "../model-stage.js";
import type { SubtopicRewrite } from "../subtopic-rewrites.js";

/**
 * The version of the fact-check prompt. The prompt is f2 of the prototype in
 * `.scratch/fact-correction-trial/prompts.mjs`, copied word for word. A change to
 * the prompt text gets a new version.
 */
export const FACT_CHECK_PROMPT_VERSION = "f2";

/** The rewrite of one subtopic, with the subtopic id and the title from the structured transcript. */
export type TitledSubtopicRewrite = Pick<SubtopicRewrite, "subtopicId" | "rewrittenSubtopic"> & {
	readonly title: string;
};

/**
 * Gives prompt f2 for one lecture. JSON mode does not fix the shape of the reply,
 * and a JSON-mode call must also ask for JSON in its messages (technical-design.md §6).
 *
 * @param lectureTitle - The lecture title from the structured transcript.
 * @returns The system message.
 */
function factCheckPrompt(lectureTitle: string): string {
	return `# Task

You check study notes for a university course in the biology of disease. The notes are for one lecture, "${lectureTitle}". Find each statement that is wrong, or that a student would learn wrongly from, and give a correction for it.

# What you get

The user message is the notes of the whole lecture, one subtopic after another. Each subtopic starts with a heading "## Subtopic <number>: <title>". A mark [FIGURE] stands for a figure that you cannot see.

# Method

1. Read the whole notes once.
2. Check every statement of every subtopic, as R1 to R4 say.
3. For each error, find the point that its passage makes. Then write the problem and the correction, as R4 and R5 say.
4. Give each subtopic an entry in "checked", as R6 says.

# Rules

## R1 — What to check

Check every statement for scientific and factual correctness: facts, mechanisms, names of people, compounds and genes, numbers, dates, chemical structures, and who discovered or said what.

## R2 — What to report

Report each statement that is wrong, or that a student would learn wrongly from. Report a doubtful statement too, and say in the problem that it is doubtful.

## R3 — What not to report

Do not report style or wording. Do not report a correct statement because it is simplified for students. Do not make additions to authors or collaborators named (but do correct their names if required).

## R4 — The context of a correction

Before you write a correction, find the point that the passage makes: what it teaches, and how it connects to the sentences around it. Write a correction that makes the statement right, and right within the context in which it sits. This rule is about the correction only. It does not change which statements you report.

## R5 — The problem explains, the correction states

Never use the correction to explain what is wrong with the original text or feel a need to argue against it, as the problematic statement will be replaced by a corrector working from your results. Put any observations about what may be wrong with the original text in the problem.

## R6 — Every subtopic is listed

Give every subtopic of the notes one entry in "checked": "errors" when you report an error in it, and "no errors" when you do not.

# Check before replying

- R1: did you check every statement of every subtopic for each kind of fact that R1 names?
- R2: did you report each wrong or misleading statement, and say in the problem when one is only doubtful?
- R3: is any report only about style, wording or a correct simplification? Does any correction add an author or collaborator?
- R4: does each correction keep the point of its passage, and is it right in that context?
- R5: does any correction explain or argue against the original text?
- R6: does "checked" have one entry for each subtopic, and does each entry agree with your errors?

# Reply format

Reply with a single JSON object and nothing else, in this exact shape:

{
  "errors": [
    {
      "subtopic": <number>,
      "passage": "<the exact words of the notes>",
      "problem": "<what is wrong or doubtful>",
      "correction": "<what is correct>",
      "severity": "serious" | "minor"
    }
  ],
  "checked": [{ "subtopic": <number>, "result": "errors" | "no errors" }]
}`;
}

/**
 * Gives the text of one subtopic as the fact check sees it: its paragraphs, each
 * separated from the next by a blank line. The search for the passage of a
 * factual error reads the same text.
 *
 * @param subtopic - The rewrite of the subtopic.
 * @returns The paragraphs as one text.
 */
export function subtopicNotes(subtopic: Pick<TitledSubtopicRewrite, "rewrittenSubtopic">): string {
	return subtopic.rewrittenSubtopic.join("\n\n");
}

/**
 * Builds the messages of the fact-check call: prompt f2, and the whole rewrite as
 * the user message. Each subtopic is under the heading `## Subtopic <id>: <title>`,
 * in lecture order.
 *
 * @param args - The lecture title and the rewrite.
 * @param args.lectureTitle - The lecture title from the structured transcript.
 * @param args.subtopics - The rewrite of each subtopic, in lecture order.
 * @returns The system and user messages.
 */
export function buildFactCheckMessages({
	lectureTitle,
	subtopics,
}: {
	readonly lectureTitle: string;
	readonly subtopics: readonly TitledSubtopicRewrite[];
}): PromptMessages {
	return promptMessages({
		system: factCheckPrompt(lectureTitle),
		user: subtopics
			.map(
				(subtopic) =>
					`## Subtopic ${subtopic.subtopicId}: ${subtopic.title}\n\n${subtopicNotes(subtopic)}`,
			)
			.join("\n\n"),
	});
}
