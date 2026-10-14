import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { slideDeckReadings, testLecture, testModuleRoot } from "../fixtures.js";
import { slideImageFileName, stageDirectoryPath, workspaceRootFor } from "../layout.js";
import { findSlideReading, type SlideReading, slideImagePath } from "./slides.js";

const readings = slideDeckReadings as readonly SlideReading[];

describe("findSlideReading", () => {
	it("should give the reading with the slide number when the readings hold it", () => {
		expect(findSlideReading({ slideReadings: readings, slideNumber: 2 })).toBe(readings[1]);
	});

	it("should give undefined when no reading has the slide number", () => {
		expect(findSlideReading({ slideReadings: readings, slideNumber: 9 })).toBeUndefined();
	});
});

describe("slideImagePath", () => {
	// layout.test.ts checks the folder name and the file name. This test checks
	// that the path joins the folder of render-slides and the image name.
	it("should place the image of a slide in the folder of render-slides when the slide is numbered", () => {
		const workspaceRoot = workspaceRootFor({
			moduleRoot: testModuleRoot,
			baseName: testLecture.baseName,
		});

		expect(slideImagePath({ workspaceRoot, slideNumber: 4 })).toBe(
			join(stageDirectoryPath({ workspaceRoot, stageId: "render-slides" }), slideImageFileName(4)),
		);
	});
});
