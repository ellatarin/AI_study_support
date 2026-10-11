/** The messages that `correct-terms` sends (technical-design.md §5, `correct-terms`). */

/* jscpd:ignore-start -- the prompt modules import the same message builder and
   slide reading. So their import blocks are the same line for line. Imports
   cannot be shared, and CLAUDE.md (File Organisation) forbids barrel files.
   Only the imports are exempt. jscpd checks the code below. */
import { labelledJson, type PromptMessages, promptMessages } from "../model-stage.js";
import type { SlideReading } from "../slides.js";
/* jscpd:ignore-end */

/**
 * The version of {@link TERM_CORRECTION_PROMPT}. A change to the prompt text gets
 * a new version, so that each rewrite attempt names the prompt that made it.
 */
export const TERM_CORRECTION_PROMPT_VERSION = "t1";

/**
 * Gives the task of the corrector, its rules and the shape of the reply. JSON
 * mode does not fix the shape, and a JSON-mode call must also ask for JSON in its
 * messages (technical-design.md §6).
 */
const TERM_CORRECTION_PROMPT = `# Task

You correct the technical terms that a speech-to-text transcriber misheard in one part of a university lecture. The lecturer showed slides in this part, and a slide often prints the right form of a misheard term. Give a list of corrections. Each correction gives the misheard form as it is in the text, the form that a slide prints, and the reason.

# What you get

The user message is one JSON object.

- "text" is what the lecturer said in this part of the lecture, as the transcriber wrote it.
- "slides" is the slides that the lecturer showed in this part. Each slide has its "slideNumber" and what a model read from the slide: its title, body, tables, figures and caption.

# Rules

## R1 — Only a misheard term

Correct a term only when the transcriber misheard it. A misheard term sounds like the term on the slide. But the transcriber wrote a different word, a wrong spelling, a split word or a word that does not exist. Do not correct a term that the lecturer said correctly in other words. A synonym, an abbreviation, a short name or a full name that the lecturer chose is not a mishearing.

## R2 — The right form is on a slide

The right form must be in the reading of one of the slides. Copy it exactly as the reading has it: the same letters, capitals, symbols, numbers, hyphens and spaces. A form that differs in any of these is not a correct copy. Do not correct a term that no slide prints, even when you know the right form.

## R3 — The wrong form is in the text

Copy the wrong form exactly as the text has it: the same letters, capitals, hyphens, spaces and punctuation. Do not tidy it. A form that differs in any of these is not a correct copy.

## R4 — One to four words

Each form has one to four words. Give only the words of the term. Do not include the words around it.

## R5 — A correction applies to every occurrence

A correction applies to each occurrence of the wrong form in the text. So choose a wrong form that is the misheard term at each place where it occurs. When the same words also occur in the text with their correct meaning, do not give the correction. The misheard term can occur in the text in more than one form. For example, one occurrence can have a capital at the start of a sentence, and another can have a hyphen. Then give one correction for each form.

## R6 — One correction for each wrong form

Give each wrong form once. When the transcriber wrote the same term in two different wrong forms, give one correction for each wrong form.

## R7 — No change to the facts

A correction changes the spelling of a term, and nothing else. It does not add a fact, remove a fact or change what the lecturer said.

## R8 — An empty list is a good answer

When the transcriber misheard no term that a slide prints, give an empty list.

# Check before replying

- **R1**: does each wrong form sound like its right form? Is it a mishearing, and not the lecturer's own choice of words?
- **R2**: is each right form in a slide reading, character for character?
- **R3**: is each wrong form in the text, character for character?
- **R4**: does each form have one to four words?
- **R5**: is each occurrence of each wrong form the misheard term?
- **R7**: does any correction change a fact?

# Reply format

In "reason", write one sentence that says why the wrong form is a mishearing of the right form, and which slide prints the right form.

Reply with a single JSON object and nothing else, in this exact shape:

{
  "corrections": [
    {
      "wrongForm": "the misheard form, exactly as in the text",
      "rightForm": "the form that a slide prints, exactly as in the reading",
      "reason": "one sentence on why this is a mishearing"
    }
  ]
}`;

/** The JSON object that the term-correction prompt describes under "What you get". */
type TermCorrectionMaterial = {
	/** The text of the subtopic, as the structured transcript holds it. */
	readonly text: string;
	/** The whole reading of each slide placed in the subtopic, in deck order. */
	readonly slides: readonly SlideReading[];
};

/**
 * Builds the messages of the term-correction call for one subtopic.
 *
 * @param material - The subtopic text and the slide readings.
 * @returns The system and user messages.
 */
export function buildTermCorrectionMessages(material: TermCorrectionMaterial): PromptMessages {
	return promptMessages({
		system: TERM_CORRECTION_PROMPT,
		user: labelledJson({ label: "Subtopic", value: material }),
	});
}
