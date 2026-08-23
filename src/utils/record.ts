/**
 * Recognising a parsed value as something with fields to read.
 *
 * Every value this pipeline parses from outside itself — the config file, a
 * lecture's manifest, a model's JSON reply — is `unknown` until something checks
 * it, and each check begins by asking the same question: is this an object whose
 * fields can be read at all? That question is written once here so the four
 * modules asking it (technical-design.md §6, §4.4, §7) share one answer.
 */

/**
 * Whether a value has fields to read: an object that is neither `null` nor an
 * array.
 *
 * Arrays are excluded because every caller goes on to read named fields, which
 * an array answers with `undefined` for all of them — a shape mismatch worth
 * reporting where it happens rather than as a missing field further down.
 *
 * A type guard rather than a boolean, so a caller that has checked can index the
 * value without asserting its type.
 *
 * @param value - The parsed value to test.
 * @returns `true` when the value's fields can be read.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
