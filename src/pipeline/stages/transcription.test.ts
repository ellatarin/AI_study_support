import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import ffmpeg from "fluent-ffmpeg";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	ManifestStageEntry,
	PipelineConfig,
	StageContext,
	StageResult,
} from "../../types/pipeline.js";
import { CONFIG_FILENAME } from "../../types/pipeline.js";
import {
	exampleConfig,
	finishedEntry,
	interceptScribeUpload,
	loggedAt,
	makeConfig,
	makeManifest,
	makeStageContext,
	makeWorkspaceTree,
	resetStubbedApi,
	scribeResponseBody,
	stagesWith,
	stubElevenLabsApi,
	transcriptionModelId,
	transcriptText,
	useStubLogger,
} from "../fixtures.js";
import { stageOutputEntry, stageOutputPath } from "../layout.js";
import type { TranscriptionOutput } from "./transcription.js";
import { API_KEY_VARIABLE, createTranscriptionStage, TranscriptionError } from "./transcription.js";

vi.mock("fluent-ffmpeg", () => ({
	default: Object.assign(vi.fn(), { ffprobe: vi.fn() }),
}));

const ffprobeMock = ffmpeg.ffprobe as unknown as Mock;

const HALF_HOUR_SECONDS = 1800;

describe("createTranscriptionStage", () => {
	let moduleRoot: string;
	let workspaceRoot: string;
	const logged = useStubLogger();

	beforeEach(async () => {
		vi.clearAllMocks();
		stubElevenLabsApi();
		({ moduleRoot, workspaceRoot } = await makeWorkspaceTree({ prefix: "transcription-" }));
		await mkdir(dirname(audioPath()), { recursive: true });
		await writeFile(audioPath(), Buffer.alloc(4096, 7));
		stubDuration(HALF_HOUR_SECONDS);
	});

	afterEach(async () => {
		resetStubbedApi();
		await rm(moduleRoot, { recursive: true, force: true });
	});

	/** The audio Stage 1 is required to have left, for the workspace under test. */
	function audioPath(): string {
		return stageOutputPath({ workspaceRoot, stageId: "audio-extraction" });
	}

	/** Where this stage is required to leave its transcript. */
	function transcriptPath(): string {
		return stageOutputPath({ workspaceRoot, stageId: "transcription" });
	}

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

	function contextWith(
		overrides: {
			readonly entry?: ManifestStageEntry;
			readonly modelId?: string | null;
			readonly elevenLabs?: Partial<PipelineConfig["elevenLabs"]>;
		} = {},
	): StageContext {
		const modelId = overrides.modelId === undefined ? transcriptionModelId : overrides.modelId;
		return makeStageContext({
			workspaceRoot,
			config: makeConfig({
				elevenLabs: { ...exampleConfig.elevenLabs, ...overrides.elevenLabs },
				stages: modelId === null ? {} : { transcription: { modelId } },
			}),
			manifest: makeManifest(
				overrides.entry === undefined
					? {}
					: { stages: stagesWith({ stageId: "transcription", entry: overrides.entry }) },
			),
		});
	}

	/** The stage under test, logging into {@link logged}. */
	function makeStage(): ReturnType<typeof createTranscriptionStage> {
		return createTranscriptionStage({ logger: logged().logger });
	}

	async function runStage(context: StageContext): Promise<StageResult<TranscriptionOutput>> {
		const stage = makeStage();
		const input = await stage.getInput(context);
		return stage.run({ input, context });
	}

	it("should name the stage transcription when the stage is created", () => {
		expect(makeStage().stageId).toBe("transcription");
	});

	it("should skip transcription when output file exists and stage is complete", async () => {
		await mkdir(dirname(transcriptPath()), { recursive: true });
		await writeFile(transcriptPath(), transcriptText);
		const context = contextWith({
			entry: finishedEntry({
				configUsed: { modelId: transcriptionModelId },
				filesWritten: [stageOutputEntry("transcription")],
			}),
		});

		expect(await makeStage().isComplete(context)).toBe(true);
	});

	it("should fail when the extracted audio is missing", async () => {
		await rm(audioPath());

		await expect(makeStage().getInput(contextWith())).rejects.toThrow(TranscriptionError);
	});

	it.each([
		{ label: "unset", value: undefined },
		{ label: "empty", value: "" },
	])("should fail before uploading when ELEVENLABS_API_KEY is $label", async ({ value }) => {
		vi.stubEnv(API_KEY_VARIABLE, value);
		const { scope } = interceptScribeUpload();

		await expect(runStage(contextWith())).rejects.toThrow(TranscriptionError);
		expect(scope.isDone()).toBe(false);
	});

	it("should fail before uploading when the transcription stage has no configured model", async () => {
		const { scope } = interceptScribeUpload();

		await expect(runStage(contextWith({ modelId: null }))).rejects.toThrow(TranscriptionError);
		// The remedy is an edit to the config file, so the failure has to name it.
		await expect(runStage(contextWith({ modelId: null }))).rejects.toThrow(CONFIG_FILENAME);
		expect(scope.isDone()).toBe(false);
	});

	it("should strip the provider prefix when sending the model ID to ElevenLabs", async () => {
		const upload = interceptScribeUpload();

		await runStage(contextWith());

		expect(upload.uploadedBody()).toContain("scribe_v2");
		expect(upload.uploadedBody()).not.toContain(transcriptionModelId);
	});

	it("should send the model ID unchanged when it carries no provider prefix", async () => {
		const upload = interceptScribeUpload();

		await runStage(contextWith({ modelId: "scribe_v2" }));

		expect(upload.uploadedBody()).toContain("scribe_v2");
	});

	it("should request a non-verbatim transcript when calling Scribe", async () => {
		const upload = interceptScribeUpload();

		await runStage(contextWith());

		expect(upload.uploadedBody()).toContain("no_verbatim");
	});

	// A different language from the example config's, so passing could not come
	// from the stage having kept a hardcoded default that happens to match.
	it("should tell Scribe the configured spoken language when uploading", async () => {
		const upload = interceptScribeUpload();

		await runStage(contextWith({ elevenLabs: { languageCode: "fra" } }));

		expect(upload.uploadedBody()).toContain("fra");
	});

	it("should upload to the configured host when elevenLabs.baseUrl names another endpoint", async () => {
		const residencyOrigin = "https://api.eu.residency.elevenlabs.test";
		const { scope } = interceptScribeUpload({ origin: residencyOrigin });

		await runStage(contextWith({ elevenLabs: { baseUrl: residencyOrigin } }));

		expect(scope.isDone()).toBe(true);
	});

	it("should write the transcript with no .tmp left behind when the API returns text", async () => {
		interceptScribeUpload();

		await runStage(contextWith());

		expect(await readFile(transcriptPath(), "utf8")).toBe(transcriptText);
		expect(await readdir(dirname(transcriptPath()))).toStrictEqual([basename(transcriptPath())]);
	});

	it("should return correct filesWritten list when stage completes", async () => {
		interceptScribeUpload();

		const result = await runStage(contextWith());

		expect(result.filesWritten).toStrictEqual([stageOutputEntry("transcription")]);
		expect(result.output.transcriptPath).toBe(transcriptPath());
	});

	it("should record cost from audio duration and the configured rate when transcription completes", async () => {
		interceptScribeUpload();

		const result = await runStage(contextWith());

		expect(result.cost).toEqual({
			promptTokens: 0,
			completionTokens: 0,
			callCount: 1,
			// The stubbed duration is half an hour, so half the configured hourly rate.
			costUsd: expect.closeTo(exampleConfig.elevenLabs.costPerAudioHourUsd / 2, 6),
		});
	});

	it("should record a null cost with costResolutionError when the audio duration cannot be read", async () => {
		stubDurationFailure("ffprobe could not read the container");
		interceptScribeUpload();

		const result = await runStage(contextWith());

		expect(result.cost).toMatchObject({ callCount: 1, costUsd: null });
		expect(result.cost).toHaveProperty(
			"costResolutionError",
			expect.stringContaining("ffprobe could not read the container"),
		);
	});

	it("should warn when the audio duration cannot be read, since the run carries on regardless", async () => {
		stubDurationFailure("ffprobe could not read the container");
		interceptScribeUpload();

		await runStage(contextWith());

		const [warning] = loggedAt({ entries: logged().entries, level: "warn" });
		expect(warning?.message).toContain("ffprobe could not read the container");
		expect(warning?.bindings).toEqual({ stage: "transcription" });
	});

	it("should record the model, bytes uploaded and latency when the Scribe call completes", async () => {
		interceptScribeUpload();

		await runStage(contextWith());

		const [entry] = loggedAt({ entries: logged().entries, level: "debug" });
		expect(entry?.message).toBe("Transcription call");
		expect(entry?.payload).toEqual({
			model: "scribe_v2",
			uploadedBytes: expect.any(Number),
			latencyMs: expect.any(Number),
		});
	});

	it("should record a null cost when ffprobe reports no duration for the audio", async () => {
		ffprobeMock.mockImplementation(
			(_path: string, callback: (error: Error | null, data: unknown) => void) => {
				callback(null, { format: {} });
			},
		);
		interceptScribeUpload();

		const result = await runStage(contextWith());

		expect(result.cost).toHaveProperty(
			"costResolutionError",
			expect.stringContaining("no duration"),
		);
	});

	it("should still write the transcript when the audio duration cannot be read", async () => {
		stubDurationFailure("ffprobe could not read the container");
		interceptScribeUpload();

		const result = await runStage(contextWith());

		expect(result.filesWritten).toStrictEqual([stageOutputEntry("transcription")]);
		expect(await readFile(transcriptPath(), "utf8")).toBe(transcriptText);
	});

	it("should fail when the response carries no transcript text", async () => {
		// A well-formed Scribe body with the one field under test removed. `text:
		// undefined` drops out when nock serialises the reply as JSON.
		interceptScribeUpload({
			body: { ...scribeResponseBody({ text: "" }), text: undefined, transcripts: [] },
		});

		await expect(runStage(contextWith())).rejects.toThrow(TranscriptionError);
	});
});
