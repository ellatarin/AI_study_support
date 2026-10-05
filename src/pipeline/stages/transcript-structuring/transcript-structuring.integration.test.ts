import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LectureIdentityChanges, Manifest, StageContext } from "../../../types/pipeline.js";
import { pathExists } from "../../../utils/files.js";
import {
	aiDerivedLecture,
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
	structuringReply,
	stubModelReply,
	stubOpenRouterApi,
	testLecture,
	titleKept,
	titleRejected,
	transcriptText,
	userChosenTitle,
} from "../../fixtures.js";
import { type ModuleDirs, stageOutputPath, workspaceRootFor } from "../../layout.js";
import { readManifest, writeManifest } from "../../manifest.js";
import { createTranscriptStructuringStage } from "./transcript-structuring.js";

describe("transcript structuring against a real module tree", () => {
	let tempDir: string;
	let moduleRoot: string;
	let dirs: ModuleDirs;
	let workspaceRoot: string;
	let sentRequest: () => Record<string, unknown>;

	/** The workspace a lecture with `baseName` occupies in this module. */
	const workspaceNamed = (baseName: string): string => workspaceRootFor({ moduleRoot, baseName });

	/** Mocks the completion, capturing what was sent. */
	function mockModelReply(reply: Record<string, unknown>): void {
		sentRequest = stubModelReply(reply);
	}

	/** The model's verdict, as the two cases every title test is written across. */
	function verdict(meaningful: boolean): Record<string, unknown> {
		return structuringReply(meaningful ? titleKept : titleRejected);
	}

	beforeEach(async () => {
		stubOpenRouterApi();

		({ tempDir, moduleRoot, dirs, workspaceRoot } = await makeLectureTree({
			prefix: "structuring-int-",
		}));
		await seedStageOutput({ workspaceRoot, stageId: "transcription", contents: transcriptText });
	});

	afterEach(async () => {
		resetStubbedApi();
		await rm(tempDir, { recursive: true, force: true });
	});

	/** Writes the lecture's manifest and returns the context built from it. */
	async function prepareLecture(overrides: Partial<Manifest> = {}): Promise<StageContext> {
		const manifest = makeManifest(overrides);
		await writeManifest({ workspaceRoot, manifest });
		return makeStageContext({
			workspaceRoot,
			manifest,
			config: configuringStage({ stageId: "transcript-structuring" }),
		});
	}

	async function runStage(context: StageContext): Promise<LectureIdentityChanges | undefined> {
		const stage = createTranscriptStructuringStage({
			logger: makeStubLogger().logger,
			client: openRouterClientFor({ config: exampleConfig }),
		});
		const result = await driveStage({ stage, context });
		return result.identityChanges;
	}

	function manifestAt(baseName: string): Promise<Manifest> {
		return readManifest({ workspaceRoot: workspaceNamed(baseName) });
	}

	it("should ask OpenRouter for JSON when the stage calls the model", async () => {
		mockModelReply(verdict(true));

		await runStage(await prepareLecture());

		expectJsonModeRequest(sentRequest());
	});

	it.each([
		{ meaningful: false, baseName: aiDerivedLecture.baseName, extinct: testLecture.baseName },
		{ meaningful: true, baseName: testLecture.baseName, extinct: aiDerivedLecture.baseName },
	])("should leave the lecture's files named $baseName when provisionalTitleMeaningful is $meaningful", async ({
		meaningful,
		baseName,
		extinct,
	}) => {
		mockModelReply(verdict(meaningful));

		await runStage(await prepareLecture());

		expect(await pathExists(join(dirs.videoRecording, `${baseName}.mp4`))).toBe(true);
		expect(await pathExists(join(dirs.slideDeck, `${baseName}.pdf`))).toBe(true);
		expect(await pathExists(join(dirs.finalOutput, `${baseName}.pdf`))).toBe(true);
		expect(
			await pathExists(
				stageOutputPath({
					workspaceRoot: workspaceNamed(baseName),
					stageId: "transcript-structuring",
				}),
			),
		).toBe(true);
		expect(await pathExists(join(dirs.videoRecording, `${extinct}.mp4`))).toBe(false);
	});

	it.each([
		{
			meaningful: false,
			decided: {
				aiDerivedTitle: aiDerivedLecture.title,
				lectureTitle: aiDerivedLecture.title,
				workspaceFolderName: aiDerivedLecture.baseName,
			},
		},
		{ meaningful: true, decided: {} },
	])("should decide $decided when provisionalTitleMeaningful is $meaningful", async ({
		meaningful,
		decided,
	}) => {
		mockModelReply(verdict(meaningful));

		expect(await runStage(await prepareLecture())).toEqual(decided);
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

		const baseName = meaningful ? testLecture.baseName : aiDerivedLecture.baseName;
		expect(await manifestAt(baseName)).toEqual(context.manifest);
	});

	it("should leave the lecture's title and every file alone when the user has named it", async () => {
		mockModelReply(verdict(false));

		const decided = await runStage(
			await prepareLecture({ userTitle: userChosenTitle, lectureTitle: userChosenTitle }),
		);

		expect(decided).toEqual({ aiDerivedTitle: aiDerivedLecture.title });
		expect(await pathExists(join(dirs.videoRecording, testLecture.videoRecordingFile))).toBe(true);
		expect(await pathExists(workspaceNamed(aiDerivedLecture.baseName))).toBe(false);
	});

	it("should move a lecture that has produced no PDF yet when the title is replaced", async () => {
		await rm(join(dirs.finalOutput, testLecture.outputFile));
		mockModelReply(verdict(false));

		await runStage(await prepareLecture());

		expect(await pathExists(workspaceNamed(aiDerivedLecture.baseName))).toBe(true);
		expect(await pathExists(join(dirs.finalOutput, `${aiDerivedLecture.baseName}.pdf`))).toBe(
			false,
		);
	});
});
