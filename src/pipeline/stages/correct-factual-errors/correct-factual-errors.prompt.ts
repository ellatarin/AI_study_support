/** The messages that `correct-factual-errors` sends (technical-design.md §5, `correct-factual-errors`). */

/* jscpd:ignore-end */
import { FIRST_FACTUAL_ERROR_NUMBER } from "../fact-corrections.js";
/* jscpd:ignore-start -- the prompt modules import the same message builder and
   subtopic rewrite. So their import blocks are the same line for line. Imports
   cannot be shared, and CLAUDE.md (File Organisation) forbids barrel files.
   Only the imports are exempt. jscpd checks the code below. */
import type { FactualError } from "../factual-errors.js";
import { type PromptMessages, promptMessages } from "../model-stage.js";
import type { TitledSubtopicRewrite } from "../subtopic-rewrites.js";

/**
 * The version of the fact-correction prompt. The prompt is k3 of the prototype in
 * `.scratch/fact-correction-trial/prompts.mjs`, copied word for word. A change to
 * the prompt text gets a new version.
 */
export const FACT_CORRECTION_PROMPT_VERSION = "k3";

/**
 * Prompt k3. JSON mode does not fix the shape of the reply, and a JSON-mode call
 * must also ask for JSON in its messages (technical-design.md §6).
 */
const FACT_CORRECTION_PROMPT = `# Task

You must correct study notes for a university course in the biology of disease. A fact check found errors in one subtopic of the notes. Correct each error with the smallest change to the notes.

# What you get

The user message has one subtopic of the notes, as a JSON list of paragraphs, and then a numbered list of errors. Each error gives the words of the notes, the problem and a correction.

# Method

1. Read the whole subtopic.
2. For each error, find its words in the paragraphs.
3. Correct the words as R1 to R5 say, or keep them as R6 says.
4. Record each error in "changes".

# Rules

## R1 — The smallest change

Make the smallest change to the notes that corrects each error. Change only the words that the error is about. Keep every other word, sentence and paragraph as it is.

## R2 — Figures and paragraphs

Keep each [FIGURE] mark where it is. Keep the number of paragraphs the same.

## R3 — A doubtful or overstated statement

When an error says that a statement is doubtful or overstated, change the statement so that it is correct.

## R4 — No new concepts

Never add a concept, agent, name or other entity that is not given by any correction.

## R5 — Other words

You may change or add other words where they enhance readability or keep sentences clear. You may also add words where they correct what the notes say a figure shows.

## R6 — An error that is wrong

When you judge that the notes are correct and the error is wrong, leave the words as they are, and say why in "note".

# Check before replying

- R1: did you change any words that no error is about, other than as R5 allows?
- R2: is each [FIGURE] mark in place, and is the number of paragraphs the same?
- R3: is each doubtful or overstated statement now correct?
- R4: does the text name any concept, agent, name or entity that no correction gives?
- R5: does each other change make the text clearer, or correct what it says a figure shows?
- R6: does each error that you judged wrong have a reason in "note"?

# Reply format

Reply with JSON only, in this shape:

{"paragraphs": ["<paragraph 1>", "..."], "changes": [{"error": <number of the error>, "before": "<the old words>", "after": "<the new words, or the same words when you made no change>", "note": "<why, when you made no change>"}]}`;

/** One subtopic as the fact correction sends it: its id, title, paragraphs and factual errors. */
export type FactCorrectionMaterial = TitledSubtopicRewrite & {
	readonly factualErrors: readonly Pick<FactualError, "passage" | "problem" | "correctStatement">[];
};

/**
 * Checks that a reply names a factual error by a number that the call sent.
 *
 * @param args - The number, and the number of factual errors that the call sent.
 * @param args.factualError - The number that the reply gives.
 * @param args.sentCount - The number of factual errors that the call sent.
 * @returns `true` when the call sent a factual error with that number.
 */
export function isSentFactualErrorNumber({
	factualError,
	sentCount,
}: {
	readonly factualError: number;
	readonly sentCount: number;
}): boolean {
	return (
		Number.isInteger(factualError) &&
		factualError >= FIRST_FACTUAL_ERROR_NUMBER &&
		factualError < FIRST_FACTUAL_ERROR_NUMBER + sentCount
	);
}

/**
 * Builds the messages of the call for one subtopic: prompt k3, and the user
 * message of the prototype. The user message gives the subtopic id and title, the
 * paragraphs as a JSON list with one paragraph on each line, and a numbered list
 * of the factual errors.
 *
 * @param material - The subtopic and its factual errors.
 * @param material.subtopicId - The subtopic.
 * @param material.title - The title of the subtopic, from the structured transcript.
 * @param material.rewrittenSubtopic - The paragraphs of the rewritten subtopic.
 * @param material.factualErrors - The factual errors of the subtopic, in the order of the merged file.
 * @returns The system and user messages.
 */
export function buildFactCorrectionMessages({
	subtopicId,
	title,
	rewrittenSubtopic,
	factualErrors,
}: FactCorrectionMaterial): PromptMessages {
	const errors = [...factualErrors.entries()]
		.map(
			([index, error]) =>
				`${index + FIRST_FACTUAL_ERROR_NUMBER}. Words of the notes: "${error.passage}"\nProblem: ${error.problem}\nCorrection: ${error.correctStatement}`,
		)
		.join("\n\n");
	return promptMessages({
		system: FACT_CORRECTION_PROMPT,
		user: `Subtopic ${subtopicId}: ${title}\n\n${JSON.stringify(rewrittenSubtopic, null, 1)}\n\nErrors:\n\n${errors}`,
	});
}
