/**
 * The messages `initial-subtopic-splitting` sends: the segmentation prototype's
 * `s6` prompt, carried over byte for byte, and the transcript
 * (technical-design.md §5, "Dividing the transcript"; "Where prompts live").
 *
 * The prompt is not edited here. Its every rule was measured in the prototype
 * (`docs/quality/segmentation-prototype/split-prompts.mts`, version `s6`), and
 * a change belongs there first, as a new version with runs against it.
 */

import type OpenAI from "openai";

/** The prototype's `s6` prompt, byte for byte. */
const S6_PROMPT = `# Task

You are dividing a university lecture transcript into subtopics.

## What a subtopic is

A SUBTOPIC is a distinct step in the lecture: a single claim developed, a mechanism explained, an example worked through.

## Method

1. Read the transcript and find where the subject changes. Divide it into subtopics.
2. Label each subtopic.
3. Write each subtopic's \`groupedBecause\`.
4. Read your subtopics again and split any that change subject inside them.
5. Check your answer against every rule below, by name, before replying.

## Rules

### R1 — Read the subject, not the speaker's words

Decide where subtopics change by reading what is being talked about. Do NOT rely on the speaker announcing a change. This lecturer says "So", "Right", and "Okay" constantly without changing subject, and several real changes of subject arrive with no announcement at all. The words are not the signal; the subject is.

### R2 — Let the material set the number

Do not decide in advance how many subtopics there should be. Divide wherever the subject genuinely changes, and let the number be whatever it turns out to be.

### R3 — What one subtopic holds

A subtopic is one thing with some other elements that the lecturer brings to bear on it: the mechanism that explains it, what it in turn causes, the conclusion it is used to support.
Do not split a subtopic because the lecturer moves from a thing to its mechanism, from a cause to its effect, from a claim to the evidence for it.

### R4 — What starts a new subtopic

Split when the lecturer takes up a different thing — another mechanism, another agent. Each new one begins its own subtopic, however many the lecturer works through, and that holds even when they all serve the same overall point and all explain the same larger process. This does not cover cases that illustrate a point; those are decided by R5.

### R5 — Cases that illustrate a point

Cases illustrating a point stay with that point, unless each of them would stand as a substantial passage on its own — roughly 350 words or more — in which case they each become their own subtopic. The decision covers all of them or none: it is not acceptable to give some of a point's cases their own subtopic and leave the others with the point.

### R6 — The opening is its own subtopic

A lecture opens with framing that is not yet its subject: welcome, learning outcomes, what the lecture will cover, how it relates to other lectures. That opening is its own subtopic, separate from the first substantive one. Do not fold it into the first thing the lecturer actually teaches.

### R7 — The closing is its own subtopic

A lecture closes with housekeeping that is no longer its subject: thanks, administrative notices, recommended reading, what the next session will cover. That closing is its own subtopic, separate from the last substantive one. Do not fold it into the last thing the lecturer actually teaches.

### R8 — Label every subtopic from the transcript

Give every subtopic a short descriptive label taken from what the transcript actually says there.

### R9 — Say why each subtopic holds together

Every subtopic carries a "groupedBecause": one sentence saying what makes its contents one thing. Write it honestly. If the most you can say is that these were discussed together, then it is not one subtopic and you must divide it.

### R10 — Then read it again

When you have divided the transcript, read each subtopic once more and ask whether the lecturer changes subject inside it. If so, split it.

## Check before replying

- **R3**: does any subtopic break a thing from its mechanism, a cause from its effect, or a claim from the evidence for it? If so, join them.
- **R5**: have you given some of a point's illustrating cases their own subtopic while leaving the others with the point? All of them or none.
- **R6**: is the opening framing its own subtopic, separate from the first substantive one?
- **R7**: is the closing housekeeping its own subtopic, separate from the last substantive one?
- **R8**: does every label say what the transcript actually says there?
- **R9**: is any \`groupedBecause\` no more than "these were discussed together"? If so, divide that subtopic.

## Reply format

You are not reproducing the transcript. Each subtopic carries only its position:
- "startsWith" must be the first EIGHT to TWELVE words of the subtopic, copied from the transcript exactly as they appear. Do not tidy them, do not drop a leading "So" or "Right", do not change capitalisation, do not paraphrase. It is used to locate the cut, so it must match the transcript character for character.
- The first subtopic begins at the very start of the transcript.
- Subtopics are contiguous and in order, and together they cover the whole transcript.

Reply with a single JSON object and nothing else, in this exact shape:

{
  "subtopics": [
    {
      "id": 1,
      "label": "what this subtopic is about",
      "groupedBecause": "one sentence on what makes this passage one subtopic",
      "startsWith": "the first eight to twelve words, verbatim"
    }
  ]
}

Ids count up from 1. Subtopics appear in transcript order.`;

/**
 * Builds the messages for one splitting run: the `s6` prompt, then the
 * transcript under the heading the prototype gave it.
 *
 * @param args - What to divide.
 * @param args.transcript - The transcript, with the whitespace at its ends removed.
 * @returns The system prompt and the user message.
 */
export function buildSplittingMessages({
	transcript,
}: {
	readonly transcript: string;
}): readonly OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
	return [
		{ role: "system", content: S6_PROMPT },
		{ role: "user", content: `Transcript:\n${transcript}` },
	];
}
