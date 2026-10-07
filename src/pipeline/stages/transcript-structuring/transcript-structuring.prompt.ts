/**
 * The messages that `transcript-structuring` sends: the structuring rules
 * (technical-design.md §5, `transcript-structuring` and "Where prompts live").
 */

/* jscpd:ignore-start -- these imports are the same as the imports of
   read-slides.prompt.ts. This stage will be removed, so the exemption is here
   and not in the module that stays. */
import type { OutputLanguage } from "../../../types/pipeline.js";
import { languageRule } from "../../../utils/language.js";
import { type PromptMessages, promptMessages } from "../model-stage.js";

/* jscpd:ignore-end */

/**
 * The shape of the reply, stated in the prompt. JSON mode does not fix the shape,
 * and a JSON-mode call must also ask for JSON in its messages (technical-design.md §6).
 */
const REPLY_CONTRACT = `Reply with a single JSON object and nothing else, in this exact shape:

{
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
	return `You are preparing a university lecture transcript for study use: structure the transcript.

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
 * @param args - The transcript to structure, and the language.
 * @param args.transcriptText - The transcript from `transcription`.
 * @param args.language - The language of the structured transcript, from `finalOutput.language`.
 * @returns The chat messages to send.
 */
export function buildStructuringMessages({
	transcriptText,
	language,
}: {
	readonly transcriptText: string;
	readonly language: OutputLanguage;
}): PromptMessages {
	return promptMessages({
		system: `${roleAndRules(language)}\n\n${REPLY_CONTRACT}`,
		user: `Transcript:\n${transcriptText}`,
	});
}
