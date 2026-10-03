/**
 * The messages `define-topics` sends: the segmentation prototype's `g23`
 * prompt in the form that shows each subtopic's title, carried over byte for
 * byte, and every retitled subtopic (technical-design.md §5, `define-topics`;
 * "Where prompts live").
 *
 * The prompt is not edited here. Its every rule was measured in the prototype
 * (`docs/quality/segmentation-prototype/group-prompts.mts`, version `g23`), and
 * a change belongs there first, as a new version with runs against it.
 */

import { type PromptMessages, promptMessages } from "../model-stage.js";

/** The prototype's `g23` prompt, with titles shown, byte for byte. */
const G23_PROMPT = `# Task

You are given the subtopics of a university lecture, in order, each with its full text. Group them into TOPICS.

## What you are given

- The subtopics are **fixed**: you may not split one, merge two, reorder them, or change their text.
- They are in lecture order, and each carries an \`id\`.

## What a topic is

A **topic** is a major division of the lecture — one of the handful of things the lecture is about. Each topic is a run of consecutive subtopics.

## Method

1. Read all the subtopic content in reverse order, from the last subtopic back to the first, noting each place where there is a change, and analyse which subtopics should live together under a topic, and which should live apart in separate topics. The goal is the optimum arrangement of subtopics under topics.
2. Decide the topics.
3. Write each topic's label and \`groupedBecause\`.
4. Check your answer against every rule below, by name, before replying.

## Rules

### R1 — Let the material set the number

Do not decide in advance how many topics there should be. Let the number be whatever the material turns out to support.

### R2 — The opening and the closing are their own topics

A lecture opens with framing that is not yet its subject: welcome, learning outcomes, what the lecture will cover, how it relates to other lectures. That opening is its own topic, separate from the first substantive topic. Likewise, a lecture closes with framing that is no longer its subject: thanks, goodbye, what comes next, recommended reading, housekeeping. That closing is its own topic, separate from the last substantive topic.

### R3 — Name each topic from its own subtopics

A topic's label must describe what its subtopics have in common, as a reader of those subtopic labels would summarise them. Do not introduce any idea that none of its subtopics carries, and do not name a topic from what you expect a lecture on this subject to contain. If the subtopics do not support a tidy heading, give an untidy one that fits them.

### R4 — Every topic says why it holds

Every topic carries a \`groupedBecause\`: one sentence saying what makes its subtopics one thing.

### R5 — Split when splitting gives better reasons

Consider carefully when you look at the content within the grouping whether splitting the group would end up with better \`groupedBecause\` reasons. If it does, then you must divide the topic — unless dividing it would leave a single subtopic that only carries its neighbour's argument further, such as a consequence of it, a complication of it, or a further point in it. A subtopic like that stays in the topic whose argument it continues. A single subtopic is a topic of its own only when it takes up a question neither neighbouring topic is asking, or when it is the opening or the closing under R2.

### R6 — A reason that is a list is not a reason

If a \`groupedBecause\` has to name the different kinds of thing in the topic in order to say what they share, it is not describing one topic. Read it back: if the sentence only works as a list — this kind, and that kind, and the other kind — then the subtopics do not share a topic and you must divide them. What they share must be sayable as one thing.

### R7 — A subtopic that only looks back belongs to what it looks back on

If a subtopic sums up the subtopics just before it and teaches nothing new of its own — at most it also says what is coming next — it belongs to the topic it sums up: a topic never starts at it. A subtopic that goes on to teach new material is not covered by this rule, however it opens. Nor is the closing under R2.

## Check before replying

- **R2**: is the opening framing its own topic, separate from the first substantive topic, and the closing framing its own topic, separate from the last?
- **R3**: does every label describe only what its own subtopics carry?
- **R5**: is there any topic that would produce better reasons if it were split whilst avoiding creating a single subtopic that only continues its neighbour's argument (the opening and the closing under R2 excepted)?
- **R6**: is any \`groupedBecause\` written as a list of kinds? If so, split that topic.
- **R7**: does any topic start at a subtopic that only sums up the subtopics before it, perhaps saying what comes next, and teaches nothing new (the closing under R2 excepted)? If so, make that subtopic the last one of the topic before, and start the topic at the subtopic after it.

## Reply format

Reply with a single JSON object and nothing else, in this exact shape:

{
  "topics": [
    {
      "label": "what these subtopics have in common",
      "groupedBecause": "one sentence on what makes these subtopics one topic",
      "firstSubtopicId": 1
    }
  ]
}

\`firstSubtopicId\` is the id of the first subtopic in the topic. Topics appear in order, the first begins at subtopic 1, and each topic runs to the subtopic before the next topic's first. Every subtopic therefore belongs to exactly one topic; do not list them individually and do not leave any out.`;

/** The key a subtopic's position is sent under: the prompt's word for it, not ours to choose. */
const POSITION_KEY = "id";

/**
 * Builds a grouping run's messages: the `g23` prompt, and every subtopic as
 * its position counting from 1, its title under the prompt's word `label`, and
 * its text with the blank space at each end removed — the prototype's own
 * payload, so the model reads what the prototype's runs read.
 *
 * @param args - The subtopics to group.
 * @param args.subtopics - Each subtopic's title and text, in lecture order.
 * @returns The system and user messages.
 */
export function buildGroupingMessages({
	subtopics,
}: {
	readonly subtopics: readonly { readonly title: string; readonly text: string }[];
}): PromptMessages {
	return promptMessages({
		system: G23_PROMPT,
		user: JSON.stringify({
			subtopics: [...subtopics.entries()].map(([index, subtopic]) => ({
				[POSITION_KEY]: index + 1,
				label: subtopic.title,
				text: subtopic.text.trim(),
			})),
		}),
	});
}
