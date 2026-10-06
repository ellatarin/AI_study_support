import { describe, expect, it } from "vitest";
import {
	captureError,
	driveStage,
	earlierSavedRun,
	makeConfig,
	makeStageContext,
	readJsonFile,
	seedSavedRuns,
	transcriptDivision,
	useStubLogger,
	useTranscribedWorkspace,
} from "../../fixtures.js";
import { stageOutputPath, stageRecordPath } from "../../layout.js";
import { ChooseDivisionError, createChooseDivisionStage } from "./choose-division.js";

const STAGE_ID = "choose-division";
// The stage calls no model, so it needs no stage entry of its own.
const config = makeConfig();
const PANEL_SIZE = config.subtopicSplitting.panelSize;

describe("choose-division", () => {
	const logged = useStubLogger();
	const workspace = useTranscribedWorkspace({ prefix: "choose-division-" });

	/** Leaves deepened splitting runs 1 to `count` on disk, run 1 cutting nowhere and the rest as the fixture division does. */
	function seedDeepenedSplittingRuns(count: number): Promise<void> {
		return seedSavedRuns({
			workspaceRoot: workspace().workspaceRoot,
			stageId: "deepen-subtopic-splitting",
			count,
			contents: (runNumber) => (runNumber === 1 ? earlierSavedRun : transcriptDivision),
		});
	}

	function run(): ReturnType<typeof driveStage> {
		return driveStage({
			stage: createChooseDivisionStage({ logger: logged().logger }),
			context: makeStageContext({ workspaceRoot: workspace().workspaceRoot, config }),
		});
	}

	it("should write the chosen run's subtopics, and beside them which run was chosen, when the stage completes", async () => {
		await seedDeepenedSplittingRuns(PANEL_SIZE);
		const { workspaceRoot } = workspace();

		const result = await run();

		expect(await readJsonFile(stageOutputPath({ workspaceRoot, stageId: STAGE_ID }))).toStrictEqual(
			transcriptDivision,
		);
		expect(await readJsonFile(stageRecordPath({ workspaceRoot, stageId: STAGE_ID }))).toStrictEqual(
			{
				chosenRun: 2,
				distanceFromVote: 0,
				panelSize: PANEL_SIZE,
			},
		);
		expect(result).toMatchObject({
			cost: null,
			filesWritten: ["Chosen division/subtopics.json", "Chosen division/choice.json"],
		});
	});

	it("should fail naming the missing run when fewer deepened splitting runs are saved than the panel holds", async () => {
		await seedDeepenedSplittingRuns(PANEL_SIZE - 1);

		const error = await captureError(run());

		expect(error).toBeInstanceOf(ChooseDivisionError);
		expect(error.message).toContain(`run-${PANEL_SIZE}.json`);
	});
});
