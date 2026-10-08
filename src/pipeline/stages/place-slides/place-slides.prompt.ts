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
 * Gives the task of the model, its rules and the shape of the reply. JSON mode
 * does not fix the shape, and a JSON-mode call must also ask for JSON in its
 * messages (technical-design.md §6).
 */
const PLACEMENT_PROMPT = `You are placing the slides of a university lecture in the lecture's transcript.

The user message gives the lecture as JSON. "subtopics" is the transcript divided into subtopics, in lecture order. Each subtopic has a "subtopicId", a title and its full text. "slides" is the slides of the deck that have subject matter, in deck order. Each slide has its "slideNumber", what it shows and its caption.

For each slide, give the one subtopic where the lecturer discusses that slide.
- Give every slide a place, also a slide that the lecturer does not discuss. Put such a slide between the slides before and after it.
- The lecturer shows the slides in deck order. A slide's subtopic is never earlier than the subtopic of the slide before it.
- A slide that the lecturer goes back to stays at its first place.

Reply with a single JSON object and nothing else, in this exact shape:

{
  "placements": [
    { "slideNumber": <slide number>, "subtopicId": <subtopic id> }
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
