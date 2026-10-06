/**
 * This module checks the output language in the config file and gives the
 * sentence that tells a model which language to write. The config loader checks
 * the tag once. So a stage never gets a language that has no name. Each prompt
 * that names the output language takes the sentence from here, so the prompts
 * cannot word it differently
 * (technical-design.md §6).
 */

import type { OutputLanguage } from "../types/pipeline.js";
import { OUTPUT_LANGUAGES } from "../types/pipeline.js";

/**
 * Tells if a string is the tag of a language that the pipeline can write.
 *
 * @param value - The string to test.
 * @returns `true` when the string is a key of {@link OUTPUT_LANGUAGES}.
 */
export function isOutputLanguage(value: string): value is OutputLanguage {
	return Object.hasOwn(OUTPUT_LANGUAGES, value);
}

/**
 * Gives the message for a value that is not a language that the pipeline can
 * write. The message lists the languages.
 *
 * @param args - The bad value to report.
 * @param args.subject - The bad value, quoted, after the config key that it came from.
 * @returns The message.
 * @example
 * unknownLanguageMessage({ subject: 'finalOutput.language "en-AU"' });
 * // 'finalOutput.language "en-AU" is not a language this pipeline can write. Languages are: en-GB, en-US'
 */
export function unknownLanguageMessage(args: { readonly subject: string }): string {
	const tags = Object.keys(OUTPUT_LANGUAGES).join(", ");
	return `${args.subject} is not a language this pipeline can write. Languages are: ${tags}`;
}

/**
 * Gives the rule that tells a model which language to write. A prompt lists it
 * with its other rules.
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
