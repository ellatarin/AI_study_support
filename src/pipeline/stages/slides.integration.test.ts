import { rm } from "node:fs/promises";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { NamedError } from "../../utils/errors.js";
import {
	captureError,
	makeStageContext,
	seedSlideImages,
	seedSlideReadings,
	slideDeckReadings,
	useTempDir,
} from "../fixtures.js";
import { checkSlideImagesExist, readSlideReadings, slideImagePath } from "./slides.js";

/** The error of the reading stage in this suite. */
class ReadingStageError extends NamedError {}

const workspaceRoot = useTempDir({ prefix: "slides-" });

/**
 * Gives the reading stage of this suite in the test workspace, with slides 1 and 2.
 *
 * @returns The stage context, the slide numbers, and the builder of {@link ReadingStageError}.
 */
function readingStage(): Parameters<typeof checkSlideImagesExist>[0] {
	return {
		context: makeStageContext({ workspaceRoot: workspaceRoot() }),
		slideNumbers: [1, 2],
		fail: (message) => new ReadingStageError(message),
	};
}

describe("checkSlideImagesExist", () => {
	it("should resolve when the image of each slide is on disk", async () => {
		await seedSlideImages({ workspaceRoot: workspaceRoot(), count: 2 });

		await expect(checkSlideImagesExist(readingStage())).resolves.toBeUndefined();
	});

	it("should fail with the reading stage's error that names the image and render-slides when an image is missing", async () => {
		await seedSlideImages({ workspaceRoot: workspaceRoot(), count: 2 });
		const missing = slideImagePath({ workspaceRoot: workspaceRoot(), slideNumber: 2 });
		await rm(missing);

		const error = await captureError(checkSlideImagesExist(readingStage()));

		expect(error).toBeInstanceOf(ReadingStageError);
		expect(error.message).toContain(basename(missing));
		expect(error.message).toContain("run render-slides first");
	});
});

describe("readSlideReadings", () => {
	it("should give the reading of each slide in the order of the slide numbers when each reading is on disk", async () => {
		await seedSlideReadings({ workspaceRoot: workspaceRoot(), readings: slideDeckReadings });

		const readings = await readSlideReadings({ ...readingStage(), slideNumbers: [3, 1] });

		expect(readings.map(({ slideNumber }) => slideNumber)).toEqual([3, 1]);
	});
});
