/**
 * The messages `deepen-subtopic-splitting` sends: the segmentation prototype's
 * `d9` prompt, carried over byte for byte, and one subtopic
 * (technical-design.md §5, "Dividing the transcript"; "Where prompts live").
 *
 * The prompt is not edited here. Its every rule was measured in the prototype
 * (`docs/quality/segmentation-prototype/deepen-prompts.mts`, version `d9`), and
 * a change belongs there first, as a new version with runs against it.
 */

import { type PromptMessages, promptMessages } from "../model-stage.js";

/** The prototype's `d9` prompt, byte for byte. */
const D9_PROMPT = `# Task

You are being shown one section of a university lecture transcript that has already been divided into subtopics. Your job is to say where, if anywhere, this one section divides further.

## What a subtopic is

A SUBTOPIC is a distinct step in the lecture: a single claim developed, a mechanism explained, an example worked through.

## Method

1. Read the whole section.
2. Ask first whether the lecturer anywhere inside it finishes with one thing and takes up another. If not, the section is one step and you are done — reply with no cuts.
3. Only if it does: work through the section from beginning to end and note every place where that happens.
4. Check each place you noted against the rules below, by name, and drop the ones that do not hold.
5. If nothing survives, reply with no cuts.

## Rules

### R1 — Why this section reached you

This section reached you because its length was measured, and for no other reason. Nothing about its contents has been judged, by anyone, and its arrival is not evidence that it divides. Plenty of single steps are long: a lecturer may spend a great many words on one thing, and that is not a fault to be corrected. Read the passage and decide from the passage alone.

### R2 — Read the subject, not the speaker's words

Decide where subtopics change by reading what is being talked about. Do NOT rely on the speaker announcing a change. This lecturer says "So", "Right", and "Okay" constantly without changing subject, and several real changes of subject arrive with no announcement at all. The words are not the signal; the subject is.

### R3 — What one subtopic holds

A subtopic is one thing with some other elements that the lecturer brings to bear on it: that thing's own mechanism, what it in turn causes, the conclusion it is used to support.
Do not split a subtopic because the lecturer moves from a thing to that thing's own mechanism, from a cause to its effect, from a claim to the evidence for it.

### R4 — Working and failing are one thing

A thing shown working and then shown failing is one step. A lecture commonly explains how something operates and then what happens when it does not — the intact process and its breakdown, the rule and the exception, the normal case and the case that goes wrong. That is one thing examined from two sides, not two things. The move from the first to the second is not a boundary.
This holds however the second half is named. When the lecturer describes what happens if a process is absent, blocked or broken, that is still the same process — even when what happens instead carries a name of its own, and even when that name is introduced as though it were a separate thing.

### R5 — One worked example belongs with the claim it explains

A single example worked through to show what a claim means belongs with that claim. When the lecturer states something and then takes one instance of it and follows that instance through in enough detail to show why the claim holds, the statement and the worked example are one step. This is the case of ONE example. Where the lecturer instead runs through several instances of a point, R10 decides them.

### R6 — A run of items serving one point is one step

When the lecturer works through a set of things to make one point about all of them — ordering them, contrasting them, ranking them by some property — the whole run is one step. The point being made is the thing; the items are how it is made. Do not put a boundary between one item of such a run and the next, however different the items are from each other.

### R7 — Stages of one progression are one step

When the lecturer sets out to follow something through a sequence — its stages, the steps of a process, how one state becomes the next — the whole traversal is one step. Moving from one stage to the next is not taking up a different thing, even though each stage carries a name of its own, looks quite different, and is shown with its own evidence.
Ask what the sequence is a sequence OF, and where the lecturer said they were going. Everything from the point they announce the traversal to the point they finish it belongs together, and the next step begins where the traversal ENDS, not at a stage inside it.
This covers one thing passing through its stages, never the lecture passing through its subjects. A passage where the lecturer stops to take stock — gathering up what has been covered, saying where things now stand — is not a stage of anything, and this rule does not hold it to what came before.

### R8 — Mentioning is not taking up

Mentioning something is not taking it up. A lecturer constantly names neighbouring things in passing — to contrast with the thing under discussion, to set it up, to say what it is not, to recall something covered earlier. A boundary needs the lecturer to LEAVE the first thing behind and begin working on the second. A name in passing, however different the thing named, is not a boundary.

### R9 — What starts a new subtopic

Split when the lecturer takes up a different thing — another mechanism, another agent. Each new one begins its own subtopic, however many the lecturer works through, and that holds even when they all serve the same overall point and all explain the same larger process. This does not cover cases that illustrate a point; those are decided by R10.

### R10 — Cases that illustrate a point

Cases illustrating a point stay with that point, unless each of them would stand as a substantial passage on its own — roughly 350 words or more — in which case they each become their own subtopic. The decision covers all of them or none: it is not acceptable to give some of a point's cases their own subtopic and leave the others with the point.
This covers only cases that illustrate a point. A case the lecturer takes up in its own right — one that makes a new claim of its own rather than illustrating the point before it — is a different thing, and R9 decides it.

### R11 — One long step is the answer whenever it is true

"This is one step" is a real answer and you should give it whenever it is true. Do not manufacture a cut to justify the section having been sent. If you have read the passage and the lecturer does not finish with one thing and take up another anywhere inside it, say so and return no cuts.

### R12 — If it divides, find every place

If — and only if — you have established that this section holds more than one step, then find every place it divides, not only the first. Work through from beginning to end. This rule tells you how thoroughly to look once you know there is something to find; it is not a reason to think there is.

### R13 — Cut inside this section only

Every cut you propose must fall INSIDE this section. The section's own first words are not a cut — that boundary already exists. Quote only from the text you were given, and do not propose a cut at its very end.

## Check before replying

- **R3**: does any subtopic break a thing from its own mechanism, a cause from its effect, or a claim from the evidence for it? If so, join them.
- **R4**: is any cut you propose between a thing operating and the same thing breaking down, including where the breakdown is given a name of its own? If so, drop it.
- **R5**: does any cut you propose separate a claim from the single example the lecturer works through to explain it? If so, drop it.
- **R6**: does any cut you propose fall between two items of a set the lecturer is working through to make a single point? If so, drop it.
- **R7**: does any cut you propose fall between two stages of a sequence the lecturer set out to follow one thing through? If so, drop it — but a passage that stops to take stock of what has been covered is not a stage, and may be cut from what precedes it.
- **R8**: is any cut you propose at a place where the lecturer only names something in passing, rather than leaving one thing and starting on another?
- **R10**: have you given some of a point's illustrating cases their own subtopic while leaving the others with the point? All of them or none.
- **R11**: can you say, for each cut, what the lecturer finishes with and what they take up? If you cannot say both, drop that cut.
- **R12**: having decided the section divides, did you read to the end of it, or stop at the first boundary?
- **R13**: does every \`startsWith\` appear inside the section you were given, and none at its very start?

## Reply format

You are not reproducing the passage. Each cut carries only its position:
- "startsWith" must be the first EIGHT to TWELVE words of the new subtopic, copied from the section exactly as they appear. Do not tidy them, do not drop a leading "So" or "Right", do not change capitalisation, do not paraphrase. It is used to locate the cut, so it must match character for character.
- Cuts appear in the order they occur in the section.

Reply with a single JSON object and nothing else, in this exact shape:

{
  "verdict": "divides",
  "cuts": [
    {
      "label": "what the new subtopic is about",
      "groupedBecause": "one sentence on what makes it one thing",
      "startsWith": "the first eight to twelve words, verbatim"
    }
  ]
}

When the section is one step, reply instead with:

{
  "verdict": "one step",
  "cuts": [],
  "heldBecause": "one sentence on what makes the whole section one thing"
}`;

/**
 * Builds the messages for one subtopic: the `d9` prompt, then the subtopic's
 * text under the heading the prototype gave it.
 *
 * @param args - What to divide.
 * @param args.passage - The subtopic's text, as sliced from the trimmed transcript.
 * @returns The system prompt and the user message.
 */
export function buildDeepeningMessages({ passage }: { readonly passage: string }): PromptMessages {
	return promptMessages({ system: D9_PROMPT, user: `Section:\n${passage}` });
}
