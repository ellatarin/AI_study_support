/** The messages that `rewrite-subtopics` sends (technical-design.md §5, `rewrite-subtopics`). */

/* jscpd:ignore-start -- the prompt modules import the same message builder and
   language rule. So their import blocks are the same line for line. Imports
   cannot be shared, and CLAUDE.md (File Organisation) forbids barrel files.
   Only the imports are exempt. jscpd checks the code below. */
import type { OutputLanguage } from "../../../types/pipeline.js";
import { languageRule } from "../../../utils/language.js";
import { CHECKED_WRITER_RULES } from "../checked-writer-rules.js";
import type { PromptMessages } from "../model-stage.js";
import { subtopicPromptMessages } from "../rewrite-attempts.js";
/* jscpd:ignore-end */

/**
 * The version of the writer prompt. A change to the prompt text gets a new
 * version, so that each rewrite names the prompt that made it.
 */
export const WRITER_PROMPT_VERSION = "w1";

/**
 * Gives the task of the writer, its rules and the shape of the reply. JSON mode
 * does not fix the shape, and a JSON-mode call must also ask for JSON in its
 * messages (technical-design.md §6).
 *
 * @param language - The language of the notes, from `finalOutput.language`.
 * @returns The system message.
 */
function writerPrompt(language: OutputLanguage): string {
	return `# Task

You convert spoken text into textbook-style writing. The text is one part of a university lecture: what the lecturer said, as a speech-to-text transcriber wrote it. An earlier step corrected the technical terms that the transcriber misheard. Write the same content as textbook prose for a student's notes.

# What you get

The user message is one JSON object. "text" is what the lecturer said in this part of the lecture.

# Rules

## R1 — The lecturer's order

Keep the order in which the lecturer makes the points. Do not move a point to another place.

${CHECKED_WRITER_RULES}

## R10 — A figure mark where the lecturer points at a slide

When the lecturer refers to something on a slide, for example with "as you can see here" or "this diagram shows", write what the lecturer says about it as a statement. Then put the mark [FIGURE] at the end of that sentence. Give the mark no number. Put one mark where the lecturer starts to refer to a new slide or a new picture. Do not put another mark while the lecturer continues to talk about the same one. Do not describe what the slide shows, except where the lecturer says it.

## R11 — Paragraphs with no heading

Write continuous prose in paragraphs. Do not write a heading, a title, a list or bullet points. Start a new paragraph where the lecturer moves to a new point. Write as a textbook does: state the content directly. Do not write "the lecturer says", and do not speak to the reader as "you".

## R12 — Symbols and formulas

Write a symbol, a formula or an equation in LaTeX between dollar signs, for example $\\alpha$ or $x^{2}$. Do not change how the text writes a name.

## R13 — Language

${languageRule({ language })}

# Check before replying

- **R1**: are the points in the lecturer's order?
- **R2**: is each fact of the text in your prose?
- **R3**: does your prose state anything that the text does not? Is each statement as certain as the lecturer made it?
- **R4 to R8**: is each term, name, residue, number and step of a mechanism exactly as the text has it?
- **R9**: did you keep each statement of subject matter that was inside filler or a course arrangement?
- **R10**: is there a [FIGURE] mark at each place where the lecturer starts to refer to a slide, and nowhere else?

# Reply format

Reply with a single JSON object and nothing else, in this exact shape:

{
  "paragraphs": [
    "the first paragraph",
    "the second paragraph"
  ]
}`;
}

/**
 * Builds the messages of the writer call for one subtopic.
 *
 * @param args - The corrected text of the subtopic, and the language.
 * @param args.text - The text of the subtopic after term correction.
 * @param args.language - The language of the notes, from `finalOutput.language`.
 * @returns The system and user messages.
 */
export function buildWriterMessages({
	text,
	language,
}: {
	readonly text: string;
	readonly language: OutputLanguage;
}): PromptMessages {
	return subtopicPromptMessages({ system: writerPrompt(language), material: { text } });
}
