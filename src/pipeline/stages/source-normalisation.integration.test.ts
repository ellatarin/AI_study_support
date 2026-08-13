import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pino } from "pino";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunManifest } from "../../types/pipeline.js";
import { makeTempDir } from "../fixtures.js";
import {
	createSourceNormalisationStage,
	SourceNormalisationError,
} from "./source-normalisation.js";

const SOURCE_DIR = "Source files";
const VIDEO_DIR = "Video files";
const SLIDE_DIR = "Lecture slides";
const PROCESSING_DIR = "Pipeline processing";
const FINAL_OUTPUT_DIR = "Final output";

const CELL_INJURY = "Lecture 1 - Cell Injury - 2025-10-10";
const VACCINATION = "Lecture 2 - Vaccination - 2025-10-17";
const CELL_INJURY_VIDEO = "2025-10-10 BOD_Cell Injury.mp4";
const CELL_INJURY_SLIDE = "2025-10-10 Cell Injury deck.pdf";

function videoDir(moduleRoot: string): string {
	return join(moduleRoot, SOURCE_DIR, VIDEO_DIR);
}

function slideDir(moduleRoot: string): string {
	return join(moduleRoot, SOURCE_DIR, SLIDE_DIR);
}

function processingDir(moduleRoot: string): string {
	return join(moduleRoot, PROCESSING_DIR);
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
	return JSON.parse(await readFile(join(folder, "manifest.json"), "utf8")) as RunManifest;
}

async function patchManifest({
	folder,
	patch,
}: {
	readonly folder: string;
	readonly patch: Partial<RunManifest>;
}): Promise<void> {
	const manifest = await readManifestIn(folder);
	await writeFile(
		join(folder, "manifest.json"),
		JSON.stringify({ ...manifest, ...patch }, null, 2),
	);
}

describe("createSourceNormalisationStage", () => {
	let tempDir: string;
	let moduleRoot: string;
	let info: ReturnType<typeof vi.fn>;
	let error: ReturnType<typeof vi.fn>;
	let confirm: Mock<(args: { readonly message: string }) => Promise<boolean>>;
	let stage: ReturnType<typeof createSourceNormalisationStage>;

	beforeEach(async () => {
		tempDir = await makeTempDir({ prefix: "stage0-" });
		moduleRoot = join(tempDir, "Biology of Disease");
		const logger = pino({ level: "silent" });
		info = vi.fn();
		error = vi.fn();
		vi.spyOn(logger, "info").mockImplementation(info as never);
		vi.spyOn(logger, "error").mockImplementation(error as never);
		confirm = vi.fn<(args: { readonly message: string }) => Promise<boolean>>();
		confirm.mockResolvedValue(true);
		stage = createSourceNormalisationStage({ logger, confirm });
	});

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
		return readManifestIn(join(processingDir(moduleRoot), CELL_INJURY));
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

		expect(error).toHaveBeenCalled();
		expect(await listNames(processingDir(moduleRoot))).toEqual(workspaces);
	}

	it("should expose the source-normalisation stage id when created", () => {
		expect(stage.stageId).toBe("source-normalisation");
	});

	it("should assign sequential lecture numbers when videos are sorted by date", async () => {
		await writeLecture("13 Oct 2025 BOD_Immunity to Infection.mp4", "2025-10-13 Immunity deck.pdf");
		await writeLecture("2025-10-10 BOD_Cell Injury.mp4", "2025-10-10 Cell Injury deck.pdf");

		await stage.normaliseModule({ moduleRoot });

		expect(await listNames(processingDir(moduleRoot))).toEqual([
			"Lecture 1 - Cell Injury - 2025-10-10",
			"Lecture 2 - Immunity to Infection - 2025-10-13",
		]);
		const first = await readManifestIn(
			join(processingDir(moduleRoot), "Lecture 1 - Cell Injury - 2025-10-10"),
		);
		expect(first).toMatchObject({ lectureNumber: 1, lectureDate: "2025-10-10" });
	});

	it("should rename the source video and matched slide to canonical names when normalisation runs", async () => {
		await writeLecture("2025-10-10 BOD_Cell Injury.mp4", "2025-10-10 Cell Injury deck.pdf");

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
		expect(manifest.currentPipelineCost).toEqual({ totalCostUsd: 0, byStage: {} });
	});

	it("should seed lectureTitle equal to provisionalTitle and leave userTitle and aiDerivedTitle null when a lecture is new", async () => {
		const manifest = await normaliseNewLecture();

		expect(manifest.lectureTitle).toBe(manifest.provisionalTitle);
		expect(manifest.userTitle).toBeNull();
		expect(manifest.aiDerivedTitle).toBeNull();
	});

	it("should name an existing lecture from its manifest lectureTitle when the title changed after Stage 0", async () => {
		await writeLecture("2025-10-10 BOD_Cell Injury.mp4", "2025-10-10 Cell Injury deck.pdf");
		await stage.normaliseModule({ moduleRoot });
		await patchManifest({
			folder: join(processingDir(moduleRoot), "Lecture 1 - Cell Injury - 2025-10-10"),
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
			join(processingDir(moduleRoot), "Lecture 1 - 2025-10-10"),
		);
		expect(manifest.provisionalTitle).toBe("");
		expect(manifest.lectureTitle).toBe("");
	});

	it("should record actions on the run logger when normalisation succeeds", async () => {
		await writeLecture("2025-10-10 BOD_Cell Injury.mp4", "2025-10-10 Cell Injury deck.pdf");

		await stage.normaliseModule({ moduleRoot });

		expect(info).toHaveBeenCalled();
		expect(error).not.toHaveBeenCalled();
	});

	it("should ignore dotfiles in the source directories when normalising", async () => {
		await writeLecture("2025-10-10 BOD_Cell Injury.mp4", "2025-10-10 Cell Injury deck.pdf");
		await writeInto(videoDir(moduleRoot), ".DS_Store");
		await writeInto(slideDir(moduleRoot), ".DS_Store");

		await stage.normaliseModule({ moduleRoot });

		expect(error).not.toHaveBeenCalled();
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
					await writeInto(videoDir(moduleRoot), "2025-10-10 BOD_Cell Injury.mp4");
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
					await writeInto(videoDir(moduleRoot), "2025-10-10 BOD_Cell Injury.mp4");
					await writeInto(videoDir(moduleRoot), "2025-10-10 BOD_Immunity.mp4");
					await writeInto(slideDir(moduleRoot), "2025-10-10 deck.pdf");
				},
			},
			{
				scenario: "two slides share a date",
				setup: async (): Promise<void> => {
					await writeInto(videoDir(moduleRoot), "2025-10-10 BOD_Cell Injury.mp4");
					await writeInto(slideDir(moduleRoot), "2025-10-10 Cell Injury deck.pdf");
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
		await writeLecture("2025-10-10 BOD_Cell Injury.mp4", "2025-10-10 Cell Injury deck.pdf");
		await stage.normaliseModule({ moduleRoot });
		const folder = join(processingDir(moduleRoot), "Lecture 1 - Cell Injury - 2025-10-10");
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
		await writeLecture("2025-10-10 BOD_Cell Injury.mp4", "2025-10-10 Cell Injury deck.pdf");
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
			join(processingDir(moduleRoot), "Lecture 3 - Vaccination - 2025-10-17"),
		);
		expect(renumbered.lectureNumber).toBe(3);
		expect(renumbered.workspaceFolderName).toBe("Lecture 3 - Vaccination - 2025-10-17");
		expect(await listNames(videoDir(moduleRoot))).toContain(
			"Lecture 3 - Vaccination - 2025-10-17.mp4",
		);
	});

	it("should leave an undateable file in Final output untouched when normalisation runs", async () => {
		await writeLecture("2025-10-10 BOD_Cell Injury.mp4", "2025-10-10 Cell Injury deck.pdf");
		await writeInto(join(moduleRoot, FINAL_OUTPUT_DIR), "Module handbook.pdf");

		await stage.normaliseModule({ moduleRoot });

		expect(error).not.toHaveBeenCalled();
		expect(await listNames(join(moduleRoot, FINAL_OUTPUT_DIR))).toEqual(["Module handbook.pdf"]);
	});

	it("should leave a workspace folder untouched when it has no readable manifest", async () => {
		await writeLecture("2025-10-10 BOD_Cell Injury.mp4", "2025-10-10 Cell Injury deck.pdf");
		await mkdir(join(processingDir(moduleRoot), "Notes I dropped in here"), { recursive: true });

		await stage.normaliseModule({ moduleRoot });

		expect(confirm).not.toHaveBeenCalled();
		expect(await listNames(processingDir(moduleRoot))).toEqual([
			"Lecture 1 - Cell Injury - 2025-10-10",
			"Notes I dropped in here",
		]);
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
			await writeInto(join(moduleRoot, FINAL_OUTPUT_DIR), `${CELL_INJURY}.pdf`);
			await writeInto(join(moduleRoot, FINAL_OUTPUT_DIR), `${VACCINATION}.pdf`);
			await patchManifest({
				folder: join(processingDir(moduleRoot), CELL_INJURY),
				patch: { currentPipelineCost: { totalCostUsd: 1.23, byStage: { transcription: 1.23 } } },
			});
			info.mockClear();
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
			{ detail: "the cost already spent", fragment: "1.23" },
		])("should show $detail in the orphan prompt when a lecture's sources are gone", async ({
			fragment,
		}) => {
			await removeSourcePair(CELL_INJURY);

			await stage.normaliseModule({ moduleRoot });

			expect(promptMessages()).toContainEqual(expect.stringContaining(fragment));
		});

		it("should delete the workspace and its Final output PDF and renumber the remainder when an orphan is approved", async () => {
			await removeSourcePair(CELL_INJURY);

			await stage.normaliseModule({ moduleRoot });

			expect(await listNames(processingDir(moduleRoot))).toEqual([
				"Lecture 1 - Vaccination - 2025-10-17",
			]);
			expect(await listNames(join(moduleRoot, FINAL_OUTPUT_DIR))).toEqual([
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
			expect(await listNames(join(moduleRoot, FINAL_OUTPUT_DIR))).toEqual([]);
		});

		it("should describe an orphan as untitled when its manifest carries no title", async () => {
			await patchManifest({
				folder: join(processingDir(moduleRoot), CELL_INJURY),
				patch: { lectureTitle: "" },
			});
			await removeSourcePair(CELL_INJURY);

			await stage.normaliseModule({ moduleRoot });

			expect(promptMessages()).toContainEqual(expect.stringContaining("(untitled)"));
		});

		it("should delete the workspace when an orphan has no final output PDF", async () => {
			await rm(join(moduleRoot, FINAL_OUTPUT_DIR, `${CELL_INJURY}.pdf`));
			await removeSourcePair(CELL_INJURY);

			await stage.normaliseModule({ moduleRoot });

			expect(await listNames(processingDir(moduleRoot))).toEqual([
				"Lecture 1 - Vaccination - 2025-10-17",
			]);
		});

		it("should log the prior number, title, date, and cost when an orphan is deleted", async () => {
			await removeSourcePair(CELL_INJURY);

			await stage.normaliseModule({ moduleRoot });

			expect(info).toHaveBeenCalledWith(
				expect.objectContaining({
					lectureNumber: 1,
					lectureTitle: "Cell Injury",
					lectureDate: "2025-10-10",
					totalCostUsd: 1.23,
				}),
				expect.any(String),
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

			expect(await listNames(join(moduleRoot, FINAL_OUTPUT_DIR))).toEqual([
				`${CELL_INJURY}.pdf`,
				`${VACCINATION}.pdf`,
			]);
			expect(await listNames(videoDir(moduleRoot))).toEqual([`${VACCINATION}.mp4`]);
		});
	});

	it("should rename the Final output PDF when a lecture is renumbered", async () => {
		await normaliseTwoLectures();
		await writeInto(join(moduleRoot, FINAL_OUTPUT_DIR), `${VACCINATION}.pdf`);
		await writeLecture("2025-10-13 BOD_Immunity to Infection.mp4", "2025-10-13 Immunity deck.pdf");

		await stage.normaliseModule({ moduleRoot });

		expect(await listNames(join(moduleRoot, FINAL_OUTPUT_DIR))).toEqual([
			"Lecture 3 - Vaccination - 2025-10-17.pdf",
		]);
	});
});
