import ffmpeg from "fluent-ffmpeg";
import type { Logger } from "pino";
import type { StageContext, StageResult } from "../../../types/pipeline.js";
import { errorMessage, NamedError } from "../../../utils/errors.js";
import { createProgressBar } from "../../../utils/progress.js";
import {
	type SourceFileInput,
	type SourceFileStageParts,
	writeStageOutput,
} from "../pipeline-stage.js";

/**
 * The error when the video recording of the lecture is missing or not unique, or
 * when ffmpeg fails. In each case, no `audio.m4a` stays on disk
 * (technical-design.md §5, `audio-extraction`).
 */
export class AudioExtractionError extends NamedError {}

/** The output of `audio-extraction`. */
export type AudioExtractionOutput = {
	/** The absolute path of `Audio/audio.m4a`. */
	readonly audioPath: string;
};

const STAGE_ID = "audio-extraction";
const PROGRESS_FORMAT = "Extracting audio |{bar}| {percentage}%";
/**
 * The m4a muxer. ffmpeg finds the container from the extension of the output,
 * and the `.tmp` extension prevents that (technical-design.md §4.3).
 */
const TMP_OUTPUT_FORMAT = "ipod";
const PERCENT_COMPLETE = 100;
const PERCENT_BEFORE_END = 99;

/**
 * Copies the audio track of the video recording to `outputPath` without
 * re-encoding. A progress bar shows the percentage that ffmpeg reports.
 * fluent-ffmpeg gives each argument to the process separately, so no path goes
 * into a shell command (technical-design.md §4.4).
 *
 * @param args - The two paths.
 * @param args.inputPath - The absolute path of the video recording.
 * @param args.outputPath - The absolute path to write the audio track to.
 * @returns A promise that resolves when ffmpeg reports that it is done.
 */
function copyAudioTrack({
	inputPath,
	outputPath,
}: {
	readonly inputPath: string;
	readonly outputPath: string;
}): Promise<void> {
	// eslint-disable-next-line max-params -- the language standard sets the signature of the Promise executor.
	return new Promise((resolve, reject) => {
		const progressBar = createProgressBar({ format: PROGRESS_FORMAT });
		progressBar.start(PERCENT_COMPLETE, 0);

		ffmpeg(inputPath)
			.noVideo()
			.audioCodec("copy")
			.format(TMP_OUTPUT_FORMAT)
			.output(outputPath)
			.on("progress", (progress: { readonly percent?: number }) => {
				progressBar.update(Math.min(Math.round(progress.percent ?? 0), PERCENT_BEFORE_END));
			})
			.on("end", () => {
				progressBar.update(PERCENT_COMPLETE);
				progressBar.stop();
				resolve();
			})
			// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- fluent-ffmpeg declares the parameter of the error handler. This handler only rejects with it. CLAUDE.md permits a mutable type that a library requires.
			.on("error", (error: Error) => {
				progressBar.stop();
				reject(error);
			})
			.run();
	});
}

/**
 * Extracts the audio track into `Audio/audio.m4a`. It writes a `.tmp` file and
 * renames it only on success. So a stopped invocation never leaves a part file
 * that a later pipeline run takes as complete (technical-design.md §4.3).
 *
 * The debug log records which video recording the stage chose, because the stage
 * selects it by base name (technical-design.md §10).
 *
 * @param args - The input, the stage context and the logger.
 * @param args.input - The video recording.
 * @param args.context - The stage context.
 * @param args.logger - The logger that records the extraction.
 * @returns The path of the audio, a `null` cost, and the file written.
 * @throws {AudioExtractionError} If ffmpeg fails. The `.tmp` file is deleted first.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger has mutable properties that the rule cannot ignore. This function only logs to it. CLAUDE.md permits a mutable type that a library requires.
async function extractAudio({
	input,
	context,
	logger,
}: {
	readonly input: SourceFileInput;
	readonly context: StageContext;
	readonly logger: Logger;
}): Promise<StageResult<AudioExtractionOutput>> {
	const startedAt = performance.now();
	let written: { readonly path: string; readonly filesWritten: readonly string[] };
	try {
		written = await writeStageOutput({
			stageId: STAGE_ID,
			context,
			produce: (tmpPath) =>
				copyAudioTrack({ inputPath: input.sourceFilePath, outputPath: tmpPath }),
		});
	} catch (error: unknown) {
		throw new AudioExtractionError(
			`Audio extraction failed for ${input.sourceFilePath}: ${errorMessage(error)}`,
		);
	}
	logger.debug(
		{
			videoRecordingPath: input.sourceFilePath,
			audioPath: written.path,
			latencyMs: Math.round(performance.now() - startedAt),
		},
		"Extracted audio track",
	);

	// The stage makes no billable call, so it records no cost.
	return {
		output: { audioPath: written.path },
		cost: null,
		filesWritten: written.filesWritten,
	};
}

/**
 * The parts of the `audio-extraction` stage. It copies the audio track of the
 * video recording to `Audio/audio.m4a` without re-encoding. The audio stays for
 * the life of the workspace (technical-design.md §5, `audio-extraction`).
 */
export const audioExtractionParts: SourceFileStageParts<AudioExtractionOutput> = {
	stageId: STAGE_ID,
	source: "videoRecording",
	fail: (message) => new AudioExtractionError(message),
	run: extractAudio,
};
