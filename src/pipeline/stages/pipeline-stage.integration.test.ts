import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { Logger } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StageContext, StageEntry } from "../../types/pipeline.js";
import { pathExists } from "../../utils/files.js";
import {
	completedEntry,
	contextWithEntry,
	contextWithOutput,
	driveStage,
	failedEntry,
	makeManifest,
	makeStageContext,
	makeWorkspaceTree,
	useStubLogger,
} from "../fixtures.js";
import {
	stageDirectoryPaths,
	stageMarkdownVersionEntry,
	stageMarkdownVersionPath,
	stageOutputEntry,
	stageOutputPath,
} from "../layout.js";
import { ManifestPathError } from "../workspace-paths.js";
import {
	createPipelineStage,
	isStageComplete,
	writeStageOutput,
	writeStageOutputWithMarkdownVersion,
} from "./pipeline-stage.js";

// The tests need a stage with one output file. The output of `audio-extraction` is the simplest.
const STAGE_ID = "audio-extraction";

// The two statuses of a completed stage. Each case must hold for both, because the
// runner writes `skipped` over `complete` (technical-design.md §4.2).
const COMPLETED_STATUSES = [{ status: "complete" }, { status: "skipped" }] as const;

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

	function contextWith(entry: StageEntry): StageContext {
		return contextWithEntry({ workspaceRoot, stageId: STAGE_ID, entry });
	}

	/**
	 * The stage context after the stage completes, for the workspace of the test.
	 *
	 * @param status - The completed status of the stage entry.
	 * @returns The stage context.
	 */
	function contextAfterStageCompletes(status: "complete" | "skipped"): StageContext {
		return contextWithOutput({ workspaceRoot, stageId: STAGE_ID, status });
	}

	/** The path of the output file of the test stage. */
	function outputPath(): string {
		return stageOutputPath({ workspaceRoot, stageId: STAGE_ID });
	}

	async function writeOutputFile(): Promise<void> {
		await writeFile(outputPath(), "audio bytes");
	}

	it.each<{ readonly scenario: string; readonly entry: StageEntry }>([
		{ scenario: "has not run", entry: { status: "pending" } },
		{ scenario: "is still running", entry: { status: "running" } },
		{ scenario: "failed", entry: failedEntry() },
	])("should report incomplete when the stage $scenario", async ({ entry }) => {
		await writeOutputFile();
		const context = contextWith(entry);

		expect(await isStageComplete({ context, stageId: STAGE_ID })).toBe(false);
	});

	it.each(
		COMPLETED_STATUSES,
	)("should report complete when a $status stage's every recorded file exists", async ({
		status,
	}) => {
		await writeOutputFile();
		const context = contextAfterStageCompletes(status);

		expect(await isStageComplete({ context, stageId: STAGE_ID })).toBe(true);
	});

	it.each(
		COMPLETED_STATUSES,
	)("should report incomplete when a $status stage's recorded output file has been deleted", async ({
		status,
	}) => {
		const context = contextAfterStageCompletes(status);

		expect(await isStageComplete({ context, stageId: STAGE_ID })).toBe(false);
	});

	it.each(
		COMPLETED_STATUSES,
	)("should report incomplete when only some of a $status stage's recorded files exist", async ({
		status,
	}) => {
		await writeOutputFile();
		const missingSibling = join(dirname(stageOutputEntry(STAGE_ID)), "extra.m4a");
		const context = contextWith(
			completedEntry({ status, filesWritten: [stageOutputEntry(STAGE_ID), missingSibling] }),
		);

		expect(await isStageComplete({ context, stageId: STAGE_ID })).toBe(false);
	});

	it.each(
		COMPLETED_STATUSES,
	)("should report complete when a $status stage recorded no output files", async ({ status }) => {
		const context = contextWith(completedEntry({ status }));

		expect(await isStageComplete({ context, stageId: STAGE_ID })).toBe(true);
	});

	it("should throw ManifestPathError when a recorded path escapes the module root", async () => {
		const context = contextWith(
			completedEntry({ status: "complete", filesWritten: [join("..", "..", "..", "escaped.m4a")] }),
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

	/** The one folder that the test stage owns. */
	function stageDir(): string {
		const [directory] = stageDirectoryPaths({ workspaceRoot, stageId: STAGE_ID });
		if (directory === undefined) {
			throw new Error(`Expected stage "${STAGE_ID}" to own a directory`);
		}
		return directory;
	}

	/**
	 * Builds a stage and runs it. The stage keeps the logger and the stage context
	 * that it gets. It also lists the files in its folder when it starts.
	 *
	 * @returns The logger, the stage context and the list of files.
	 */
	async function runStageAndReturnWhatItReceived(): Promise<{
		readonly logger: Logger;
		readonly namesOnEntry: readonly string[];
		readonly context: StageContext;
	}> {
		let observed: {
			logger: Logger;
			namesOnEntry: readonly string[];
			context: StageContext;
		} | null = null;
		const stage = createPipelineStage({
			stageId: STAGE_ID,
			logger: logged().logger,
			getInput: async () => undefined,
			run: async ({ logger, context }) => {
				observed = { logger, namesOnEntry: await readdir(stageDir()), context };
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
		const { namesOnEntry } = await runStageAndReturnWhatItReceived();

		expect(namesOnEntry).toStrictEqual([]);
		expect(await pathExists(stageDir())).toBe(true);
	});

	it("should delete a .tmp file when a crashed run left one in the stage's directory", async () => {
		await mkdir(stageDir(), { recursive: true });
		await writeFile(join(stageDir(), "audio.m4a.tmp"), "half an audio track");
		await writeFile(join(stageDir(), "keep.m4a"), "a finished file");

		const { namesOnEntry } = await runStageAndReturnWhatItReceived();

		expect(namesOnEntry).toStrictEqual(["keep.m4a"]);
	});

	it("should stamp the stage and the lecture onto every entry when run logs through the logger it was given", async () => {
		const { logger, context } = await runStageAndReturnWhatItReceived();

		logger.debug({ detail: 1 }, "from inside the stage");

		expect(logged().entries).toStrictEqual([
			{
				level: "debug",
				bindings: {
					stage: STAGE_ID,
					module: basename(moduleRoot),
					lectureNumber: context.lectureNumber,
					lectureDate: context.lectureDate,
				},
				payload: { detail: 1 },
				message: "from inside the stage",
			},
		]);
	});
});

// The tests below check that a writer gives the `filesWritten` entry of the file it
// just wrote. They resolve the entry as the `isComplete` check does, and do not
// build the path again (technical-design.md §4.2, §4.3, §4.5).

// The one stage that writes a Markdown version of its output (technical-design.md §3.3).
// The Markdown version is temporary.
const MARKDOWN_VERSION_STAGE = "transcript-verification";

describe("recording what a stage wrote", () => {
	let moduleRoot: string;
	let workspaceRoot: string;

	beforeEach(async () => {
		({ moduleRoot, workspaceRoot } = await makeWorkspaceTree({ prefix: "stage-output-" }));
		for (const stageId of [STAGE_ID, MARKDOWN_VERSION_STAGE] as const) {
			await mkdir(dirname(stageOutputPath({ workspaceRoot, stageId })), { recursive: true });
		}
	});

	afterEach(async () => {
		await rm(moduleRoot, { recursive: true, force: true });
	});

	/**
	 * The path that a `filesWritten` entry names, resolved against the workspace as
	 * the `isComplete` check resolves it.
	 *
	 * @param filesWritten - The entries that the writer gave.
	 * @returns The absolute path that the one entry names.
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

	it("should put the Markdown version beside the output when a stage writes one", async () => {
		const { path } = await writeStageOutputWithMarkdownVersion({
			stageId: MARKDOWN_VERSION_STAGE,
			workspaceRoot,
			content: '{"overallVerdict":"pass"}',
			markdownVersion: "# Transcript verification\n",
		});

		expect(await readFile(path, "utf8")).toBe('{"overallVerdict":"pass"}');
		expect(
			await readFile(
				stageMarkdownVersionPath({ workspaceRoot, stageId: MARKDOWN_VERSION_STAGE }),
				"utf8",
			),
		).toBe("# Transcript verification\n");
	});

	it("should record both files when a stage writes a Markdown version of its output", async () => {
		const { filesWritten } = await writeStageOutputWithMarkdownVersion({
			stageId: MARKDOWN_VERSION_STAGE,
			workspaceRoot,
			content: "{}",
			markdownVersion: "# Transcript verification\n",
		});

		expect(filesWritten).toStrictEqual([
			stageOutputEntry(MARKDOWN_VERSION_STAGE),
			stageMarkdownVersionEntry(MARKDOWN_VERSION_STAGE),
		]);
	});
});
