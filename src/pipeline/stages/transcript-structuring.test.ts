import { rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunManifest, StageContext, StageCost, StageResult } from "../../types/pipeline.js";
import { pathExists } from "../../utils/files.js";
import {
	aiDerivedLecture,
	captureError,
	configuringStage,
	driveStage,
	loggedAt,
	makeManifest,
	makeStageContext,
	makeStubLogger,
	makeWorkspaceTree,
	seedStageOutput,
	structuringReply,
	stubbedCostUsd,
	testLecture,
	titleKept,
	titleRejected,
	transcriptText,
	userChosenTitle,
} from "../fixtures.js";
import { stageOutputEntry, stageOutputPath } from "../layout.js";
import { manifestPath } from "../manifest.js";
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

/** The lecture as `rename` leaves it: the user's title, already in force. */
const userNamed = { userTitle: userChosenTitle, lectureTitle: userChosenTitle };
const COST: StageCost = {
	promptTokens: 1200,
	completionTokens: 300,
	callCount: 1,
	costUsd: stubbedCostUsd,
};

/** A well-formed model reply, with the fields a test cares about overridden. */
function stubReply(overrides: Readonly<Record<string, unknown>> = {}): void {
	completionMock.mockResolvedValue({
		content: JSON.stringify(structuringReply(overrides)),
		cost: COST,
	});
}

describe("createTranscriptStructuringStage", () => {
	let moduleRoot: string;
	let workspaceRoot: string;
	let logged: ReturnType<typeof makeStubLogger>;

	beforeEach(async () => {
		vi.clearAllMocks();
		logged = makeStubLogger();
		({ moduleRoot, workspaceRoot } = await makeWorkspaceTree({ prefix: "structuring-" }));
		await seedStageOutput({ workspaceRoot, stageId: "transcription", contents: transcriptText });
		stubReply();
	});

	afterEach(async () => {
		await rm(moduleRoot, { recursive: true, force: true });
	});

	function contextWith(manifestOverrides: Partial<RunManifest> = {}): StageContext {
		return makeStageContext({
			workspaceRoot,
			config: configuringStage({ stageId: "transcript-structuring" }),
			manifest: makeManifest(manifestOverrides),
		});
	}

	/** The stage under test, logging into {@link logged}. */
	function makeStage(): ReturnType<typeof createTranscriptStructuringStage> {
		return createTranscriptStructuringStage({ logger: logged.logger });
	}

	/** The outcome the stage recorded for the lecture's title. */
	function settledTitleOutcome(): unknown {
		const [entry] = loggedAt({ entries: logged.entries, level: "debug" }).filter(
			(logEntry) => logEntry.message === "Settled lecture title",
		);
		return entry?.payload.outcome;
	}

	function runStage(context: StageContext): Promise<StageResult<TranscriptStructuringOutput>> {
		return driveStage({ stage: makeStage(), context });
	}

	/** Whether the stage left a manifest anywhere it might have written one. */
	async function anyManifestWritten(): Promise<boolean> {
		const folders = [testLecture.folderName, aiDerivedLecture.folderName];
		const written = await Promise.all(
			folders.map((folder) =>
				pathExists(manifestPath({ workspaceRoot: join(dirname(workspaceRoot), folder) })),
			),
		);
		return written.includes(true);
	}

	it("should name the stage transcript-structuring when the stage is created", () => {
		expect(makeStage().stageId).toBe("transcript-structuring");
	});

	it("should fail when the transcript is missing", async () => {
		await rm(stageOutputPath({ workspaceRoot, stageId: "transcription" }));

		await expect(makeStage().getInput(contextWith())).rejects.toThrow(TranscriptStructuringError);
	});

	it("should fail when the transcript holds no text", async () => {
		await writeFile(stageOutputPath({ workspaceRoot, stageId: "transcription" }), "   \n  ");

		await expect(makeStage().getInput(contextWith())).rejects.toThrow(TranscriptStructuringError);
	});

	it("should ask the model for JSON when the stage calls it", async () => {
		await runStage(contextWith());

		expect(completionMock).toHaveBeenCalledWith(
			expect.objectContaining({ stageId: "transcript-structuring", responseFormat: "json" }),
		);
	});

	it("should send the transcript and the provisional title when the stage calls the model", async () => {
		await runStage(contextWith());

		const sent = JSON.stringify(completionMock.mock.calls[0]?.[0].messages);
		expect(sent).toContain(transcriptText);
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

	it("should settle no identity when the model judges the title meaningful", async () => {
		const result = await runStage(contextWith());

		expect(result.identityChanges).toEqual({});
	});

	it("should leave the workspace where it stands when the model judges the title meaningful", async () => {
		await runStage(contextWith());

		expect(await pathExists(workspaceRoot)).toBe(true);
	});

	// The runner hands a stage the context as it stood before the stage began, so a
	// stage writing the manifest back reverts its own `running` entry (§4.2). Stage 3
	// settles the lecture's identity and is the likeliest stage to try; it must not.
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

		it("should settle the whole identity for the runner when the provisional is not meaningful", async () => {
			const result = await runStage(contextWith());

			expect(result.identityChanges).toEqual({
				aiDerivedTitle: aiDerivedLecture.title,
				lectureTitle: aiDerivedLecture.title,
				workspaceFolderName: aiDerivedLecture.folderName,
			});
		});

		it("should overwrite the lecture title when the provisional is not meaningful", async () => {
			const result = await runStage(contextWith());

			expect(result.output.lectureTitle).toBe(aiDerivedLecture.title);
		});

		it("should fail when the model proposes no title to replace it with", async () => {
			stubReply({ ...titleRejected, suggestedTitle: null });

			const error = await captureError(runStage(contextWith()));

			expect(error).toBeInstanceOf(TranscriptStructuringError);
		});

		it("should fail when the proposed title has no characters usable in a filename", async () => {
			stubReply({ ...titleRejected, suggestedTitle: ".." });

			const error = await captureError(runStage(contextWith()));

			expect(error).toBeInstanceOf(TranscriptStructuringError);
		});
	});

	describe("deferring to a title the user set", () => {
		beforeEach(() => {
			stubReply(titleRejected);
		});

		it("should keep the user's title as the lecture title when they have named it", async () => {
			const result = await runStage(contextWith(userNamed));

			expect(result.output.lectureTitle).toBe(userChosenTitle);
		});

		// `aiDerivedTitle` alone: the user's title holds, so neither `lectureTitle`
		// nor the base name on disk changes, and settling either would move files
		// the user has already named.
		it("should settle only what the model derived when the user has named it", async () => {
			const result = await runStage(contextWith(userNamed));

			expect(result.identityChanges).toEqual({ aiDerivedTitle: aiDerivedLecture.title });
		});

		it("should leave the workspace where it stands when the user has named it", async () => {
			await runStage(contextWith(userNamed));

			expect(await pathExists(workspaceRoot)).toBe(true);
		});
	});

	describe("recording which way the title was settled", () => {
		// Every later stage names its output from the title settled here, so which
		// branch ran is the fact the debug log has to carry (§10).
		it.each([
			{ outcome: "kept-provisional", reply: titleKept, manifest: {} },
			{ outcome: "adopted-derived", reply: titleRejected, manifest: {} },
			{ outcome: "kept-user-title", reply: titleRejected, manifest: userNamed },
		])("should record $outcome when that is how the title was settled", async (settled) => {
			stubReply(settled.reply);

			await runStage(contextWith(settled.manifest));

			expect(settledTitleOutcome()).toBe(settled.outcome);
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
