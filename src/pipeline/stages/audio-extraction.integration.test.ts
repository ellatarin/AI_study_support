import { mkdir, readdir, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { FfprobeData } from "fluent-ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	makeStageContext,
	makeStubLogger,
	makeWorkspaceTree,
	mediaTestTimeoutMs,
	renderFixtureMedia,
	testLecture,
} from "../fixtures.js";
import { moduleDirs, stageOutputEntry, stageOutputPath } from "../layout.js";
import { createAudioExtractionStage } from "./audio-extraction.js";

const FIXTURE_SECONDS = 1;

/** Renders a tiny H.264 + AAC test video, so the suite needs no binary fixture. */
function renderFixtureVideo(outputPath: string): Promise<void> {
	return renderFixtureMedia({
		ffmpegArgs: [
			"-f",
			"lavfi",
			"-i",
			`testsrc=duration=${FIXTURE_SECONDS}:size=160x120:rate=10`,
			"-f",
			"lavfi",
			"-i",
			`sine=frequency=440:duration=${FIXTURE_SECONDS}`,
			"-c:v",
			"libx264",
			"-c:a",
			"aac",
			outputPath,
		],
	});
}

function probe(path: string): Promise<FfprobeData> {
	return new Promise((resolve, reject) => {
		ffmpeg.ffprobe(path, (error: Error | null, data: FfprobeData) => {
			if (error !== null) {
				reject(error);
				return;
			}
			resolve(data);
		});
	});
}

describe("createAudioExtractionStage against real ffmpeg", () => {
	let moduleRoot: string;
	let workspaceRoot: string;

	beforeEach(async () => {
		({ moduleRoot, workspaceRoot } = await makeWorkspaceTree({ prefix: "audio-extraction-live-" }));
		await mkdir(moduleDirs({ moduleRoot }).video, { recursive: true });
	});

	afterEach(async () => {
		await rm(moduleRoot, { recursive: true, force: true });
	});

	it(
		"should produce valid m4a output when extracting the audio track from a real video file",
		async () => {
			await renderFixtureVideo(join(moduleDirs({ moduleRoot }).video, testLecture.videoFile));
			const stage = createAudioExtractionStage({ logger: makeStubLogger().logger });
			const context = makeStageContext({ workspaceRoot });

			const input = await stage.getInput(context);
			const result = await stage.run({ input, context });

			const audioPath = stageOutputPath({ workspaceRoot, stageId: "audio-extraction" });
			expect(result.filesWritten).toStrictEqual([stageOutputEntry("audio-extraction")]);
			expect(await readdir(dirname(audioPath))).toStrictEqual([basename(audioPath)]);

			const probed = await probe(result.output.audioPath);
			const [audioStream] = probed.streams;
			expect(probed.streams.map((stream) => stream.codec_type)).toStrictEqual(["audio"]);
			expect(audioStream?.codec_name).toBe("aac");
			expect(probed.format.duration).toBeCloseTo(FIXTURE_SECONDS, 0);
		},
		mediaTestTimeoutMs,
	);
});
