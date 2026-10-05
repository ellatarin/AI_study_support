/* jscpd:ignore-start -- sibling stage suites import the same fixtures and mock the
   same module, so their preambles match line for line. Neither half can move:
   imports cannot be shared and barrel files are forbidden (CLAUDE.md, File
   Organisation), and vi.mock is hoisted, so it must sit in the file that mocks.
   Only the preamble is exempt; the suite below is checked as normal. */
import { rm } from "node:fs/promises";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	Manifest,
	QaCheckerReport,
	QaDeficiencyType,
	QaSeverity,
	StageContext,
	StageCost,
} from "../../../types/pipeline.js";
import {
	captureError,
	configuringStage,
	driveStage,
	exampleStageConfig,
	makeManifest,
	makeStageContext,
	openRouterClientFor,
	readJsonFile,
	seedStageOutput,
	structuredMarkdown,
	stubbedCostUsd,
	useStubLogger,
	useTranscribedWorkspace,
	verificationConsideration,
	verificationDeficiency,
	verificationReply,
} from "../../fixtures.js";
import { type StageWithOutputFile, stageOutputPath } from "../../layout.js";
import { callModel } from "../../openrouter.js";
import {
	createTranscriptVerificationStage,
	TranscriptVerificationError,
} from "./transcript-verification.js";

// Only the call is stubbed; everything else the module exports stays real.
vi.mock(import("../../openrouter.js"), async (importOriginal) => ({
	...(await importOriginal()),
	callModel: vi.fn(),
}));

const modelCallMock = callModel as unknown as Mock;
/* jscpd:ignore-end */

const STAGE_ID = "transcript-verification";

const COST: StageCost = {
	promptTokens: 9000,
	completionTokens: 1400,
	callCount: 1,
	costUsd: stubbedCostUsd,
};

/**
 * Every way one of the two versions can leave the stage with nothing to compare:
 * each input absent, and each input present but blank. `contents` of `null` means
 * remove the file; anything else is written into it.
 */
const UNUSABLE_INPUTS = [
	{ stageId: "transcription", state: "missing", contents: null },
	{ stageId: "transcription", state: "empty", contents: "  \n" },
	{ stageId: "transcript-structuring", state: "missing", contents: null },
	{ stageId: "transcript-structuring", state: "empty", contents: "  \n" },
] as const satisfies readonly {
	readonly stageId: StageWithOutputFile;
	readonly state: string;
	readonly contents: string | null;
}[];

/** Sends back exactly this text as the checker's reply, whether or not it is a report. */
function stubRawReply(content: string): void {
	modelCallMock.mockResolvedValue({ content, cost: COST });
}

/** A well-formed checker reply, with the fields a test is about replaced. */
function stubReply(overrides: Readonly<Record<string, unknown>> = {}): void {
	stubRawReply(JSON.stringify(verificationReply(overrides)));
}

/**
 * Unusable replies, each wrong in a different place: the reply as a whole, a top-level field, a deficiency, and a
 * consideration.
 */
const UNUSABLE_REPLIES = [
	{ label: "not JSON at all", content: "The structuring looks faithful to me." },
	{ label: "a JSON list rather than a report", content: "[]" },
	{
		label: "a verdict that is neither pass nor fail",
		content: JSON.stringify(verificationReply({ overallVerdict: "unsure" })),
	},
	{
		label: "a coverage score that is not a number",
		content: JSON.stringify(verificationReply({ coverageScore: "72%" })),
	},
	{
		label: "deficiencies that are not a list",
		content: JSON.stringify(verificationReply({ deficiencies: verificationDeficiency })),
	},
	{
		label: "a deficiency with no suggested fix",
		content: JSON.stringify(
			verificationReply({ deficiencies: [{ ...verificationDeficiency, suggestedFix: undefined }] }),
		),
	},
	{
		label: "a cleared consideration with no reason",
		content: JSON.stringify(
			verificationReply({ considered: [{ source: verificationConsideration.source }] }),
		),
	},
] as const satisfies readonly { readonly label: string; readonly content: string }[];

/**
 * Every severity a deficiency can carry. The stage completes on all of them, so the
 * never-gates rule is stated across the whole scale rather than at its top.
 */
const SEVERITIES = ["critical", "major", "minor"] as const satisfies readonly QaSeverity[];

/**
 * The deficiency types that judge the writing of the notes rather than faithfulness to
 * the source. This checker compares two transcripts and is never offered them,
 * so a reply carrying one is answering a question it was not asked.
 */
const PROSE_FAULT_TYPES = [
	"clarity",
	"british-english",
	"formatting",
	"figure-reference",
] as const satisfies readonly QaDeficiencyType[];

describe("createTranscriptVerificationStage", () => {
	const workspace = useTranscribedWorkspace({ prefix: "verification-" });
	const logged = useStubLogger();

	/** The lecture workspace the current test is running against. */
	const workspaceRoot = (): string => workspace().workspaceRoot;

	beforeEach(async () => {
		vi.clearAllMocks();
		await seedStageOutput({
			workspaceRoot: workspaceRoot(),
			stageId: "transcript-structuring",
			contents: structuredMarkdown,
		});
		stubReply();
	});

	function contextWith(manifest: Partial<Manifest> = {}): StageContext {
		return makeStageContext({
			workspaceRoot: workspaceRoot(),
			manifest: makeManifest(manifest),
			config: configuringStage({ stageId: STAGE_ID }),
		});
	}

	/** Runs the stage against a prepared workspace, the way the runner would. */
	async function run(manifest: Partial<Manifest> = {}): ReturnType<typeof driveStage> {
		const result = await driveStage({
			stage: createTranscriptVerificationStage({
				logger: logged().logger,
				client: openRouterClientFor({ config: configuringStage({ stageId: STAGE_ID }) }),
			}),
			context: contextWith(manifest),
		});
		return result;
	}

	/** The report the stage wrote, parsed back off disk. */
	async function writtenReport(): Promise<QaCheckerReport> {
		return (await readJsonFile(
			stageOutputPath({ workspaceRoot: workspaceRoot(), stageId: STAGE_ID }),
		)) as QaCheckerReport;
	}

	it("should write every deficiency the checker returned when the stage runs", async () => {
		await run();

		expect(await writtenReport()).toMatchObject({ deficiencies: [verificationDeficiency] });
	});

	it("should record what the checker cleared when it reports having considered it", async () => {
		await run();

		expect(await writtenReport()).toMatchObject({ considered: [verificationConsideration] });
	});

	it.each(
		SEVERITIES,
	)("should complete rather than fail when the checker returns a %s deficiency", async (severity) => {
		stubReply({
			overallVerdict: "fail",
			deficiencies: [{ ...verificationDeficiency, severity }],
		});

		await expect(run()).resolves.toMatchObject({ output: { deficiencyCount: 1 } });
	});

	it.each(UNUSABLE_INPUTS)("should fail when the $stageId output is $state", async ({
		stageId,
		contents,
	}) => {
		const path = stageOutputPath({ workspaceRoot: workspaceRoot(), stageId });
		if (contents === null) {
			await rm(path);
		} else {
			await seedStageOutput({ workspaceRoot: workspaceRoot(), stageId, contents });
		}

		const error = await captureError(run());

		expect(error).toBeInstanceOf(TranscriptVerificationError);
		expect(error.message).toContain(path);
	});

	it.each(UNUSABLE_REPLIES)("should fail when the reply is $label", async ({ content }) => {
		stubRawReply(content);

		expect(await captureError(run())).toBeInstanceOf(TranscriptVerificationError);
	});

	it.each(
		PROSE_FAULT_TYPES,
	)("should fail when a deficiency carries the prose fault deficiency type %s", async (type) => {
		stubReply({ deficiencies: [{ ...verificationDeficiency, type }] });

		expect(await captureError(run())).toBeInstanceOf(TranscriptVerificationError);
	});

	// A tuning parameter narrows routing to the providers that honour it, and this
	// call wants the reasoning model's own defaults over a narrowed pool (A11.2d).
	it("should send neither a temperature nor a token cap when the shipped example configures the stage", () => {
		const { temperature, maxTokens } = exampleStageConfig(STAGE_ID);

		expect({ temperature, maxTokens }).toEqual({ temperature: undefined, maxTokens: undefined });
	});
});
