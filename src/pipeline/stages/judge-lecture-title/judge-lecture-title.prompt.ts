/**
 * The messages that `judge-lecture-title` sends. The rules are the title rules of
 * the earlier `transcript-structuring` prompt, with the additions that
 * technical-design.md §5 lists (`judge-lecture-title` and "Where prompts live").
 */

/* jscpd:ignore-start -- the prompt modules import the same language rule and
   message builder. So their import blocks are the same line for line. Imports
   cannot be shared, and CLAUDE.md (File Organisation) forbids barrel files.
   Only the imports are exempt. jscpd checks the code below. */
import type { OutputLanguage } from "../../../types/pipeline.js";
import { languageRule } from "../../../utils/language.js";
import { type PromptMessages, promptMessages } from "../model-stage.js";
/* jscpd:ignore-end */

/** The lecture as the model reads it: each topic, with its subtopics in order. */
export type GroupedLecture = {
	readonly topics: readonly {
		readonly title: string;
		readonly subtopics: readonly { readonly title: string; readonly text: string }[];
	}[];
};

/**
 * Gives the task of the model, its rules and the shape of the reply. JSON mode
 * does not fix the shape, and a JSON-mode call must also ask for JSON in its
 * messages (technical-design.md §6).
 *
 * @param language - The language of the notes, from `finalOutput.language`.
 * @returns The system message.
 */
function titleJudgementPrompt(language: OutputLanguage): string {
	return `You are judging the working title of a university lecture.

The user message gives the working title, then the lecture as JSON. The lecture is a list of topics in lecture order. Each topic has a title and a list of subtopics. Each subtopic has a title and its full text. A model wrote the topic titles and subtopic titles from the text. The lecturer did not write them.

The working title comes from the filename the lecturer gave the recording, so it may be a full descriptive title, or it may be thin or meaningless. Judge whether it is meaningful and accurate for what the lecture actually covers.
- A title the lecturer wrote is authoritative. If it is meaningful and accurate, keep it: set "provisionalTitleMeaningful" to true and "suggestedTitle" to null. Do not propose something merely because you could phrase it better.
- Only if it is not meaningful — empty, generic, or at odds with the content — set "provisionalTitleMeaningful" to false and put one concise, descriptive academic title for the whole lecture, of four to eight words, in "suggestedTitle". Name what all the topics have in common. Do not list the topics, and do not use the title of one topic. It becomes a filename, so use plain words. ${languageRule({ language })}
- Put one sentence in "judgedBecause" that says why you judged the working title as you did.

Reply with a single JSON object and nothing else, in this exact shape:

{
  "provisionalTitleMeaningful": boolean,
  "suggestedTitle": string or null,
  "judgedBecause": string
}`;
}

/**
 * Builds the messages of the one model call of `judge-lecture-title`. An empty
 * provisional title is sent as a statement that the filename carried no title.
 *
 * @param args - The lecture, its provisional title, and the language.
 * @param args.lecture - The topics of the lecture, each with its subtopics.
 * @param args.provisionalTitle - The provisional title. It can be empty.
 * @param args.language - The language of the AI-derived title, from `finalOutput.language`.
 * @returns The system and user messages.
 */
export function buildTitleJudgementMessages({
	lecture,
	provisionalTitle,
	language,
}: {
	readonly lecture: GroupedLecture;
	readonly provisionalTitle: string;
	readonly language: OutputLanguage;
}): PromptMessages {
	const workingTitle =
		provisionalTitle.trim() === ""
			? "(none — the filename carried no title)"
			: `"${provisionalTitle}"`;
	return promptMessages({
		system: titleJudgementPrompt(language),
		user: `Working title: ${workingTitle}\n\nLecture:\n${JSON.stringify(lecture)}`,
	});
}
