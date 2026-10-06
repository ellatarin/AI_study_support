/**
 * The messages that `retitle-subtopics` sends. They are the `r9` prompt of the
 * segmentation prototype, copied byte for byte, and the text of each subtopic
 * (technical-design.md §5, `retitle-subtopics` and "Where prompts live").
 *
 * Do not edit the prompt here. A change goes first to
 * `docs/quality/segmentation-prototype/retitle-prompts.mts`, version `r9`, as a new
 * version with runs against it.
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
 * The key of a subtopic id in the user message. The `r9` prompt uses the same
 * key in its reply. "id" is the word of the prototype, copied with the prompt.
 */
const SUBTOPIC_ID_KEY = "id";

/**
 * Builds the messages of the retitling call. The system message is the `r9`
 * prompt. The user message gives each subtopic as its subtopic id and its text,
 * with the whitespace at its ends removed. The prototype sent the same user
 * message. The old title is not sent.
 *
 * @param args - The subtopics to title.
 * @param args.texts - The text of each subtopic, in order.
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
				[SUBTOPIC_ID_KEY]: index + 1,
				text: text.trim(),
			})),
		}),
	});
}
