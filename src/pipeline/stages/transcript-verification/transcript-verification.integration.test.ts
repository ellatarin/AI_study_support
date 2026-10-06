import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { QaCheckerReport, StageContext } from "../../../types/pipeline.js";
import { pathExists } from "../../../utils/files.js";
import {
	configuringStage,
	driveStage,
	exampleConfig,
	expectJsonModeRequest,
	makeLectureTree,
	makeManifest,
	makeStageContext,
	makeStubLogger,
	openRouterClientFor,
	resetStubbedApi,
	seedStageOutput,
	structuredMarkdown,
	stubModelReply,
	stubOpenRouterApi,
	transcriptText,
	verificationDeficiency,
	verificationReply,
} from "../../fixtures.js";
import { writeManifest } from "../../manifest.js";
import { createTranscriptVerificationStage } from "./transcript-verification.js";

const STAGE_ID = "transcript-verification";

/**
 * The path of the verification report in the workspace. The test writes the path
 * in full, and does not take it from the layout. The user expects to find these
 * names. A path from the layout would change with the layout, and the test would
 * not see the change.
 */
const REPORT_LOCATION = join("Transcript verification", "verification-report.json");

/** The path of the verification report Markdown, written in full for the same reason. */
const VIEW_LOCATION = join("Transcript verification", "verification-report.md");

describe("transcript verification against a real module tree", () => {
	let tempDir: string;
	let workspaceRoot: string;
	let sentRequest: () => Record<string, unknown>;

	beforeEach(async () => {
		stubOpenRouterApi();
		({ tempDir, workspaceRoot } = await makeLectureTree({ prefix: "verification-int-" }));
		await seedStageOutput({ workspaceRoot, stageId: "transcription", contents: transcriptText });
		await seedStageOutput({
			workspaceRoot,
			stageId: "transcript-structuring",
			contents: structuredMarkdown,
		});
		sentRequest = stubModelReply(verificationReply());
	});

	afterEach(async () => {
		resetStubbedApi();
		await rm(tempDir, { recursive: true, force: true });
	});

	/** Writes the manifest of the lecture, and gives the stage context built from it. */
	async function prepareLecture(): Promise<StageContext> {
		const manifest = makeManifest();
		await writeManifest({ workspaceRoot, manifest });
		return makeStageContext({
			workspaceRoot,
			manifest,
			config: configuringStage({ stageId: STAGE_ID }),
		});
	}

	/** Runs the stage on the prepared lecture, as the runner does. */
	async function runStage(): ReturnType<typeof driveStage> {
		return driveStage({
			stage: createTranscriptVerificationStage({
				logger: makeStubLogger().logger,
				client: openRouterClientFor({ config: exampleConfig }),
			}),
			context: await prepareLecture(),
		});
	}

	/**
	 * Gives the text of the sent messages as one string. The test searches this
	 * text, not the request body, because the JSON body escapes each newline of the
	 * transcript.
	 */
	function sentToModel(): string {
		const messages = sentRequest().messages as readonly { readonly content: string }[];
		return messages.map(({ content }) => content).join("\n");
	}

	it("should ask OpenRouter for JSON when the stage calls the model", async () => {
		await runStage();

		expectJsonModeRequest(sentRequest());
	});

	it("should put both versions in front of the checker when the stage calls the model", async () => {
		await runStage();

		expect(sentToModel()).toContain(transcriptText);
		expect(sentToModel()).toContain(structuredMarkdown);
	});

	it("should write the report to Transcript verification when the stage completes", async () => {
		const { output } = await runStage();

		expect(await pathExists(join(workspaceRoot, REPORT_LOCATION))).toBe(true);
		expect(output).toMatchObject({
			verificationReportPath: join(workspaceRoot, REPORT_LOCATION),
		});
	});

	it("should write the readable view beside the report when the stage completes", async () => {
		await runStage();

		const written = await readFile(join(workspaceRoot, VIEW_LOCATION), "utf8");
		expect(written).toContain("# Transcript verification");
		expect(written).toContain(verificationDeficiency.description);
	});

	it("should record both files in the manifest as the stage's recorded files when the stage completes", async () => {
		const { filesWritten } = await runStage();

		expect(filesWritten).toEqual([REPORT_LOCATION, VIEW_LOCATION]);
	});

	it("should write the report as readable JSON when the stage completes", async () => {
		await runStage();

		const written = await readFile(join(workspaceRoot, REPORT_LOCATION), "utf8");
		expect(written).toContain("\n");
		expect(JSON.parse(written) as QaCheckerReport).toEqual(verificationReply());
	});
});
