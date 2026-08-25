import { describe, expect, it } from "vitest";
import type { OutputLanguage } from "../types/pipeline.js";
import { OUTPUT_LANGUAGES } from "../types/pipeline.js";
import { isOutputLanguage, languageRule, unknownLanguageMessage } from "./language.js";

const OUTPUT_LANGUAGE_TAGS = Object.keys(OUTPUT_LANGUAGES);

describe("isOutputLanguage", () => {
	it.each(OUTPUT_LANGUAGE_TAGS)("should accept %s when it is a supported language", (tag) => {
		expect(isOutputLanguage(tag)).toBe(true);
	});

	it.each([
		{ scenario: "the tag names a language with no regional variant", value: "en" },
		{ scenario: "the tag is a language this pipeline cannot write", value: "fr-FR" },
		{ scenario: "the tag is written in the wrong case", value: "en-gb" },
		{ scenario: "the value names nothing at all", value: "" },
	])("should reject the value when $scenario", ({ value }) => {
		expect(isOutputLanguage(value)).toBe(false);
	});
});

describe("languageRule", () => {
	it.each([
		{ language: "en-GB", expected: "Write in British English." },
		{ language: "en-US", expected: "Write in American English." },
	] as const)("should instruct the model with $expected when the tag is $language", ({
		language,
		expected,
	}) => {
		expect(languageRule({ language })).toBe(expected);
	});

	it.each(
		OUTPUT_LANGUAGE_TAGS,
	)("should name the language in words rather than as a tag when the tag is %s", (tag) => {
		// "Write in en-GB" is not an instruction a model can follow, which is the
		// whole reason a tag is mapped to a name before it reaches a prompt.
		expect(languageRule({ language: tag as OutputLanguage })).not.toContain(tag);
	});
});

describe("unknownLanguageMessage", () => {
	it("should name the offending subject when the subject is reported", () => {
		expect(unknownLanguageMessage({ subject: '"en-AU"' })).toContain('"en-AU"');
	});

	it("should list every supported language when the reader is shown what they could have named", () => {
		const message = unknownLanguageMessage({ subject: "anything" });

		for (const tag of OUTPUT_LANGUAGE_TAGS) {
			expect(message).toContain(tag);
		}
	});
});
