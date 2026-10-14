import { describe, expect, it } from "vitest";
import {
	itFailsNamingAnUnusableLectureFile,
	readLectureFile,
	seedJsonFile,
	useTempDir,
} from "../fixtures.js";
import {
	readSlideRelocations,
	type SlideRelocation,
	slideRelocationsPath,
} from "./slide-relocations.js";

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

	it("should give the entry of each subtopic when the file has the documented shape", async () => {
		await seedJsonFile({
			path: slideRelocationsPath(workspaceRoot()),
			contents: { slideRelocations: [relocation] },
		});

		const file = await readLectureFile({ reader: readSlideRelocations, workspaceRoot });

		expect(file).toEqual({ slideRelocations: [relocation] });
	});

	itFailsNamingAnUnusableLectureFile({
		reader: readSlideRelocations,
		workspaceRoot,
		path: slideRelocationsPath,
		wrongEntries: [
			{
				state: "an entry without its slides",
				contents: JSON.stringify({ slideRelocations: [{ ...relocation, slides: undefined }] }),
			},
		],
	});
});
