/**
 * This module tells if a parsed value has fields to read. The pipeline parses
 * the config file, manifests, run logs and model replies. Each parsed value is
 * `unknown` until a check reads it, and each check starts with this test.
 */

/**
 * Checks that a value has fields to read: an object that is not `null` and not an
 * array. An array fails, because each caller reads named fields. So a wrong shape
 * is found here, and not later as a missing field.
 *
 * @param value - The parsed value to test.
 * @returns `true` when the value's fields can be read.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Turns a check of a parsed value's shape into a function. The function gives
 * the value when the check accepts it, and `null` otherwise. The readers
 * of saved files and input files take a function of that kind.
 *
 * @param check - The check of the value's shape.
 * @returns The function that gives the value, or `null`.
 * @typeParam TValue - The shape that the check accepts.
 */
export function readerFromCheck<TValue>(
	check: (value: unknown) => value is TValue,
): (value: unknown) => TValue | null {
	return (value) => (check(value) ? value : null);
}
