import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunManifest, StageContext, StageCost, StageResult } from "../../types/pipeline.js";
import { pathExists } from "../../utils/files.js";
import {
	captureError,
	makeConfig,
	makeManifest,
	makeStageContext,
	makeWorkspaceTree,
} from "../fixtures.js";
import { readManifest } from "../manifest.js";
import { makeCompletionCall } from "../openrouter.js";
import type { TranscriptStructuringOutput } from "./transcript-structuring.js";
import {
	createTranscriptStructuringStage,
	TranscriptStructuringError,
} from "./transcript-structuring.js";

vi.mock("../openrouter.js", () => ({ makeCompletionCall: vi.fn() }));

const completionMock = makeCompletionCall as unknown as Mock;

const WORKSPACE_FOLDER = "Lecture 1 - Cell Injury - 2025-10-10";
const RENAMED_FOLDER = "Lecture 1 - Innate Immune Response - 2025-10-10";
const PROVISIONAL_TITLE = "Cell Injury";
const SUGGESTED_TITLE = "Innate Immune Response";
const USER_TITLE = "Cell Injury and Death";
const TRANSCRIPT_ENTRY = join("Transcript", "transcript.txt");
const STRUCTURED_ENTRY = join("Structured transcript", "structured-transcript.md");
const TRANSCRIPT_TEXT = "Today we are covering the innate immune response.";
const STRUCTURED_MARKDOWN = "## The Innate Immune Response\n\nBarrier defences come first.";
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
			structuredMarkdown: STRUCTURED_MARKDOWN,
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
		({ moduleRoot, workspaceRoot } = await makeWorkspaceTree({
			prefix: "structuring-",
			folderName: WORKSPACE_FOLDER,
		}));
		await mkdir(join(workspaceRoot, "Transcript"), { recursive: true });
		await writeFile(join(workspaceRoot, TRANSCRIPT_ENTRY), TRANSCRIPT_TEXT);
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
			manifest: makeManifest({
				provisionalTitle: PROVISIONAL_TITLE,
				lectureTitle: PROVISIONAL_TITLE,
				workspaceFolderName: WORKSPACE_FOLDER,
				...manifestOverrides,
			}),
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
		await rm(join(workspaceRoot, TRANSCRIPT_ENTRY));

		await expect(createTranscriptStructuringStage().getInput(contextWith())).rejects.toThrow(
			TranscriptStructuringError,
		);
	});

	it("should fail when the transcript holds no text", async () => {
		await writeFile(join(workspaceRoot, TRANSCRIPT_ENTRY), "   \n  ");

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
		expect(sent).toContain(PROVISIONAL_TITLE);
	});

	it("should extract the structured markdown when the model returns it", async () => {
		const result = await runStage(contextWith());

		expect(result.output.structuredTranscriptPath).toBe(join(workspaceRoot, STRUCTURED_ENTRY));
		expect(result.filesWritten).toStrictEqual([STRUCTURED_ENTRY]);
	});

	it("should record the cost of the call when the stage completes", async () => {
		const result = await runStage(contextWith());

		expect(result.cost).toEqual(COST);
	});

	it("should keep the provisional title when the model judges it meaningful", async () => {
		const result = await runStage(contextWith());

		expect(result.output.lectureTitle).toBe(PROVISIONAL_TITLE);
	});

	it("should leave the workspace where it stands when the model judges the title meaningful", async () => {
		await runStage(contextWith());

		expect(await pathExists(workspaceRoot)).toBe(true);
	});

	it("should write no manifest when the model judges the title meaningful", async () => {
		await runStage(contextWith());

		expect(await pathExists(join(workspaceRoot, "manifest.json"))).toBe(false);
	});

	describe("replacing a title the model judges not meaningful", () => {
		beforeEach(() => {
			stubReply({ provisionalTitleMeaningful: false, suggestedTitle: SUGGESTED_TITLE });
		});

		it("should store the suggested title as aiDerivedTitle when the provisional is not meaningful", async () => {
			await runStage(contextWith());

			expect((await readManifestAt(RENAMED_FOLDER)).aiDerivedTitle).toBe(SUGGESTED_TITLE);
		});

		it("should overwrite the lecture title when the provisional is not meaningful", async () => {
			const result = await runStage(contextWith());

			expect(result.output.lectureTitle).toBe(SUGGESTED_TITLE);
			expect((await readManifestAt(RENAMED_FOLDER)).lectureTitle).toBe(SUGGESTED_TITLE);
		});

		it("should record the workspace's new folder name when the title is replaced", async () => {
			await runStage(contextWith());

			expect((await readManifestAt(RENAMED_FOLDER)).workspaceFolderName).toBe(RENAMED_FOLDER);
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
		const userNamed = { userTitle: USER_TITLE, lectureTitle: USER_TITLE };

		beforeEach(() => {
			stubReply({ provisionalTitleMeaningful: false, suggestedTitle: SUGGESTED_TITLE });
		});

		it("should keep the user's title as the lecture title when they have named it", async () => {
			const result = await runStage(contextWith(userNamed));

			expect(result.output.lectureTitle).toBe(USER_TITLE);
			expect((await readManifestAt(WORKSPACE_FOLDER)).lectureTitle).toBe(USER_TITLE);
		});

		it("should still record what the model derived when the user has named it", async () => {
			await runStage(contextWith(userNamed));

			expect((await readManifestAt(WORKSPACE_FOLDER)).aiDerivedTitle).toBe(SUGGESTED_TITLE);
		});

		it("should leave the workspace where it stands when the user has named it", async () => {
			await runStage(contextWith(userNamed));

			expect((await readManifestAt(WORKSPACE_FOLDER)).workspaceFolderName).toBe(WORKSPACE_FOLDER);
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
