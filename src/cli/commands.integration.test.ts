import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { makeManifest } from "../pipeline/fixtures.js";
import { readManifest, writeManifest } from "../pipeline/manifest.js";
import type { BatchSummary, LectureMatch, OverallStatus, RunSummary } from "../types/pipeline.js";
import {
	type CliDeps,
	executeCommand,
	type PipelineRunnerFacade,
	type RunnableCliCommand,
} from "./commands.js";

const FOLDER = "Lecture 1 - Cell Injury - 2025-10-10";

describe("executeCommand", () => {
	let tempDir: string;
	let moduleRoot: string;
	let workspaceRoot: string;
	let match: LectureMatch;
	let written: string[];
	let runner: {
		readonly normaliseSources: ReturnType<typeof vi.fn>;
		readonly runLecture: ReturnType<typeof vi.fn>;
		readonly runBatch: ReturnType<typeof vi.fn>;
		readonly costReport: ReturnType<typeof vi.fn>;
		readonly resolveLecturesByDate: ReturnType<typeof vi.fn>;
	};
	let selectMatches: Mock<
		(args: { readonly matches: readonly LectureMatch[] }) => Promise<readonly LectureMatch[]>
	>;
	let selectMatch: Mock<
		(args: { readonly matches: readonly LectureMatch[] }) => Promise<LectureMatch | null>
	>;
	let confirm: Mock<(args: { readonly message: string }) => Promise<boolean>>;

	function runSummaryFor({
		workspace,
		overallStatus = "success",
	}: {
		readonly workspace: string;
		readonly overallStatus?: OverallStatus;
	}): RunSummary {
		return {
			workspaceRoot: workspace,
			runId: "2025-10-10T09-00-00Z",
			startedAt: "2025-10-10T09:00:00.000Z",
			endedAt: "2025-10-10T09:30:00.000Z",
			totalCostUsd: 0.2,
			stageOutcomes: [
				{
					stageId: "transcription",
					entry: {
						action: "ran",
						status: "complete",
						configUsed: { modelId: "elevenlabs/scribe_v2" },
						cost: { totalCostUsd: 0.2, callCount: 1 },
					},
				},
			],
			overallStatus,
		};
	}

	async function makeLectureWorkspace(folder: string): Promise<string> {
		const workspace = join(moduleRoot, "Pipeline processing", folder);
		await writeManifest({
			workspaceRoot: workspace,
			manifest: makeManifest({
				lectureTitle: "Cell Injury",
				workspaceFolderName: folder,
				stages: {
					transcription: {
						status: "complete",
						completedAt: "2025-10-10T09:05:00.000Z",
						configUsed: { modelId: "elevenlabs/scribe_v2" },
						cost: { promptTokens: 0, completionTokens: 0, callCount: 1, totalCostUsd: 0.2 },
						filesWritten: ["Transcript/transcript.txt"],
					},
				} as ReturnType<typeof makeManifest>["stages"],
			}),
		});
		return workspace;
	}

	function deps(): CliDeps {
		return {
			runner: runner as unknown as PipelineRunnerFacade,
			moduleRoots: [moduleRoot, join(tempDir, "Immunology")],
			gbpPerUsd: 0.74,
			selectMatches,
			selectMatch,
			confirm,
			write: (text: string) => {
				written.push(text);
			},
		};
	}

	function output(): string {
		return written.join("");
	}

	/** Carries a command out against freshly built dependencies, as the CLI does. */
	function invoke(command: RunnableCliCommand): Promise<number> {
		return executeCommand({ command, deps: deps() });
	}

	/** A second lecture sharing the first one's date, for the multi-match cases. */
	async function makeSecondLecture(): Promise<LectureMatch> {
		return {
			moduleRoot,
			workspaceRoot: await makeLectureWorkspace("Lecture 2 - Antigens - 2025-10-10"),
			lectureNumber: 2,
			lectureTitle: "Antigens",
		};
	}

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "commands-"));
		moduleRoot = join(tempDir, "Biology of Disease");
		workspaceRoot = await makeLectureWorkspace(FOLDER);
		match = { moduleRoot, workspaceRoot, lectureNumber: 1, lectureTitle: "Cell Injury" };
		written = [];
		runner = {
			normaliseSources: vi.fn(async () => undefined),
			runLecture: vi.fn(async () => runSummaryFor({ workspace: workspaceRoot })),
			runBatch: vi.fn(),
			costReport: vi.fn(async () => undefined),
			resolveLecturesByDate: vi.fn(async () => [match]),
		};
		selectMatches = vi.fn(async () => [match]);
		selectMatch = vi.fn(async () => match);
		confirm = vi.fn(async () => true);
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	describe("run", () => {
		const runCommand = {
			command: "run",
			lectureDate: "2025-10-10",
			options: {},
		} as const;

		it("should normalise every configured module before looking for the lecture when running", async () => {
			await invoke(runCommand);

			expect(runner.normaliseSources).toHaveBeenCalledWith({
				moduleRoots: [moduleRoot, join(tempDir, "Immunology")],
			});
		});

		it("should run the lecture without prompting when exactly one matches the date", async () => {
			const code = await invoke(runCommand);

			expect(code).toBe(0);
			expect(selectMatches).not.toHaveBeenCalled();
			expect(runner.runLecture).toHaveBeenCalledWith({ workspaceRoot, options: {} });
		});

		it("should print the end-of-run summary when a lecture has run", async () => {
			await invoke(runCommand);

			expect(output()).toContain("Run summary");
			expect(output()).toContain("Transcription");
			// 0.2 USD at 0.74 = 0.148.
			expect(output()).toContain("£0.148");
		});

		it("should pass the run options through when flags were given", async () => {
			await executeCommand({
				command: { ...runCommand, options: { fromStage: "transcription", continueOnError: true } },
				deps: deps(),
			});

			expect(runner.runLecture).toHaveBeenCalledWith({
				workspaceRoot,
				options: { fromStage: "transcription", continueOnError: true },
			});
		});

		it("should report a failure when the run failed", async () => {
			runner.runLecture.mockResolvedValue(
				runSummaryFor({ workspace: workspaceRoot, overallStatus: "failed" }),
			);

			const code = await invoke(runCommand);

			expect(code).toBe(1);
		});

		it("should name each failed stage and its error when a stage failed", async () => {
			runner.runLecture.mockResolvedValue({
				...runSummaryFor({ workspace: workspaceRoot, overallStatus: "failed" }),
				stageOutcomes: [
					{
						stageId: "transcription",
						entry: {
							action: "ran",
							status: "failed",
							error: "ELEVENLABS_API_KEY is not set",
							configUsed: null,
							cost: { totalCostUsd: null, callCount: 0 },
						},
					},
					{ stageId: "synthesis", entry: { action: "not-reached" } },
				],
			});

			await invoke(runCommand);

			expect(output()).toContain("Transcription failed: ELEVENLABS_API_KEY is not set");
			expect(output()).toContain("runs/");
		});

		it("should report that nothing matched when no lecture carries the date", async () => {
			runner.resolveLecturesByDate.mockResolvedValue([]);

			const code = await invoke(runCommand);

			expect(code).toBe(1);
			expect(output()).toContain("2025-10-10");
			expect(runner.runLecture).not.toHaveBeenCalled();
		});

		it("should ask which lectures to run when several share the date", async () => {
			const other = await makeSecondLecture();
			runner.resolveLecturesByDate.mockResolvedValue([match, other]);
			selectMatches.mockResolvedValue([match, other]);
			runner.runLecture.mockImplementation(async ({ workspaceRoot: workspace }) =>
				runSummaryFor({ workspace }),
			);

			await invoke(runCommand);

			expect(selectMatches).toHaveBeenCalledWith({ matches: [match, other] });
			expect(runner.runLecture).toHaveBeenCalledTimes(2);
		});

		it("should run nothing when the user cancels the choice", async () => {
			runner.resolveLecturesByDate.mockResolvedValue([match, match]);
			selectMatches.mockResolvedValue([]);

			const code = await invoke(runCommand);

			expect(code).toBe(0);
			expect(runner.runLecture).not.toHaveBeenCalled();
		});
	});

	describe("batch", () => {
		function batchSummary(overallStatus: OverallStatus): BatchSummary {
			return {
				startedAt: "2025-10-10T09:00:00.000Z",
				endedAt: "2025-10-10T10:00:00.000Z",
				lectures: [runSummaryFor({ workspace: workspaceRoot })],
				totalCostUsd: 0.2,
				overallStatus,
			};
		}

		beforeEach(() => {
			runner.runBatch.mockResolvedValue(batchSummary("success"));
		});

		it("should batch every configured module when none is named", async () => {
			const code = await executeCommand({
				command: { command: "batch", moduleRoot: null, options: { concurrency: 2 } },
				deps: deps(),
			});

			expect(code).toBe(0);
			expect(runner.runBatch).toHaveBeenCalledWith({
				moduleRoots: [moduleRoot, join(tempDir, "Immunology")],
				options: { concurrency: 2 },
			});
		});

		it("should batch only the named module when one is given", async () => {
			await executeCommand({
				command: { command: "batch", moduleRoot, options: {} },
				deps: deps(),
			});

			expect(runner.runBatch).toHaveBeenCalledWith({ moduleRoots: [moduleRoot], options: {} });
		});

		it("should print each lecture's summary and the batch total when the batch ends", async () => {
			await executeCommand({
				command: { command: "batch", moduleRoot: null, options: {} },
				deps: deps(),
			});

			expect(output()).toContain("Run summary");
			expect(output()).toContain("Batch summary");
			expect(output()).toContain("Biology of Disease");
		});

		it("should report a failure when any lecture in the batch failed", async () => {
			runner.runBatch.mockResolvedValue(batchSummary("failed"));

			const code = await executeCommand({
				command: { command: "batch", moduleRoot: null, options: {} },
				deps: deps(),
			});

			expect(code).toBe(1);
		});
	});

	describe("cost-report", () => {
		it("should report across every configured module when nothing narrows it", async () => {
			const code = await invoke({ command: "cost-report", lectureDate: null, moduleRoot: null });

			expect(code).toBe(0);
			expect(runner.costReport).toHaveBeenCalledWith({
				moduleRoots: [moduleRoot, join(tempDir, "Immunology")],
				options: {},
			});
		});

		it("should report on one module only when --module narrows it", async () => {
			await invoke({ command: "cost-report", lectureDate: null, moduleRoot });

			expect(runner.costReport).toHaveBeenCalledWith({ moduleRoots: [moduleRoot], options: {} });
		});

		it("should narrow to the chosen lectures when the date matches several modules", async () => {
			const other: LectureMatch = {
				moduleRoot: join(tempDir, "Immunology"),
				workspaceRoot: join(tempDir, "Immunology", "Pipeline processing", "L1"),
				lectureNumber: 1,
				lectureTitle: "Antigens",
			};
			runner.resolveLecturesByDate.mockResolvedValue([match, other]);
			selectMatches.mockResolvedValue([other]);

			await invoke({ command: "cost-report", lectureDate: "2025-10-10", moduleRoot: null });

			expect(runner.costReport).toHaveBeenCalledWith({
				moduleRoots: [other.moduleRoot],
				options: { lectureDate: "2025-10-10" },
			});
		});

		it("should report that nothing matched when no lecture carries the date", async () => {
			runner.resolveLecturesByDate.mockResolvedValue([]);

			const code = await invoke({
				command: "cost-report",
				lectureDate: "2025-10-10",
				moduleRoot: null,
			});

			expect(code).toBe(1);
			expect(runner.costReport).not.toHaveBeenCalled();
		});

		it("should report on nothing when the user cancels the choice", async () => {
			runner.resolveLecturesByDate.mockResolvedValue([match, match]);
			selectMatches.mockResolvedValue([]);

			const code = await invoke({
				command: "cost-report",
				lectureDate: "2025-10-10",
				moduleRoot: null,
			});

			expect(code).toBe(0);
			expect(runner.costReport).not.toHaveBeenCalled();
		});
	});

	describe("rename", () => {
		const renameCommand = {
			command: "rename",
			lectureDate: "2025-10-10",
			title: "Cell Injury and Death",
		} as const;

		it("should record the new title when renaming", async () => {
			const code = await invoke(renameCommand);

			expect(code).toBe(0);
			expect((await readManifest({ workspaceRoot })).userTitle).toBe("Cell Injury and Death");
		});

		it("should renormalise the lecture's module when renaming", async () => {
			await invoke(renameCommand);

			expect(runner.normaliseSources).toHaveBeenCalledWith({ moduleRoots: [moduleRoot] });
		});

		it("should report that nothing matched when no lecture carries the date", async () => {
			runner.resolveLecturesByDate.mockResolvedValue([]);

			const code = await invoke(renameCommand);

			expect(code).toBe(1);
			expect(runner.normaliseSources).not.toHaveBeenCalled();
		});

		it("should rename nothing when the user cancels the choice", async () => {
			runner.resolveLecturesByDate.mockResolvedValue([match, match]);
			selectMatch.mockResolvedValue(null);

			const code = await invoke(renameCommand);

			expect(code).toBe(0);
			expect((await readManifest({ workspaceRoot })).userTitle).toBeNull();
			expect(runner.normaliseSources).not.toHaveBeenCalled();
		});

		it("should ask for one lecture only when several share the date", async () => {
			const other = await makeSecondLecture();
			runner.resolveLecturesByDate.mockResolvedValue([match, other]);
			selectMatch.mockResolvedValue(other);

			await invoke(renameCommand);

			// One title cannot sensibly belong to two lectures, so rename never offers
			// the "All matches" picker the other commands use.
			expect(selectMatches).not.toHaveBeenCalled();
			expect(selectMatch).toHaveBeenCalledWith({ matches: [match, other] });
			expect((await readManifest({ workspaceRoot: other.workspaceRoot })).userTitle).toBe(
				"Cell Injury and Death",
			);
			expect((await readManifest({ workspaceRoot })).userTitle).toBeNull();
		});
	});

	describe("delete", () => {
		const deleteCommand = { command: "delete", lectureDate: "2025-10-10" } as const;

		beforeEach(async () => {
			const videoDir = join(moduleRoot, "Source files", "Video files");
			await mkdir(videoDir, { recursive: true });
			await writeFile(join(videoDir, `${FOLDER}.mp4`), "video");
		});

		it("should ask before deleting when a lecture is to be removed", async () => {
			await invoke(deleteCommand);

			expect(confirm).toHaveBeenCalledTimes(1);
			expect(String((confirm.mock.calls[0] as [{ message: string }])[0].message)).toContain(
				"Cell Injury",
			);
		});

		it("should remove the lecture and renormalise when the deletion is approved", async () => {
			const code = await invoke(deleteCommand);

			expect(code).toBe(0);
			await expect(readManifest({ workspaceRoot })).rejects.toThrow();
			expect(runner.normaliseSources).toHaveBeenCalledWith({ moduleRoots: [moduleRoot] });
		});

		it("should leave the lecture in place when the deletion is declined", async () => {
			confirm.mockResolvedValue(false);

			const code = await invoke(deleteCommand);

			expect(code).toBe(0);
			await expect(readManifest({ workspaceRoot })).resolves.toBeTruthy();
			expect(runner.normaliseSources).not.toHaveBeenCalled();
		});
	});

	describe("change-date", () => {
		const changeCommand = {
			command: "change-date",
			lectureDate: "2025-10-10",
			newLectureDate: "2025-10-24",
		} as const;

		beforeEach(async () => {
			for (const dir of ["Video files", "Lecture slides"]) {
				await mkdir(join(moduleRoot, "Source files", dir), { recursive: true });
			}
			await writeFile(join(moduleRoot, "Source files", "Video files", `${FOLDER}.mp4`), "video");
			await writeFile(
				join(moduleRoot, "Source files", "Lecture slides", `${FOLDER}.pdf`),
				"slides",
			);
		});

		it("should move the lecture to the new date when changing it", async () => {
			const code = await invoke(changeCommand);

			expect(code).toBe(0);
			const moved = join(moduleRoot, "Pipeline processing", "Lecture 1 - Cell Injury - 2025-10-24");
			expect((await readManifest({ workspaceRoot: moved })).lectureDate).toBe("2025-10-24");
		});

		it("should renormalise the lecture's module when changing the date", async () => {
			await invoke(changeCommand);

			expect(runner.normaliseSources).toHaveBeenCalledWith({ moduleRoots: [moduleRoot] });
		});
	});
});
