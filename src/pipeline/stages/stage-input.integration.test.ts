import { rm, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { NamedError } from "../../utils/errors.js";
import {
	captureError,
	makeStageContext,
	transcriptText,
	useTranscribedWorkspace,
} from "../fixtures.js";
import { stageOutputPath } from "../layout.js";
import { readStageText } from "./stage-input.js";

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

	it.each([
		{
			state: "missing",
			leave: (): Promise<void> => rm(transcriptPath()),
			says: "run transcription first",
		},
		{
			state: "blank",
			leave: (): Promise<void> => writeFile(transcriptPath(), "  \n "),
			says: "holds no text; there is nothing to divide",
		},
	])("should raise the reading stage's own error naming the file when it is $state", async ({
		leave,
		says,
	}) => {
		await leave();
		const error = await captureError(read());
		expect(error).toBeInstanceOf(ReadingStageError);
		expect(error.message).toContain(transcriptPath());
		expect(error.message).toContain(says);
	});
});
