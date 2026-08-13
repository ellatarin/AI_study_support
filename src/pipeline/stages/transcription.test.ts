import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import ffmpeg from "fluent-ffmpeg";
import nock from "nock";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManifestStageEntry, StageContext, StageResult } from "../../types/pipeline.js";
import {
	makeConfig,
	makeManifest,
	makeStageContext,
	makeWorkspaceTree,
	resetElevenLabsApi,
	stagesWith,
	stubElevenLabsApi,
} from "../fixtures.js";
import type { TranscriptionOutput } from "./transcription.js";
import { createTranscriptionStage, TranscriptionError } from "./transcription.js";

vi.mock("fluent-ffmpeg", () => ({
	default: Object.assign(vi.fn(), { ffprobe: vi.fn() }),
}));

const ffprobeMock = ffmpeg.ffprobe as unknown as Mock;

const ELEVENLABS_ORIGIN = "https://api.elevenlabs.io";
const SPEECH_TO_TEXT_PATH = "/v1/speech-to-text";
const AUDIO_ENTRY = join("Audio", "audio.m4a");
const TRANSCRIPT_ENTRY = join("Transcript", "transcript.txt");
const TRANSCRIPT_TEXT = "Today we are covering cell injury.";
const HALF_HOUR_SECONDS = 1800;
const COST_PER_AUDIO_HOUR_USD = 0.22;

/** A Scribe v2 single-channel response body, as the SDK expects to deserialise it. */
function scribeResponse(text: string): Record<string, unknown> {
	return { language_code: "eng", language_probability: 0.99, text, words: [] };
}

describe("createTranscriptionStage", () => {
	let moduleRoot: string;
	let workspaceRoot: string;
	let capturedBody: string;

	beforeEach(async () => {
		vi.clearAllMocks();
		capturedBody = "";
		stubElevenLabsApi();
		({ moduleRoot, workspaceRoot } = await makeWorkspaceTree({ prefix: "transcription-" }));
		await mkdir(join(workspaceRoot, "Audio"), { recursive: true });
		await writeFile(join(workspaceRoot, AUDIO_ENTRY), Buffer.alloc(4096, 7));
		stubDuration(HALF_HOUR_SECONDS);
	});

	afterEach(async () => {
		resetElevenLabsApi();
		await rm(moduleRoot, { recursive: true, force: true });
	});

	function stubDuration(seconds: number): void {
		ffprobeMock.mockImplementation(
			(_path: string, callback: (error: Error | null, data: unknown) => void) => {
				callback(null, { format: { duration: seconds } });
			},
		);
	}

	function stubDurationFailure(message: string): void {
		ffprobeMock.mockImplementation(
			(_path: string, callback: (error: Error | null, data: unknown) => void) => {
				callback(new Error(message), null);
			},
		);
	}

	function interceptTranscription(body: Record<string, unknown>): nock.Scope {
		return nock(ELEVENLABS_ORIGIN)
			.post(SPEECH_TO_TEXT_PATH)
			.reply(200, (_uri: string, requestBody: nock.Body) => {
				capturedBody = typeof requestBody === "string" ? requestBody : JSON.stringify(requestBody);
				return body;
			});
	}

	function contextWith(
		overrides: { readonly entry?: ManifestStageEntry; readonly modelId?: string | null } = {},
	): StageContext {
		const modelId = overrides.modelId === undefined ? "elevenlabs/scribe_v2" : overrides.modelId;
		return makeStageContext({
			workspaceRoot,
			config: makeConfig({
				elevenLabs: { costPerAudioHourUsd: COST_PER_AUDIO_HOUR_USD },
				stages: modelId === null ? {} : { transcription: { modelId } },
			}),
			manifest: makeManifest(
				overrides.entry === undefined
					? {}
					: { stages: stagesWith({ stageId: "transcription", entry: overrides.entry }) },
			),
		});
	}

	async function runStage(context: StageContext): Promise<StageResult<TranscriptionOutput>> {
		const stage = createTranscriptionStage();
		const input = await stage.getInput(context);
		return stage.run({ input, context });
	}

	it("should name the stage transcription when the stage is created", () => {
		expect(createTranscriptionStage().stageId).toBe("transcription");
	});

	it("should skip transcription when output file exists and stage is complete", async () => {
		await mkdir(join(workspaceRoot, "Transcript"), { recursive: true });
		await writeFile(join(workspaceRoot, TRANSCRIPT_ENTRY), TRANSCRIPT_TEXT);
		const context = contextWith({
			entry: {
				status: "complete",
				completedAt: "2025-10-10T10:00:00.000Z",
				configUsed: { modelId: "elevenlabs/scribe_v2" },
				cost: null,
				filesWritten: [TRANSCRIPT_ENTRY],
			},
		});

		expect(await createTranscriptionStage().isComplete(context)).toBe(true);
	});

	it("should fail when the extracted audio is missing", async () => {
		await rm(join(workspaceRoot, AUDIO_ENTRY));

		await expect(createTranscriptionStage().getInput(contextWith())).rejects.toThrow(
			TranscriptionError,
		);
	});

	it.each([
		{ label: "unset", value: undefined },
		{ label: "empty", value: "" },
	])("should fail before uploading when ELEVENLABS_API_KEY is $label", async ({ value }) => {
		vi.stubEnv("ELEVENLABS_API_KEY", value);
		const scope = interceptTranscription(scribeResponse(TRANSCRIPT_TEXT));

		await expect(runStage(contextWith())).rejects.toThrow(TranscriptionError);
		expect(scope.isDone()).toBe(false);
	});

	it("should fail before uploading when the transcription stage has no configured model", async () => {
		const scope = interceptTranscription(scribeResponse(TRANSCRIPT_TEXT));

		await expect(runStage(contextWith({ modelId: null }))).rejects.toThrow(TranscriptionError);
		expect(scope.isDone()).toBe(false);
	});

	it("should strip the provider prefix when sending the model ID to ElevenLabs", async () => {
		interceptTranscription(scribeResponse(TRANSCRIPT_TEXT));

		await runStage(contextWith());

		expect(capturedBody).toContain("scribe_v2");
		expect(capturedBody).not.toContain("elevenlabs/scribe_v2");
	});

	it("should send the model ID unchanged when it carries no provider prefix", async () => {
		interceptTranscription(scribeResponse(TRANSCRIPT_TEXT));

		await runStage(contextWith({ modelId: "scribe_v2" }));

		expect(capturedBody).toContain("scribe_v2");
	});

	it("should request an English non-verbatim transcript when calling Scribe", async () => {
		interceptTranscription(scribeResponse(TRANSCRIPT_TEXT));

		await runStage(contextWith());

		expect(capturedBody).toContain("eng");
		expect(capturedBody).toContain("no_verbatim");
	});

	it("should write the transcript with no .tmp left behind when the API returns text", async () => {
		interceptTranscription(scribeResponse(TRANSCRIPT_TEXT));

		await runStage(contextWith());

		expect(await readFile(join(workspaceRoot, TRANSCRIPT_ENTRY), "utf8")).toBe(TRANSCRIPT_TEXT);
		expect(await readdir(join(workspaceRoot, "Transcript"))).toStrictEqual(["transcript.txt"]);
	});

	it("should return correct filesWritten list when stage completes", async () => {
		interceptTranscription(scribeResponse(TRANSCRIPT_TEXT));

		const result = await runStage(contextWith());

		expect(result.filesWritten).toStrictEqual([TRANSCRIPT_ENTRY]);
		expect(result.output.transcriptPath).toBe(join(workspaceRoot, TRANSCRIPT_ENTRY));
	});

	it("should record cost from audio duration and the configured rate when transcription completes", async () => {
		interceptTranscription(scribeResponse(TRANSCRIPT_TEXT));

		const result = await runStage(contextWith());

		expect(result.cost).toEqual({
			promptTokens: 0,
			completionTokens: 0,
			callCount: 1,
			totalCostUsd: expect.closeTo(COST_PER_AUDIO_HOUR_USD / 2, 6),
		});
	});

	it("should record a null cost with costResolutionError when the audio duration cannot be read", async () => {
		stubDurationFailure("ffprobe could not read the container");
		interceptTranscription(scribeResponse(TRANSCRIPT_TEXT));

		const result = await runStage(contextWith());

		expect(result.cost).toMatchObject({ callCount: 1, totalCostUsd: null });
		expect(result.cost).toHaveProperty(
			"costResolutionError",
			expect.stringContaining("ffprobe could not read the container"),
		);
	});

	it("should record a null cost when ffprobe reports no duration for the audio", async () => {
		ffprobeMock.mockImplementation(
			(_path: string, callback: (error: Error | null, data: unknown) => void) => {
				callback(null, { format: {} });
			},
		);
		interceptTranscription(scribeResponse(TRANSCRIPT_TEXT));

		const result = await runStage(contextWith());

		expect(result.cost).toHaveProperty(
			"costResolutionError",
			expect.stringContaining("no duration"),
		);
	});

	it("should still write the transcript when the audio duration cannot be read", async () => {
		stubDurationFailure("ffprobe could not read the container");
		interceptTranscription(scribeResponse(TRANSCRIPT_TEXT));

		const result = await runStage(contextWith());

		expect(result.filesWritten).toStrictEqual([TRANSCRIPT_ENTRY]);
		expect(await readFile(join(workspaceRoot, TRANSCRIPT_ENTRY), "utf8")).toBe(TRANSCRIPT_TEXT);
	});

	it("should fail when the response carries no transcript text", async () => {
		nock(ELEVENLABS_ORIGIN)
			.post(SPEECH_TO_TEXT_PATH)
			.reply(200, { transcripts: [], language_code: "eng", language_probability: 0.99 });

		await expect(runStage(contextWith())).rejects.toThrow(TranscriptionError);
	});
});
