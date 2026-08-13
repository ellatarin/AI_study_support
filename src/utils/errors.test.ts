import { describe, expect, it } from "vitest";
import { errorMessage, NamedError } from "./errors.js";

class SampleError extends NamedError {}

describe("NamedError", () => {
	it("should take its name from the concrete subclass when constructed", () => {
		const error = new SampleError("something went wrong");

		expect(error.name).toBe("SampleError");
		expect(error.message).toBe("something went wrong");
		expect(error).toBeInstanceOf(Error);
	});
});

describe("errorMessage", () => {
	it.each([
		{ label: "an Error", thrown: new Error("ffprobe failed"), expected: "ffprobe failed" },
		{ label: "a NamedError", thrown: new SampleError("bad manifest"), expected: "bad manifest" },
		{ label: "a string", thrown: "plain failure", expected: "plain failure" },
		{ label: "a number", thrown: 42, expected: "42" },
		{ label: "null", thrown: null, expected: "null" },
	])("should render $label when it is caught", ({ thrown, expected }) => {
		expect(errorMessage(thrown)).toBe(expected);
	});
});
