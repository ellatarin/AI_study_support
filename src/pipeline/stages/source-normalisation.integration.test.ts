import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunManifest } from "../../types/pipeline.js";
import type { LoggedEntry, LoggedLevel } from "../fixtures.js";
import { loggedAt, makeStubLogger, makeTempDir } from "../fixtures.js";
import { moduleDirs, workspaceRootFor } from "../layout.js";
import { manifestPath, writeManifest } from "../manifest.js";
import {
	createSourceNormalisationStage,
	SourceNormalisationError,
} from "./source-normalisation.js";

// The names Stage 0 is expected to produce, written out on purpose: this suite
// tests the naming rule, so deriving them would assert it against itself. The
// directories they live in are the layout's business, not this suite's, and come
// from moduleDirs.
const CELL_INJURY = "Lecture 1 - Cell Injury - 2025-10-10";
const VACCINATION = "Lecture 2 - Vaccination - 2025-10-17";
const CELL_INJURY_VIDEO = "2025-10-10 BOD_Cell Injury.mp4";
const CELL_INJURY_SLIDE = "2025-10-10 Cell Injury deck.pdf";
// The suffix Stage 0 renames through, written out for the same reason as the
// names above: these tests arrange the on-disk state a crash mid-rename leaves,
// so taking the suffix from the stage would assert it against itself.
const TEMP_SUFFIX = ".stage0-tmp";

function videoDir(moduleRoot: string): string {
	return moduleDirs({ moduleRoot }).video;
}

function slideDir(moduleRoot: string): string {
	return moduleDirs({ moduleRoot }).slide;
}

function processingDir(moduleRoot: string): string {
	return moduleDirs({ moduleRoot }).processing;
}

function finalOutputDir(moduleRoot: string): string {
	return moduleDirs({ moduleRoot }).finalOutput;
}

async function writeInto(dir: string, name: string): Promise<void> {
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, name), "source bytes");
}

async function listNames(dir: string): Promise<readonly string[]> {
	try {
		return (await readdir(dir)).sort();
	} catch {
		return [];
	}
}

async function readManifestIn(folder: string): Promise<RunManifest> {
	return JSON.parse(await readFile(manifestPath({ workspaceRoot: folder }), "utf8")) as RunManifest;
}

async function patchManifest({
	folder,
	patch,
}: {
	readonly folder: string;
	readonly patch: Partial<RunManifest>;
}): Promise<void> {
	const manifest = await readManifestIn(folder);
	await writeManifest({ workspaceRoot: folder, manifest: { ...manifest, ...patch } });
}

describe("createSourceNormalisationStage", () => {
	let tempDir: string;
	let moduleRoot: string;
	let logged: ReturnType<typeof makeStubLogger>;
	let confirm: Mock<(args: { readonly message: string }) => Promise<boolean>>;
	let stage: ReturnType<typeof createSourceNormalisationStage>;

	beforeEach(async () => {
		tempDir = await makeTempDir({ prefix: "stage0-" });
		moduleRoot = join(tempDir, "Biology of Disease");
		confirm = vi.fn<(args: { readonly message: string }) => Promise<boolean>>();
		confirm.mockResolvedValue(true);
		freshStage();
	});

	/**
	 * Rebuilds the stage against an empty log. Called again by a test whose arrange
	 * step already normalised the module, so its assertions see only what the run
	 * under test logged.
	 */
	function freshStage(): void {
		logged = makeStubLogger();
		stage = createSourceNormalisationStage({ logger: logged.logger, confirm });
	}

	/** What the stage logged at one level. */
	function logsAt(level: LoggedLevel): readonly LoggedEntry[] {
		return loggedAt({ entries: logged.entries, level });
	}

	afterEach(async () => {
		vi.restoreAllMocks();
		await rm(tempDir, { recursive: true, force: true });
	});

	async function writeLecture(video: string, slide: string): Promise<void> {
		await writeInto(videoDir(moduleRoot), video);
		await writeInto(slideDir(moduleRoot), slide);
	}

	/** Normalises a single new lecture and returns the manifest Stage 0 wrote. */
	async function normaliseNewLecture(): Promise<RunManifest> {
		await writeLecture(CELL_INJURY_VIDEO, CELL_INJURY_SLIDE);
		await stage.normaliseModule({ moduleRoot });
		return readManifestIn(workspaceRootFor({ moduleRoot, folderName: CELL_INJURY }));
	}

	/** Normalises a two-lecture module, the starting point for renumbering cases. */
	async function normaliseTwoLectures(): Promise<void> {
		await writeLecture(CELL_INJURY_VIDEO, CELL_INJURY_SLIDE);
		await writeLecture("2025-10-17 BOD_Vaccination.mp4", "2025-10-17 Vaccination deck.pdf");
		await stage.normaliseModule({ moduleRoot });
	}

	/**
	 * Asserts that normalisation aborts: it throws, logs the failure, and leaves
	 * exactly the given workspaces behind.
	 */
	async function expectNormalisationToAbort(workspaces: readonly string[]): Promise<void> {
		await expect(stage.normaliseModule({ moduleRoot })).rejects.toThrow(SourceNormalisationError);

		expect(logsAt("error")).not.toHaveLength(0);
		expect(await listNames(processingDir(moduleRoot))).toEqual(workspaces);
	}

	it("should expose the source-normalisation stage id when created", () => {
		expect(stage.stageId).toBe("source-normalisation");
	});

	it("should assign sequential lecture numbers when videos are sorted by date", async () => {
		await writeLecture("13 Oct 2025 BOD_Immunity to Infection.mp4", "2025-10-13 Immunity deck.pdf");
		await writeLecture(CELL_INJURY_VIDEO, CELL_INJURY_SLIDE);

		await stage.normaliseModule({ moduleRoot });

		expect(await listNames(processingDir(moduleRoot))).toEqual([
			"Lecture 1 - Cell Injury - 2025-10-10",
			"Lecture 2 - Immunity to Infection - 2025-10-13",
		]);
		const first = await readManifestIn(workspaceRootFor({ moduleRoot, folderName: CELL_INJURY }));
		expect(first).toMatchObject({ lectureNumber: 1, lectureDate: "2025-10-10" });
	});

	it("should rename the source video and matched slide to canonical names when normalisation runs", async () => {
		await writeLecture(CELL_INJURY_VIDEO, CELL_INJURY_SLIDE);

		await stage.normaliseModule({ moduleRoot });

		expect(await listNames(videoDir(moduleRoot))).toEqual([
			"Lecture 1 - Cell Injury - 2025-10-10.mp4",
		]);
		expect(await listNames(slideDir(moduleRoot))).toEqual([
			"Lecture 1 - Cell Injury - 2025-10-10.pdf",
		]);
	});

	it("should create a workspace and seed pending stages when a lecture is new", async () => {
		const manifest = await normaliseNewLecture();

		expect(manifest).toMatchObject({
			lectureNumber: 1,
			lectureDate: "2025-10-10",
			provisionalTitle: "Cell Injury",
			workspaceFolderName: "Lecture 1 - Cell Injury - 2025-10-10",
		});
		expect(manifest.stages["audio-extraction"]).toEqual({ status: "pending" });
		expect(manifest.stages["pdf-generation"]).toEqual({ status: "pending" });
	});

	it("should seed lectureTitle equal to provisionalTitle and leave userTitle and aiDerivedTitle null when a lecture is new", async () => {
		const manifest = await normaliseNewLecture();

		expect(manifest.lectureTitle).toBe(manifest.provisionalTitle);
		expect(manifest.userTitle).toBeNull();
		expect(manifest.aiDerivedTitle).toBeNull();
	});

	it("should name an existing lecture from its manifest lectureTitle when the title changed after Stage 0", async () => {
		await writeLecture(CELL_INJURY_VIDEO, CELL_INJURY_SLIDE);
		await stage.normaliseModule({ moduleRoot });
		await patchManifest({
			folder: workspaceRootFor({ moduleRoot, folderName: CELL_INJURY }),
			patch: { lectureTitle: "Innate Immune Response" },
		});

		await stage.normaliseModule({ moduleRoot });

		expect(await listNames(processingDir(moduleRoot))).toEqual([
			"Lecture 1 - Innate Immune Response - 2025-10-10",
		]);
		expect(await listNames(videoDir(moduleRoot))).toEqual([
			"Lecture 1 - Innate Immune Response - 2025-10-10.mp4",
		]);
	});

	it("should fall back to a bare Lecture N name when the video filename has no descriptive title", async () => {
		await writeLecture("2025-10-10 Lecture 1.mp4", "2025-10-10 deck.pdf");

		await stage.normaliseModule({ moduleRoot });

		expect(await listNames(processingDir(moduleRoot))).toEqual(["Lecture 1 - 2025-10-10"]);
		const manifest = await readManifestIn(
			workspaceRootFor({ moduleRoot, folderName: "Lecture 1 - 2025-10-10" }),
		);
		expect(manifest.provisionalTitle).toBe("");
		expect(manifest.lectureTitle).toBe("");
	});

	it("should record actions on the run logger when normalisation succeeds", async () => {
		await writeLecture(CELL_INJURY_VIDEO, CELL_INJURY_SLIDE);

		await stage.normaliseModule({ moduleRoot });

		expect(logsAt("info")).not.toHaveLength(0);
		expect(logsAt("error")).toHaveLength(0);
	});

	it("should record each lecture's date, number and matched sources when normalisation succeeds", async () => {
		await normaliseTwoLectures();

		expect(
			logsAt("debug")
				.filter((entry) => entry.message === "Resolved lecture")
				.map((entry) => entry.payload),
		).toStrictEqual([
			{
				lectureNumber: 1,
				lectureDate: "2025-10-10",
				videoName: CELL_INJURY_VIDEO,
				slideName: CELL_INJURY_SLIDE,
				provisionalTitle: "Cell Injury",
			},
			{
				lectureNumber: 2,
				lectureDate: "2025-10-17",
				videoName: "2025-10-17 BOD_Vaccination.mp4",
				slideName: "2025-10-17 Vaccination deck.pdf",
				provisionalTitle: "Vaccination",
			},
		]);
	});

	it("should ignore dotfiles in the source directories when normalising", async () => {
		await writeLecture(CELL_INJURY_VIDEO, CELL_INJURY_SLIDE);
		await writeInto(videoDir(moduleRoot), ".DS_Store");
		await writeInto(slideDir(moduleRoot), ".DS_Store");

		await stage.normaliseModule({ moduleRoot });

		expect(logsAt("error")).toHaveLength(0);
		expect(await listNames(processingDir(moduleRoot))).toEqual([
			"Lecture 1 - Cell Injury - 2025-10-10",
		]);
	});

	describe("validation errors", () => {
		it.each([
			{
				scenario: "a video has no extractable date",
				setup: async (): Promise<void> => {
					await writeInto(videoDir(moduleRoot), "BOD_Cell Injury no date.mp4");
				},
			},
			{
				scenario: "a slide has no extractable date",
				setup: async (): Promise<void> => {
					await writeInto(slideDir(moduleRoot), "BOD_Cell Injury deck no date.pdf");
				},
			},
			{
				scenario: "a video has no matching slide",
				setup: async (): Promise<void> => {
					await writeInto(videoDir(moduleRoot), CELL_INJURY_VIDEO);
				},
			},
			{
				scenario: "a slide has no matching video",
				setup: async (): Promise<void> => {
					await writeInto(slideDir(moduleRoot), "2025-10-10 Orphan deck.pdf");
				},
			},
			{
				scenario: "two videos share a date",
				setup: async (): Promise<void> => {
					await writeInto(videoDir(moduleRoot), CELL_INJURY_VIDEO);
					await writeInto(videoDir(moduleRoot), "2025-10-10 BOD_Immunity.mp4");
					await writeInto(slideDir(moduleRoot), "2025-10-10 deck.pdf");
				},
			},
			{
				scenario: "two slides share a date",
				setup: async (): Promise<void> => {
					await writeInto(videoDir(moduleRoot), CELL_INJURY_VIDEO);
					await writeInto(slideDir(moduleRoot), CELL_INJURY_SLIDE);
					await writeInto(slideDir(moduleRoot), "2025-10-10 Extra deck.pdf");
				},
			},
		])("should log an error and make no filesystem changes when $scenario", async ({ setup }) => {
			await setup();
			const videosBefore = await listNames(videoDir(moduleRoot));
			const slidesBefore = await listNames(slideDir(moduleRoot));

			await expectNormalisationToAbort([]);

			expect(await listNames(videoDir(moduleRoot))).toEqual(videosBefore);
			expect(await listNames(slideDir(moduleRoot))).toEqual(slidesBefore);
		});

		it("should report every anomaly in a single error when several sources are wrong", async () => {
			await writeInto(videoDir(moduleRoot), "BOD_no date.mp4");
			await writeInto(slideDir(moduleRoot), "2025-10-10 Orphan deck.pdf");

			const rejection = stage.normaliseModule({ moduleRoot });

			await expect(rejection).rejects.toThrow(/no date.*mp4|Orphan/s);
		});
	});

	it("should produce no filesystem changes when re-run on already-normalised sources", async () => {
		await writeLecture(CELL_INJURY_VIDEO, CELL_INJURY_SLIDE);
		await stage.normaliseModule({ moduleRoot });
		const folder = workspaceRootFor({ moduleRoot, folderName: CELL_INJURY });
		const manifestAfterFirst = await readManifestIn(folder);
		const videosAfterFirst = await listNames(videoDir(moduleRoot));
		const slidesAfterFirst = await listNames(slideDir(moduleRoot));

		await stage.normaliseModule({ moduleRoot });

		expect(await listNames(processingDir(moduleRoot))).toEqual([
			"Lecture 1 - Cell Injury - 2025-10-10",
		]);
		expect(await listNames(videoDir(moduleRoot))).toEqual(videosAfterFirst);
		expect(await listNames(slideDir(moduleRoot))).toEqual(slidesAfterFirst);
		expect(await readManifestIn(folder)).toEqual(manifestAfterFirst);
	});

	it("should renumber affected lectures when a new lecture is inserted between existing dates", async () => {
		await writeLecture(CELL_INJURY_VIDEO, CELL_INJURY_SLIDE);
		await writeLecture("2025-10-17 BOD_Vaccination.mp4", "2025-10-17 Vaccination deck.pdf");
		await stage.normaliseModule({ moduleRoot });
		await writeLecture("2025-10-13 BOD_Immunity to Infection.mp4", "2025-10-13 Immunity deck.pdf");

		await stage.normaliseModule({ moduleRoot });

		expect(await listNames(processingDir(moduleRoot))).toEqual([
			"Lecture 1 - Cell Injury - 2025-10-10",
			"Lecture 2 - Immunity to Infection - 2025-10-13",
			"Lecture 3 - Vaccination - 2025-10-17",
		]);
		const renumbered = await readManifestIn(
			workspaceRootFor({ moduleRoot, folderName: "Lecture 3 - Vaccination - 2025-10-17" }),
		);
		expect(renumbered.lectureNumber).toBe(3);
		expect(renumbered.workspaceFolderName).toBe("Lecture 3 - Vaccination - 2025-10-17");
		expect(await listNames(videoDir(moduleRoot))).toContain(
			"Lecture 3 - Vaccination - 2025-10-17.mp4",
		);
	});

	it("should leave an undateable file in Final output untouched when normalisation runs", async () => {
		await writeLecture(CELL_INJURY_VIDEO, CELL_INJURY_SLIDE);
		await writeInto(finalOutputDir(moduleRoot), "Module handbook.pdf");

		await stage.normaliseModule({ moduleRoot });

		expect(logsAt("error")).toHaveLength(0);
		expect(await listNames(finalOutputDir(moduleRoot))).toEqual(["Module handbook.pdf"]);
	});

	it("should leave a workspace folder untouched when it has no readable manifest", async () => {
		await writeLecture(CELL_INJURY_VIDEO, CELL_INJURY_SLIDE);
		await mkdir(workspaceRootFor({ moduleRoot, folderName: "Notes I dropped in here" }), {
			recursive: true,
		});

		await stage.normaliseModule({ moduleRoot });

		expect(confirm).not.toHaveBeenCalled();
		expect(await listNames(processingDir(moduleRoot))).toEqual([
			"Lecture 1 - Cell Injury - 2025-10-10",
			"Notes I dropped in here",
		]);
	});

	describe("interrupted renames", () => {
		it("should restore a temporary source file to its target name when a previous run was interrupted", async () => {
			await writeInto(videoDir(moduleRoot), `${CELL_INJURY}.mp4${TEMP_SUFFIX}`);
			await writeInto(slideDir(moduleRoot), `${CELL_INJURY}.pdf${TEMP_SUFFIX}`);

			await stage.normaliseModule({ moduleRoot });

			expect(await listNames(videoDir(moduleRoot))).toEqual([`${CELL_INJURY}.mp4`]);
			expect(await listNames(slideDir(moduleRoot))).toEqual([`${CELL_INJURY}.pdf`]);
			expect(await listNames(processingDir(moduleRoot))).toEqual([CELL_INJURY]);
		});

		it("should restore a temporary workspace folder to its target name when a previous run was interrupted", async () => {
			await normaliseNewLecture();
			const processing = processingDir(moduleRoot);
			await rename(join(processing, CELL_INJURY), join(processing, `${CELL_INJURY}${TEMP_SUFFIX}`));
			freshStage();

			await stage.normaliseModule({ moduleRoot });

			expect(await listNames(processing)).toEqual([CELL_INJURY]);
			expect(logsAt("error")).toHaveLength(0);
		});

		it("should abort without filesystem changes when a temporary file's target name is taken", async () => {
			await writeInto(videoDir(moduleRoot), `${CELL_INJURY}.mp4`);
			await writeInto(videoDir(moduleRoot), `${CELL_INJURY}.mp4${TEMP_SUFFIX}`);
			await writeInto(slideDir(moduleRoot), `${CELL_INJURY}.pdf`);

			await expectNormalisationToAbort([]);

			expect(logsAt("error").map((entry) => entry.payload)).toContainEqual(
				expect.objectContaining({
					anomalies: [expect.stringContaining(`${CELL_INJURY}.mp4${TEMP_SUFFIX}`)],
				}),
			);
			expect(await listNames(videoDir(moduleRoot))).toEqual([
				`${CELL_INJURY}.mp4`,
				`${CELL_INJURY}.mp4${TEMP_SUFFIX}`,
			]);
		});
	});

	describe("orphan handling", () => {
		function promptMessages(): readonly string[] {
			return confirm.mock.calls.map(([args]) => args.message);
		}

		async function removeSourcePair(baseName: string): Promise<void> {
			await rm(join(videoDir(moduleRoot), `${baseName}.mp4`));
			await rm(join(slideDir(moduleRoot), `${baseName}.pdf`));
		}

		beforeEach(async () => {
			await normaliseTwoLectures();
			await writeInto(finalOutputDir(moduleRoot), `${CELL_INJURY}.pdf`);
			await writeInto(finalOutputDir(moduleRoot), `${VACCINATION}.pdf`);
			freshStage();
			confirm.mockClear();
		});

		it("should not prompt when every workspace still has its source pair", async () => {
			await stage.normaliseModule({ moduleRoot });

			expect(confirm).not.toHaveBeenCalled();
		});

		it.each([
			{ detail: "the lecture number", fragment: "Lecture 1" },
			{ detail: "the title", fragment: "Cell Injury" },
			{ detail: "the date", fragment: "2025-10-10" },
		])("should show $detail in the orphan prompt when a lecture's sources are gone", async ({
			fragment,
		}) => {
			await removeSourcePair(CELL_INJURY);

			await stage.normaliseModule({ moduleRoot });

			expect(promptMessages()).toContainEqual(expect.stringContaining(fragment));
		});

		it("should quote no figure in the orphan prompt when a lecture's sources are gone", async () => {
			// What a lecture has cost is the sum of its stages, and stage costs are
			// not summed (NFR-2.2). `cost-report` still has the per-stage figures for
			// as long as the workspace stands.
			await removeSourcePair(CELL_INJURY);

			await stage.normaliseModule({ moduleRoot });

			for (const message of promptMessages()) {
				expect(message).not.toContain("£");
			}
		});

		it("should delete the workspace and its Final output PDF and renumber the remainder when an orphan is approved", async () => {
			await removeSourcePair(CELL_INJURY);

			await stage.normaliseModule({ moduleRoot });

			expect(await listNames(processingDir(moduleRoot))).toEqual([
				"Lecture 1 - Vaccination - 2025-10-17",
			]);
			expect(await listNames(finalOutputDir(moduleRoot))).toEqual([
				"Lecture 1 - Vaccination - 2025-10-17.pdf",
			]);
			expect(await listNames(videoDir(moduleRoot))).toEqual([
				"Lecture 1 - Vaccination - 2025-10-17.mp4",
			]);
		});

		it("should take a final confirmation and delete every orphan when several are all approved", async () => {
			await removeSourcePair(CELL_INJURY);
			await removeSourcePair(VACCINATION);

			await stage.normaliseModule({ moduleRoot });

			expect(confirm).toHaveBeenCalledTimes(3);
			expect(await listNames(processingDir(moduleRoot))).toEqual([]);
			expect(await listNames(finalOutputDir(moduleRoot))).toEqual([]);
		});

		it("should describe an orphan as untitled when its manifest carries no title", async () => {
			await patchManifest({
				folder: workspaceRootFor({ moduleRoot, folderName: CELL_INJURY }),
				patch: { lectureTitle: "" },
			});
			await removeSourcePair(CELL_INJURY);

			await stage.normaliseModule({ moduleRoot });

			expect(promptMessages()).toContainEqual(expect.stringContaining("(untitled)"));
		});

		it("should delete the workspace when an orphan has no final output PDF", async () => {
			await rm(join(finalOutputDir(moduleRoot), `${CELL_INJURY}.pdf`));
			await removeSourcePair(CELL_INJURY);

			await stage.normaliseModule({ moduleRoot });

			expect(await listNames(processingDir(moduleRoot))).toEqual([
				"Lecture 1 - Vaccination - 2025-10-17",
			]);
		});

		it("should log the prior number, title, and date when an orphan is deleted", async () => {
			await removeSourcePair(CELL_INJURY);

			await stage.normaliseModule({ moduleRoot });

			expect(logsAt("info").map((entry) => entry.payload)).toContainEqual(
				expect.objectContaining({
					lectureNumber: 1,
					lectureTitle: "Cell Injury",
					lectureDate: "2025-10-10",
				}),
			);
		});

		it.each([
			{ scenario: "an orphan deletion is declined", responses: [false] },
			{ scenario: "the final confirmation is declined", responses: [true, false] },
		])("should abort without filesystem changes when $scenario", async ({ responses }) => {
			await removeSourcePair(CELL_INJURY);
			for (const response of responses) {
				confirm.mockResolvedValueOnce(response);
			}

			await expectNormalisationToAbort([CELL_INJURY, VACCINATION]);

			expect(await listNames(finalOutputDir(moduleRoot))).toEqual([
				`${CELL_INJURY}.pdf`,
				`${VACCINATION}.pdf`,
			]);
			expect(await listNames(videoDir(moduleRoot))).toEqual([`${VACCINATION}.mp4`]);
		});
	});

	it("should rename the Final output PDF when a lecture is renumbered", async () => {
		await normaliseTwoLectures();
		await writeInto(finalOutputDir(moduleRoot), `${VACCINATION}.pdf`);
		await writeLecture("2025-10-13 BOD_Immunity to Infection.mp4", "2025-10-13 Immunity deck.pdf");

		await stage.normaliseModule({ moduleRoot });

		expect(await listNames(finalOutputDir(moduleRoot))).toEqual([
			"Lecture 3 - Vaccination - 2025-10-17.pdf",
		]);
	});
});
