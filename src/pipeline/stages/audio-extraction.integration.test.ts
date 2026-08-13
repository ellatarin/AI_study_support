import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { FfprobeData } from "fluent-ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	makeManifest,
	makeStageContext,
	makeWorkspaceTree,
	renderFixtureMedia,
} from "../fixtures.js";
import { createAudioExtractionStage } from "./audio-extraction.js";

const FOLDER_NAME = "Lecture 1 - Cell Injury - 2025-10-10";
const VIDEO_DIR = join("Source files", "Video files");
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
		({ moduleRoot, workspaceRoot } = await makeWorkspaceTree({
			prefix: "audio-extraction-live-",
			folderName: FOLDER_NAME,
		}));
		await mkdir(join(moduleRoot, VIDEO_DIR), { recursive: true });
	});

	afterEach(async () => {
		await rm(moduleRoot, { recursive: true, force: true });
	});

	it("should produce valid m4a output when extracting the audio track from a real video file", async () => {
		await renderFixtureVideo(join(moduleRoot, VIDEO_DIR, `${FOLDER_NAME}.mp4`));
		const stage = createAudioExtractionStage();
		const context = makeStageContext({
			workspaceRoot,
			manifest: makeManifest({ workspaceFolderName: FOLDER_NAME }),
		});

		const input = await stage.getInput(context);
		const result = await stage.run({ input, context });

		expect(result.filesWritten).toStrictEqual([join("Audio", "audio.m4a")]);
		expect(await readdir(join(workspaceRoot, "Audio"))).toStrictEqual(["audio.m4a"]);

		const probed = await probe(result.output.audioPath);
		expect(probed.streams.map((stream) => stream.codec_type)).toStrictEqual(["audio"]);
		expect(probed.streams[0].codec_name).toBe("aac");
		expect(probed.format.duration).toBeCloseTo(FIXTURE_SECONDS, 0);
	}, 30_000);
});
