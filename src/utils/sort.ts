/** The comparators that the sorts of the project share. */

/**
 * Compares two numbers for a sort from the smallest to the largest.
 *
 * @param first - The first number.
 * @param second - The second number.
 * @returns A negative number when `first` is smaller, zero when the two are equal, and a positive number otherwise.
 */
// eslint-disable-next-line max-params -- the specification sets the parameters of the comparator of Array.prototype.sort.
export function inAscendingOrder(first: number, second: number): number {
	return first - second;
}
