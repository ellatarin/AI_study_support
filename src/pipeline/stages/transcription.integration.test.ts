import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	exampleConfig,
	interceptScribeUpload,
	makeConfig,
	makeManifest,
	makeStageContext,
	makeStubLogger,
	makeWorkspaceTree,
	mediaTestTimeoutMs,
	renderFixtureMedia,
	resetStubbedApi,
	stubElevenLabsApi,
	toneInput,
	transcriptionModelId,
	transcriptText,
} from "../fixtures.js";
import { stageOutputEntry, stageOutputPath } from "../layout.js";
import { createTranscriptionStage } from "./transcription.js";

const FIXTURE_SECONDS = 2;
const SECONDS_PER_HOUR = 3600;

/**
 * Renders a real AAC-in-m4a fixture, so the stage streams genuine audio bytes and
 * `ffprobe` reads a genuine duration.
 */
function renderFixtureAudio(outputPath: string): Promise<void> {
	return renderFixtureMedia({
		ffmpegArgs: [...toneInput({ seconds: FIXTURE_SECONDS }), "-c:a", "aac", outputPath],
	});
}

describe("createTranscriptionStage against real audio", () => {
	let moduleRoot: string;
	let workspaceRoot: string;

	beforeEach(async () => {
		stubElevenLabsApi();
		({ moduleRoot, workspaceRoot } = await makeWorkspaceTree({ prefix: "transcription-live-" }));
		const audioPath = stageOutputPath({ workspaceRoot, stageId: "audio-extraction" });
		await mkdir(dirname(audioPath), { recursive: true });
		await renderFixtureAudio(audioPath);
	});

	afterEach(async () => {
		resetStubbedApi();
		await rm(moduleRoot, { recursive: true, force: true });
	});

	it(
		"should return transcript text when audio file uploaded to ElevenLabs",
		async () => {
			const upload = interceptScribeUpload();
			const stage = createTranscriptionStage({ logger: makeStubLogger().logger });
			const context = makeStageContext({
				workspaceRoot,
				manifest: makeManifest(),
				config: makeConfig({ stages: { transcription: { modelId: transcriptionModelId } } }),
			});

			const input = await stage.getInput(context);
			const result = await stage.run({ input, context });

			expect(upload.scope.isDone()).toBe(true);
			expect(upload.uploadedBody().length).toBeGreaterThan(0);
			expect(
				await readFile(stageOutputPath({ workspaceRoot, stageId: "transcription" }), "utf8"),
			).toBe(transcriptText);
			expect(result.filesWritten).toStrictEqual([stageOutputEntry("transcription")]);
			expect(result.cost?.costUsd).toBeCloseTo(
				(FIXTURE_SECONDS / SECONDS_PER_HOUR) * exampleConfig.elevenLabs.costPerAudioHourUsd,
				5,
			);
		},
		mediaTestTimeoutMs,
	);
});
