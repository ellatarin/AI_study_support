/** The messages that `relocate-slides` sends (technical-design.md §5, "After the fact correction"). */

import { type PromptMessages, promptMessages } from "../model-stage.js";
import type { SlideReading } from "../slides.js";

/**
 * The version of {@link SLIDE_RELOCATION_PROMPT}. A change to the prompt text gets
 * a new version, so that each subtopic file names the prompt that made it.
 */
export const SLIDE_RELOCATION_PROMPT_VERSION = "r4";

/**
 * Gives the task of the model, its rules and the shape of the reply. The text is
 * prompt r4 of the slide relocation prototype, word for word
 * (`.scratch/slide-relocation/prompts.mts`).
 */
const SLIDE_RELOCATION_PROMPT = `# Task

You put the slides of a university lecture into the study notes of the lecture. You get one subtopic of the notes and the slides that belong to that subtopic. For each slide, find the sentence of the notes where the explanation of the slide starts. A student reads the notes with each slide in the text, at that sentence.

# What you get

The user message is one JSON object.

- "paragraphs" is the notes of the subtopic, as a list of paragraphs in reading order. A writer wrote the notes from the transcript of the lecture. The notes say what the lecturer said, in different words. In some places the order of the points is different from the lecture.
- "slides" is the slides of the subtopic, in deck order. Each slide has its "slideNumber" and what a model read from the slide: its title, body, tables, figures, caption and kind.

Some paragraphs contain figure marks, such as [FIGURE 1] and [FIGURE 2]. The writer put a mark where the lecturer pointed at a slide.

# Rules

## R1 — Match the subject, not the words

Find the sentence of the notes that starts the explanation of what the slide shows. Decide from what the slide is about and what the notes explain. Do not rely on shared words. The notes can explain a slide in other words, and can use a slide's words without explaining that slide. Use what you know of the subject. A figure or a table on the slide counts as much as its text.

## R2 — The first sentence

When the notes explain a slide in more than one place, give the first sentence where the explanation starts.

## R3 — Deck order

The sentence of a slide is never earlier in the notes than the sentence of the slide before it in the list. Two slides next to each other can have the same sentence.

## R4 — Every slide gets one sentence

Give each slide in the list exactly one sentence. This includes a slide that the notes do not explain. For such a slide, choose a sentence from the sentence of the slide before it to the sentence of the slide after it. Choose the sentence whose subject is nearest to the slide.

## R5 — Start words mark the sentence

Give the start words of the sentence in "startWords": the first EIGHT to TWELVE words of the sentence, copied from the paragraph exactly as they appear. When the sentence has fewer words, give the whole sentence. Do not change capitals or punctuation, and do not paraphrase. The start words are used to find the sentence, so they must match the text character for character.

## R6 — Figure marks

For each figure mark, give the number of the slide that the mark points at. When the mark points at none of the slides in the list, give null. Two marks can point at the same slide.

## R7 — Only the given numbers

Use only the slide numbers in "slides" and the mark numbers in the paragraphs.

# Check before replying

- **R3**: does any slide have an earlier sentence than the slide before it? If so, decide which of the two sentences is wrong, and change only that one.
- **R4**: does each slide in the list have exactly one entry?
- **R5**: does each "startWords" appear, word for word, in a paragraph?
- **R6**: does each figure mark have exactly one entry?

# Reply format

Reply with a single JSON object and nothing else, in this exact shape:

{
  "slides": [
    { "slide": <slide number>, "startWords": "the first eight to twelve words of the sentence, verbatim" }
  ],
  "figureMarks": [
    { "mark": <mark number>, "slide": <slide number or null> }
  ]
}

Give the slides in deck order. When the paragraphs have no figure marks, give an empty "figureMarks" list.`;

/** The JSON object that the slide relocation prompt describes under "What you get". */
type SlideRelocationMaterial = {
	/** The paragraphs of the fact-corrected subtopic, with numbered figure marks. */
	readonly paragraphs: readonly string[];
	/** The whole reading of each slide placed in the subtopic, in deck order. */
	readonly slides: readonly SlideReading[];
};

/**
 * Builds the messages of the slide relocation call for one subtopic. The user
 * message is the JSON object alone, with no heading, as the prompt describes it.
 *
 * @param material - The paragraphs and the slide readings.
 * @returns The system and user messages.
 */
export function buildSlideRelocationMessages(material: SlideRelocationMaterial): PromptMessages {
	return promptMessages({ system: SLIDE_RELOCATION_PROMPT, user: JSON.stringify(material) });
}
