import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import nock from "nock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RunManifest, StageContext } from "../../types/pipeline.js";
import { pathExists } from "../../utils/files.js";
import {
	aiDerivedLecture,
	makeConfig,
	makeLectureTree,
	makeManifest,
	makeStageContext,
	openRouterCompletionBody,
	openRouterUrls,
	structuredMarkdown,
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
			.reply(200, { data: { total_cost: 0.004 } });
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
			config: makeConfig({ stages: { "transcript-structuring": { modelId: "openai/gpt-4o" } } }),
		});
	}

	async function runStage(context: StageContext): Promise<void> {
		const stage = createTranscriptStructuringStage();
		await stage.run({ input: await stage.getInput(context), context });
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
			folder: aiDerivedLecture.folderName,
			title: aiDerivedLecture.title,
			derived: aiDerivedLecture.title,
		},
		{ meaningful: true, folder: testLecture.folderName, title: testLecture.title, derived: null },
	])("should record lectureTitle $title when provisionalTitleMeaningful is $meaningful", async ({
		meaningful,
		folder,
		title,
		derived,
	}) => {
		mockModelReply(verdict(meaningful));

		await runStage(await prepareLecture());

		const manifest = await manifestAt(folder);
		expect(manifest.lectureTitle).toBe(title);
		expect(manifest.aiDerivedTitle).toBe(derived);
		expect(manifest.workspaceFolderName).toBe(folder);
	});

	it("should leave the lecture's title and every file alone when the user has named it", async () => {
		mockModelReply(verdict(false));

		await runStage(
			await prepareLecture({ userTitle: userChosenTitle, lectureTitle: userChosenTitle }),
		);

		const manifest = await manifestAt(testLecture.folderName);
		expect(manifest.lectureTitle).toBe(userChosenTitle);
		expect(manifest.aiDerivedTitle).toBe(aiDerivedLecture.title);
		expect(await pathExists(join(dirs.video, `${testLecture.folderName}.mp4`))).toBe(true);
		expect(await pathExists(join(dirs.processing, aiDerivedLecture.folderName))).toBe(false);
	});

	it("should move a lecture that has produced no PDF yet when the title is replaced", async () => {
		await rm(join(dirs.finalOutput, `${testLecture.folderName}.pdf`));
		mockModelReply(verdict(false));

		await runStage(await prepareLecture());

		expect(await pathExists(join(dirs.processing, aiDerivedLecture.folderName))).toBe(true);
		expect(await pathExists(join(dirs.finalOutput, `${aiDerivedLecture.folderName}.pdf`))).toBe(
			false,
		);
	});
});
