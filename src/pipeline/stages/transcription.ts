import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import type { FfprobeData } from "fluent-ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import type { Logger } from "pino";
import {
	CONFIG_FILENAME,
	type PipelineConfig,
	type PipelineStage,
	type StageContext,
	type StageCost,
	type StageResult,
} from "../../types/pipeline.js";
import { errorMessage, NamedError } from "../../utils/errors.js";
import { writeFileAtomic } from "../../utils/files.js";
import { splitModelId } from "../../utils/model-id.js";
import { createUploadProgressStream } from "../../utils/progress.js";
import { stageOutputEntry, stageOutputPath } from "../layout.js";
import { createPipelineStage } from "./pipeline-stage.js";

// prefer-readonly-parameter-types is disabled file-wide: every helper here takes
// the StageContext, whose RunManifest is a large intersection the rule cannot
// verify as deeply readonly. None of them mutate it; CLAUDE.md permits dropping
// readonly for such types.
/* eslint-disable @typescript-eslint/prefer-readonly-parameter-types */

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
	// Asked of the layout rather than restated here, so this stage and the stage
	// that extracted the audio cannot disagree about where it is (§3.3).
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
	const configured = context.config.stages[STAGE_ID]?.modelId;
	if (configured === undefined) {
		throw new TranscriptionError(
			`No model configured for stage "${STAGE_ID}" in ${CONFIG_FILENAME}`,
		);
	}
	return splitModelId(configured).name;
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
		// eslint-disable-next-line max-params -- ffprobe's callback signature is fixed by fluent-ffmpeg
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

/**
 * Derives the transcription cost from the audio's duration, since ElevenLabs
 * returns no price with a transcript. Scribe is billed by audio duration rather
 * than tokens, so the token counts are zero and `callCount` is one. A duration
 * that cannot be read yields a `null` cost carrying the reason — the stage still
 * succeeds, because cost telemetry must never gate pipeline progress
 * (technical-design.md §7).
 *
 * A failed lookup is logged as well as recorded on the cost: the run carries on
 * regardless, so without a log line the only trace of it is a `null` in a cost
 * report read days later (technical-design.md §10).
 *
 * @param args - The cost inputs.
 * @param args.audioPath - Absolute path to the transcribed audio.
 * @param args.costPerAudioHourUsd - The configured Scribe rate per audio hour.
 * @param args.logger - The stage's logger, which records a failed duration lookup.
 * @returns The resolved cost, or a `null` cost with its `costResolutionError`.
 */
async function deriveCost({
	audioPath,
	costPerAudioHourUsd,
	logger,
}: {
	readonly audioPath: string;
	readonly costPerAudioHourUsd: number;
	readonly logger: Logger;
}): Promise<StageCost> {
	const base = { promptTokens: 0, completionTokens: 0, callCount: 1 };
	try {
		const seconds = await readDurationSeconds(audioPath);
		return { ...base, costUsd: (seconds / SECONDS_PER_HOUR) * costPerAudioHourUsd };
	} catch (error: unknown) {
		const costResolutionError = `Audio duration lookup failed: ${errorMessage(error)}`;
		logger.warn({ audioPath, err: error }, costResolutionError);
		return { ...base, costUsd: null, costResolutionError };
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

	const transcriptPath = stageOutputPath({
		workspaceRoot: context.workspaceRoot,
		stageId: STAGE_ID,
	});

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
	await writeFileAtomic({ path: transcriptPath, content: text });

	const cost = await deriveCost({
		audioPath: input.audioPath,
		costPerAudioHourUsd: context.config.elevenLabs.costPerAudioHourUsd,
		logger,
	});
	return { output: { transcriptPath }, cost, filesWritten: [stageOutputEntry(STAGE_ID)] };
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
