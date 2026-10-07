import { access, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import ffmpeg from "fluent-ffmpeg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	PipelineStage,
	StageContext,
	StageEntry,
	StageResult,
} from "../../../types/pipeline.js";
import {
	contextWithEntry,
	contextWithOutput,
	driveStage,
	loggedAt,
	makeStageContext,
	makeWorkspaceTree,
	seedStageOutput,
	testLecture,
	useStubLogger,
} from "../../fixtures.js";
import { moduleDirs, stageOutputEntry, stageOutputPath } from "../../layout.js";
import { createSourceFileStage, type SourceFileInput } from "../pipeline-stage.js";
import type { AudioExtractionOutput } from "./audio-extraction.js";
import { AudioExtractionError, audioExtractionParts } from "./audio-extraction.js";

vi.mock("fluent-ffmpeg", () => ({ default: vi.fn() }));

const ffmpegMock = vi.mocked(ffmpeg);

/** The listeners that the stage puts on the ffmpeg command, keyed by event name. */
type CommandListeners = Record<string, ((value?: unknown) => void) | undefined>;

/** The record that the stub keeps of one `ffmpeg()` call. */
type ExtractionCall = {
	readonly inputPath: string;
	outputPath: string;
	readonly audioCodecs: string[];
	noVideoCalled: boolean;
	outputFormat: string;
};

/** Makes a stubbed ffmpeg command succeed or fail, as a test needs. */
type RunBehaviour = (args: {
	readonly call: ExtractionCall;
	readonly listeners: CommandListeners;
}) => Promise<void>;

describe("createAudioExtractionStage", () => {
	let moduleRoot: string;
	let workspaceRoot: string;
	let videoRecordingsDir: string;
	let calls: ExtractionCall[];
	const logged = useStubLogger();

	beforeEach(async () => {
		vi.clearAllMocks();
		calls = [];
		({ moduleRoot, workspaceRoot } = await makeWorkspaceTree({ prefix: "audio-extraction-" }));
		videoRecordingsDir = moduleDirs({ moduleRoot }).videoRecording;
		await mkdir(videoRecordingsDir, { recursive: true });
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

	function contextWith(entry?: StageEntry): StageContext {
		return entry === undefined
			? makeStageContext({ workspaceRoot })
			: contextWithEntry({ workspaceRoot, stageId: "audio-extraction", entry });
	}

	/** The path where the stage must put its audio, in the workspace under test. */
	function audioPath(): string {
		return stageOutputPath({ workspaceRoot, stageId: "audio-extraction" });
	}

	/** The folder of the audio file that the stage writes. */
	function audioDir(): string {
		return dirname(audioPath());
	}

	/** The ffmpeg call that the stage made. The test fails when the stage made none. */
	function extractionCall(): ExtractionCall {
		const [call] = calls;
		if (call === undefined) {
			throw new Error("Expected the stage to invoke ffmpeg, but it recorded no call");
		}
		return call;
	}

	async function writeVideoRecording(name: string): Promise<void> {
		await writeFile(join(videoRecordingsDir, name), "video bytes");
	}

	/** The stage under test, which logs into {@link logged}. */
	function makeStage(): PipelineStage<SourceFileInput, AudioExtractionOutput> {
		return createSourceFileStage({ logger: logged().logger, ...audioExtractionParts });
	}

	function runStage(): Promise<StageResult<AudioExtractionOutput>> {
		return driveStage({ stage: makeStage(), context: contextWith() });
	}

	it("should name the stage audio-extraction when the stage is created", () => {
		expect(makeStage().stageId).toBe("audio-extraction");
	});

	function completedContext(): StageContext {
		return contextWithOutput({ workspaceRoot, stageId: "audio-extraction" });
	}

	it("should skip audio extraction when output file exists and stage is complete", async () => {
		await seedStageOutput({
			workspaceRoot,
			stageId: "audio-extraction",
			contents: "already extracted",
		});

		expect(await makeStage().isComplete(completedContext())).toBe(true);
	});

	it("should re-run audio extraction when the recorded output has been deleted", async () => {
		expect(await makeStage().isComplete(completedContext())).toBe(false);
	});

	it("should locate the video recording when its extension is not .mp4", async () => {
		await writeVideoRecording(`${testLecture.baseName}.mov`);

		const input = await makeStage().getInput(contextWith());

		expect(input.sourceFilePath).toBe(join(videoRecordingsDir, `${testLecture.baseName}.mov`));
	});

	it("should fail before invoking ffmpeg when the video recording is missing", async () => {
		await expect(makeStage().getInput(contextWith())).rejects.toThrow(AudioExtractionError);
		expect(ffmpegMock).not.toHaveBeenCalled();
	});

	it("should fail before invoking ffmpeg when two video recordings share the workspace base name", async () => {
		await writeVideoRecording(testLecture.videoRecordingFile);
		await writeVideoRecording(`${testLecture.baseName}.mov`);

		await expect(makeStage().getInput(contextWith())).rejects.toThrow(AudioExtractionError);
		expect(ffmpegMock).not.toHaveBeenCalled();
	});

	describe("once the video recording is in place and ffmpeg succeeds", () => {
		beforeEach(async () => {
			await writeVideoRecording(testLecture.videoRecordingFile);
			stubFfmpeg(succeed);
		});

		it("should return correct filesWritten list when stage completes", async () => {
			const result = await runStage();

			expect(result.filesWritten).toStrictEqual([stageOutputEntry("audio-extraction")]);
			expect(result.output.audioPath).toBe(audioPath());
		});

		it("should record which video recording it chose when extraction completes", async () => {
			await runStage();

			const [entry] = loggedAt({ entries: logged().entries, level: "debug" });
			expect(entry?.message).toBe("Extracted audio track");
			expect(entry?.bindings).toMatchObject({ stage: "audio-extraction" });
			expect(entry?.payload).toEqual({
				videoRecordingPath: join(videoRecordingsDir, testLecture.videoRecordingFile),
				audioPath: audioPath(),
				latencyMs: expect.any(Number),
			});
		});

		it("should record no cost when the stage makes no billable call", async () => {
			const result = await runStage();

			expect(result.cost).toBeNull();
		});

		it("should copy the audio track without re-encoding when extracting", async () => {
			await runStage();

			const call = extractionCall();

			expect(call.inputPath).toBe(join(videoRecordingsDir, testLecture.videoRecordingFile));
			expect(call.audioCodecs).toStrictEqual(["copy"]);
			expect(call.noVideoCalled).toBe(true);
		});

		it("should write to a .tmp sibling and rename it when extraction succeeds", async () => {
			await runStage();

			const call = extractionCall();

			expect(call.outputPath).toBe(`${audioPath()}.tmp`);
			// The .tmp extension stops ffmpeg finding the container, so the stage names the muxer.
			expect(call.outputFormat).toBe("ipod");
			await expect(access(audioPath())).resolves.toBeUndefined();
			expect(await readdir(audioDir())).toStrictEqual([basename(audioPath())]);
		});

		it("should remove stale .tmp files when an earlier invocation left them behind", async () => {
			await mkdir(audioDir(), { recursive: true });
			await writeFile(`${audioPath()}.tmp`, "half-written");
			await writeFile(join(audioDir(), "stale.m4a.tmp"), "half-written");

			await runStage();

			expect(await readdir(audioDir())).toStrictEqual([basename(audioPath())]);
		});
	});

	// These rows are outside the "ffmpeg succeeds" describe block on purpose. They
	// make ffmpeg fail. The `beforeEach` of that block sets a stub that succeeds. If
	// these rows replaced that stub, the name of the block would say the opposite of
	// what the rows test.
	it.each([
		{ label: "an Error", failure: new Error("ffmpeg exited with code 1") },
		{ label: "a bare string", failure: "ffmpeg exited with code 1" },
	])("should reject and leave no audio file when ffmpeg fails with $label", async ({ failure }) => {
		await writeVideoRecording(testLecture.videoRecordingFile);
		stubFfmpeg(failWith(failure));

		await expect(runStage()).rejects.toThrow(AudioExtractionError);
		expect(await readdir(audioDir())).toStrictEqual([]);
	});
});
