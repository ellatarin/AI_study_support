import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Logger } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ManifestStageEntry, StageContext } from "../../types/pipeline.js";
import { pathExists } from "../../utils/files.js";
import {
	contextWithEntry,
	contextWithOutput,
	driveStage,
	failedEntry,
	finishedEntry,
	makeManifest,
	makeStageContext,
	makeWorkspaceTree,
	useStubLogger,
} from "../fixtures.js";
import { stageDirectoryPaths, stageOutputEntry, stageOutputPath } from "../layout.js";
import { ManifestPathError } from "../workspace-paths.js";
import { createPipelineStage, isStageComplete, writeStageOutput } from "./pipeline-stage.js";

// Any stage with a single output file would do; Stage 1's is the simplest.
const STAGE_ID = "audio-extraction";

// The two ways a stage finishes with its output on disk. `skipped` is what the
// runner writes over `complete` on the second run, so every case below that
// holds for one must hold for the other or a third run pays for the work again
// (technical-design.md §4.2).
const FINISHED_STATUSES = [{ status: "complete" }, { status: "skipped" }] as const;

describe("isStageComplete", () => {
	let moduleRoot: string;
	let workspaceRoot: string;

	beforeEach(async () => {
		({ moduleRoot, workspaceRoot } = await makeWorkspaceTree({ prefix: "pipeline-stage-" }));
		await mkdir(dirname(outputPath()), { recursive: true });
	});

	afterEach(async () => {
		await rm(moduleRoot, { recursive: true, force: true });
	});

	function contextWith(entry: ManifestStageEntry): StageContext {
		return contextWithEntry({ workspaceRoot, stageId: STAGE_ID, entry });
	}

	/**
	 * The context as it stands once the stage has finished and recorded its
	 * output, for the workspace under test.
	 *
	 * @param status - Which of the two finished statuses the entry carries.
	 * @returns The stage context.
	 */
	function contextRecordingOutput(status: "complete" | "skipped"): StageContext {
		return contextWithOutput({ workspaceRoot, stageId: STAGE_ID, status });
	}

	/** Where the chosen stage is required to leave its output. */
	function outputPath(): string {
		return stageOutputPath({ workspaceRoot, stageId: STAGE_ID });
	}

	async function writeOutputFile(): Promise<void> {
		await writeFile(outputPath(), "audio bytes");
	}

	it.each<{ readonly scenario: string; readonly entry: ManifestStageEntry }>([
		{ scenario: "has not run", entry: { status: "pending" } },
		{ scenario: "is still running", entry: { status: "running" } },
		{ scenario: "failed", entry: failedEntry() },
	])("should report incomplete when the stage $scenario", async ({ entry }) => {
		await writeOutputFile();
		const context = contextWith(entry);

		expect(await isStageComplete({ context, stageId: STAGE_ID })).toBe(false);
	});

	it.each(
		FINISHED_STATUSES,
	)("should report complete when a $status stage's every recorded file exists", async ({
		status,
	}) => {
		await writeOutputFile();
		const context = contextRecordingOutput(status);

		expect(await isStageComplete({ context, stageId: STAGE_ID })).toBe(true);
	});

	it.each(
		FINISHED_STATUSES,
	)("should report incomplete when a $status stage's recorded output file has been deleted", async ({
		status,
	}) => {
		const context = contextRecordingOutput(status);

		expect(await isStageComplete({ context, stageId: STAGE_ID })).toBe(false);
	});

	it.each(
		FINISHED_STATUSES,
	)("should report incomplete when only some of a $status stage's recorded files exist", async ({
		status,
	}) => {
		await writeOutputFile();
		const missingSibling = join(dirname(stageOutputEntry(STAGE_ID)), "extra.m4a");
		const context = contextWith(
			finishedEntry({ status, filesWritten: [stageOutputEntry(STAGE_ID), missingSibling] }),
		);

		expect(await isStageComplete({ context, stageId: STAGE_ID })).toBe(false);
	});

	it.each(
		FINISHED_STATUSES,
	)("should report complete when a $status stage recorded no output files", async ({ status }) => {
		const context = contextWith(finishedEntry({ status }));

		expect(await isStageComplete({ context, stageId: STAGE_ID })).toBe(true);
	});

	it("should throw ManifestPathError when a recorded path escapes the module root", async () => {
		const context = contextWith(
			finishedEntry({ status: "complete", filesWritten: [join("..", "..", "..", "escaped.m4a")] }),
		);

		await expect(isStageComplete({ context, stageId: STAGE_ID })).rejects.toThrow(
			ManifestPathError,
		);
	});
});

describe("createPipelineStage", () => {
	let moduleRoot: string;
	let workspaceRoot: string;
	const logged = useStubLogger();

	beforeEach(async () => {
		({ moduleRoot, workspaceRoot } = await makeWorkspaceTree({ prefix: "pipeline-stage-" }));
	});

	afterEach(async () => {
		await rm(moduleRoot, { recursive: true, force: true });
	});

	/** The one directory the chosen stage owns. */
	function stageDir(): string {
		const [directory] = stageDirectoryPaths({ workspaceRoot, stageId: STAGE_ID });
		if (directory === undefined) {
			throw new Error(`Expected stage "${STAGE_ID}" to own a directory`);
		}
		return directory;
	}

	/**
	 * Builds a stage whose `run` records what it was handed and reports what was
	 * on disk when it began, then runs it.
	 *
	 * @returns What `run` observed.
	 */
	async function runRecordingStage(): Promise<{
		readonly logger: Logger;
		readonly namesOnEntry: readonly string[];
	}> {
		let observed: { logger: Logger; namesOnEntry: readonly string[] } | null = null;
		const stage = createPipelineStage({
			stageId: STAGE_ID,
			logger: logged().logger,
			getInput: async () => undefined,
			run: async ({ logger }) => {
				observed = { logger, namesOnEntry: await readdir(stageDir()) };
				return { output: undefined, cost: null, filesWritten: [] };
			},
		});
		const context = makeStageContext({ workspaceRoot, manifest: makeManifest() });
		await driveStage({ stage, context });
		if (observed === null) {
			throw new Error("Expected the stage's run to have been invoked");
		}
		return observed;
	}

	it("should create the stage's output directory when run begins without one", async () => {
		const { namesOnEntry } = await runRecordingStage();

		expect(namesOnEntry).toStrictEqual([]);
		expect(await pathExists(stageDir())).toBe(true);
	});

	it("should delete a .tmp file when a crashed run left one in the stage's directory", async () => {
		await mkdir(stageDir(), { recursive: true });
		await writeFile(join(stageDir(), "audio.m4a.tmp"), "half an audio track");
		await writeFile(join(stageDir(), "keep.m4a"), "a finished file");

		const { namesOnEntry } = await runRecordingStage();

		expect(namesOnEntry).toStrictEqual(["keep.m4a"]);
	});

	it("should stamp the stage onto every entry when run logs through the logger it was given", async () => {
		const { logger } = await runRecordingStage();

		logger.debug({ detail: 1 }, "from inside the stage");

		expect(logged().entries).toStrictEqual([
			{
				level: "debug",
				bindings: { stage: STAGE_ID },
				payload: { detail: 1 },
				message: "from inside the stage",
			},
		]);
	});
});

// The two ways a stage's single output reaches disk: content it holds, and
// content a subprocess produces. Both answer with the entry `filesWritten`
// records, and the point of both is that the entry names the file that was just
// put in place — which is what these assert, by resolving the entry the way the
// next run's completeness check resolves it rather than by rebuilding the path
// (technical-design.md §4.3, §4.5).
describe("recording a stage's single output", () => {
	let moduleRoot: string;
	let workspaceRoot: string;

	beforeEach(async () => {
		({ moduleRoot, workspaceRoot } = await makeWorkspaceTree({ prefix: "stage-output-" }));
		await mkdir(dirname(stageOutputPath({ workspaceRoot, stageId: STAGE_ID })), {
			recursive: true,
		});
	});

	afterEach(async () => {
		await rm(moduleRoot, { recursive: true, force: true });
	});

	/**
	 * Where a returned `filesWritten` entry points, resolved against the
	 * workspace as the completeness check resolves it.
	 *
	 * @param filesWritten - The entries the writer handed back.
	 * @returns The absolute path the single entry names.
	 */
	function recordedPath(filesWritten: readonly string[]): string {
		const [entry] = filesWritten;
		if (entry === undefined) {
			throw new Error("Expected exactly one recorded entry");
		}
		return join(workspaceRoot, entry);
	}

	it("should record the file it just wrote when a stage hands over its content", async () => {
		const { path, filesWritten } = await writeStageOutput({
			stageId: STAGE_ID,
			workspaceRoot,
			content: "audio bytes",
		});

		expect(recordedPath(filesWritten)).toBe(path);
		expect(await readFile(recordedPath(filesWritten), "utf8")).toBe("audio bytes");
	});

	it("should record the file it just wrote when a subprocess produces the content", async () => {
		const { path, filesWritten } = await writeStageOutput({
			stageId: STAGE_ID,
			workspaceRoot,
			produce: (tmpPath) => writeFile(tmpPath, "produced bytes"),
		});

		expect(recordedPath(filesWritten)).toBe(path);
		expect(await readFile(recordedPath(filesWritten), "utf8")).toBe("produced bytes");
	});

	it("should leave nothing at the output path when the producer fails", async () => {
		const failing = writeStageOutput({
			stageId: STAGE_ID,
			workspaceRoot,
			produce: () => Promise.reject(new Error("ffmpeg failed")),
		});

		await expect(failing).rejects.toThrow("ffmpeg failed");
		expect(await pathExists(stageOutputPath({ workspaceRoot, stageId: STAGE_ID }))).toBe(false);
	});
});
