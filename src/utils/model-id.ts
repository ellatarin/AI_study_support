/**
 * This module splits a model ID, written `<provider>/<name>`, into its two
 * parts. The config loader compares the provider with
 * `modelIdCheck.exemptProviders`. `transcription` sends ElevenLabs only the
 * name, because that API accepts no other form. Both split the ID here, so they
 * agree on the split (technical-design.md §5, `transcription`, and §6).
 */

/** The character between the provider and the name in a model ID. */
const PROVIDER_SEPARATOR = "/";

/** The two parts of a model ID. */
export type ModelIdParts = {
	/** The text before the first separator, or `null` when the ID names no provider. */
	readonly provider: string | null;
	/** The text after the first separator, or the whole ID when it has no separator. */
	readonly name: string;
};

/**
 * Splits a model ID into the provider and the name that the provider uses.
 *
 * An ID with no separator gives a `null` provider, not an empty one. So the
 * provider of such an ID cannot match an exempt provider (technical-design.md §5, `transcription`).
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
