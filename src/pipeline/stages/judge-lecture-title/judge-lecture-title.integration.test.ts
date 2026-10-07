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
	seedEarlierOutputs,
	seedStageOutput,
	stubModelReply,
	stubOpenRouterApi,
	testLecture,
	titleJudgementReply,
	titleRejected,
	transcriptText,
	withUserTitle,
} from "../../fixtures.js";
import { type ModuleDirs, stageOutputPath, workspaceRootFor } from "../../layout.js";
import { renameLectureFiles } from "../../lecture-files.js";
import { readManifest, writeManifest } from "../../manifest.js";
import { createJudgeLectureTitleStage } from "./judge-lecture-title.js";

const STAGE_ID = "judge-lecture-title";

describe("judge-lecture-title against a real module tree", () => {
	let tempDir: string;
	let moduleRoot: string;
	let dirs: ModuleDirs;
	let workspaceRoot: string;
	let sentRequest: () => Record<string, unknown>;

	/** The workspace path of a lecture with this base name in the module. */
	const workspaceNamed = (baseName: string): string => workspaceRootFor({ moduleRoot, baseName });

	/** Stubs a reply that keeps or rejects the provisional title, and keeps the request that the stage sends. */
	function stubJudgement({ meaningful }: { readonly meaningful: boolean }): void {
		sentRequest = stubModelReply(titleJudgementReply(meaningful ? {} : titleRejected));
	}

	beforeEach(async () => {
		stubOpenRouterApi();

		({ tempDir, moduleRoot, dirs, workspaceRoot } = await makeLectureTree({
			prefix: "judge-title-int-",
		}));
		await seedStageOutput({ workspaceRoot, stageId: "transcription", contents: transcriptText });
		await seedEarlierOutputs({
			workspaceRoot,
			readsFrom: ["retitle-subtopics", "group-into-topics"],
		});
	});

	afterEach(async () => {
		resetStubbedApi();
		await rm(tempDir, { recursive: true, force: true });
	});

	/** Writes the manifest of the lecture, and gives the stage context built from it. */
	async function prepareLecture(overrides: Partial<Manifest> = {}): Promise<StageContext> {
		const manifest = makeManifest(overrides);
		await writeManifest({ workspaceRoot, manifest });
		return makeStageContext({
			workspaceRoot,
			manifest,
			config: configuringStage({ stageId: STAGE_ID }),
		});
	}

	async function runStage(context: StageContext): Promise<LectureIdentityChanges | undefined> {
		const stage = createJudgeLectureTitleStage({
			logger: makeStubLogger().logger,
			client: openRouterClientFor({ config: exampleConfig }),
		});
		const result = await driveStage({ stage, context });
		return result.identityChanges;
	}

	/** Tells which of the lecture's four files have the base name. */
	function filesNamed(baseName: string): Promise<readonly boolean[]> {
		return Promise.all(
			[
				join(dirs.videoRecording, `${baseName}.mp4`),
				join(dirs.slideDeck, `${baseName}.pdf`),
				join(dirs.finalOutput, `${baseName}.pdf`),
				workspaceNamed(baseName),
			].map(pathExists),
		);
	}

	it("should ask OpenRouter for JSON when the stage calls the model", async () => {
		stubJudgement({ meaningful: true });

		await runStage(await prepareLecture());

		expectJsonModeRequest(sentRequest());
	});

	it("should move the video, the slide, the workspace and the PDF to the new base name when the outcome is adopted-derived", async () => {
		stubJudgement({ meaningful: false });

		await runStage(await prepareLecture());

		expect(await filesNamed(aiDerivedLecture.baseName)).toStrictEqual([true, true, true, true]);
		expect(await filesNamed(testLecture.baseName)).toStrictEqual([false, false, false, false]);
	});

	it("should write the judgement into the workspace before it moves when the outcome is adopted-derived", async () => {
		stubJudgement({ meaningful: false });

		await runStage(await prepareLecture());

		expect(
			await pathExists(
				stageOutputPath({
					workspaceRoot: workspaceNamed(aiDerivedLecture.baseName),
					stageId: STAGE_ID,
				}),
			),
		).toBe(true);
	});

	it.each([
		{ outcome: "kept-provisional", meaningful: true, manifest: {} },
		{ outcome: "kept-user-title", meaningful: false, manifest: withUserTitle },
	])("should leave every file in place when the outcome is $outcome", async ({
		meaningful,
		manifest,
	}) => {
		stubJudgement({ meaningful });

		await runStage(await prepareLecture(manifest));

		expect(await filesNamed(testLecture.baseName)).toStrictEqual([true, true, true, true]);
		expect(await pathExists(workspaceNamed(aiDerivedLecture.baseName))).toBe(false);
	});

	it("should move the files back to the provisional title's base name when the outcome is kept-provisional after an earlier run renamed the lecture", async () => {
		workspaceRoot = await renameLectureFiles({
			dirs,
			workspaceRoot,
			lectureDate: testLecture.date,
			baseName: aiDerivedLecture.baseName,
		});
		const context = await prepareLecture({
			aiDerivedTitle: aiDerivedLecture.title,
			lectureTitle: aiDerivedLecture.title,
			baseName: aiDerivedLecture.baseName,
		});
		stubJudgement({ meaningful: true });

		await runStage(context);

		expect(await filesNamed(testLecture.baseName)).toStrictEqual([true, true, true, true]);
		expect(await filesNamed(aiDerivedLecture.baseName)).toStrictEqual([false, false, false, false]);
	});

	it.each([
		{
			outcome: "adopted-derived",
			meaningful: false,
			manifest: {},
			decided: {
				aiDerivedTitle: aiDerivedLecture.title,
				lectureTitle: aiDerivedLecture.title,
				baseName: aiDerivedLecture.baseName,
			},
		},
		{ outcome: "kept-provisional", meaningful: true, manifest: {}, decided: {} },
		{
			outcome: "kept-user-title",
			meaningful: false,
			manifest: withUserTitle,
			decided: { aiDerivedTitle: aiDerivedLecture.title },
		},
	])("should return the identity changes of $outcome for the runner to write when the stage completes", async ({
		meaningful,
		manifest,
		decided,
	}) => {
		stubJudgement({ meaningful });

		expect(await runStage(await prepareLecture(manifest))).toEqual(decided);
	});

	// The manifest of the lecture is on disk in this suite. So this test finds a
	// stage that writes the manifest (technical-design.md §4.2).
	it.each([
		{ meaningful: false, baseName: aiDerivedLecture.baseName },
		{ meaningful: true, baseName: testLecture.baseName },
	])("should leave the manifest to the runner when provisionalTitleMeaningful is $meaningful", async ({
		meaningful,
		baseName,
	}) => {
		stubJudgement({ meaningful });
		const context = await prepareLecture();

		await runStage(context);

		expect(await readManifest({ workspaceRoot: workspaceNamed(baseName) })).toEqual(
			context.manifest,
		);
	});

	it("should move a lecture that has produced no PDF yet when the outcome is adopted-derived", async () => {
		await rm(join(dirs.finalOutput, testLecture.finalOutputFile));
		stubJudgement({ meaningful: false });

		await runStage(await prepareLecture());

		expect(await pathExists(workspaceNamed(aiDerivedLecture.baseName))).toBe(true);
		expect(await pathExists(join(dirs.finalOutput, `${aiDerivedLecture.baseName}.pdf`))).toBe(
			false,
		);
	});
});
