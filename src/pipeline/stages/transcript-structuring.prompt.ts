/**
 * Stage 3's prompt: the title judgement and the transcript-structuring rules,
 * stated as chat messages.
 *
 * Kept beside the stage rather than inside it so that prompt changes — the part
 * iterated on hardest once real lectures run — read as their own diffs
 * (technical-design.md §5, "Where prompts live").
 */

import type OpenAI from "openai";
import type { OutputLanguage } from "../../types/pipeline.js";
import { languageRule } from "../../utils/language.js";

/**
 * The reply contract, restated in the prompt. JSON mode alone does not
 * guarantee the shape, and OpenRouter documents that a JSON-mode call must ask
 * for JSON in its messages too (technical-design.md §6).
 */
const REPLY_CONTRACT = `Reply with a single JSON object and nothing else, in this exact shape:

{
  "provisionalTitleMeaningful": boolean,
  "suggestedTitle": string or null,
  "structuredMarkdown": string
}`;

/**
 * What the model is asked to do, and the rules it must follow.
 *
 * The language rule sits alongside "add nothing that is not in the transcript"
 * and does not contradict it, because it corrects rather than adds: speech
 * carries no spelling, so the transcript's spelling is the transcriber's rather
 * than the lecturer's, and Stage 2 cannot influence it — ElevenLabs takes an
 * ISO-639-1 or ISO-639-3 language code, neither of which can express a regional
 * variant, so `eng` names English and nothing more. An LLM call is the first
 * point in the pipeline at which the output's language can be chosen at all.
 *
 * @param language - The configured language every prose stage writes in.
 * @returns The system prompt's role and rules.
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
 * Builds the messages for Stage 3's single call.
 *
 * @param args - What the model is being asked to judge and structure.
 * @param args.transcriptText - The raw transcript from Stage 2.
 * @param args.provisionalTitle - The title Stage 0 derived from the filename; may be empty.
 * @param args.language - The configured language the structured transcript is written in.
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
