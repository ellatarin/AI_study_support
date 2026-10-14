import { describe, expect, it } from "vitest";
import { inAscendingOrder } from "./sort.js";

describe("inAscendingOrder", () => {
	it("should sort numbers from the smallest to the largest when it is the comparator of a sort", () => {
		const sorted = [12, 3, 40, 3, 7].sort(inAscendingOrder);

		expect(sorted).toStrictEqual([3, 3, 7, 12, 40]);
	});
});
