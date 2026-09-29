import { describe, expect, it } from "vitest";
import { NamedError } from "../../utils/errors.js";
import {
	captureError,
	makeStageContext,
	paddedTranscriptText,
	seedStageOutput,
	transcriptText,
	unusableTranscripts,
	useTranscribedWorkspace,
} from "../fixtures.js";
import { stageOutputPath } from "../layout.js";
import { readStageText, readTranscript } from "./stage-input.js";

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
