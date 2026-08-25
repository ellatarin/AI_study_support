import { basename, extname, join } from "node:path";
import ffmpeg from "fluent-ffmpeg";
import type { Logger } from "pino";
import type { PipelineStage, StageContext, StageResult } from "../../types/pipeline.js";
import { errorMessage, NamedError } from "../../utils/errors.js";
import { listFileNames } from "../../utils/files.js";
import { createProgressBar } from "../../utils/progress.js";
import { moduleDirs } from "../layout.js";
import { createPipelineStage, writeStageOutput } from "./pipeline-stage.js";

/**
 * Thrown when the lecture's source video cannot be located unambiguously, or
 * when ffmpeg fails to extract its audio track. Either way no `audio.m4a` is
 * left behind (technical-design.md §5, Stage 1).
 */
export class AudioExtractionError extends NamedError {}

/** The source video Stage 1 extracts audio from. */
export type AudioExtractionInput = {
	/** Absolute path to the lecture's source video, whatever container it uses. */
	readonly sourceVideoPath: string;
};

/** The extracted audio Stage 1 produces. */
export type AudioExtractionOutput = {
	/** Absolute path to the extracted `Audio/audio.m4a`. */
	readonly audioPath: string;
};

const STAGE_ID = "audio-extraction";
const PROGRESS_FORMAT = "Extracting audio |{bar}| {percentage}%";
/**
 * The m4a muxer, named explicitly because extraction writes to a `.tmp` sibling
 * (§4.3) and ffmpeg infers the container from the output extension — which
 * `.tmp` defeats.
 */
const TMP_OUTPUT_FORMAT = "ipod";
const PERCENT_COMPLETE = 100;
const PERCENT_BEFORE_END = 99;

/**
 * Locates the lecture's source video by base name. Stage 0 gives the video, the
 * slide, and the workspace folder the same base name but preserves the original
 * container extension, so the video is whichever file in the module's video
 * directory shares the workspace folder's name (technical-design.md §5, Stage 1).
 *
 * @param context - The current lecture run context.
 * @returns The located source video.
 * @throws {AudioExtractionError} If no video matches, or more than one does.
 */
async function locateSourceVideo(context: StageContext): Promise<AudioExtractionInput> {
	const videoDir = moduleDirs({ moduleRoot: context.moduleRoot }).video;
	const baseName = context.manifest.workspaceFolderName;
	const matches = (await listFileNames(videoDir)).filter(
		(name) => basename(name, extname(name)) === baseName,
	);

	const [sourceVideo, ...surplus] = matches;
	if (sourceVideo === undefined) {
		throw new AudioExtractionError(`No source video named "${baseName}" found in ${videoDir}`);
	}
	if (surplus.length > 0) {
		throw new AudioExtractionError(
			`Multiple source videos named "${baseName}" found in ${videoDir}: ${matches.join(", ")}`,
		);
	}
	return { sourceVideoPath: join(videoDir, sourceVideo) };
}

/**
 * Copies the video's audio track into `outputPath` without re-encoding, driving a
 * percentage progress bar from ffmpeg's progress events. fluent-ffmpeg spawns
 * with an explicit argv array, so no path is ever interpolated into a shell
 * command (technical-design.md §4.4).
 *
 * @param args - The extraction paths.
 * @param args.inputPath - Absolute path to the source video.
 * @param args.outputPath - Absolute path to write the audio track to.
 * @returns A promise that resolves once ffmpeg reports completion.
 */
function copyAudioTrack({
	inputPath,
	outputPath,
}: {
	readonly inputPath: string;
	readonly outputPath: string;
}): Promise<void> {
	// eslint-disable-next-line max-params -- Promise executor signature is spec-defined
	return new Promise((resolve, reject) => {
		const bar = createProgressBar({ format: PROGRESS_FORMAT });
		bar.start(PERCENT_COMPLETE, 0);

		ffmpeg(inputPath)
			.noVideo()
			.audioCodec("copy")
			.format(TMP_OUTPUT_FORMAT)
			.output(outputPath)
			.on("progress", (progress: { readonly percent?: number }) => {
				bar.update(Math.min(Math.round(progress.percent ?? 0), PERCENT_BEFORE_END));
			})
			.on("end", () => {
				bar.update(PERCENT_COMPLETE);
				bar.stop();
				resolve();
			})
			// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- fluent-ffmpeg declares the error handler's parameter; it is only rejected with here (CLAUDE.md permits dropping readonly where a library requires a mutable type)
			.on("error", (error: Error) => {
				bar.stop();
				reject(error);
			})
			.run();
	});
}

/**
 * Extracts the audio track into `Audio/audio.m4a`, writing to a `.tmp` sibling
 * and renaming only on success so a killed run never leaves a truncated file a
 * later run would mistake for complete (technical-design.md §4.3).
 *
 * The source video is logged with the extraction: this stage picks it by base
 * name from whatever the module's video directory holds, so which file was
 * chosen is a decision worth being able to check afterwards
 * (technical-design.md §10).
 *
 * @param args - The run inputs.
 * @param args.input - The located source video.
 * @param args.context - The current lecture run context.
 * @param args.logger - The stage's logger, which records the extraction.
 * @returns The extracted audio path, a `null` cost, and the file written.
 * @throws {AudioExtractionError} If ffmpeg fails; the partial `.tmp` is removed first.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger carries mutable properties the rule cannot see past; it is only logged to here (CLAUDE.md permits dropping readonly where a library requires a mutable type)
async function extractAudio({
	input,
	context,
	logger,
}: {
	readonly input: AudioExtractionInput;
	readonly context: StageContext;
	readonly logger: Logger;
}): Promise<StageResult<AudioExtractionOutput>> {
	const startedAt = performance.now();
	let written: { readonly path: string; readonly filesWritten: readonly string[] };
	try {
		written = await writeStageOutput({
			stageId: STAGE_ID,
			workspaceRoot: context.workspaceRoot,
			produce: (tmpPath) =>
				copyAudioTrack({ inputPath: input.sourceVideoPath, outputPath: tmpPath }),
		});
	} catch (error: unknown) {
		throw new AudioExtractionError(
			`Audio extraction failed for ${input.sourceVideoPath}: ${errorMessage(error)}`,
		);
	}
	logger.debug(
		{
			sourceVideoPath: input.sourceVideoPath,
			audioPath: written.path,
			latencyMs: Math.round(performance.now() - startedAt),
		},
		"Extracted audio track",
	);

	// No billable call is made, so this stage records no cost.
	return {
		output: { audioPath: written.path },
		cost: null,
		filesWritten: written.filesWritten,
	};
}

/**
 * Builds Stage 1, which extracts the lecture video's audio track to
 * `Audio/audio.m4a` with `-acodec copy` — no re-encoding — and retains it for the
 * life of the workspace (technical-design.md §5, Stage 1).
 *
 * @param args - The stage's dependencies.
 * @param args.logger - The run's logger; the factory binds it to this stage.
 * @returns The audio-extraction stage.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger carries mutable properties the rule cannot see past; it is only read from here (CLAUDE.md permits dropping readonly where a library requires a mutable type)
export function createAudioExtractionStage({
	logger,
}: {
	readonly logger: Logger;
}): PipelineStage<AudioExtractionInput, AudioExtractionOutput> {
	return createPipelineStage({
		stageId: STAGE_ID,
		logger,
		getInput: locateSourceVideo,
		run: extractAudio,
	});
}
