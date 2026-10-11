/** The messages that `check-rewrite-attempts` sends (technical-design.md §5, `check-rewrite-attempts`). */

/* jscpd:ignore-start -- the prompt modules import the same message builder and
   shared rules. So their import blocks are the same line for line. Imports
   cannot be shared, and CLAUDE.md (File Organisation) forbids barrel files.
   Only the imports are exempt. jscpd checks the code below. */
import type { OutputLanguage } from "../../../types/pipeline.js";
import { languageName } from "../../../utils/language.js";
import { CHECKED_WRITER_RULES } from "../checked-writer-rules.js";
import type { PromptMessages } from "../model-stage.js";
import { subtopicPromptMessages } from "../rewrite-attempts.js";
import type { ReplyCorrection } from "../term-corrections.js";
/* jscpd:ignore-end */

/**
 * The version of the checker prompt. A change to the prompt text gets a new
 * version, so that each check names the prompt that made it.
 */
export const CHECKER_PROMPT_VERSION = "c2";

/**
 * Gives the task of the checker, the faults to report and the shape of the reply.
 *
 * @param language - The language of the notes, from `finalOutput.language`. The writer wrote in it.
 * @returns The checker prompt.
 */
function checkerPrompt(language: OutputLanguage): string {
	const name = languageName({ language });
	return `# Task

You check a rewrite of one part of a university lecture. The source is what the lecturer said, as a speech-to-text transcriber wrote it. An earlier step corrected some technical terms that the transcriber misheard. A writer then wrote the corrected text as textbook prose. Find each place where the rewrite is not faithful to the source. Do not rewrite or correct anything.

# What you get

The user message is one JSON object:
- "text" is what the lecturer said, before term correction.
- "corrections" is the list of term corrections. Each has "wrongForm", the form in "text", "rightForm", the form that replaced it, and "reason".
- "rewrite" is the list of paragraphs that the writer wrote.

# The writer's rules

The writer had to follow these rules.

${CHECKED_WRITER_RULES}

The writer also had to write in ${name}.

# What you report

Report a deficiency for each of these faults:
- An omission: a fact, a detail or a qualification of the text is not in the rewrite.
- A distortion: the rewrite states something that the text contradicts. This includes a changed term, name, residue, number, step or causal link, and a changed certainty.
- An unsourced addition: the rewrite states something that the text does not state at all, even when it is true.

Each deficiency names the rule that the rewrite breaks.

## The corrections

Treat each correction as right. Do not judge a correction. A rewrite that uses the right form of a correction in place of its wrong form is not a distortion.

## What is not a deficiency

- A [FIGURE] mark where the lecturer points at a slide.
- Dropped filler, false starts, repetitions that add nothing, jokes, remarks to the audience and course arrangements. When such a passage also states subject matter, a dropped statement is an omission.
- Different words that keep the meaning, the terms and the certainty exactly.
- A spelling of ${name} in place of another spelling of the same word, such as "colour" for "color". The text has the transcriber's spelling, which can differ.
- The order of the points, the paragraphs, style and grammar.
- A fact that the rewrite could explain better. Report only what is missing, wrong or added.

# Considerations

For each passage that you examined and found not to be a deficiency, add a consideration with the reason. Dropped filler is an example.

# Reply format

Reply with a single JSON object and nothing else, in this exact shape:

{
  "deficiencies": [
    {
      "deficiencyType": "omission" or "distortion" or "unsourced-addition",
      "rule": "R2" to "R9",
      "description": what is wrong,
      "sourcePassage": the words of "text" that the deficiency is about, copied exactly, or null for an unsourced addition,
      "rewritePassage": the words of the rewrite that the deficiency is about, copied exactly, or null for an omission
    }
  ],
  "considerations": [
    { "sourcePassage": the words of "text", copied exactly, "reason": why it is not a deficiency }
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
