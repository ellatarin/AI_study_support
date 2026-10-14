import { describe, expect, it } from "vitest";
import { missingInputMessage } from "./stage-input.js";

describe("missingInputMessage", () => {
	it("should name the path and the stage to run when an input of an earlier stage is missing", () => {
		expect(missingInputMessage({ path: "/lecture/Slide images", stageId: "render-slides" })).toBe(
			"No file at /lecture/Slide images; run render-slides first",
		);
	});
});
