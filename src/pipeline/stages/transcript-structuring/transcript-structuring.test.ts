import { rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	Manifest,
	OutputLanguage,
	StageContext,
	StageCost,
	StageResult,
} from "../../../types/pipeline.js";
import { pathExists } from "../../../utils/files.js";
import {
	aiDerivedLecture,
	captureError,
	configuringStage,
	driveStage,
	exampleConfig,
	loggedAt,
	makeManifest,
	makeStageContext,
	openRouterClientFor,
	structuringReply,
	stubbedCostUsd,
	testLecture,
	testUserTitle,
	titleKept,
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

/** The lecture after `rename`. The user title is the lecture title. */
const withUserTitle = { userTitle: testUserTitle, lectureTitle: testUserTitle };
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

	function contextWith({
		manifest = {},
		language,
	}: {
		readonly manifest?: Partial<Manifest>;
		readonly language?: OutputLanguage;
	} = {}): StageContext {
		return makeStageContext({
			workspaceRoot: workspaceRoot(),
			config: configuringStage({ stageId: "transcript-structuring", language }),
			manifest: makeManifest(manifest),
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

	/** The outcome that the stage logged for the lecture title. */
	function decidedTitleOutcome(): unknown {
		const [entry] = loggedAt({ entries: logged().entries, level: "debug" }).filter(
			(logEntry) => logEntry.message === "Decided lecture title",
		);
		return entry?.payload.outcome;
	}

	function runStage(context: StageContext): Promise<StageResult<TranscriptStructuringOutput>> {
		return driveStage({ stage: makeStage(), context });
	}

	/** Checks for a manifest at the workspace path before and after a title change. */
	async function anyManifestWritten(): Promise<boolean> {
		const baseNames = [testLecture.baseName, aiDerivedLecture.baseName];
		const written = await Promise.all(
			baseNames.map((baseName) =>
				pathExists(manifestPath({ workspaceRoot: join(dirname(workspaceRoot()), baseName) })),
			),
		);
		return written.includes(true);
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

	it("should send the transcript and the provisional title when the stage calls the model", async () => {
		await runStage(contextWith());

		const sent = JSON.stringify(modelCallMock.mock.calls[0]?.[0].messages);
		expect(sent).toContain(transcriptText);
		expect(sent).toContain(testLecture.title);
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

	it("should keep the provisional title when the model judges it meaningful", async () => {
		const result = await runStage(contextWith());

		expect(result.output.lectureTitle).toBe(testLecture.title);
	});

	it("should decide no identity when the model judges the title meaningful", async () => {
		const result = await runStage(contextWith());

		expect(result.identityChanges).toEqual({});
	});

	it("should leave the workspace where it stands when the model judges the title meaningful", async () => {
		await runStage(contextWith());

		expect(await pathExists(workspaceRoot())).toBe(true);
	});

	// The stage context holds the manifest from before the stage started. So a stage
	// that writes the manifest reverts its own `running` entry (technical-design.md
	// §4.2). This stage decides the lecture identity, so it is the stage most likely to write the manifest.
	it.each([
		{ what: "the provisional title stands", reply: titleKept },
		{ what: "the title is replaced", reply: titleRejected },
	])("should write no manifest when $what", async ({ reply }) => {
		stubReply(reply);

		await runStage(contextWith());

		expect(await anyManifestWritten()).toBe(false);
	});

	describe("replacing a title the model judges not meaningful", () => {
		beforeEach(() => {
			stubReply(titleRejected);
		});

		it("should decide the whole identity for the runner when the provisional is not meaningful", async () => {
			const result = await runStage(contextWith());

			expect(result.identityChanges).toEqual({
				aiDerivedTitle: aiDerivedLecture.title,
				lectureTitle: aiDerivedLecture.title,
				baseName: aiDerivedLecture.baseName,
			});
		});

		it("should overwrite the lecture title when the provisional is not meaningful", async () => {
			const result = await runStage(contextWith());

			expect(result.output.lectureTitle).toBe(aiDerivedLecture.title);
		});

		it.each([
			{ scenario: "the model proposes no title to replace it with", suggestedTitle: null },
			{
				scenario: "the proposed title has no characters usable in a filename",
				suggestedTitle: "..",
			},
		])("should fail when $scenario", async ({ suggestedTitle }) => {
			stubReply({ ...titleRejected, suggestedTitle });

			const error = await captureError(runStage(contextWith()));

			expect(error).toBeInstanceOf(TranscriptStructuringError);
		});
	});

	describe("deferring to a title the user set", () => {
		beforeEach(() => {
			stubReply(titleRejected);
		});

		it("should keep the user title as the lecture title when the lecture has one", async () => {
			const result = await runStage(contextWith({ manifest: withUserTitle }));

			expect(result.output.lectureTitle).toBe(testUserTitle);
		});

		// The user title holds, so the lecture title and the base name do not change.
		// A change to either would move lecture files that carry the user title.
		it("should decide only what the model derived when the lecture has a user title", async () => {
			const result = await runStage(contextWith({ manifest: withUserTitle }));

			expect(result.identityChanges).toEqual({ aiDerivedTitle: aiDerivedLecture.title });
		});

		it("should leave the workspace where it stands when the lecture has a user title", async () => {
			await runStage(contextWith({ manifest: withUserTitle }));

			expect(await pathExists(workspaceRoot())).toBe(true);
		});
	});

	describe("recording which way the title was decided", () => {
		// Every later stage names its output from this title. So the debug log must
		// record the outcome (technical-design.md §10).
		it.each([
			{ outcome: "kept-provisional", reply: titleKept, manifest: {} },
			{ outcome: "adopted-derived", reply: titleRejected, manifest: {} },
			{ outcome: "kept-user-title", reply: titleRejected, manifest: withUserTitle },
		])("should record $outcome when that is how the title was decided", async (decided) => {
			stubReply(decided.reply);

			await runStage(contextWith({ manifest: decided.manifest }));

			expect(decidedTitleOutcome()).toBe(decided.outcome);
		});
	});

	describe("treating as unusable a reply that is not the documented JSON object", () => {
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
			modelCallMock.mockResolvedValue({ content, cost: COST });

			const error = await captureError(runStage(contextWith()));

			expect(error).toBeInstanceOf(TranscriptStructuringError);
		});
	});
});
