import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunManifest, StageContext, StageCost, StageResult } from "../../types/pipeline.js";
import { pathExists } from "../../utils/files.js";
import {
	aiDerivedLecture,
	captureError,
	makeConfig,
	makeManifest,
	makeStageContext,
	makeWorkspaceTree,
	structuredMarkdown,
	testLecture,
	userChosenTitle,
} from "../fixtures.js";
import { stageOutputEntry, stageOutputPath } from "../layout.js";
import { manifestPath, readManifest } from "../manifest.js";
import { makeCompletionCall } from "../openrouter.js";
import type { TranscriptStructuringOutput } from "./transcript-structuring.js";
import {
	createTranscriptStructuringStage,
	TranscriptStructuringError,
} from "./transcript-structuring.js";

// Only the call is stubbed; everything else the module exports — the endpoint
// paths the fixtures build their URLs from — stays real.
vi.mock(import("../openrouter.js"), async (importOriginal) => ({
	...(await importOriginal()),
	makeCompletionCall: vi.fn(),
}));

const completionMock = makeCompletionCall as unknown as Mock;

const TRANSCRIPT_TEXT = "Today we are covering the innate immune response.";
const COST: StageCost = {
	promptTokens: 1200,
	completionTokens: 300,
	callCount: 1,
	totalCostUsd: 0.004,
};

/** A well-formed model reply, with the fields a test cares about overridden. */
function stubReply(overrides: Record<string, unknown> = {}): void {
	completionMock.mockResolvedValue({
		content: JSON.stringify({
			provisionalTitleMeaningful: true,
			suggestedTitle: null,
			structuredMarkdown: structuredMarkdown,
			...overrides,
		}),
		cost: COST,
	});
}

describe("createTranscriptStructuringStage", () => {
	let moduleRoot: string;
	let workspaceRoot: string;

	beforeEach(async () => {
		vi.clearAllMocks();
		({ moduleRoot, workspaceRoot } = await makeWorkspaceTree({ prefix: "structuring-" }));
		const transcriptPath = stageOutputPath({ workspaceRoot, stageId: "transcription" });
		await mkdir(dirname(transcriptPath), { recursive: true });
		await writeFile(transcriptPath, TRANSCRIPT_TEXT);
		stubReply();
	});

	afterEach(async () => {
		await rm(moduleRoot, { recursive: true, force: true });
	});

	function contextWith(manifestOverrides: Partial<RunManifest> = {}): StageContext {
		return makeStageContext({
			workspaceRoot,
			config: makeConfig({
				stages: { "transcript-structuring": { modelId: "openai/gpt-4o" } },
			}),
			manifest: makeManifest(manifestOverrides),
		});
	}

	async function runStage(
		context: StageContext,
	): Promise<StageResult<TranscriptStructuringOutput>> {
		const stage = createTranscriptStructuringStage();
		return stage.run({ input: await stage.getInput(context), context });
	}

	/** The manifest wherever the stage left the workspace. */
	function readManifestAt(folderName: string): Promise<RunManifest> {
		return readManifest({ workspaceRoot: join(dirname(workspaceRoot), folderName) });
	}

	it("should name the stage transcript-structuring when the stage is created", () => {
		expect(createTranscriptStructuringStage().stageId).toBe("transcript-structuring");
	});

	it("should fail when the transcript is missing", async () => {
		await rm(stageOutputPath({ workspaceRoot, stageId: "transcription" }));

		await expect(createTranscriptStructuringStage().getInput(contextWith())).rejects.toThrow(
			TranscriptStructuringError,
		);
	});

	it("should fail when the transcript holds no text", async () => {
		await writeFile(stageOutputPath({ workspaceRoot, stageId: "transcription" }), "   \n  ");

		await expect(createTranscriptStructuringStage().getInput(contextWith())).rejects.toThrow(
			TranscriptStructuringError,
		);
	});

	it("should ask the model for JSON when the stage calls it", async () => {
		await runStage(contextWith());

		expect(completionMock).toHaveBeenCalledWith(
			expect.objectContaining({ stageId: "transcript-structuring", responseFormat: "json" }),
		);
	});

	it("should send the transcript and the provisional title when the stage calls the model", async () => {
		await runStage(contextWith());

		const sent = JSON.stringify(completionMock.mock.calls[0][0].messages);
		expect(sent).toContain(TRANSCRIPT_TEXT);
		expect(sent).toContain(testLecture.title);
	});

	it("should extract the structured markdown when the model returns it", async () => {
		const result = await runStage(contextWith());

		expect(result.output.structuredTranscriptPath).toBe(
			stageOutputPath({ workspaceRoot, stageId: "transcript-structuring" }),
		);
		expect(result.filesWritten).toStrictEqual([stageOutputEntry("transcript-structuring")]);
	});

	it("should record the cost of the call when the stage completes", async () => {
		const result = await runStage(contextWith());

		expect(result.cost).toEqual(COST);
	});

	it("should keep the provisional title when the model judges it meaningful", async () => {
		const result = await runStage(contextWith());

		expect(result.output.lectureTitle).toBe(testLecture.title);
	});

	it("should leave the workspace where it stands when the model judges the title meaningful", async () => {
		await runStage(contextWith());

		expect(await pathExists(workspaceRoot)).toBe(true);
	});

	it("should write no manifest when the model judges the title meaningful", async () => {
		await runStage(contextWith());

		expect(await pathExists(manifestPath({ workspaceRoot }))).toBe(false);
	});

	describe("replacing a title the model judges not meaningful", () => {
		beforeEach(() => {
			stubReply({ provisionalTitleMeaningful: false, suggestedTitle: aiDerivedLecture.title });
		});

		it("should store the suggested title as aiDerivedTitle when the provisional is not meaningful", async () => {
			await runStage(contextWith());

			expect((await readManifestAt(aiDerivedLecture.folderName)).aiDerivedTitle).toBe(
				aiDerivedLecture.title,
			);
		});

		it("should overwrite the lecture title when the provisional is not meaningful", async () => {
			const result = await runStage(contextWith());

			expect(result.output.lectureTitle).toBe(aiDerivedLecture.title);
			expect((await readManifestAt(aiDerivedLecture.folderName)).lectureTitle).toBe(
				aiDerivedLecture.title,
			);
		});

		it("should record the workspace's new folder name when the title is replaced", async () => {
			await runStage(contextWith());

			expect((await readManifestAt(aiDerivedLecture.folderName)).workspaceFolderName).toBe(
				aiDerivedLecture.folderName,
			);
		});

		it("should fail when the model proposes no title to replace it with", async () => {
			stubReply({ provisionalTitleMeaningful: false, suggestedTitle: null });

			const error = await captureError(runStage(contextWith()));

			expect(error).toBeInstanceOf(TranscriptStructuringError);
		});

		it("should fail when the proposed title has no characters usable in a filename", async () => {
			stubReply({ provisionalTitleMeaningful: false, suggestedTitle: ".." });

			const error = await captureError(runStage(contextWith()));

			expect(error).toBeInstanceOf(TranscriptStructuringError);
		});
	});

	describe("deferring to a title the user set", () => {
		/** The lecture as `rename` leaves it: the user's title, already in force. */
		const userNamed = { userTitle: userChosenTitle, lectureTitle: userChosenTitle };

		beforeEach(() => {
			stubReply({ provisionalTitleMeaningful: false, suggestedTitle: aiDerivedLecture.title });
		});

		it("should keep the user's title as the lecture title when they have named it", async () => {
			const result = await runStage(contextWith(userNamed));

			expect(result.output.lectureTitle).toBe(userChosenTitle);
			expect((await readManifestAt(testLecture.folderName)).lectureTitle).toBe(userChosenTitle);
		});

		it("should still record what the model derived when the user has named it", async () => {
			await runStage(contextWith(userNamed));

			expect((await readManifestAt(testLecture.folderName)).aiDerivedTitle).toBe(
				aiDerivedLecture.title,
			);
		});

		it("should leave the workspace where it stands when the user has named it", async () => {
			await runStage(contextWith(userNamed));

			expect((await readManifestAt(testLecture.folderName)).workspaceFolderName).toBe(
				testLecture.folderName,
			);
		});
	});

	describe("rejecting a reply that is not the documented JSON object", () => {
		it.each([
			{ what: "prose rather than JSON", content: "Here are your structured notes!" },
			{ what: "JSON that is not an object", content: '"a string"' },
			{
				what: "an object missing structuredMarkdown",
				content: '{"provisionalTitleMeaningful":true}',
			},
			{
				what: "a non-boolean judgement",
				content:
					'{"provisionalTitleMeaningful":"yes","suggestedTitle":null,"structuredMarkdown":"x"}',
			},
		])("should fail when the model returns $what", async ({ content }) => {
			completionMock.mockResolvedValue({ content, cost: COST });

			const error = await captureError(runStage(contextWith()));

			expect(error).toBeInstanceOf(TranscriptStructuringError);
		});
	});
});
