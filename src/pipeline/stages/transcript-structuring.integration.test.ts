import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import nock from "nock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RunManifest, StageContext } from "../../types/pipeline.js";
import { pathExists } from "../../utils/files.js";
import {
	makeConfig,
	makeLectureTree,
	makeManifest,
	makeStageContext,
	openRouterCompletionBody,
	openRouterUrls,
} from "../fixtures.js";
import { type ModuleDirs, stageOutputEntry } from "../layout.js";
import { readManifest, writeManifest } from "../manifest.js";
import { createTranscriptStructuringStage } from "./transcript-structuring.js";

const FOLDER = "Lecture 1 - Cell Injury - 2025-10-10";
const RENAMED_FOLDER = "Lecture 1 - Innate Immune Response - 2025-10-10";
const PROVISIONAL_TITLE = "Cell Injury";
const SUGGESTED_TITLE = "Innate Immune Response";
const USER_TITLE = "Cell Injury and Death";
const LECTURE_DATE = "2025-10-10";
const STRUCTURED_ENTRY = stageOutputEntry("transcript-structuring");
const STRUCTURED_MARKDOWN = "## The Innate Immune Response\n\nBarrier defences come first.";

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
			suggestedTitle: meaningful ? null : SUGGESTED_TITLE,
			structuredMarkdown: STRUCTURED_MARKDOWN,
		};
	}

	beforeEach(async () => {
		process.env.OPENROUTER_API_KEY = "test-key";
		nock.cleanAll();
		nock.disableNetConnect();
		capturedBody = {};

		({ tempDir, dirs, workspaceRoot } = await makeLectureTree({
			prefix: "structuring-int-",
			folderName: FOLDER,
		}));
		await mkdir(join(workspaceRoot, "Transcript"), { recursive: true });
		await writeFile(join(workspaceRoot, "Transcript", "transcript.txt"), "The lecture text.");
	});

	afterEach(async () => {
		nock.cleanAll();
		nock.enableNetConnect();
		await rm(tempDir, { recursive: true, force: true });
	});

	/** Writes the lecture's manifest and returns the context built from it. */
	async function prepareLecture(overrides: Partial<RunManifest> = {}): Promise<StageContext> {
		const manifest = makeManifest({
			lectureNumber: 1,
			lectureDate: LECTURE_DATE,
			provisionalTitle: PROVISIONAL_TITLE,
			lectureTitle: PROVISIONAL_TITLE,
			workspaceFolderName: FOLDER,
			...overrides,
		});
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
		{ meaningful: false, folder: RENAMED_FOLDER, extinct: FOLDER },
		{ meaningful: true, folder: FOLDER, extinct: RENAMED_FOLDER },
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
		expect(await pathExists(join(dirs.processing, folder, STRUCTURED_ENTRY))).toBe(true);
		expect(await pathExists(join(dirs.video, `${extinct}.mp4`))).toBe(false);
	});

	it.each([
		{ meaningful: false, folder: RENAMED_FOLDER, title: SUGGESTED_TITLE, derived: SUGGESTED_TITLE },
		{ meaningful: true, folder: FOLDER, title: PROVISIONAL_TITLE, derived: null },
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

		await runStage(await prepareLecture({ userTitle: USER_TITLE, lectureTitle: USER_TITLE }));

		const manifest = await manifestAt(FOLDER);
		expect(manifest.lectureTitle).toBe(USER_TITLE);
		expect(manifest.aiDerivedTitle).toBe(SUGGESTED_TITLE);
		expect(await pathExists(join(dirs.video, `${FOLDER}.mp4`))).toBe(true);
		expect(await pathExists(join(dirs.processing, RENAMED_FOLDER))).toBe(false);
	});

	it("should move a lecture that has produced no PDF yet when the title is replaced", async () => {
		await rm(join(dirs.finalOutput, `${FOLDER}.pdf`));
		mockModelReply(verdict(false));

		await runStage(await prepareLecture());

		expect(await pathExists(join(dirs.processing, RENAMED_FOLDER))).toBe(true);
		expect(await pathExists(join(dirs.finalOutput, `${RENAMED_FOLDER}.pdf`))).toBe(false);
	});
});
