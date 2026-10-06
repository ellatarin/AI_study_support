/**
 * The messages that `transcript-structuring` sends: the title judgement and the
 * structuring rules (technical-design.md §5, `transcript-structuring` and "Where
 * prompts live").
 */

import type OpenAI from "openai";
import type { OutputLanguage } from "../../../types/pipeline.js";
import { languageRule } from "../../../utils/language.js";

/**
 * The shape of the reply, stated in the prompt. JSON mode does not fix the shape,
 * and a JSON-mode call must also ask for JSON in its messages (technical-design.md §6).
 */
const REPLY_CONTRACT = `Reply with a single JSON object and nothing else, in this exact shape:

{
  "provisionalTitleMeaningful": boolean,
  "suggestedTitle": string or null,
  "structuredMarkdown": string
}`;

/**
 * Gives the task of the model and its rules. The language rule does not break
 * the rule "Add nothing that is not in the transcript". It sets only the spelling,
 * and the transcript has no spelling of its own (technical-design.md §5,
 * `transcript-structuring`, "Transcript Structuring").
 *
 * @param language - The language of the notes, from `finalOutput.language`.
 * @returns The role and the rules of the system message.
 */
function roleAndRules(language: OutputLanguage): string {
	return `You are preparing a university lecture transcript for study use. You do two things in one pass: judge the lecture's working title, and structure the transcript.

TITLE JUDGEMENT
The working title comes from the filename the lecturer gave the recording, so it may be a full descriptive title, or it may be thin or meaningless. Judge whether it is meaningful and accurate for what the lecture actually covers.
- A title the lecturer wrote is authoritative. If it is meaningful and accurate, keep it: set "provisionalTitleMeaningful" to true and "suggestedTitle" to null. Do not propose something merely because you could phrase it better.
- Only if it is not meaningful — empty, generic, or at odds with the content — set "provisionalTitleMeaningful" to false and put a concise, descriptive academic title of four to eight words in "suggestedTitle". It becomes a filename, so use plain words.

STRUCTURING
Put the structured transcript in "structuredMarkdown", following these rules:
- Identify topic boundaries from what the lecturer says to signal them ("Now, moving on to...", "To summarise...").
- Use H2 (##) headings for major topics and H3 (###) for sub-topics.
- Remove filler words only — "um", "uh", "sort of", "you know". Every substantive statement is preserved.
- Convert spoken mathematics to LaTeX where you can tell that is what it is.
- Mark question-and-answer passages as a blockquote beginning "> **Q&A:**".
- Add nothing that is not in the transcript. Do not explain, expand, correct, or summarise beyond the structure asked for.
- ${languageRule({ language })}`;
}

/**
 * Builds the messages of the one model call of `transcript-structuring`.
 *
 * @param args - The title to judge and the transcript to structure.
 * @param args.transcriptText - The transcript from `transcription`.
 * @param args.provisionalTitle - The provisional title. It can be empty.
 * @param args.language - The language of the structured transcript, from `finalOutput.language`.
 * @returns The chat messages to send.
 */
export function buildStructuringMessages({
	transcriptText,
	provisionalTitle,
	language,
}: {
	readonly transcriptText: string;
	readonly provisionalTitle: string;
	readonly language: OutputLanguage;
}): readonly OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
	const workingTitle =
		provisionalTitle.trim() === ""
			? "(none — the filename carried no title)"
			: `"${provisionalTitle}"`;
	return [
		{ role: "system", content: `${roleAndRules(language)}\n\n${REPLY_CONTRACT}` },
		{
			role: "user",
			content: `Working title: ${workingTitle}\n\nTranscript:\n${transcriptText}`,
		},
	];
}
