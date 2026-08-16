import { access, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import ffmpeg from "fluent-ffmpeg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManifestStageEntry, StageContext, StageResult } from "../../types/pipeline.js";
import {
	firstOrFail,
	makeManifest,
	makeStageContext,
	makeWorkspaceTree,
	stageCompletedAt,
	stagesWith,
	testLecture,
} from "../fixtures.js";
import { moduleDirs, stageOutputEntry, stageOutputPath } from "../layout.js";
import type { AudioExtractionOutput } from "./audio-extraction.js";
import { AudioExtractionError, createAudioExtractionStage } from "./audio-extraction.js";

vi.mock("fluent-ffmpeg", () => ({ default: vi.fn() }));

const ffmpegMock = vi.mocked(ffmpeg);

/** The listeners a stage registers on the ffmpeg command, keyed by event name. */
type CommandListeners = Record<string, ((value?: unknown) => void) | undefined>;

/** What one `ffmpeg()` invocation was asked to do, captured by the stub. */
type ExtractionCall = {
	readonly inputPath: string;
	outputPath: string;
	readonly audioCodecs: string[];
	noVideoCalled: boolean;
	outputFormat: string;
};

/** Drives a stubbed ffmpeg run to whichever outcome a test needs. */
type RunBehaviour = (args: {
	readonly call: ExtractionCall;
	readonly listeners: CommandListeners;
}) => Promise<void>;

describe("createAudioExtractionStage", () => {
	let moduleRoot: string;
	let workspaceRoot: string;
	let videoDir: string;
	let calls: ExtractionCall[];

	beforeEach(async () => {
		vi.clearAllMocks();
		calls = [];
		({ moduleRoot, workspaceRoot } = await makeWorkspaceTree({ prefix: "audio-extraction-" }));
		videoDir = moduleDirs({ moduleRoot }).video;
		await mkdir(videoDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(moduleRoot, { recursive: true, force: true });
	});

	function stubFfmpeg(onRun: RunBehaviour): void {
		ffmpegMock.mockImplementation((input?: unknown) => {
			const listeners: CommandListeners = {};
			const call: ExtractionCall = {
				inputPath: String(input),
				outputPath: "",
				audioCodecs: [],
				noVideoCalled: false,
				outputFormat: "",
			};
			calls.push(call);
			const command = {
				noVideo: () => {
					call.noVideoCalled = true;
					return command;
				},
				audioCodec: (codec: string) => {
					call.audioCodecs.push(codec);
					return command;
				},
				format: (name: string) => {
					call.outputFormat = name;
					return command;
				},
				output: (path: string) => {
					call.outputPath = path;
					return command;
				},
				on: (event: string, handler: (value?: unknown) => void) => {
					listeners[event] = handler;
					return command;
				},
				run: () => {
					void onRun({ call, listeners });
				},
			};
			return command as unknown as ReturnType<typeof ffmpeg>;
		});
	}

	const succeed: RunBehaviour = async ({ call, listeners }) => {
		// ffmpeg reports progress without a percentage until it knows the duration.
		listeners.progress?.({});
		listeners.progress?.({ percent: 42 });
		await writeFile(call.outputPath, "extracted audio");
		listeners.end?.();
	};

	const failWith = (failure: unknown): RunBehaviour => {
		return async ({ listeners }) => {
			await Promise.resolve();
			listeners.error?.(failure);
		};
	};

	function contextWith(entry?: ManifestStageEntry): StageContext {
		const manifest = makeManifest(
			entry === undefined ? {} : { stages: stagesWith({ stageId: "audio-extraction", entry }) },
		);
		return makeStageContext({ workspaceRoot, manifest });
	}

	/** Where the stage is required to leave its audio, for the workspace under test. */
	function audioPath(): string {
		return stageOutputPath({ workspaceRoot, stageId: "audio-extraction" });
	}

	/** The directory that audio file sits in. */
	function audioDir(): string {
		return dirname(audioPath());
	}

	/** The ffmpeg invocation the stage recorded, failing when it made none. */
	function extractionCall(): ExtractionCall {
		return firstOrFail({ items: calls, label: "the stage to invoke ffmpeg" });
	}

	async function writeSourceVideo(name: string): Promise<void> {
		await writeFile(join(videoDir, name), "video bytes");
	}

	async function runStage(): Promise<StageResult<AudioExtractionOutput>> {
		const stage = createAudioExtractionStage();
		const context = contextWith();
		const input = await stage.getInput(context);
		return stage.run({ input, context });
	}

	it("should name the stage audio-extraction when the stage is created", () => {
		expect(createAudioExtractionStage().stageId).toBe("audio-extraction");
	});

	function completedContext(): StageContext {
		return contextWith({
			status: "complete",
			completedAt: stageCompletedAt,
			configUsed: null,
			cost: null,
			filesWritten: [stageOutputEntry("audio-extraction")],
		});
	}

	it("should skip audio extraction when output file exists and stage is complete", async () => {
		await mkdir(audioDir(), { recursive: true });
		await writeFile(audioPath(), "already extracted");

		expect(await createAudioExtractionStage().isComplete(completedContext())).toBe(true);
	});

	it("should re-run audio extraction when the recorded output has been deleted", async () => {
		expect(await createAudioExtractionStage().isComplete(completedContext())).toBe(false);
	});

	it("should locate the source video when its extension is not .mp4", async () => {
		await writeSourceVideo(`${testLecture.folderName}.mov`);

		const input = await createAudioExtractionStage().getInput(contextWith());

		expect(input.sourceVideoPath).toBe(join(videoDir, `${testLecture.folderName}.mov`));
	});

	it("should fail before invoking ffmpeg when the source video is missing", async () => {
		await expect(createAudioExtractionStage().getInput(contextWith())).rejects.toThrow(
			AudioExtractionError,
		);
		expect(ffmpegMock).not.toHaveBeenCalled();
	});

	it("should fail before invoking ffmpeg when two videos share the workspace base name", async () => {
		await writeSourceVideo(testLecture.videoFile);
		await writeSourceVideo(`${testLecture.folderName}.mov`);

		await expect(createAudioExtractionStage().getInput(contextWith())).rejects.toThrow(
			AudioExtractionError,
		);
		expect(ffmpegMock).not.toHaveBeenCalled();
	});

	it("should return correct filesWritten list when stage completes", async () => {
		await writeSourceVideo(testLecture.videoFile);
		stubFfmpeg(succeed);

		const result = await runStage();

		expect(result.filesWritten).toStrictEqual([stageOutputEntry("audio-extraction")]);
		expect(result.output.audioPath).toBe(audioPath());
	});

	it("should record no cost when the stage makes no billable call", async () => {
		await writeSourceVideo(testLecture.videoFile);
		stubFfmpeg(succeed);

		const result = await runStage();

		expect(result.cost).toBeNull();
	});

	it("should copy the audio track without re-encoding when extracting", async () => {
		await writeSourceVideo(testLecture.videoFile);
		stubFfmpeg(succeed);

		await runStage();

		const call = extractionCall();

		expect(call.inputPath).toBe(join(videoDir, testLecture.videoFile));
		expect(call.audioCodecs).toStrictEqual(["copy"]);
		expect(call.noVideoCalled).toBe(true);
	});

	it("should write to a .tmp sibling and rename it when extraction succeeds", async () => {
		await writeSourceVideo(testLecture.videoFile);
		stubFfmpeg(succeed);

		await runStage();

		const call = extractionCall();

		expect(call.outputPath).toBe(`${audioPath()}.tmp`);
		// The .tmp extension defeats container inference, so the muxer is explicit.
		expect(call.outputFormat).toBe("ipod");
		await expect(access(audioPath())).resolves.toBeUndefined();
		expect(await readdir(audioDir())).toStrictEqual([basename(audioPath())]);
	});

	it("should remove stale .tmp files when a previous run left them behind", async () => {
		await writeSourceVideo(testLecture.videoFile);
		await mkdir(audioDir(), { recursive: true });
		await writeFile(`${audioPath()}.tmp`, "half-written");
		await writeFile(join(audioDir(), "stale.m4a.tmp"), "half-written");
		stubFfmpeg(succeed);

		await runStage();

		expect(await readdir(audioDir())).toStrictEqual([basename(audioPath())]);
	});

	it.each([
		{ label: "an Error", failure: new Error("ffmpeg exited with code 1") },
		{ label: "a bare string", failure: "ffmpeg exited with code 1" },
	])("should reject and leave no audio file when ffmpeg fails with $label", async ({ failure }) => {
		await writeSourceVideo(testLecture.videoFile);
		stubFfmpeg(failWith(failure));

		await expect(runStage()).rejects.toThrow(AudioExtractionError);
		expect(await readdir(audioDir())).toStrictEqual([]);
	});
});
