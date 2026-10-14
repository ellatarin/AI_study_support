/**
 * This module checks the shape of a parsed value. The pipeline parses the config
 * file, manifests, run logs and model replies. Each parsed value is `unknown`
 * until a check reads it.
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
 * Gives the check that a value is one entry of a fixed list, such as a stage id
 * or a role. The check takes the value alone, because a type predicate cannot
 * name a field of an options object.
 *
 * @param list - The entries that a value can be.
 * @returns The check. It gives `true` when the value is an entry of `list`.
 * @typeParam TEntry - One entry of the list.
 * @example
 * isOneOf(MODEL_ROLES)("secondary"); // true
 */
export function isOneOf<TEntry>(list: readonly TEntry[]): (value: unknown) => value is TEntry {
	return (value): value is TEntry => (list as readonly unknown[]).includes(value);
}

/**
 * Checks that a value is a list of strings.
 *
 * @param value - The value to test.
 * @returns `true` when the value is an array and every entry is a string.
 */
export function isStringList(value: unknown): value is readonly string[] {
	return Array.isArray(value) && value.every((entry) => typeof entry === "string");
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
