import { access, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import ffmpeg from "fluent-ffmpeg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManifestStageEntry, StageContext, StageResult } from "../../types/pipeline.js";
import { makeManifest, makeStageContext, makeWorkspaceTree, stagesWith } from "../fixtures.js";
import type { AudioExtractionOutput } from "./audio-extraction.js";
import { AudioExtractionError, createAudioExtractionStage } from "./audio-extraction.js";

vi.mock("fluent-ffmpeg", () => ({ default: vi.fn() }));

const ffmpegMock = vi.mocked(ffmpeg);

const FOLDER_NAME = "Lecture 1 - Cell Injury - 2025-10-10";
const VIDEO_DIR = join("Source files", "Video files");
const AUDIO_ENTRY = join("Audio", "audio.m4a");

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
		({ moduleRoot, workspaceRoot } = await makeWorkspaceTree({
			prefix: "audio-extraction-",
			folderName: FOLDER_NAME,
		}));
		videoDir = join(moduleRoot, VIDEO_DIR);
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
		const manifest = makeManifest({
			workspaceFolderName: FOLDER_NAME,
			...(entry === undefined
				? {}
				: { stages: stagesWith({ stageId: "audio-extraction", entry }) }),
		});
		return makeStageContext({ workspaceRoot, manifest });
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
			completedAt: "2025-10-10T10:00:00.000Z",
			configUsed: null,
			cost: null,
			filesWritten: [AUDIO_ENTRY],
		});
	}

	it("should skip audio extraction when output file exists and stage is complete", async () => {
		await mkdir(join(workspaceRoot, "Audio"), { recursive: true });
		await writeFile(join(workspaceRoot, AUDIO_ENTRY), "already extracted");

		expect(await createAudioExtractionStage().isComplete(completedContext())).toBe(true);
	});

	it("should re-run audio extraction when the recorded output has been deleted", async () => {
		expect(await createAudioExtractionStage().isComplete(completedContext())).toBe(false);
	});

	it("should locate the source video when its extension is not .mp4", async () => {
		await writeSourceVideo(`${FOLDER_NAME}.mov`);

		const input = await createAudioExtractionStage().getInput(contextWith());

		expect(input.sourceVideoPath).toBe(join(videoDir, `${FOLDER_NAME}.mov`));
	});

	it("should fail before invoking ffmpeg when the source video is missing", async () => {
		await expect(createAudioExtractionStage().getInput(contextWith())).rejects.toThrow(
			AudioExtractionError,
		);
		expect(ffmpegMock).not.toHaveBeenCalled();
	});

	it("should fail before invoking ffmpeg when two videos share the workspace base name", async () => {
		await writeSourceVideo(`${FOLDER_NAME}.mp4`);
		await writeSourceVideo(`${FOLDER_NAME}.mov`);

		await expect(createAudioExtractionStage().getInput(contextWith())).rejects.toThrow(
			AudioExtractionError,
		);
		expect(ffmpegMock).not.toHaveBeenCalled();
	});

	it("should return correct filesWritten list when stage completes", async () => {
		await writeSourceVideo(`${FOLDER_NAME}.mp4`);
		stubFfmpeg(succeed);

		const result = await runStage();

		expect(result.filesWritten).toStrictEqual([AUDIO_ENTRY]);
		expect(result.output.audioPath).toBe(join(workspaceRoot, AUDIO_ENTRY));
	});

	it("should record no cost when the stage makes no billable call", async () => {
		await writeSourceVideo(`${FOLDER_NAME}.mp4`);
		stubFfmpeg(succeed);

		const result = await runStage();

		expect(result.cost).toBeNull();
	});

	it("should copy the audio track without re-encoding when extracting", async () => {
		await writeSourceVideo(`${FOLDER_NAME}.mp4`);
		stubFfmpeg(succeed);

		await runStage();

		expect(calls[0].inputPath).toBe(join(videoDir, `${FOLDER_NAME}.mp4`));
		expect(calls[0].audioCodecs).toStrictEqual(["copy"]);
		expect(calls[0].noVideoCalled).toBe(true);
	});

	it("should write to a .tmp sibling and rename it when extraction succeeds", async () => {
		await writeSourceVideo(`${FOLDER_NAME}.mp4`);
		stubFfmpeg(succeed);

		await runStage();

		expect(calls[0].outputPath).toBe(join(workspaceRoot, `${AUDIO_ENTRY}.tmp`));
		// The .tmp extension defeats container inference, so the muxer is explicit.
		expect(calls[0].outputFormat).toBe("ipod");
		await expect(access(join(workspaceRoot, AUDIO_ENTRY))).resolves.toBeUndefined();
		expect(await readdir(join(workspaceRoot, "Audio"))).toStrictEqual(["audio.m4a"]);
	});

	it("should remove stale .tmp files when a previous run left them behind", async () => {
		await writeSourceVideo(`${FOLDER_NAME}.mp4`);
		await mkdir(join(workspaceRoot, "Audio"), { recursive: true });
		await writeFile(join(workspaceRoot, "Audio", "audio.m4a.tmp"), "half-written");
		await writeFile(join(workspaceRoot, "Audio", "stale.m4a.tmp"), "half-written");
		stubFfmpeg(succeed);

		await runStage();

		expect(await readdir(join(workspaceRoot, "Audio"))).toStrictEqual(["audio.m4a"]);
	});

	it.each([
		{ label: "an Error", failure: new Error("ffmpeg exited with code 1") },
		{ label: "a bare string", failure: "ffmpeg exited with code 1" },
	])("should reject and leave no audio file when ffmpeg fails with $label", async ({ failure }) => {
		await writeSourceVideo(`${FOLDER_NAME}.mp4`);
		stubFfmpeg(failWith(failure));

		await expect(runStage()).rejects.toThrow(AudioExtractionError);
		expect(await readdir(join(workspaceRoot, "Audio"))).toStrictEqual([]);
	});
});
