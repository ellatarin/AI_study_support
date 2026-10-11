import { describe, expect, it } from "vitest";
import { outputLanguageNames } from "../pipeline/fixtures.js";
import type { OutputLanguage } from "../types/pipeline.js";
import { OUTPUT_LANGUAGES } from "../types/pipeline.js";
import {
	isOutputLanguage,
	languageName,
	languageRule,
	unknownLanguageMessage,
} from "./language.js";

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

describe("languageName", () => {
	it.each(outputLanguageNames)("should give $name when the tag is $language", ({
		language,
		name,
	}) => {
		expect(languageName({ language })).toBe(name);
	});
});

describe("languageRule", () => {
	it.each(
		outputLanguageNames,
	)("should instruct the model to write in $name when the tag is $language", ({
		language,
		name,
	}) => {
		expect(languageRule({ language })).toBe(`Write in ${name}.`);
	});

	it.each(
		OUTPUT_LANGUAGE_TAGS,
	)("should name the language in words rather than as a tag when the tag is %s", (tag) => {
		// A model cannot follow "Write in en-GB". So the tag becomes a name before
		// it reaches a prompt (technical-design.md §6).
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
