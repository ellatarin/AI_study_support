import { beforeEach, describe, expect, it } from "vitest";
import type { Manifest } from "../../../types/pipeline.js";
import {
	aiDerivedLecture,
	captureError,
	driveStage,
	makeManifest,
	makeStageContext,
	readJsonFile,
	seedEarlierOutputs,
	spoilJsonFile,
	transcriptStructuredTranscript,
	unusableTopicsWithSubtopicsFiles,
	unusableTranscripts,
	useStubLogger,
	useTranscribedWorkspace,
} from "../../fixtures.js";
import { stageOutputPath } from "../../layout.js";
import {
	createStructureTranscriptStage,
	StructureTranscriptError,
} from "./structure-transcript.js";

const STAGE_ID = "structure-transcript";

describe("structure-transcript", () => {
	const logged = useStubLogger();
	const workspace = useTranscribedWorkspace({ prefix: `${STAGE_ID}-` });

	beforeEach(async () => {
		await seedEarlierOutputs({
			workspaceRoot: workspace().workspaceRoot,
			readsFrom: ["retitle-subtopics", "group-into-topics"],
		});
	});

	function run(manifest: Partial<Manifest> = {}): ReturnType<typeof driveStage> {
		const { workspaceRoot } = workspace();
		return driveStage({
			stage: createStructureTranscriptStage({ logger: logged().logger }),
			context: makeStageContext({ workspaceRoot, manifest: makeManifest(manifest) }),
		});
	}

	function writtenStructuredTranscript(): Promise<unknown> {
		return readJsonFile(
			stageOutputPath({ workspaceRoot: workspace().workspaceRoot, stageId: STAGE_ID }),
		);
	}

	it("should write the lecture title, and each topic with its subtopics' ids, titles and texts in lecture order, when the stage completes", async () => {
		await run();

		expect(await writtenStructuredTranscript()).toStrictEqual(transcriptStructuredTranscript);
	});

	it("should write the manifest's lecture title when it differs from the provisional title", async () => {
		await run({ lectureTitle: aiDerivedLecture.title });

		expect(await writtenStructuredTranscript()).toMatchObject({
			lectureTitle: aiDerivedLecture.title,
		});
	});

	it("should record the one file written when the stage completes", async () => {
		const result = await run();

		expect(result).toMatchObject({
			filesWritten: ["Structured transcript/structured-transcript.json"],
		});
	});

	it.each(
		unusableTopicsWithSubtopicsFiles,
	)("should fail naming the file when the $file is $state", async ({ path: pathIn, contents }) => {
		const path = pathIn(workspace().workspaceRoot);
		await spoilJsonFile({ path, contents });

		const error = await captureError(run());

		expect(error).toBeInstanceOf(StructureTranscriptError);
		expect(error.message).toContain(path);
	});

	it.each(unusableTranscripts)("should fail when the transcript $state", async ({
		spoil,
		says,
	}) => {
		await spoil(workspace().workspaceRoot);

		const error = await captureError(run());

		expect(error).toBeInstanceOf(StructureTranscriptError);
		expect(error.message).toContain(says);
	});
});
