import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { QaFindingsReport, StageContext } from "../../types/pipeline.js";
import { pathExists } from "../../utils/files.js";
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
	verificationReply,
} from "../fixtures.js";
import { writeManifest } from "../manifest.js";
import { createTranscriptVerificationStage } from "./transcript-verification.js";

const STAGE_ID = "transcript-verification";

/**
 * Where the report belongs, spelled out rather than derived from the layout the
 * stage itself uses: the folder and file names are what the user goes looking
 * for, so a test that rebuilt them could not notice them changing.
 */
const REPORT_LOCATION = join("Transcript verification", "verification-report.json");

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

	/** Writes the lecture's manifest and returns the context built from it. */
	async function prepareLecture(): Promise<StageContext> {
		const manifest = makeManifest();
		await writeManifest({ workspaceRoot, manifest });
		return makeStageContext({
			workspaceRoot,
			manifest,
			config: configuringStage({ stageId: STAGE_ID }),
		});
	}

	/** Runs the stage the way the runner would, against the prepared lecture. */
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
	 * Everything the request put in front of the model, as one searchable string.
	 * The messages' own text, not the encoded request: a JSON-escaped body holds
	 * no newline a transcript could be found by.
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
		const { output, filesWritten } = await runStage();

		expect(await pathExists(join(workspaceRoot, REPORT_LOCATION))).toBe(true);
		expect(filesWritten).toEqual([REPORT_LOCATION]);
		expect(output).toMatchObject({
			verificationReportPath: join(workspaceRoot, REPORT_LOCATION),
		});
	});

	it("should write the report as readable JSON when the stage completes", async () => {
		await runStage();

		const written = await readFile(join(workspaceRoot, REPORT_LOCATION), "utf8");
		expect(written).toContain("\n");
		expect(JSON.parse(written) as QaFindingsReport).toEqual(verificationReply());
	});
});
