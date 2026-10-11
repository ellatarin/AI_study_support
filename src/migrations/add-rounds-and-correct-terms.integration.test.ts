import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	completedEntry,
	entryBeforeRounds,
	failedEntry,
	makeManifest,
	makeTempDir,
	otherModuleName,
	readJsonFile,
	runningEntry,
	testModuleName,
	testTimestampId,
} from "../pipeline/fixtures.js";
import { runLogsDirPath, workspaceRootFor } from "../pipeline/layout.js";
import { manifestPath } from "../pipeline/manifest.js";
import { pathExists } from "../utils/files.js";
import { migrateModules } from "./add-rounds-and-correct-terms.js";

describe("migrateModule", () => {
	let tempDir: string;
	let moduleRoot: string;
	let workspaceRoot: string;

	beforeEach(async () => {
		tempDir = await makeTempDir({ prefix: "migration-" });
		moduleRoot = join(tempDir, testModuleName);
		workspaceRoot = workspaceRootFor({ moduleRoot, baseName: makeManifest().baseName });
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	/**
	 * The function that migrates the suite's module alone, with no output.
	 *
	 * @returns A promise that resolves when the module is migrated.
	 */
	function migrate(): Promise<void> {
		return migrateModules({ moduleRoots: [moduleRoot], write: () => undefined });
	}

	/** The saved term corrections of subtopic 1, in the folder of `correct-terms`. */
	const correctTermsFile = "Term corrections/subtopic-1-attempt-1.json";

	/** The run log that the suite writes. */
	const runLogPath = (): string =>
		join(runLogsDirPath({ workspaceRoot }), `${testTimestampId}.json`);

	/** A run log entry of a stage that ran, with no `rounds`. */
	const ranEntryBeforeRounds = {
		action: "ran",
		status: "complete",
		configUsed: null,
		cost: { costUsd: 0.01, callCount: 1 },
	};

	/**
	 * The writer of one stored file. It makes the folder of the file first.
	 *
	 * @param args - The file and its contents.
	 * @param args.path - The absolute path of the file.
	 * @param args.contents - The text of the file.
	 * @returns A promise that resolves when the file is written.
	 */
	async function writeStoredFile({
		path,
		contents,
	}: {
		readonly path: string;
		readonly contents: string;
	}): Promise<void> {
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, contents);
	}

	/**
	 * The writer of a manifest that the migration must change, in any workspace.
	 * The manifest readers reject it.
	 *
	 * @param args - The workspace and the stage entries.
	 * @param args.root - The absolute path of the workspace.
	 * @param args.stages - The stage entries, each one written as it is.
	 * @returns A promise that resolves when the manifest is written.
	 */
	function writeOldManifestIn({
		root,
		stages,
	}: {
		readonly root: string;
		readonly stages: Readonly<Record<string, unknown>>;
	}): Promise<void> {
		return writeStoredFile({
			path: manifestPath({ workspaceRoot: root }),
			contents: JSON.stringify({ ...makeManifest(), stages }),
		});
	}

	/**
	 * The writer of a manifest that the migration must change, in the suite's workspace.
	 *
	 * @param stages - The stage entries, each one written as it is.
	 * @returns A promise that resolves when the manifest is written.
	 */
	function writeOldManifest(stages: Readonly<Record<string, unknown>>): Promise<void> {
		return writeOldManifestIn({ root: workspaceRoot, stages });
	}

	/**
	 * The writer of a run log that the migration must change.
	 *
	 * @param stages - The run log entries, each one written as it is.
	 * @returns A promise that resolves when the run log is written.
	 */
	function writeOldRunLog(stages: Readonly<Record<string, unknown>>): Promise<void> {
		return writeStoredFile({
			path: runLogPath(),
			contents: JSON.stringify({ pipelineRunId: testTimestampId, stages }),
		});
	}

	it("should set round 1 in each stage entry that is not pending when the module is migrated", async () => {
		await writeOldManifest({
			"audio-extraction": entryBeforeRounds(completedEntry()),
			transcription: entryBeforeRounds(failedEntry()),
			"choose-division": { status: "pending" },
		});

		await migrate();

		expect(await readJsonFile(manifestPath({ workspaceRoot }))).toMatchObject({
			stages: {
				"audio-extraction": completedEntry(),
				transcription: failedEntry(),
				"choose-division": { status: "pending" },
			},
		});
	});

	it("should set rounds 1 in each run log entry of a stage that ran when the module is migrated", async () => {
		await writeOldManifest({ "audio-extraction": entryBeforeRounds(completedEntry()) });
		await writeOldRunLog({
			"audio-extraction": ranEntryBeforeRounds,
			transcription: { action: "skipped" },
		});

		await migrate();

		expect(await readJsonFile(runLogPath())).toHaveProperty("stages", {
			"audio-extraction": { ...ranEntryBeforeRounds, rounds: 1 },
			transcription: { action: "skipped" },
		});
	});

	it("should leave a lecture unchanged when it already has a correct-terms entry and a rewrite-subtopics entry", async () => {
		const stages = {
			"correct-terms": completedEntry({ filesWritten: [correctTermsFile] }),
			"rewrite-subtopics": completedEntry({ filesWritten: ["Rewrites/subtopic-1-attempt-1.json"] }),
		};
		const runLogStages = {
			"correct-terms": { ...ranEntryBeforeRounds, rounds: 1 },
			"rewrite-subtopics": { ...ranEntryBeforeRounds, rounds: 1 },
		};
		await writeOldManifest(stages);
		await writeOldRunLog(runLogStages);

		await migrate();

		expect(await readJsonFile(manifestPath({ workspaceRoot }))).toHaveProperty("stages", stages);
		expect(await readJsonFile(runLogPath())).toHaveProperty("stages", runLogStages);
	});

	it("should migrate each module and name each one in the output when several modules are given", async () => {
		const otherModuleRoot = join(tempDir, otherModuleName);
		const otherWorkspaceRoot = workspaceRootFor({
			moduleRoot: otherModuleRoot,
			baseName: makeManifest().baseName,
		});
		const oldStages = { "audio-extraction": entryBeforeRounds(completedEntry()) };
		await writeOldManifest(oldStages);
		await writeOldManifestIn({ root: otherWorkspaceRoot, stages: oldStages });
		const lines: string[] = [];

		await migrateModules({
			moduleRoots: [moduleRoot, otherModuleRoot],
			write: (line) => lines.push(line),
		});

		for (const root of [workspaceRoot, otherWorkspaceRoot]) {
			expect(await readJsonFile(manifestPath({ workspaceRoot: root }))).toHaveProperty(
				["stages", "audio-extraction", "round"],
				1,
			);
		}
		expect(lines).toStrictEqual([`Migrated ${testModuleName}`, `Migrated ${otherModuleName}`]);
	});

	it("should leave a folder alone when it holds no manifest", async () => {
		await writeOldRunLog({ "audio-extraction": ranEntryBeforeRounds });

		await migrate();

		expect(await readJsonFile(runLogPath())).toHaveProperty("stages", {
			"audio-extraction": ranEntryBeforeRounds,
		});
	});

	it("should leave a file in the run logs folder unchanged when it is not a run log", async () => {
		await writeOldManifest({});
		const debugLogPath = join(runLogsDirPath({ workspaceRoot }), "debug.json");
		const debugLog = JSON.stringify({ level: "debug", msg: "Pipeline run started" });
		await writeStoredFile({ path: debugLogPath, contents: debugLog });

		await migrate();

		expect(await readFile(debugLogPath, "utf8")).toBe(debugLog);
	});

	describe("a lecture that ran term correction", () => {
		/** The saved term corrections of subtopic 1, where the migration finds them. */
		const termCorrectionFile = "Rewrite attempts/subtopic-1-attempt-1.json";

		const savedCorrections = JSON.stringify({ subtopicId: 1, corrections: [] });

		beforeEach(async () => {
			await writeOldManifest({
				"rewrite-subtopics": entryBeforeRounds(
					completedEntry({ filesWritten: [termCorrectionFile] }),
				),
			});
			await writeStoredFile({
				path: join(workspaceRoot, termCorrectionFile),
				contents: savedCorrections,
			});
		});

		it("should move the stage entry and its file paths to correct-terms when the module is migrated", async () => {
			await migrate();

			expect(await readJsonFile(manifestPath({ workspaceRoot }))).toHaveProperty("stages", {
				"correct-terms": completedEntry({ filesWritten: [correctTermsFile] }),
			});
		});

		it("should move the stage entry to correct-terms in round 1 when term correction was running", async () => {
			await writeOldManifest({ "rewrite-subtopics": { status: "running" } });

			await migrate();

			expect(await readJsonFile(manifestPath({ workspaceRoot }))).toHaveProperty("stages", {
				"correct-terms": runningEntry,
			});
		});

		it("should move the saved term corrections into the folder of correct-terms when the module is migrated", async () => {
			await migrate();

			expect(await readFile(join(workspaceRoot, correctTermsFile), "utf8")).toBe(savedCorrections);
			expect(await pathExists(join(workspaceRoot, dirname(termCorrectionFile)))).toBe(false);
		});

		it("should rename the stage id of term correction to correct-terms in each run log when the module is migrated", async () => {
			await writeOldRunLog({ "rewrite-subtopics": ranEntryBeforeRounds });

			await migrate();

			const runLog = await readJsonFile(runLogPath());
			expect(runLog).toHaveProperty(["stages", "correct-terms", "action"], "ran");
			expect(runLog).not.toHaveProperty(["stages", "rewrite-subtopics"]);
		});
	});
});
