/**
 * Reading the two parts of a configured model ID.
 *
 * A model ID is written `<provider>/<name>`, and its halves are wanted by
 * parties that never meet: the config loader matches the provider against
 * `modelIdCheck.exemptProviders` to decide whether the ID must appear in
 * OpenRouter's list, and Stage 2 sends ElevenLabs the name alone, which is the
 * only form that API accepts. Splitting it here is what stops those two drifting
 * over what separates the halves or which side of it each is reading
 * (technical-design.md §5 Stage 2, §6).
 */

/** What separates a model ID's provider from the name that provider knows it by. */
const PROVIDER_SEPARATOR = "/";

/** The two parts of a model ID. */
export type ModelIdParts = {
	/** The segment before the first separator, or `null` where the ID names no provider. */
	readonly provider: string | null;
	/** Everything after the first separator, or the whole ID where it carries none. */
	readonly name: string;
};

/**
 * Splits a configured model ID into the provider that serves it and the name
 * that provider knows it by.
 *
 * An ID carrying no separator yields a `null` provider rather than an empty
 * one, so it cannot be matched against a list of exempt providers: an
 * unqualified ID has nothing to opt out with, which is the rule §5 Stage 2
 * states and the reason config keeps the qualified form.
 *
 * @param modelId - The configured model ID.
 * @returns The provider, or `null` where the ID names none, together with the model's own name.
 * @example
 * splitModelId("elevenlabs/scribe_v2");  // { provider: "elevenlabs", name: "scribe_v2" }
 * splitModelId("scribe_v2");             // { provider: null, name: "scribe_v2" }
 */
export function splitModelId(modelId: string): ModelIdParts {
	const separatorIndex = modelId.indexOf(PROVIDER_SEPARATOR);
	if (separatorIndex === -1) {
		return { provider: null, name: modelId };
	}
	return {
		provider: modelId.slice(0, separatorIndex),
		name: modelId.slice(separatorIndex + PROVIDER_SEPARATOR.length),
	};
}
