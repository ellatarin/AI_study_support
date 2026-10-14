import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	factCheckModelIds,
	factCorrectedSubtopicsFile,
	itFailsNamingAnUnusableLectureFile,
	readLectureFile,
	seededFactualError,
	seedJsonFile,
	tobaccoSubtopic,
	useTempDir,
} from "../fixtures.js";
import { type FactCorrectionFile, readFactCorrections } from "./fact-corrections.js";

/** The file of one subtopic with no factual errors: its rewrite, unchanged. */
const correction: FactCorrectionFile = {
	subtopicId: tobaccoSubtopic.subtopicId,
	factCorrectionPromptVersion: "k3",
	factualErrors: [],
	factCorrectedSubtopic: tobaccoSubtopic.rewrittenSubtopic,
	changes: [],
	checkedBy: factCheckModelIds,
	paragraphCountBefore: tobaccoSubtopic.rewrittenSubtopic.length,
	paragraphCountAfter: tobaccoSubtopic.rewrittenSubtopic.length,
};

describe("readFactCorrections", () => {
	const workspaceRoot = useTempDir({ prefix: "fact-corrections-" });

	it("should give the file of each subtopic when the lecture file has the documented shape", async () => {
		await seedJsonFile({
			path: join(workspaceRoot(), factCorrectedSubtopicsFile),
			contents: { factCorrectedSubtopics: [correction] },
		});

		const file = await readLectureFile({ reader: readFactCorrections, workspaceRoot });

		expect(file).toEqual({ factCorrectedSubtopics: [correction] });
	});

	itFailsNamingAnUnusableLectureFile({
		reader: readFactCorrections,
		workspaceRoot,
		path: (root) => join(root, factCorrectedSubtopicsFile),
		wrongEntries: [
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
