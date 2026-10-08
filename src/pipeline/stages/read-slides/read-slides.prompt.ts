/**
 * The messages that `read-slides` sends for one slide (technical-design.md §5,
 * `read-slides`).
 */

import type { OutputLanguage } from "../../../types/pipeline.js";
import { languageRule } from "../../../utils/language.js";
import { type PromptMessages, promptMessages } from "../model-stage.js";
import type { SlideKind } from "../slides.js";

/** The type of a figure (CONTEXT.md, "Figure"), as the reply gives it. */
export const FIGURE_TYPES = [
	"diagram",
	"chart",
	"micrograph",
	"photograph",
	"drawing",
	"printed page",
] as const;

/** The rule that the prompt gives the model for each kind of a slide. */
export const SLIDE_KIND_RULES: Readonly<Record<SlideKind, string>> = {
	"content-free": `The slide has no subject matter for a student. These slides are content-free:
  - a title slide
  - an outline or agenda
  - a section divider
  - a "questions?" or "thank you" slide
  - a learning-objectives slide
  - a blank slide
  - a slide with only a video or a link.`,
	references: "The slide lists the sources of the lecture.",
	"subject-matter": "All other slides.",
};

/**
 * Writes values as the prompt lists them: each in quotes, joined by commas, with
 * `last` before the final value.
 *
 * @param args - The values, and the word before the final value.
 * @param args.values - The values to list.
 * @param args.last - The word before the final value, such as "or".
 * @returns The list, such as `"a", "b" or "c"`.
 */
function quotedList({
	values,
	last,
}: {
	readonly values: readonly string[];
	readonly last: string;
}): string {
	const quoted = values.map((value) => `"${value}"`);
	return quoted.length < 2
		? quoted.join("")
		: `${quoted.slice(0, -1).join(", ")} ${last} ${quoted.at(-1)}`;
}

/**
 * Gives the task of the model, the structure of a slide reading, the method, the
 * rules and the shape of the reply. A JSON-mode call must also ask for JSON in
 * its messages (technical-design.md §6).
 *
 * @param language - The language of the caption and the figure descriptions, from `finalOutput.language`.
 * @returns The system message.
 */
function slideReadingPrompt(language: OutputLanguage): string {
	return `# Task

You read one slide from a university lecture. You write a reading of the slide as JSON.

# Purpose

The pipeline uses your reading for two things:

1. A later step compares your reading with the lecture transcript. It finds the part of the lecture where the lecturer discusses the slide.
2. The notes show the slide image at that part. Your caption goes under the image.

The words of the slide and the figure descriptions are the evidence for the first step. So copy the words exactly, and describe each figure fully.

# Input

The user message is the image of one slide. You see only this slide. You do not see the other slides, the transcript or the lecture title.

# The structure of a reading

A reading has six fields. Four fields hold what is on the slide. Two fields hold your judgement of the slide.

Each word on the slide goes into one field only:

| Words on the slide | Field |
|---|---|
| The title | "title" |
| The words in a table | "tables" |
| The words that are part of a figure, such as labels and the words on a printed page | "figures", in the description of that figure |
| Image credits, URLs and copyright lines | No field. Keep one only when it tells what a figure is. Then it goes in the description of that figure. |
| All other words, such as subheadings, bullets, sentences and formulas | "body" |

A figure is a diagram, a chart, a micrograph, a photograph, a drawing or a printed page.

The two fields of judgement are:

- "caption": what the slide shows, for a student.
- "kind": whether the slide has subject matter.

# Method

1. Find the title, the tables and the figures of the slide.
2. Copy the title.
3. Copy each table.
4. Describe each figure.
5. Copy all other words into the body.
6. Write the caption.
7. Decide the kind of the slide.

# Fields

## title

The title of the slide, word for word. When the slide has no title, use "".

## body

The words that are not in the title, a table or a figure. Copy them word for word, in reading order, as Markdown.

- Write a subheading as a Markdown heading.
- Write a bullet as a Markdown list item.
- Write a formula as LaTeX.

When the slide has no such words, use "".

## tables

Each table on the slide, as one Markdown table. When the slide has no table, use [].

## figures

One entry for each figure that shows subject matter. Each entry has two fields:

- "type": ${quotedList({ values: FIGURE_TYPES, last: "or" })}.
- "description": what the figure shows.

In the description:

- Name the parts of the figure.
- Write each label, and the part that the label names.
- Write each arrow, and the two parts that the arrow joins.
- Tell how each part affects or relates to the other parts.
- For a chart, write the axes, the series and the trend.
- For each mark on the figure, write the thing that the mark shows. A mark is an outline, a circle, an arrow or a highlight.
- For a printed page, such as a page of a paper or a book, tell what the page is and what it shows. Copy only its headings and the parts that the slide marks.

Do not make an entry for a decorative picture, such as a logo or clip art. When the slide has no figure, use [].

## caption

One or two sentences that tell a student what the slide shows.

## kind

One of three values:

${Object.entries(SLIDE_KIND_RULES)
	.map(([kind, rule]) => `- "${kind}": ${rule}`)
	.join("\n")}

Decide the kind only from what the slide shows.

# Rules

- Write only what the slide shows. Do not add facts from your own knowledge.
- When a word is too small or not clear, write [illegible]. Do not guess the word.
- The title, the body and the tables keep the spelling of the slide.
- The caption and the figure descriptions follow this language rule: ${languageRule({ language })}

# Output

Reply with one JSON object and nothing else. Use this shape:

\`\`\`json
{
  "title": string,
  "body": string,
  "tables": [string],
  "figures": [{ "type": string, "description": string }],
  "caption": string,
  "kind": ${quotedList({ values: Object.keys(SLIDE_KIND_RULES), last: "or" })}
}
\`\`\``;
}

/**
 * Builds the messages of the call for one slide. The user message is the slide
 * image alone, so the reading says only what is on the slide.
 *
 * @param args - The slide image, and the language.
 * @param args.pngBase64 - The bytes of the slide image, in base64.
 * @param args.language - The language of the caption and the figure descriptions, from `finalOutput.language`.
 * @returns The system and user messages.
 */
export function buildSlideReadingMessages({
	pngBase64,
	language,
}: {
	readonly pngBase64: string;
	readonly language: OutputLanguage;
}): PromptMessages {
	return promptMessages({ system: slideReadingPrompt(language), user: { pngBase64 } });
}
