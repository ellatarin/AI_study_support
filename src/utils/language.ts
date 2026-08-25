/**
 * Recognising a string as a language the pipeline can write, reporting it when
 * it is not, and naming it in the words a prompt uses.
 *
 * Every stage that produces prose is told which language to write in, and the
 * config file is where that is chosen. The tag is validated once, when config
 * is loaded, so a stage is never handed a language it has no name for — and the
 * mapping from tag to name lives here rather than in each prompt, so the stages
 * cannot drift into instructing the model differently from one another
 * (technical-design.md §6).
 */

import type { OutputLanguage } from "../types/pipeline.js";
import { OUTPUT_LANGUAGES } from "../types/pipeline.js";

/**
 * Whether a string names a language the pipeline can write.
 *
 * A type guard rather than a boolean so a caller that has checked can go on to
 * use the value as an {@link OutputLanguage} without asserting it.
 *
 * @param value - The string to test.
 * @returns `true` when the string is a key of {@link OUTPUT_LANGUAGES}.
 */
export function isOutputLanguage(value: string): value is OutputLanguage {
	return Object.hasOwn(OUTPUT_LANGUAGES, value);
}

/**
 * Reports that something names no language the pipeline can write, listing the
 * languages it could have named.
 *
 * @param args - What to report against.
 * @param args.subject - The offending value as it should appear in the message, already quoted and labelled by the caller with the config key it came from.
 * @returns The message.
 * @example
 * unknownLanguageMessage({ subject: 'output.language "en-AU"' });
 * // 'output.language "en-AU" is not a language this pipeline can write. Languages are: en-GB, en-US'
 */
export function unknownLanguageMessage(args: { readonly subject: string }): string {
	const tags = Object.keys(OUTPUT_LANGUAGES).join(", ");
	return `${args.subject} is not a language this pipeline can write. Languages are: ${tags}`;
}

/**
 * The instruction telling a model which language to write in, as every prose
 * stage's prompt states it.
 *
 * The sentence lives here rather than in each prompt so the stages cannot drift
 * into wording it differently, and so the configured language reaches all of
 * them from one place. It is phrased as a rule because that is how each prompt
 * lists it, alongside the other rules that stage imposes.
 *
 * @param args - The language to instruct.
 * @param args.language - The configured language tag.
 * @returns The instruction, as a complete sentence.
 * @example
 * languageRule({ language: "en-GB" }); // → "Write in British English."
 */
export function languageRule(args: { readonly language: OutputLanguage }): string {
	return `Write in ${OUTPUT_LANGUAGES[args.language]}.`;
}
