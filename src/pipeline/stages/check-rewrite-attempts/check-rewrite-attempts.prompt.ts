/** The messages that `check-rewrite-attempts` sends (technical-design.md §5, `check-rewrite-attempts`). */

/* jscpd:ignore-start -- the prompt modules import the same message builder. So
   their import blocks are the same line for line. Imports cannot be shared,
   and CLAUDE.md (File Organisation) forbids barrel files. Only the imports are
   exempt. jscpd checks the code below. */
import type { OutputLanguage } from "../../../types/pipeline.js";
import { languageName } from "../../../utils/language.js";
import type { PromptMessages } from "../model-stage.js";
import { subtopicPromptMessages } from "../rewrite-attempts.js";
import type { ReplyCorrection } from "../term-corrections.js";
/* jscpd:ignore-end */

/**
 * The version of the checker prompt. A change to the prompt text gets a new
 * version, so that each check names the prompt that made it.
 */
export const CHECKER_PROMPT_VERSION = "c3";

/**
 * Gives the task of the checker, the faults to report and the shape of the reply.
 *
 * @param language - The language of the notes, from `finalOutput.language`. The writer wrote in it.
 * @returns The checker prompt.
 */
function checkerPrompt(language: OutputLanguage): string {
	const name = languageName({ language });
	return `# Task

You check a rewrite of one part of a university lecture. The source is what the lecturer said, as a speech-to-text transcriber wrote it. An earlier step corrected some technical terms that the transcriber misheard. A writer then wrote the corrected text as textbook prose in ${name}. Find each place where the rewrite does not say what the lecturer said. Do not rewrite or correct anything.

# What you get

The user message is one JSON object:
- "text" is what the lecturer said, before term correction.
- "corrections" is the list of term corrections. Each has "wrongForm", the form in "text", "rightForm", the form that replaced it, and "reason".
- "rewrite" is the list of paragraphs that the writer wrote.

# What you report

Report a change only when a student who learns from the rewrite would learn something different from what the lecturer said. You decide whether a change is of that kind.

- An omission: the rewrite leaves out a fact, an observation, a step of reasoning or a causal link that the text states.
- An unsourced addition: the rewrite states a fact, or a causal, defining or equating link, that the text does not state. This is a fault even when the added statement is true.
- A distortion: the rewrite states something different from the text. This includes a changed term, name or number, a causal claim with a changed cause or effect, and a hedge removed from a scientific claim.

A link can be one word.

Treat each correction as right. A rewrite that uses the right form of a correction is not a distortion.

# What you do not report

Do not report a change that leaves the scientific content as it was. Examples:
- Dropped filler, false starts, repetitions, jokes, remarks to the audience, and statements about the course or the lecture. When such a passage also states subject matter, a dropped statement is an omission.
- Different words with the same meaning.
- A spelling of ${name} in place of another spelling of the same word, such as "colour" for "color". The text has the transcriber's spelling, which can differ.
- A [FIGURE] mark, the order of the points, the paragraphs, style and grammar.

# Considerations

For each passage that you examined and did not report, add a consideration with the reason.

# Reply format

Reply with a single JSON object and nothing else, in this exact shape:

{
  "deficiencies": [
    {
      "deficiencyType": "omission" or "distortion" or "unsourced-addition",
      "description": what is wrong,
      "sourcePassage": the words of "text" that the fault is about, copied exactly. For an unsourced addition, the words of "text" that the addition is built on, or null when there are none,
      "rewritePassage": the words of the rewrite that the fault is about, copied exactly. For an omission, the words of the rewrite where the fact should be, or null when there are none
    }
  ],
  "considerations": [
    { "sourcePassage": the words of "text", copied exactly, "reason": why you did not report it }
  ]
}

An empty "deficiencies" list means that the rewrite is faithful.`;
}

/**
 * The text, the kept corrections and the rewrite that the checker gets for one
 * subtopic, as the user message holds them.
 */
export type MaterialToCheck = {
	/** The text of the subtopic before term correction. */
	readonly text: string;
	/** The kept corrections of the rewrite attempt, with their reasons. */
	readonly corrections: readonly ReplyCorrection[];
	/** The paragraphs of the rewritten subtopic. */
	readonly rewrite: readonly string[];
};

/**
 * Builds the messages of the checker call for one subtopic.
 *
 * @param args - The material of the subtopic, and the language.
 * @param args.material - The text, the kept corrections and the rewrite of the subtopic.
 * @param args.language - The language of the notes, from `finalOutput.language`.
 * @returns The system and user messages.
 */
export function buildCheckerMessages({
	material,
	language,
}: {
	readonly material: MaterialToCheck;
	readonly language: OutputLanguage;
}): PromptMessages {
	return subtopicPromptMessages({ system: checkerPrompt(language), material });
}
