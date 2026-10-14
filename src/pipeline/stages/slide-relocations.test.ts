import { describe, expect, it } from "vitest";
import { figureLabel, slideRelocationsDirectory } from "./slide-relocations.js";

describe("slideRelocationsDirectory", () => {
	it("should give the folder Slide relocations in the workspace when it gets the workspace", () => {
		expect(slideRelocationsDirectory("/lecture")).toBe("/lecture/Slide relocations");
	});
});

describe("figureLabel", () => {
	it("should give the word Figure and the figure number when a slide has a figure number", () => {
		expect(figureLabel(12)).toBe("Figure 12");
	});
});
