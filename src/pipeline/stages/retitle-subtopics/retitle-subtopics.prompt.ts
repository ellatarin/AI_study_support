/**
 * The messages `retitle-subtopics` sends: the segmentation prototype's `r9`
 * prompt, carried over byte for byte, and every subtopic's text
 * (technical-design.md §5, `retitle-subtopics`; "Where prompts live").
 *
 * The prompt is not edited here. Its every rule was measured in the prototype
 * (`docs/quality/segmentation-prototype/retitle-prompts.mts`, version `r9`), and
 * a change belongs there first, as a new version with runs against it.
 */

import { type PromptMessages, promptMessages } from "../model-stage.js";

/** The prototype's `r9` prompt, byte for byte. */
const R9_PROMPT = `# Task

You are given a university lecture divided into subtopics, in order: each subtopic's id and full text. Give every subtopic a title. The rules below apply to each title.

## Method

Work through the subtopics one at a time, in order. For each, read it to its last sentence, then choose its title, following the rules below, before moving on to the next.

## Rules

### R1 — Title it from its own text

Give the subtopic a short descriptive title taken from what the transcript actually says in it.

### R2 — Only what it covers

The title must describe only this subtopic's own text. Material the lecturer covers in the subtopics before or after it does not belong in its title, even where this subtopic mentions it in passing.

### R3 — Sentence case

Write the title in sentence case: capitalise its first word and any word that is always capitalised, such as a name, an acronym or a gene symbol, and nothing else.

### R4 — Title the whole subtopic

The title must say what the subtopic as a whole is about — the point it develops, not only how it opens or one example in it — and be specific enough that a reader could tell it apart from the subtopics either side.

### R5 — Best short description

Make the title the best short description of the subtopic's subject matter for a science undergraduate, using the most precise words for it.

### R6 — Name summaries

Where a subtopic recaps material the lecture has already covered, begin its title with "Summary of". Where it is the lecture's closing summary or closing remarks, begin its title with "Lecture summary:" or "Lecture close:".

## Check before replying

- **R1**: does the title say what the transcript actually says here?
- **R2**: does the title name anything covered in the subtopic before or after, rather than in this one?
- **R3**: is the title in sentence case, with only its first word and words that are always capitalised starting with a capital?
- **R4**: does the title say what the whole subtopic develops, rather than how it opens or one example in it, and could a reader tell it apart from the subtopics either side?
- **R5**: is the title the best short description of the subtopic's subject matter for a science undergraduate, and is each word the most precise one for it?
- **R6**: if the subtopic recaps earlier material, does its title begin "Summary of"; if it closes the lecture, does its title begin "Lecture summary:" or "Lecture close:"?

## Reply format

Reply with a single JSON object and nothing else, in this exact shape:

{
  "titles": [
    { "id": <subtopic id>, "title": "what this subtopic is about" }
  ]
}

Give one entry for every subtopic, in the order the subtopics are given.`;

/**
 * What the prompt calls a subtopic's position, counting from 1, in what it is
 * sent and in its reply: the prototype's word, carried over with the prompt.
 */
const POSITION_KEY = "id";

/**
 * Builds the messages for the one retitling call: the `r9` prompt, then every
 * subtopic as its position, counting from 1, and its text with the whitespace
 * at its ends removed — as the prototype sent them, and without the old title.
 *
 * @param args - What to title.
 * @param args.texts - Each subtopic's text, in order.
 * @returns The system prompt and the user message.
 */
export function buildRetitleMessages({
	texts,
}: {
	readonly texts: readonly string[];
}): PromptMessages {
	return promptMessages({
		system: R9_PROMPT,
		user: JSON.stringify({
			subtopics: [...texts.entries()].map(([index, text]) => ({
				[POSITION_KEY]: index + 1,
				text: text.trim(),
			})),
		}),
	});
}
