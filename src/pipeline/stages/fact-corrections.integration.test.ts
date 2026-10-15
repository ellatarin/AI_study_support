import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	factCheckModelIds,
	factCorrectedSubtopicsFile,
	itFailsNamingAnUnusableLectureFile,
	readLectureFile,
	seededFactCorrectionRecord,
	seededFactualError,
	seedJsonFile,
	tobaccoSubtopic,
	useTempDir,
} from "../fixtures.js";
import {
	type FactCorrectedSubtopics,
	type FactCorrectionFile,
	readFactCorrections,
} from "./fact-corrections.js";

/** The file of one subtopic with no factual errors: its rewrite, unchanged. */
const correction: FactCorrectionFile = {
	subtopicId: tobaccoSubtopic.subtopicId,
	factCorrectionPromptVersion: "k3",
	bypassed: false,
	factualErrors: [],
	factCorrectedSubtopic: tobaccoSubtopic.rewrittenSubtopic,
	changes: [],
	checkedBy: factCheckModelIds,
	paragraphCountBefore: tobaccoSubtopic.rewrittenSubtopic.length,
	paragraphCountAfter: tobaccoSubtopic.rewrittenSubtopic.length,
};

/** The file of the whole lecture: the model and the date of the correction, and {@link correction}. */
const correctedLecture: FactCorrectedSubtopics = {
	...seededFactCorrectionRecord,
	factCorrectedSubtopics: [correction],
};

describe("readFactCorrections", () => {
	const workspaceRoot = useTempDir({ prefix: "fact-corrections-" });

	it("should give the file of each subtopic when the lecture file has the documented shape", async () => {
		await seedJsonFile({
			path: join(workspaceRoot(), factCorrectedSubtopicsFile),
			contents: correctedLecture,
		});

		const file = await readLectureFile({ reader: readFactCorrections, workspaceRoot });

		expect(file).toEqual(correctedLecture);
	});

	itFailsNamingAnUnusableLectureFile({
		reader: readFactCorrections,
		workspaceRoot,
		path: (root) => join(root, factCorrectedSubtopicsFile),
		wrongEntries: [
			{
				state: "a file without the model of the correction",
				contents: JSON.stringify({ ...correctedLecture, correctedBy: undefined }),
			},
			{
				state: "a file without the date of the correction",
				contents: JSON.stringify({ ...correctedLecture, correctedOn: undefined }),
			},
			{
				state: "an entry without its bypass mark",
				contents: JSON.stringify({
					factCorrectedSubtopics: [{ ...correction, bypassed: undefined }],
				}),
			},
			{
				state: "an entry without its fact-corrected subtopic",
				contents: JSON.stringify({
					factCorrectedSubtopics: [{ ...correction, factCorrectedSubtopic: undefined }],
				}),
			},
			{
				state: "a change without its words before",
				contents: JSON.stringify({
					factCorrectedSubtopics: [
						{ ...correction, changes: [{ factualError: 1, after: "two", note: "" }] },
					],
				}),
			},
			{
				state: "a factual error without its problem",
				contents: JSON.stringify({
					factCorrectedSubtopics: [
						{ ...correction, factualErrors: [{ ...seededFactualError, problem: undefined }] },
					],
				}),
			},
		],
	});
});
