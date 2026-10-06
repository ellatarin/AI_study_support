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
} from "../../../types/pipeline.js";
import { errorMessage, NamedError } from "../../../utils/errors.js";
import { splitModelId } from "../../../utils/model-id.js";
import { createUploadProgressStream } from "../../../utils/progress.js";
import { configuredStage, unconfiguredStageMessage } from "../../../utils/stage-config.js";
import { stageOutputPath } from "../../layout.js";
import { createPipelineStage, writeStageOutput } from "../pipeline-stage.js";

/**
 * The error when the extracted audio is missing or `ELEVENLABS_API_KEY` is not
 * set. It is also the error when the stage has no model in the config, or the
 * response has no transcript text. An unknown cost is not an error
 * (technical-design.md §5, `transcription`, and §7).
 */
export class TranscriptionError extends NamedError {}

/** The input of `transcription`. */
export type TranscriptionInput = {
	/** The absolute path of `Audio/audio.m4a`. */
	readonly audioPath: string;
	/** The size of the audio in bytes. It is the total of the upload progress bar. */
	readonly sizeBytes: number;
};

/** The output of `transcription`. */
export type TranscriptionOutput = {
	/** The absolute path of `Transcript/transcript.txt`. */
	readonly transcriptPath: string;
};

/**
 * The ElevenLabs routes, relative to the configured base URL. The SDK builds the
 * route itself. The route is named here so that a test that intercepts the
 * upload uses the same route (technical-design.md §6). Its `v1` is the API
 * version, not the Scribe version (technical-design.md §5, `transcription`).
 */
export const ELEVENLABS_PATHS = {
	speechToText: "/v1/speech-to-text",
} as const;

/**
 * The environment variable that holds the ElevenLabs API key. A suite that stubs
 * or unsets the key uses this name. The key never leaves the environment
 * (technical-design.md §5, `transcription`).
 */
export const API_KEY_VARIABLE = "ELEVENLABS_API_KEY";

const STAGE_ID = "transcription";
const SECONDS_PER_HOUR = 3600;

/**
 * The model IDs that the SDK accepts: the Scribe versions that it shipped with.
 * The stage widens the configured ID to this type, so a newer Scribe ID needs
 * only a config edit. ElevenLabs refuses an unknown ID itself
 * (technical-design.md §5, `transcription`). The type comes from the SDK, so the
 * cast says exactly what it widens.
 */
type ScribeModelId = Parameters<ElevenLabsClient["speechToText"]["convert"]>[0]["modelId"];

/**
 * Finds the extracted audio and its size.
 *
 * @param context - The stage context.
 * @returns The path and the size of the audio.
 * @throws {TranscriptionError} If the audio from `audio-extraction` is not on disk.
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
 * @throws {TranscriptionError} If the variable is not set or is empty.
 */
function requireApiKey(): string {
	const apiKey = process.env[API_KEY_VARIABLE];
	if (apiKey === undefined || apiKey.length === 0) {
		throw new TranscriptionError(`${API_KEY_VARIABLE} is not set; cannot transcribe`);
	}
	return apiKey;
}

/**
 * Gives the configured model ID without its provider prefix. The config holds
 * `elevenlabs/scribe_v2`, but the ElevenLabs API takes `scribe_v2`
 * (technical-design.md §5, `transcription`).
 *
 * @param context - The stage context.
 * @returns The model ID to send to ElevenLabs.
 * @throws {TranscriptionError} If the stage has no model in the config.
 */
function resolveModelId(context: StageContext): string {
	const stageConfig = configuredStage({ config: context.config, stageId: STAGE_ID });
	if (stageConfig === null) {
		throw new TranscriptionError(unconfiguredStageMessage({ stageId: STAGE_ID }));
	}
	return splitModelId(stageConfig.modelId).name;
}

/**
 * Uploads the audio to ElevenLabs Scribe and returns the transcript text. The
 * file streams through a progress bar that counts bytes. The stage does not read
 * the whole file into memory first.
 *
 * @param args - The inputs of the upload.
 * @param args.apiKey - The ElevenLabs API key.
 * @param args.modelId - The Scribe model ID, without the provider prefix.
 * @param args.input - The audio to upload.
 * @param args.elevenLabs - The ElevenLabs settings from the config: the address and the spoken language.
 * @returns The transcript text.
 * @throws {TranscriptionError} If the response has no transcript text.
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
	const { stream, progressBar } = createUploadProgressStream(input.sizeBytes);
	const client = new ElevenLabsClient({ apiKey, baseUrl: elevenLabs.baseUrl });
	try {
		const result = await client.speechToText.convert({
			file: createReadStream(input.audioPath).pipe(stream),
			modelId: modelId as ScribeModelId,
			languageCode: elevenLabs.languageCode,
			// Only scribe_v2 supports this setting, so it goes with that model ID.
			noVerbatim: true,
			// The default is true. Then the transcript holds the transcriber's own
			// notes, such as "[coughing]", "[lip smacks]" and "[audience applauding]".
			// The lecturer did not say them, but each later stage treats them as
			// content: it quotes, summarises and counts them. So the stage sets this to
			// false, and the transcript holds speech only.
			tagAudioEvents: false,
		});
		if (!("text" in result)) {
			throw new TranscriptionError("ElevenLabs returned no transcript text for the uploaded audio");
		}
		return result.text;
	} finally {
		progressBar.stop();
	}
}

/**
 * Reads the duration of an audio file, in seconds, with `ffprobe`.
 *
 * @param audioPath - The absolute path of the audio file.
 * @returns The duration in seconds.
 * @throws {TranscriptionError} If ffprobe reports no duration for the file.
 */
function readDurationSeconds(audioPath: string): Promise<number> {
	// eslint-disable-next-line max-params -- the language standard sets the signature of the Promise executor.
	return new Promise((resolve, reject) => {
		// eslint-disable-next-line max-params, @typescript-eslint/prefer-readonly-parameter-types -- fluent-ffmpeg sets the signature of the ffprobe callback: the number of parameters and their types. This callback only reads both parameters. CLAUDE.md permits a mutable type that a library requires.
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

/** The inputs that `deriveCost` and `priceAudio` take. */
type AudioPricing = {
	readonly audioPath: string;
	readonly costPerAudioHourUsd: number;
	readonly logger: Logger;
};

/**
 * Gives the cost of the one upload of this stage. Scribe bills by audio
 * duration, not by tokens. So the token counts are zero, the call count is 1,
 * and {@link priceAudio} gives the price (technical-design.md §7).
 *
 * @param args - The pricing inputs, as {@link priceAudio} describes them.
 * @returns The cost of the stage.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- AudioPricing holds pino's Logger, which has mutable properties that the rule cannot ignore. This function only logs to it. CLAUDE.md permits a mutable type that a library requires.
async function deriveCost(args: AudioPricing): Promise<StageCost> {
	return { promptTokens: 0, completionTokens: 0, callCount: 1, ...(await priceAudio(args)) };
}

/**
 * Prices the transcription from the duration of the audio, because ElevenLabs
 * returns no price. If the duration cannot be read, the cost is unknown and the
 * stage still succeeds (technical-design.md §7). The failure also goes to the
 * debug log at `warn`. Without that line, its only trace is a `null` in a cost
 * report (technical-design.md §10).
 *
 * @param args - The pricing inputs.
 * @param args.audioPath - The absolute path of the audio.
 * @param args.costPerAudioHourUsd - The configured Scribe price for each hour of audio.
 * @param args.logger - The logger that records a failed duration lookup.
 * @returns The cost, or `null` with the reason that the cost is unknown.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- AudioPricing holds pino's Logger, which has mutable properties that the rule cannot ignore. This function only logs to it. CLAUDE.md permits a mutable type that a library requires.
async function priceAudio({
	audioPath,
	costPerAudioHourUsd,
	logger,
}: AudioPricing): Promise<CostResolution> {
	try {
		const seconds = await readDurationSeconds(audioPath);
		return { costUsd: (seconds / SECONDS_PER_HOUR) * costPerAudioHourUsd };
	} catch (error: unknown) {
		const unknownCostReason = `Audio duration lookup failed: ${errorMessage(error)}`;
		logger.warn({ audioPath, err: error }, unknownCostReason);
		return { costUsd: null, unknownCostReason };
	}
}

/**
 * Transcribes the audio and writes `Transcript/transcript.txt` atomically. The
 * stage reads the API key and the model before the upload. So a bad config fails
 * before any spend (technical-design.md §5, `transcription`).
 *
 * The upload is a billable call. So the debug log records it like a model call,
 * with the model, the bytes sent and the latency (technical-design.md §10).
 *
 * @param args - The input, the stage context and the logger.
 * @param args.input - The audio to upload.
 * @param args.context - The stage context.
 * @param args.logger - The logger that records the Scribe call.
 * @returns The transcript path, the cost from the audio duration, and the file written.
 * @throws {TranscriptionError} If the key or the model is missing, or the response has no text.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger has mutable properties that the rule cannot ignore. This function only logs to it. CLAUDE.md permits a mutable type that a library requires.
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
 * Builds the `transcription` stage. It uploads `Audio/audio.m4a` to ElevenLabs
 * Scribe v2 and writes the transcript to `Transcript/transcript.txt`
 * (technical-design.md §5, `transcription`).
 *
 * @param args - The dependencies of the stage.
 * @param args.logger - The logger. `createPipelineStage` binds it to this stage.
 * @returns The stage.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger has mutable properties that the rule cannot ignore. This function only reads it. CLAUDE.md permits a mutable type that a library requires.
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
