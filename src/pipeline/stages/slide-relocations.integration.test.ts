import { describe, expect, it } from "vitest";
import { NamedError } from "../../utils/errors.js";
import {
	captureError,
	makeStageContext,
	seedJsonFile,
	seedTextFile,
	unusableJsonContents,
	useTempDir,
} from "../fixtures.js";
import {
	readSlideRelocations,
	type SlideRelocation,
	slideRelocationsPath,
} from "./slide-relocations.js";

/** The error of the reading stage in this suite. */
class ReadingStageError extends NamedError {}

/** The file of one subtopic, with one slide at a figure mark and one mark that points at no slide. */
const relocation: SlideRelocation = {
	subtopicId: 2,
	slideRelocationPromptVersion: "r4",
	paragraphs: [
		"Tobacco smoke causes most lung cancers. (Figure 1) Snuff causes mouth cancer. [FIGURE]",
	],
	slides: [{ slideNumber: 3, paragraphIndex: 0, characterOffset: 40, figureNumber: 1 }],
	figureMarksWithNoSlide: [{ paragraphIndex: 0, characterOffset: 79 }],
};

describe("readSlideRelocations", () => {
	const workspaceRoot = useTempDir({ prefix: "slide-relocations-" });

	/**
	 * Reads the file of the test workspace.
	 *
	 * @returns What {@link readSlideRelocations} gives.
	 */
	function read(): ReturnType<typeof readSlideRelocations> {
		return readSlideRelocations({
			context: makeStageContext({ workspaceRoot: workspaceRoot() }),
			fail: (message) => new ReadingStageError(message),
		});
	}

	it("should give the entry of each subtopic when the file has the documented shape", async () => {
		await seedJsonFile({
			path: slideRelocationsPath(workspaceRoot()),
			contents: { slideRelocations: [relocation] },
		});

		const file = await read();

		expect(file).toEqual({ slideRelocations: [relocation] });
	});

	it.each([
		...unusableJsonContents,
		{
			state: "an entry without its slides",
			contents: JSON.stringify({ slideRelocations: [{ ...relocation, slides: undefined }] }),
		},
	])("should fail with the reading stage's error that names the file when the file is $state", async ({
		contents,
	}) => {
		const path = slideRelocationsPath(workspaceRoot());
		if (contents !== null) {
			await seedTextFile({ path, contents });
		}

		const error = await captureError(read());

		expect(error).toBeInstanceOf(ReadingStageError);
		expect(error.message).toContain(path);
	});
});
