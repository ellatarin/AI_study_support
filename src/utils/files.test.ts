import { describe, expect, it } from "vitest";
import { jsonFileContent } from "./files.js";

describe("jsonFileContent", () => {
	it("should give the value as indented JSON ending in a newline when a value is given", () => {
		expect(jsonFileContent({ chosenRun: 2, changed: [1] })).toBe(
			'{\n  "chosenRun": 2,\n  "changed": [\n    1\n  ]\n}\n',
		);
	});
});
