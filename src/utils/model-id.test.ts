import { describe, expect, it } from "vitest";
import { splitModelId } from "./model-id.js";

describe("splitModelId", () => {
	it.each([
		{
			scenario: "the ID names a provider",
			modelId: "elevenlabs/scribe_v2",
			provider: "elevenlabs",
			name: "scribe_v2",
		},
		{
			scenario: "the ID names none",
			modelId: "scribe_v2",
			provider: null,
			name: "scribe_v2",
		},
		{
			// OpenRouter qualifies some IDs beyond the provider. The split is on the
			// FIRST separator, so everything after it is the name the provider knows.
			scenario: "the ID carries a further segment",
			modelId: "openrouter/anthropic/claude-sonnet-4",
			provider: "openrouter",
			name: "anthropic/claude-sonnet-4",
		},
	])("should read the provider as $provider when $scenario", ({ modelId, provider, name }) => {
		expect(splitModelId(modelId)).toStrictEqual({ provider, name });
	});
});
