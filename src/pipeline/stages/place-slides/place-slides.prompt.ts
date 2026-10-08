/**
 * The messages that `place-slides` sends (technical-design.md §5, `place-slides`).
 */

import { type PromptMessages, promptMessages } from "../model-stage.js";
import type { SlideReading } from "../slides.js";

/** One subtopic as the model reads it: its subtopic id, its title and its trimmed text. */
export type SentSubtopic = {
	readonly subtopicId: number;
	readonly title: string;
	readonly text: string;
};

/**
 * The version of {@link PLACEMENT_PROMPT}. A change to the prompt text gets a new
 * version, so that each placements file names the prompt that made it.
 */
export const PROMPT_VERSION = "p1";

/**
 * Gives the task of the model, its rules and the shape of the reply. JSON mode
 * does not fix the shape, and a JSON-mode call must also ask for JSON in its
 * messages (technical-design.md §6).
 */
const PLACEMENT_PROMPT = `# Task

You place the slides of a university lecture in the transcript of the same lecture. For each slide, give the one subtopic of the transcript where the lecturer discusses what the slide shows. A student reads the notes with each slide next to the part of the lecture that explains it.

# What you get

The user message is one JSON object with two lists.

- "subtopics" is the transcript, divided into subtopics, in lecture order. Each subtopic has a "subtopicId", a "title" and its full "text". The text is what the lecturer said. A model wrote the titles from the text. The lecturer did not write them.
- "slides" is the slides that have subject matter, in deck order. Each slide has its "slideNumber" and what a model read from the slide: its title, body, tables, figures and caption. Slides with no subject matter, such as a title slide or a list of references, are not in the list. So the slide numbers can have gaps.

# Key considerations

- The transcript does not show when the lecturer changed slides. You must decide from what the lecturer says.
- The lecturer often explains a slide in words that are not on the slide.
- The lecturer shows the slides in deck order. So the places of the slides go forward through the lecture, and never back.
- One subtopic can get many slides. A subtopic can get no slide.

# Method

1. Read all the subtopics, so that you know what each part of the lecture is about.
2. Read all the slides in deck order.
3. For each slide on its own, find the first subtopic where the lecturer discusses what the slide shows. Do not look at the places of the other slides yet.
4. Go through the slides in deck order. When a slide has an earlier subtopic than the slide before it, the two places disagree. Read both slides and both subtopics again, and decide which of the two places is wrong. Move only that slide. Do not move the slides after it. A move can make a new disagreement, so do this step again from the first slide. Stop when no two places disagree.
5. Place each slide that the lecturer does not discuss, by R4.
6. Check each place against the rules below, by name. Change each place that breaks a rule.
7. Give the reply.

# Rules

## R1 — Match the subject, not the words

Decide from what the slide is about and what the lecturer talks about. Do not rely on shared words. The lecturer can explain a slide in other words, and can say a slide's words without discussing that slide. Use what you know of the subject. A figure or a table on the slide counts as much as its text.

## R2 — Deck order

A slide's subtopic is never earlier than the subtopic of the slide before it in the list. Two slides next to each other can have the same subtopic.

## R3 — The first place

The lecturer can discuss a slide in more than one subtopic. Then give the first subtopic where the lecturer discusses it. A slide that the lecturer goes back to later stays at its first place.

## R4 — Every slide gets one place

Give each slide in the list exactly one place. This includes a slide that the lecturer does not discuss. For such a slide, choose a subtopic from the subtopic of the slide before it to the subtopic of the slide after it. Choose the subtopic whose subject is nearest to the slide.

## R5 — A repeated slide

A slide can repeat an earlier slide. Each copy is a separate slide in the list. Place each copy by these rules, as if the other copy did not exist.

## R6 — The text decides, not the title

A subtopic title is a short summary of the subtopic's text, and a model wrote it. When the title and the text disagree, the text decides.

## R7 — Only the given numbers

Use only the slide numbers in "slides" and the subtopic ids in "subtopics".

# Check before replying

- **R1**: for each slide, does the lecturer discuss what the slide shows in the subtopic you chose, and not only say some of its words?
- **R2**: does any slide have an earlier subtopic than the slide before it? If so, decide which of the two places is wrong, and move only that slide.
- **R3**: for each slide, is there an earlier subtopic, at or after the subtopic of the slide before it, where the lecturer already discusses the slide? If so, use that subtopic.
- **R4**: does each slide in the list have exactly one entry?
- **R6**: did you choose any subtopic because of its title, when its text does not discuss the slide?
- **R7**: is each slide number in "slides", and each subtopic id in "subtopics"?
- **placedBecause**: does each sentence name what the lecturer discusses, and does it agree with the subtopic that you chose?

# Reply format

Give one entry for each slide, in deck order. In "placedBecause", write one sentence that says what the lecturer discusses in that subtopic that the slide shows. For a slide that the lecturer does not discuss, say so, and say why you chose that subtopic.

Reply with a single JSON object and nothing else, in this exact shape:

{
  "placements": [
    {
      "slideNumber": <slide number>,
      "subtopicId": <subtopic id>,
      "placedBecause": "one sentence on why the slide goes in this subtopic"
    }
  ]
}`;

/**
 * Builds the messages of the one model call of `place-slides`.
 *
 * @param args - The subtopics and the slide readings.
 * @param args.subtopics - Every subtopic, in lecture order.
 * @param args.slides - The reading of each subject-matter slide, whole, in deck order.
 * @returns The system and user messages.
 */
export function buildPlacementMessages({
	subtopics,
	slides,
}: {
	readonly subtopics: readonly SentSubtopic[];
	readonly slides: readonly SlideReading[];
}): PromptMessages {
	return promptMessages({
		system: PLACEMENT_PROMPT,
		user: `Lecture:\n${JSON.stringify({ subtopics, slides })}`,
	});
}
