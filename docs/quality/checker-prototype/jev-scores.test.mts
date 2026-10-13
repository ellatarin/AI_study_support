import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTempDir } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/pipeline/fixtures.js";
import { type AskJev, JEV_SCORES_FILE, type JevState, readScoredFaults, scoreRunFaults } from "./jev-scores.mts";
import { subtopicResultFile } from "./prototype-layout.mts";

const runFolder = useTempDir({ prefix: "jev-scores-" });

const material = [{ subtopicId: 2, text: "The lecturer's words.", rewrite: ["First paragraph.", "Second paragraph."] }];

const faults = [
	{ deficiencyType: "distortion", description: "A first fault.", sourcePassage: "lecturer's words", rewritePassage: "First paragraph" },
	{ deficiencyType: "omission", description: "A second fault.", sourcePassage: "The lecturer's", rewritePassage: null },
];

/**
 * Writes the check of subtopic 2, with its faults, in the run folder.
 *
 * @returns Nothing.
 */
async function writeCheck(): Promise<void> {
	await writeFile(
		join(runFolder(), subtopicResultFile(2)),
		JSON.stringify({ subtopicId: 2, deficiencies: faults, considerations: [] }),
	);
}

/** A stub of Jev that scores each fault by the length of its description. */
const askJevStub: AskJev = async (state) => ({
	score: state.reportedFault.length / 100,
	jevModel: "jev-stub",
	inputTokens: 10,
});

describe("scoreRunFaults", () => {
	it("should write one Jev score for each fault of the run when Jev answers", async () => {
		await writeCheck();

		await scoreRunFaults({ runFolder: runFolder(), material, askJev: askJevStub });

		const saved: unknown = JSON.parse(await readFile(join(runFolder(), JEV_SCORES_FILE), "utf8"));
		expect(saved).toMatchObject({
			inputTokens: 20,
			scores: [
				{ subtopicId: 2, faultIndex: 0, score: 0.14, jevModel: "jev-stub" },
				{ subtopicId: 2, faultIndex: 1, score: 0.15, jevModel: "jev-stub" },
			],
		});
	});

	it("should give Jev the subtopic text, the joined rewrite and the fault's quotes when it asks about a fault", async () => {
		await writeCheck();
		const asked: JevState[] = [];

		await scoreRunFaults({
			runFolder: runFolder(),
			material,
			askJev: async (state) => {
				asked.push(state);
				return askJevStub(state);
			},
		});

		expect(asked).toEqual([
			{
				lecture: "The lecturer's words.",
				rewrite: "First paragraph.\n\nSecond paragraph.",
				reportedFault: "A first fault.",
				lecturePassage: "lecturer's words",
				rewritePassage: "First paragraph",
			},
			{
				lecture: "The lecturer's words.",
				rewrite: "First paragraph.\n\nSecond paragraph.",
				reportedFault: "A second fault.",
				lecturePassage: "The lecturer's",
				rewritePassage: "none",
			},
		]);
	});

	it("should read each fault of the run with its Jev score when the run has scores", async () => {
		await writeCheck();
		await scoreRunFaults({ runFolder: runFolder(), material, askJev: askJevStub });

		const scored = await readScoredFaults(runFolder());

		expect(scored).toEqual([
			{ subtopicId: 2, description: "A first fault.", sourcePassage: "lecturer's words", rewritePassage: "First paragraph", jevScore: 0.14 },
			{ subtopicId: 2, description: "A second fault.", sourcePassage: "The lecturer's", rewritePassage: null, jevScore: 0.15 },
		]);
	});

	it("should fail when a subtopic of the run has no material", async () => {
		await writeCheck();

		await expect(scoreRunFaults({ runFolder: runFolder(), material: [], askJev: askJevStub })).rejects.toThrow(
			"Subtopic 2",
		);
	});
});
