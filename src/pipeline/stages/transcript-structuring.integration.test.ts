import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import nock from "nock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LectureIdentityChanges, RunManifest, StageContext } from "../../types/pipeline.js";
import { pathExists } from "../../utils/files.js";
import {
	aiDerivedLecture,
	makeConfig,
	makeLectureTree,
	makeManifest,
	makeStageContext,
	makeStubLogger,
	openRouterCompletionBody,
	openRouterStageConfig,
	openRouterUrls,
	structuredMarkdown,
	stubbedCostUsd,
	testLecture,
	userChosenTitle,
} from "../fixtures.js";
import { type ModuleDirs, stageOutputPath } from "../layout.js";
import { readManifest, writeManifest } from "../manifest.js";
import { createTranscriptStructuringStage } from "./transcript-structuring.js";

describe("transcript structuring against a real module tree", () => {
	let tempDir: string;
	let dirs: ModuleDirs;
	let workspaceRoot: string;
	let capturedBody: Record<string, unknown>;

	/** Mocks the completion and its cost lookup, capturing what was sent. */
	function mockModelReply(reply: Record<string, unknown>): void {
		nock(openRouterUrls.origin)
			.post(openRouterUrls.completions)
			.reply((_uri, body) => {
				capturedBody = body as Record<string, unknown>;
				return [200, openRouterCompletionBody({ content: JSON.stringify(reply) })];
			});
		nock(openRouterUrls.origin)
			.get(openRouterUrls.generation)
			.query(true)
			.reply(200, { data: { total_cost: stubbedCostUsd } });
	}

	/** The model's verdict, as the two cases every title test is written across. */
	function verdict(meaningful: boolean): Record<string, unknown> {
		return {
			provisionalTitleMeaningful: meaningful,
			suggestedTitle: meaningful ? null : aiDerivedLecture.title,
			structuredMarkdown: structuredMarkdown,
		};
	}

	beforeEach(async () => {
		process.env.OPENROUTER_API_KEY = "test-key";
		nock.cleanAll();
		nock.disableNetConnect();
		capturedBody = {};

		({ tempDir, dirs, workspaceRoot } = await makeLectureTree({ prefix: "structuring-int-" }));
		const transcriptPath = stageOutputPath({ workspaceRoot, stageId: "transcription" });
		await mkdir(dirname(transcriptPath), { recursive: true });
		await writeFile(transcriptPath, "The lecture text.");
	});

	afterEach(async () => {
		nock.cleanAll();
		nock.enableNetConnect();
		await rm(tempDir, { recursive: true, force: true });
	});

	/** Writes the lecture's manifest and returns the context built from it. */
	async function prepareLecture(overrides: Partial<RunManifest> = {}): Promise<StageContext> {
		const manifest = makeManifest(overrides);
		await writeManifest({ workspaceRoot, manifest });
		return makeStageContext({
			workspaceRoot,
			manifest,
			config: makeConfig({
				stages: {
					"transcript-structuring": openRouterStageConfig({ stageId: "transcript-structuring" }),
				},
			}),
		});
	}

	async function runStage(context: StageContext): Promise<LectureIdentityChanges | undefined> {
		const stage = createTranscriptStructuringStage({ logger: makeStubLogger().logger });
		const result = await stage.run({ input: await stage.getInput(context), context });
		return result.identityChanges;
	}

	function manifestAt(folderName: string): Promise<RunManifest> {
		return readManifest({ workspaceRoot: join(dirs.processing, folderName) });
	}

	it("should ask OpenRouter for JSON when the stage calls the model", async () => {
		mockModelReply(verdict(true));

		await runStage(await prepareLecture());

		expect(capturedBody.response_format).toEqual({ type: "json_object" });
		expect(capturedBody.provider).toEqual({ require_parameters: true });
	});

	it.each([
		{ meaningful: false, folder: aiDerivedLecture.folderName, extinct: testLecture.folderName },
		{ meaningful: true, folder: testLecture.folderName, extinct: aiDerivedLecture.folderName },
	])("should leave the lecture's files named $folder when provisionalTitleMeaningful is $meaningful", async ({
		meaningful,
		folder,
		extinct,
	}) => {
		mockModelReply(verdict(meaningful));

		await runStage(await prepareLecture());

		expect(await pathExists(join(dirs.video, `${folder}.mp4`))).toBe(true);
		expect(await pathExists(join(dirs.slide, `${folder}.pdf`))).toBe(true);
		expect(await pathExists(join(dirs.finalOutput, `${folder}.pdf`))).toBe(true);
		expect(
			await pathExists(
				stageOutputPath({
					workspaceRoot: join(dirs.processing, folder),
					stageId: "transcript-structuring",
				}),
			),
		).toBe(true);
		expect(await pathExists(join(dirs.video, `${extinct}.mp4`))).toBe(false);
	});

	it.each([
		{
			meaningful: false,
			settled: {
				aiDerivedTitle: aiDerivedLecture.title,
				lectureTitle: aiDerivedLecture.title,
				workspaceFolderName: aiDerivedLecture.folderName,
			},
		},
		{ meaningful: true, settled: {} },
	])("should settle $settled when provisionalTitleMeaningful is $meaningful", async ({
		meaningful,
		settled,
	}) => {
		mockModelReply(verdict(meaningful));

		expect(await runStage(await prepareLecture())).toEqual(settled);
	});

	// The lecture's own manifest is on disk throughout, so a stage that wrote one
	// would be caught here rather than only in the unit suite (§4.2).
	it.each([
		{ meaningful: false },
		{ meaningful: true },
	])("should leave the manifest to the runner when provisionalTitleMeaningful is $meaningful", async ({
		meaningful,
	}) => {
		mockModelReply(verdict(meaningful));
		const context = await prepareLecture();

		await runStage(context);

		const folder = meaningful ? testLecture.folderName : aiDerivedLecture.folderName;
		expect(await manifestAt(folder)).toEqual(context.manifest);
	});

	it("should leave the lecture's title and every file alone when the user has named it", async () => {
		mockModelReply(verdict(false));

		const settled = await runStage(
			await prepareLecture({ userTitle: userChosenTitle, lectureTitle: userChosenTitle }),
		);

		expect(settled).toEqual({ aiDerivedTitle: aiDerivedLecture.title });
		expect(await pathExists(join(dirs.video, testLecture.videoFile))).toBe(true);
		expect(await pathExists(join(dirs.processing, aiDerivedLecture.folderName))).toBe(false);
	});

	it("should move a lecture that has produced no PDF yet when the title is replaced", async () => {
		await rm(join(dirs.finalOutput, testLecture.outputFile));
		mockModelReply(verdict(false));

		await runStage(await prepareLecture());

		expect(await pathExists(join(dirs.processing, aiDerivedLecture.folderName))).toBe(true);
		expect(await pathExists(join(dirs.finalOutput, `${aiDerivedLecture.folderName}.pdf`))).toBe(
			false,
		);
	});
});
