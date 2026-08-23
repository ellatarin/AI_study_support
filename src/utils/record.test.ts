import { describe, expect, it } from "vitest";
import { isRecord } from "./record.js";

describe("isRecord", () => {
	it.each([
		{ scenario: "the value is an object with fields", value: { modelId: "openai/gpt-5" } },
		{ scenario: "the value is an object with none", value: {} },
	])("should accept the value when $scenario", ({ value }) => {
		expect(isRecord(value)).toBe(true);
	});

	it.each([
		{ scenario: "the value is null", value: null },
		{ scenario: "the value is an array", value: [] },
		{ scenario: "the value is a string", value: "openRouter" },
		{ scenario: "the value is a number", value: 3 },
		{ scenario: "the value is a boolean", value: true },
		{ scenario: "the value is absent", value: undefined },
	])("should reject the value when $scenario", ({ value }) => {
		expect(isRecord(value)).toBe(false);
	});

	it("should narrow the value to a readable record when the value is accepted", () => {
		const value: unknown = { languageCode: "en" };

		expect(isRecord(value) ? value.languageCode : null).toBe("en");
	});
});
