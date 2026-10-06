import { describe, expect, it } from "vitest";
import { NamedError } from "../../utils/errors.js";
import {
	captureError,
	makeStageContext,
	paddedTranscriptText,
	seedSavedRuns,
	seedStageOutput,
	transcriptDivision,
	transcriptText,
	unusableTranscripts,
	useTranscribedWorkspace,
} from "../fixtures.js";
import { stageOutputPath } from "../layout.js";
import { readStageText, readTranscript, readTranscriptAndRuns } from "./stage-input.js";

/** The error the reading stage raises, standing in for any stage's own. */
class ReadingStageError extends NamedError {}

describe("readStageText", () => {
	const workspace = useTranscribedWorkspace({ prefix: "stage-input-" });

	/** The transcript's path in the current test's workspace. */
	const transcriptPath = (): string =>
		stageOutputPath({ workspaceRoot: workspace().workspaceRoot, stageId: "transcription" });

	/** Reads the transcript as a stage dividing it would. */
	function read(): Promise<string> {
		return readStageText({
			context: makeStageContext({ workspaceRoot: workspace().workspaceRoot }),
			stageId: "transcription",
			purpose: "divide",
			fail: (message) => new ReadingStageError(message),
		});
	}

	it("should return the file's text when the stage's output holds text", async () => {
		expect(await read()).toBe(transcriptText);
	});

	it.each(
		unusableTranscripts,
	)("should raise the reading stage's own error naming the file when it is $state", async ({
		spoil,
		says,
	}) => {
		await spoil(workspace().workspaceRoot);
		const error = await captureError(read());
		expect(error).toBeInstanceOf(ReadingStageError);
		expect(error.message).toContain(transcriptPath());
		expect(error.message).toContain(says);
	});
});

describe("readTranscript", () => {
	const workspace = useTranscribedWorkspace({ prefix: "transcript-input-" });

	/** Reads the transcript as a division stage would. */
	function read(): Promise<string> {
		return readTranscript({
			context: makeStageContext({ workspaceRoot: workspace().workspaceRoot }),
			fail: (message) => new ReadingStageError(message),
		});
	}

	it("should remove the whitespace at the transcript's ends when it is read", async () => {
		await seedStageOutput({
			workspaceRoot: workspace().workspaceRoot,
			stageId: "transcription",
			contents: paddedTranscriptText,
		});
		expect(await read()).toBe(transcriptText);
	});

	it("should raise the reading stage's own error when the transcript is missing", async () => {
		const [missing] = unusableTranscripts;
		await missing?.spoil(workspace().workspaceRoot);
		expect(await captureError(read())).toBeInstanceOf(ReadingStageError);
	});
});

describe("readTranscriptAndRuns", () => {
	const workspace = useTranscribedWorkspace({ prefix: "runs-input-" });
	const context = (): ReturnType<typeof makeStageContext> =>
		makeStageContext({ workspaceRoot: workspace().workspaceRoot });

	/** Leaves the first `count` runs of the initial splitting panel on disk. */
	function seedSplittingRunsBeforeDeepening(count: number): Promise<void> {
		return seedSavedRuns({
			workspaceRoot: workspace().workspaceRoot,
			stageId: "initial-subtopic-splitting",
			count,
			contents: () => transcriptDivision,
		});
	}

	/** Reads the transcript and the initial splitting panel, as deepening does. */
	function read(): ReturnType<typeof readTranscriptAndRuns> {
		return readTranscriptAndRuns({
			context: context(),
			panelStage: "initial-subtopic-splitting",
			fail: (message) => new ReadingStageError(message),
		});
	}

	it("should return the transcript and every run of the panel when the panel is complete", async () => {
		const { panelSize } = context().config.subtopicSplitting;
		await seedSplittingRunsBeforeDeepening(panelSize);
		expect(await read()).toStrictEqual({
			transcript: transcriptText,
			runs: Array(panelSize).fill(transcriptDivision),
		});
	});

	it("should raise the reading stage's own error naming the stage to run when a run is missing", async () => {
		await seedSplittingRunsBeforeDeepening(1);
		const error = await captureError(read());
		expect(error).toBeInstanceOf(ReadingStageError);
		expect(error.message).toContain("run initial-subtopic-splitting first");
	});
});
