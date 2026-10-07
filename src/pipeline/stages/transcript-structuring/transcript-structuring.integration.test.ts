import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, it } from "vitest";
import {
	configuringStage,
	driveStage,
	exampleConfig,
	expectJsonModeRequest,
	makeLectureTree,
	makeStageContext,
	makeStubLogger,
	openRouterClientFor,
	resetStubbedApi,
	seedStageOutput,
	structuringReply,
	stubModelReply,
	stubOpenRouterApi,
	transcriptText,
} from "../../fixtures.js";
import { createTranscriptStructuringStage } from "./transcript-structuring.js";

describe("transcript structuring against a real module tree", () => {
	let tempDir: string;
	let workspaceRoot: string;

	beforeEach(async () => {
		stubOpenRouterApi();

		({ tempDir, workspaceRoot } = await makeLectureTree({ prefix: "structuring-int-" }));
		await seedStageOutput({ workspaceRoot, stageId: "transcription", contents: transcriptText });
	});

	afterEach(async () => {
		resetStubbedApi();
		await rm(tempDir, { recursive: true, force: true });
	});

	it("should ask OpenRouter for JSON when the stage calls the model", async () => {
		const sentRequest = stubModelReply(structuringReply());
		const stage = createTranscriptStructuringStage({
			logger: makeStubLogger().logger,
			client: openRouterClientFor({ config: exampleConfig }),
		});

		await driveStage({
			stage,
			context: makeStageContext({
				workspaceRoot,
				config: configuringStage({ stageId: "transcript-structuring" }),
			}),
		});

		expectJsonModeRequest(sentRequest());
	});
});
