import { rm, writeFile } from "node:fs/promises";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	OutputLanguage,
	StageContext,
	StageCost,
	StageResult,
} from "../../../types/pipeline.js";
import { pathExists } from "../../../utils/files.js";
import {
	captureError,
	configuringStage,
	driveStage,
	exampleConfig,
	makeStageContext,
	openRouterClientFor,
	structuringReply,
	stubbedCostUsd,
	testLecture,
	titleRejected,
	transcriptText,
	useStubLogger,
	useTranscribedWorkspace,
} from "../../fixtures.js";
import { stageOutputEntry, stageOutputPath } from "../../layout.js";
import { manifestPath } from "../../manifest.js";
import { callModel } from "../../openrouter.js";
import type { TranscriptStructuringOutput } from "./transcript-structuring.js";
import {
	createTranscriptStructuringStage,
	TranscriptStructuringError,
} from "./transcript-structuring.js";

// The suite stubs only the model call. The other exports stay real, because the
// fixtures build their URLs from the endpoint paths.
vi.mock(import("../../openrouter.js"), async (importOriginal) => ({
	...(await importOriginal()),
	callModel: vi.fn(),
}));

const modelCallMock = callModel as unknown as Mock;

const COST: StageCost = {
	promptTokens: 1200,
	completionTokens: 300,
	callCount: 1,
	costUsd: stubbedCostUsd,
};

/** Stubs a usable reply. The overrides replace the fields that a test needs. */
function stubReply(overrides: Readonly<Record<string, unknown>> = {}): void {
	modelCallMock.mockResolvedValue({
		content: JSON.stringify(structuringReply(overrides)),
		cost: COST,
	});
}

describe("createTranscriptStructuringStage", () => {
	const workspace = useTranscribedWorkspace({ prefix: "structuring-" });
	const logged = useStubLogger();

	/** The workspace of the current test. */
	const workspaceRoot = (): string => workspace().workspaceRoot;

	beforeEach(() => {
		vi.clearAllMocks();
		stubReply();
	});

	function contextWith({ language }: { readonly language?: OutputLanguage } = {}): StageContext {
		return makeStageContext({
			workspaceRoot: workspaceRoot(),
			config: configuringStage({ stageId: "transcript-structuring", language }),
		});
	}

	/** The stage under test. It logs into {@link logged}. */
	function makeStage(): ReturnType<typeof createTranscriptStructuringStage> {
		return createTranscriptStructuringStage({
			logger: logged().logger,
			// The suite stubs the model call, so the stage never uses the client.
			// The stage requires one.
			client: openRouterClientFor({ config: exampleConfig }),
		});
	}

	function runStage(context: StageContext): Promise<StageResult<TranscriptStructuringOutput>> {
		return driveStage({ stage: makeStage(), context });
	}

	it("should name the stage transcript-structuring when the stage is created", () => {
		expect(makeStage().stageId).toBe("transcript-structuring");
	});

	it("should fail when the transcript is missing", async () => {
		await rm(stageOutputPath({ workspaceRoot: workspaceRoot(), stageId: "transcription" }));

		await expect(makeStage().getInput(contextWith())).rejects.toThrow(TranscriptStructuringError);
	});

	it("should fail when the transcript holds no text", async () => {
		await writeFile(
			stageOutputPath({ workspaceRoot: workspaceRoot(), stageId: "transcription" }),
			"   \n  ",
		);

		await expect(makeStage().getInput(contextWith())).rejects.toThrow(TranscriptStructuringError);
	});

	it("should ask the model for JSON when the stage calls it", async () => {
		await runStage(contextWith());

		expect(modelCallMock).toHaveBeenCalledWith(
			expect.objectContaining({ stageId: "transcript-structuring", responseFormat: "json" }),
		);
	});

	it("should send the transcript and no provisional title when the stage calls the model", async () => {
		await runStage(contextWith());

		const sent = JSON.stringify(modelCallMock.mock.calls[0]?.[0].messages);
		expect(sent).toContain(transcriptText);
		expect(sent).not.toContain(testLecture.title);
	});

	// The model call of `transcript-structuring` is the first in the pipeline that sets the language of the output
	// (technical-design.md §5, `transcript-structuring`). Two languages prove that
	// the stage reads the config setting.
	it.each([
		{ language: "en-GB", instruction: "British English" },
		{ language: "en-US", instruction: "American English" },
	] as const)("should tell the model to write in $instruction when the configured language is $language", async ({
		language,
		instruction,
	}) => {
		await runStage(contextWith({ language }));

		const sent = JSON.stringify(modelCallMock.mock.calls[0]?.[0].messages);
		expect(sent).toContain(`Write in ${instruction}`);
	});

	it("should extract the structured markdown when the model returns it", async () => {
		const result = await runStage(contextWith());

		expect(result.output.structuredTranscriptPath).toBe(
			stageOutputPath({ workspaceRoot: workspaceRoot(), stageId: "transcript-structuring" }),
		);
		expect(result.filesWritten).toStrictEqual([stageOutputEntry("transcript-structuring")]);
	});

	it("should record the cost of the call when the stage completes", async () => {
		const result = await runStage(contextWith());

		expect(result.cost).toEqual(COST);
	});

	// A reply that still judges the title must change nothing. Only judge-lecture-title
	// renames a lecture (technical-design.md §5, `judge-lecture-title`).
	it("should return no identity changes and leave the workspace where it stands when the stage completes", async () => {
		stubReply(titleRejected);

		const result = await runStage(contextWith());

		expect(result.identityChanges ?? {}).toEqual({});
		expect(await pathExists(workspaceRoot())).toBe(true);
	});

	// The stage context holds the manifest from before the stage started. So a stage
	// that writes the manifest reverts its own `running` entry (technical-design.md §4.2).
	it("should write no manifest when the stage completes", async () => {
		await runStage(contextWith());

		expect(await pathExists(manifestPath({ workspaceRoot: workspaceRoot() }))).toBe(false);
	});

	describe("treating as unusable a reply that is not the documented JSON object", () => {
		it.each([
			{ what: "prose rather than JSON", content: "Here are your structured notes!" },
			{ what: "JSON that is not an object", content: '"a string"' },
			{ what: "an object missing structuredMarkdown", content: '{"markdown":"x"}' },
			{ what: "structuredMarkdown that is not text", content: '{"structuredMarkdown":42}' },
		])("should fail when the model returns $what", async ({ content }) => {
			modelCallMock.mockResolvedValue({ content, cost: COST });

			const error = await captureError(runStage(contextWith()));

			expect(error).toBeInstanceOf(TranscriptStructuringError);
		});
	});
});
