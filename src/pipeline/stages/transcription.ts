import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import type { FfprobeData } from "fluent-ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import type { Logger } from "pino";
import type {
	CostResolution,
	PipelineConfig,
	PipelineStage,
	StageContext,
	StageCost,
	StageResult,
} from "../../types/pipeline.js";
import { errorMessage, NamedError } from "../../utils/errors.js";
import { splitModelId } from "../../utils/model-id.js";
import { createUploadProgressStream } from "../../utils/progress.js";
import { configuredStage, unconfiguredStageMessage } from "../../utils/stage-config.js";
import { stageOutputPath } from "../layout.js";
import { createPipelineStage, writeStageOutput } from "./pipeline-stage.js";

/**
 * Thrown when transcription cannot proceed or cannot produce a transcript: the
 * extracted audio is missing, `ELEVENLABS_API_KEY` is unset, the stage has no
 * configured model, or the API returns a response carrying no transcript text.
 * A failed cost lookup is NOT one of these — cost telemetry never gates pipeline
 * progress (technical-design.md §5, Stage 2; §7).
 */
export class TranscriptionError extends NamedError {}

/** The extracted audio Stage 2 uploads. */
export type TranscriptionInput = {
	/** Absolute path to `Audio/audio.m4a`. */
	readonly audioPath: string;
	/** The audio's size on disk, used as the upload progress bar's target. */
	readonly sizeBytes: number;
};

/** The transcript Stage 2 produces. */
export type TranscriptionOutput = {
	/** Absolute path to the written `Transcript/transcript.txt`. */
	readonly transcriptPath: string;
};

/**
 * ElevenLabs' endpoints, relative to the configured base URL.
 *
 * `speechToText` is the SDK's own route — the stage never builds it — and is
 * named here only so a test intercepting the upload does not have to know it
 * independently of the code under test, exactly as `OPENROUTER_PATHS` does. Its
 * `v1` is the API version, not the Scribe version: one endpoint serves every
 * Scribe model, and which one runs is decided by `model_id` in the request body
 * (technical-design.md §6).
 */
export const ELEVENLABS_PATHS = {
	speechToText: "/v1/speech-to-text",
} as const;

/**
 * The environment variable holding the ElevenLabs API key. Exported because the
 * suites that stub or unset it must name the same variable the stage reads; the
 * key itself is a secret and never leaves the environment.
 */
export const API_KEY_VARIABLE = "ELEVENLABS_API_KEY";

const STAGE_ID = "transcription";
const SECONDS_PER_HOUR = 3600;

/**
 * The SDK narrows `modelId` to the Scribe versions it shipped with, but the model
 * is configuration (technical-design.md §6) — a newer Scribe ID must be usable by
 * editing `pipeline-config.json`, not by waiting for an SDK release. Deriving the
 * type here rather than hard-coding it keeps the cast at the call site honest
 * about exactly what is being widened; ElevenLabs rejects an unknown ID itself.
 */
type ScribeModelId = Parameters<ElevenLabsClient["speechToText"]["convert"]>[0]["modelId"];

/**
 * Resolves the extracted audio and its size.
 *
 * @param context - The current lecture run context.
 * @returns The audio path and byte size.
 * @throws {TranscriptionError} If Stage 1's audio is not on disk.
 */
async function locateAudio(context: StageContext): Promise<TranscriptionInput> {
	const audioPath = stageOutputPath({
		workspaceRoot: context.workspaceRoot,
		stageId: "audio-extraction",
	});
	try {
		const { size } = await stat(audioPath);
		return { audioPath, sizeBytes: size };
	} catch (error: unknown) {
		throw new TranscriptionError(
			`No extracted audio at ${audioPath}; run audio extraction first (${errorMessage(error)})`,
		);
	}
}

/**
 * Reads the ElevenLabs API key from the environment.
 *
 * @returns The API key.
 * @throws {TranscriptionError} If the variable is unset or empty.
 */
function requireApiKey(): string {
	const apiKey = process.env[API_KEY_VARIABLE];
	if (apiKey === undefined || apiKey.length === 0) {
		throw new TranscriptionError(`${API_KEY_VARIABLE} is not set; cannot transcribe`);
	}
	return apiKey;
}

/**
 * Resolves the configured model ID and strips its provider prefix. Config holds
 * the provider-qualified `elevenlabs/scribe_v2` because only a qualified ID can
 * be matched by `modelIdCheck.exemptProviders`, but the ElevenLabs API expects
 * the bare `scribe_v2` (technical-design.md §5, Stage 2).
 *
 * @param context - The current lecture run context.
 * @returns The bare model ID to send to ElevenLabs.
 * @throws {TranscriptionError} If the stage has no configured model.
 */
function resolveModelId(context: StageContext): string {
	const stageConfig = configuredStage({ config: context.config, stageId: STAGE_ID });
	if (stageConfig === null) {
		throw new TranscriptionError(unconfiguredStageMessage({ stageId: STAGE_ID }));
	}
	return splitModelId(stageConfig.modelId).name;
}

/**
 * Uploads the audio to ElevenLabs Scribe and returns the transcript text,
 * streaming the file through a byte-progress bar rather than buffering it.
 *
 * @param args - The call inputs.
 * @param args.apiKey - The ElevenLabs API key.
 * @param args.modelId - The bare Scribe model ID.
 * @param args.input - The audio to upload.
 * @param args.elevenLabs - Where ElevenLabs is and what language to expect, from config.
 * @returns The transcript text.
 * @throws {TranscriptionError} If the response carries no transcript text.
 */
async function requestTranscript({
	apiKey,
	modelId,
	input,
	elevenLabs,
}: {
	readonly apiKey: string;
	readonly modelId: string;
	readonly input: TranscriptionInput;
	readonly elevenLabs: PipelineConfig["elevenLabs"];
}): Promise<string> {
	const { stream, bar } = createUploadProgressStream(input.sizeBytes);
	const client = new ElevenLabsClient({ apiKey, baseUrl: elevenLabs.baseUrl });
	try {
		const result = await client.speechToText.convert({
			file: createReadStream(input.audioPath).pipe(stream),
			modelId: modelId as ScribeModelId,
			languageCode: elevenLabs.languageCode,
			// Supported only on scribe_v2, so it travels with that model ID.
			noVerbatim: true,
			// Defaults to true, which writes the transcriber's own notes into the
			// transcript — "[coughing]", "[lip smacks]", "[audience applauding]".
			// They are not words the lecturer said, and every later stage has to
			// treat them as though they were: they are quoted back, summarised, and
			// counted as content. Off, so the transcript holds speech only.
			tagAudioEvents: false,
		});
		if (!("text" in result)) {
			throw new TranscriptionError("ElevenLabs returned no transcript text for the uploaded audio");
		}
		return result.text;
	} finally {
		bar.stop();
	}
}

/**
 * Reads an audio file's duration in seconds with `ffprobe`.
 *
 * @param audioPath - Absolute path to the audio file.
 * @returns The duration in seconds.
 * @throws {TranscriptionError} If ffprobe reports no duration for the file.
 */
function readDurationSeconds(audioPath: string): Promise<number> {
	// eslint-disable-next-line max-params -- Promise executor signature is spec-defined
	return new Promise((resolve, reject) => {
		// eslint-disable-next-line max-params, @typescript-eslint/prefer-readonly-parameter-types -- fluent-ffmpeg fixes ffprobe's callback signature, both its arity and its parameter types; both parameters are only read here (CLAUDE.md permits dropping readonly where a library requires a mutable type)
		ffmpeg.ffprobe(audioPath, (error: Error | null, data: FfprobeData) => {
			if (error) {
				reject(error);
				return;
			}
			const duration = data.format.duration;
			if (typeof duration !== "number") {
				reject(new TranscriptionError(`ffprobe reported no duration for ${audioPath}`));
				return;
			}
			resolve(duration);
		});
	});
}

/** What pricing a transcription needs to know, as both readers below take it. */
type AudioPricing = {
	readonly audioPath: string;
	readonly costPerAudioHourUsd: number;
	readonly logger: Logger;
};

/**
 * What this stage's one upload cost.
 *
 * Scribe bills by audio duration rather than by tokens, so the counts a
 * token-billed stage would carry are all zero here and the call count is the one
 * upload; what the duration came to is {@link priceAudio}'s answer
 * (technical-design.md §7).
 *
 * @param args - The pricing inputs, as {@link priceAudio} describes them.
 * @returns The stage's cost.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- AudioPricing carries pino's Logger, which has mutable properties the rule cannot see past; it is only logged to here (CLAUDE.md permits dropping readonly where a library requires a mutable type)
async function deriveCost(args: AudioPricing): Promise<StageCost> {
	return { promptTokens: 0, completionTokens: 0, callCount: 1, ...(await priceAudio(args)) };
}

/**
 * Prices the transcription from the audio's duration, ElevenLabs returning no
 * price with a transcript.
 *
 * A duration that cannot be read yields a `null` cost carrying the reason: the
 * stage still succeeds, because cost telemetry must never gate pipeline progress
 * (technical-design.md §7). The failure is logged as well as recorded, since the
 * run carries on regardless and without a log line the only trace of it is a
 * `null` in a cost report read days later (technical-design.md §10).
 *
 * @param args - The pricing inputs.
 * @param args.audioPath - Absolute path to the transcribed audio.
 * @param args.costPerAudioHourUsd - The configured Scribe rate per audio hour.
 * @param args.logger - The stage's logger, which records a failed duration lookup.
 * @returns The cost, or `null` with the reason it could not be read.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- AudioPricing carries pino's Logger, which has mutable properties the rule cannot see past; it is only logged to here (CLAUDE.md permits dropping readonly where a library requires a mutable type)
async function priceAudio({
	audioPath,
	costPerAudioHourUsd,
	logger,
}: AudioPricing): Promise<CostResolution> {
	try {
		const seconds = await readDurationSeconds(audioPath);
		return { costUsd: (seconds / SECONDS_PER_HOUR) * costPerAudioHourUsd };
	} catch (error: unknown) {
		const costResolutionError = `Audio duration lookup failed: ${errorMessage(error)}`;
		logger.warn({ audioPath, err: error }, costResolutionError);
		return { costUsd: null, costResolutionError };
	}
}

/**
 * Transcribes the extracted audio and writes `Transcript/transcript.txt`
 * atomically. The API key and model are resolved before any upload begins, so a
 * misconfigured run fails without spending (technical-design.md §5, Stage 2).
 *
 * The upload is a billable model call, so it is logged like one — the model, the
 * bytes sent, and how long it took (technical-design.md §10).
 *
 * @param args - The run inputs.
 * @param args.input - The located audio to upload.
 * @param args.context - The current lecture run context.
 * @param args.logger - The stage's logger, which records the Scribe call.
 * @returns The transcript path, the duration-derived cost, and the file written.
 * @throws {TranscriptionError} If the key or model is missing, or no text is returned.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger carries mutable properties the rule cannot see past; it is only logged to here (CLAUDE.md permits dropping readonly where a library requires a mutable type)
async function transcribeAudio({
	input,
	context,
	logger,
}: {
	readonly input: TranscriptionInput;
	readonly context: StageContext;
	readonly logger: Logger;
}): Promise<StageResult<TranscriptionOutput>> {
	const apiKey = requireApiKey();
	const modelId = resolveModelId(context);

	const startedAt = performance.now();
	const text = await requestTranscript({
		apiKey,
		modelId,
		input,
		elevenLabs: context.config.elevenLabs,
	});
	logger.debug(
		{
			model: modelId,
			uploadedBytes: input.sizeBytes,
			latencyMs: Math.round(performance.now() - startedAt),
		},
		"Transcription call",
	);
	const { path: transcriptPath, filesWritten } = await writeStageOutput({
		stageId: STAGE_ID,
		workspaceRoot: context.workspaceRoot,
		content: text,
	});

	const cost = await deriveCost({
		audioPath: input.audioPath,
		costPerAudioHourUsd: context.config.elevenLabs.costPerAudioHourUsd,
		logger,
	});
	return { output: { transcriptPath }, cost, filesWritten };
}

/**
 * Builds Stage 2, which uploads `Audio/audio.m4a` to ElevenLabs Scribe v2 and
 * writes the returned transcript to `Transcript/transcript.txt`
 * (technical-design.md §5, Stage 2).
 *
 * @param args - The stage's dependencies.
 * @param args.logger - The run's logger; the factory binds it to this stage.
 * @returns The transcription stage.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger carries mutable properties the rule cannot see past; it is only read from here (CLAUDE.md permits dropping readonly where a library requires a mutable type)
export function createTranscriptionStage({
	logger,
}: {
	readonly logger: Logger;
}): PipelineStage<TranscriptionInput, TranscriptionOutput> {
	return createPipelineStage({
		stageId: STAGE_ID,
		logger,
		getInput: locateAudio,
		run: transcribeAudio,
	});
}
