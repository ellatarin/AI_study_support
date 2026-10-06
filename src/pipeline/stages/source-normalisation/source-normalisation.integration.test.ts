import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Manifest } from "../../../types/pipeline.js";
import type { LectureSources, LoggedEntry, LoggedLevel } from "../../fixtures.js";
import {
	cellInjuryAsFirst,
	cellInjurySources,
	exampleConfig,
	immunityAsSecond,
	immunitySources,
	loggedAt,
	makeStubLogger,
	makeTempDir,
	stageCompletedAt,
	vaccinationAsFirst,
	vaccinationAsSecond,
	vaccinationAsThird,
	vaccinationSources,
} from "../../fixtures.js";
import { moduleDirs, workspaceRootFor } from "../../layout.js";
import { patchManifest, readManifest } from "../../manifest.js";
import {
	createSourceNormalisationStage,
	SourceNormalisationError,
} from "./source-normalisation.js";

// The source file names and their base names are written out, not derived,
// because this suite tests the naming rule. They are fixtures, so this suite and
// the unit suite of lecture-resolution.ts use the same names. The folders come
// from moduleDirs.
//
// The suffix is written out for the same reason. These tests make the files that
// a stop between the two rename passes leaves. A test that used the stage's own
// constant would test the `.normalisation-tmp` suffix against itself. No other suite makes these files, so the
// suffix is not a fixture.
const TEMP_SUFFIX = ".normalisation-tmp";

/** A slide deck on a date that has no video recording. */
const UNMATCHED_SLIDE_DECK = `${cellInjurySources.date} Unmatched deck.pdf`;

function videoRecordingsDir(moduleRoot: string): string {
	return moduleDirs({ moduleRoot }).videoRecording;
}

function slideDecksDir(moduleRoot: string): string {
	return moduleDirs({ moduleRoot }).slideDeck;
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

/** Reads the manifest in a folder. Each folder in this suite is a workspace root. */
function readManifestIn(folder: string): Promise<Manifest> {
	return readManifest({ workspaceRoot: folder });
}

async function amendManifestIn({
	folder,
	patch,
}: {
	readonly folder: string;
	readonly patch: Partial<Manifest>;
}): Promise<void> {
	await patchManifest({
		workspaceRoot: folder,
		manifest: await readManifestIn(folder),
		changes: patch,
		updatedAt: stageCompletedAt,
	});
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
	 * Builds the stage again with an empty log. A test calls it after its arrange
	 * step normalised the module. Then its assertions see only the log of the
	 * normalisation under test.
	 */
	function freshStage(): void {
		logged = makeStubLogger();
		stage = createSourceNormalisationStage({
			logger: logged.logger,
			confirm,
			modulePrefixes: exampleConfig.naming.modulePrefixes,
		});
	}

	/** The entries that the stage logged at one level. */
	function logsAt(level: LoggedLevel): readonly LoggedEntry[] {
		return loggedAt({ entries: logged.entries, level });
	}

	afterEach(async () => {
		vi.restoreAllMocks();
		await rm(tempDir, { recursive: true, force: true });
	});

	async function writeLecture({
		videoRecording,
		slideDeck,
	}: Pick<LectureSources, "videoRecording" | "slideDeck">): Promise<void> {
		await writeInto(videoRecordingsDir(moduleRoot), videoRecording);
		await writeInto(slideDecksDir(moduleRoot), slideDeck);
	}

	/** Normalises one new lecture and returns the manifest that the stage wrote. */
	async function normaliseNewLecture(): Promise<Manifest> {
		await writeLecture(cellInjurySources);
		await stage.normaliseModule({ moduleRoot });
		return readManifestIn(workspaceRootFor({ moduleRoot, baseName: cellInjuryAsFirst }));
	}

	/** Normalises a module of two lectures. The renumbering tests start from it. */
	async function normaliseTwoLectures(): Promise<void> {
		await writeLecture(cellInjurySources);
		await writeLecture(vaccinationSources);
		await stage.normaliseModule({ moduleRoot });
	}

	/** The names in the two source folders of the module. */
	async function sourceNames(): Promise<{
		readonly videoRecordings: readonly string[];
		readonly slideDecks: readonly string[];
	}> {
		return {
			videoRecordings: await listNames(videoRecordingsDir(moduleRoot)),
			slideDecks: await listNames(slideDecksDir(moduleRoot)),
		};
	}

	/** The names that the stage gives to the source pair of a lecture. */
	function sourcesNamed(baseName: string): {
		readonly videoRecordings: string[];
		readonly slideDecks: string[];
	} {
		return { videoRecordings: [`${baseName}.mp4`], slideDecks: [`${baseName}.pdf`] };
	}

	/**
	 * Runs the normalisation and asserts that it aborts: it throws, logs an error,
	 * and leaves only the given workspaces.
	 *
	 * This helper is the act and the assertion, so each caller puts it in the act
	 * position. Only `expect(...).rejects` handles a rejection. To keep the act and
	 * the assertion apart, a test would have to catch the error by hand.
	 */
	async function expectNormalisationToAbort(workspaces: readonly string[]): Promise<void> {
		await expect(stage.normaliseModule({ moduleRoot })).rejects.toThrow(SourceNormalisationError);

		expect(logsAt("error")).not.toHaveLength(0);
		expect(await listNames(processingDir(moduleRoot))).toEqual(workspaces);
	}

	it("should expose the source-normalisation stage id when created", () => {
		expect(stage.stageId).toBe("source-normalisation");
	});

	it("should assign sequential lecture numbers when video recordings are sorted by date", async () => {
		// The Immunity name writes its date as `13 Oct 2025`, and the Cell Injury name
		// writes its date as `2025-10-10`. So the test shows that the order comes from
		// the date in the name, not from the form of the date.
		await writeLecture({
			...immunitySources,
			videoRecording: "13 Oct 2025 BOD_Immunity to Infection.mp4",
		});
		await writeLecture(cellInjurySources);

		await stage.normaliseModule({ moduleRoot });

		expect(await listNames(processingDir(moduleRoot))).toEqual([
			cellInjuryAsFirst,
			immunityAsSecond,
		]);
		const first = await readManifestIn(
			workspaceRootFor({ moduleRoot, baseName: cellInjuryAsFirst }),
		);
		expect(first).toMatchObject({ lectureNumber: 1, lectureDate: "2025-10-10" });
	});

	it("should rename the video recording and matched slide deck to their base name when normalisation runs", async () => {
		await writeLecture(cellInjurySources);

		await stage.normaliseModule({ moduleRoot });

		expect(await sourceNames()).toEqual(sourcesNamed(cellInjuryAsFirst));
	});

	it("should create a workspace and seed pending stages when a lecture is new", async () => {
		const manifest = await normaliseNewLecture();

		expect(manifest).toMatchObject({
			lectureNumber: 1,
			lectureDate: cellInjurySources.date,
			provisionalTitle: "Cell Injury",
			baseName: cellInjuryAsFirst,
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

	it("should name an existing lecture from its manifest lectureTitle when the title changed after source-normalisation", async () => {
		const retitled = "Lecture 1 - Innate Immune Response - 2025-10-10";
		await writeLecture(cellInjurySources);
		await stage.normaliseModule({ moduleRoot });
		await amendManifestIn({
			folder: workspaceRootFor({ moduleRoot, baseName: cellInjuryAsFirst }),
			patch: { lectureTitle: "Innate Immune Response" },
		});

		await stage.normaliseModule({ moduleRoot });

		expect(await listNames(processingDir(moduleRoot))).toEqual([retitled]);
		expect(await listNames(videoRecordingsDir(moduleRoot))).toEqual([`${retitled}.mp4`]);
	});

	it("should fall back to a bare Lecture N name when the video recording's filename has no descriptive title", async () => {
		const untitled = "Lecture 1 - 2025-10-10";
		await writeLecture({
			videoRecording: `${cellInjurySources.date} Lecture 1.mp4`,
			slideDeck: `${cellInjurySources.date} deck.pdf`,
		});

		await stage.normaliseModule({ moduleRoot });

		expect(await listNames(processingDir(moduleRoot))).toEqual([untitled]);
		const manifest = await readManifestIn(workspaceRootFor({ moduleRoot, baseName: untitled }));
		expect(manifest.provisionalTitle).toBe("");
		expect(manifest.lectureTitle).toBe("");
	});

	it("should log each action to the debug log when normalisation succeeds", async () => {
		await writeLecture(cellInjurySources);

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
				lectureDate: cellInjurySources.date,
				videoName: cellInjurySources.videoRecording,
				slideName: cellInjurySources.slideDeck,
				provisionalTitle: "Cell Injury",
			},
			{
				lectureNumber: 2,
				lectureDate: vaccinationSources.date,
				videoName: vaccinationSources.videoRecording,
				slideName: vaccinationSources.slideDeck,
				provisionalTitle: "Vaccination",
			},
		]);
	});

	it("should ignore dotfiles in the source directories when normalising", async () => {
		await writeLecture(cellInjurySources);
		await writeInto(videoRecordingsDir(moduleRoot), ".DS_Store");
		await writeInto(slideDecksDir(moduleRoot), ".DS_Store");

		await stage.normaliseModule({ moduleRoot });

		expect(logsAt("error")).toHaveLength(0);
		expect(await listNames(processingDir(moduleRoot))).toEqual([cellInjuryAsFirst]);
	});

	describe("broken source rules", () => {
		it.each([
			{
				scenario: "a video has no extractable date",
				setup: async (): Promise<void> => {
					await writeInto(videoRecordingsDir(moduleRoot), "BOD_Cell Injury no date.mp4");
				},
			},
			{
				scenario: "a slide has no extractable date",
				setup: async (): Promise<void> => {
					await writeInto(slideDecksDir(moduleRoot), "BOD_Cell Injury deck no date.pdf");
				},
			},
			{
				scenario: "a video has no matching slide",
				setup: async (): Promise<void> => {
					await writeInto(videoRecordingsDir(moduleRoot), cellInjurySources.videoRecording);
				},
			},
			{
				scenario: "a slide has no matching video",
				setup: async (): Promise<void> => {
					await writeInto(slideDecksDir(moduleRoot), UNMATCHED_SLIDE_DECK);
				},
			},
			{
				scenario: "two videos share a date",
				setup: async (): Promise<void> => {
					await writeInto(videoRecordingsDir(moduleRoot), cellInjurySources.videoRecording);
					await writeInto(
						videoRecordingsDir(moduleRoot),
						`${cellInjurySources.date} BOD_Immunity.mp4`,
					);
					await writeInto(slideDecksDir(moduleRoot), `${cellInjurySources.date} deck.pdf`);
				},
			},
			{
				scenario: "two slides share a date",
				setup: async (): Promise<void> => {
					await writeInto(videoRecordingsDir(moduleRoot), cellInjurySources.videoRecording);
					await writeInto(slideDecksDir(moduleRoot), cellInjurySources.slideDeck);
					await writeInto(slideDecksDir(moduleRoot), `${cellInjurySources.date} Extra deck.pdf`);
				},
			},
		])("should log an error and make no filesystem changes when $scenario", async ({ setup }) => {
			await setup();
			const before = await sourceNames();

			await expectNormalisationToAbort([]);

			expect(await sourceNames()).toEqual(before);
		});

		it("should report every broken rule in a single error when several sources are wrong", async () => {
			await writeInto(videoRecordingsDir(moduleRoot), "BOD_no date.mp4");
			await writeInto(slideDecksDir(moduleRoot), UNMATCHED_SLIDE_DECK);

			const rejection = stage.normaliseModule({ moduleRoot });

			await expect(rejection).rejects.toThrow(/no date.*mp4|Unmatched/s);
		});
	});

	it("should produce no filesystem changes when re-run on already-normalised sources", async () => {
		await writeLecture(cellInjurySources);
		await stage.normaliseModule({ moduleRoot });
		const folder = workspaceRootFor({ moduleRoot, baseName: cellInjuryAsFirst });
		const manifestAfterFirst = await readManifestIn(folder);
		const sourcesAfterFirst = await sourceNames();

		await stage.normaliseModule({ moduleRoot });

		expect(await listNames(processingDir(moduleRoot))).toEqual([cellInjuryAsFirst]);
		expect(await sourceNames()).toEqual(sourcesAfterFirst);
		expect(await readManifestIn(folder)).toEqual(manifestAfterFirst);
	});

	it("should renumber affected lectures when a new lecture is inserted between existing dates", async () => {
		await normaliseTwoLectures();
		await writeLecture(immunitySources);

		await stage.normaliseModule({ moduleRoot });

		expect(await listNames(processingDir(moduleRoot))).toEqual([
			cellInjuryAsFirst,
			immunityAsSecond,
			vaccinationAsThird,
		]);
		const renumbered = await readManifestIn(
			workspaceRootFor({ moduleRoot, baseName: vaccinationAsThird }),
		);
		expect(renumbered.lectureNumber).toBe(3);
		expect(renumbered.baseName).toBe(vaccinationAsThird);
		expect(await listNames(videoRecordingsDir(moduleRoot))).toContain(`${vaccinationAsThird}.mp4`);
	});

	it("should leave an undated file in Final output untouched when normalisation runs", async () => {
		await writeLecture(cellInjurySources);
		await writeInto(finalOutputDir(moduleRoot), "Module handbook.pdf");

		await stage.normaliseModule({ moduleRoot });

		expect(logsAt("error")).toHaveLength(0);
		expect(await listNames(finalOutputDir(moduleRoot))).toEqual(["Module handbook.pdf"]);
	});

	it("should leave a workspace folder untouched when it has no readable manifest", async () => {
		await writeLecture(cellInjurySources);
		await mkdir(workspaceRootFor({ moduleRoot, baseName: "Notes I dropped in here" }), {
			recursive: true,
		});

		await stage.normaliseModule({ moduleRoot });

		expect(confirm).not.toHaveBeenCalled();
		expect(await listNames(processingDir(moduleRoot))).toEqual([
			cellInjuryAsFirst,
			"Notes I dropped in here",
		]);
	});

	describe("interrupted renames", () => {
		it("should restore a temporary source file to its target name when an earlier invocation was interrupted", async () => {
			await writeInto(videoRecordingsDir(moduleRoot), `${cellInjuryAsFirst}.mp4${TEMP_SUFFIX}`);
			await writeInto(slideDecksDir(moduleRoot), `${cellInjuryAsFirst}.pdf${TEMP_SUFFIX}`);

			await stage.normaliseModule({ moduleRoot });

			expect(await sourceNames()).toEqual(sourcesNamed(cellInjuryAsFirst));
			expect(await listNames(processingDir(moduleRoot))).toEqual([cellInjuryAsFirst]);
		});

		it("should restore a temporary workspace folder to its target name when an earlier invocation was interrupted", async () => {
			await normaliseNewLecture();
			const processing = processingDir(moduleRoot);
			await rename(
				join(processing, cellInjuryAsFirst),
				join(processing, `${cellInjuryAsFirst}${TEMP_SUFFIX}`),
			);
			freshStage();

			await stage.normaliseModule({ moduleRoot });

			expect(await listNames(processing)).toEqual([cellInjuryAsFirst]);
			expect(logsAt("error")).toHaveLength(0);
		});

		it("should abort without filesystem changes when a temporary file's target name is taken", async () => {
			await writeInto(videoRecordingsDir(moduleRoot), `${cellInjuryAsFirst}.mp4`);
			await writeInto(videoRecordingsDir(moduleRoot), `${cellInjuryAsFirst}.mp4${TEMP_SUFFIX}`);
			await writeInto(slideDecksDir(moduleRoot), `${cellInjuryAsFirst}.pdf`);

			await expectNormalisationToAbort([]);

			expect(logsAt("error").map((entry) => entry.payload)).toContainEqual(
				expect.objectContaining({
					problems: [expect.stringContaining(`${cellInjuryAsFirst}.mp4${TEMP_SUFFIX}`)],
				}),
			);
			expect(await listNames(videoRecordingsDir(moduleRoot))).toEqual([
				`${cellInjuryAsFirst}.mp4`,
				`${cellInjuryAsFirst}.mp4${TEMP_SUFFIX}`,
			]);
		});
	});

	describe("orphaned workspace handling", () => {
		function promptMessages(): readonly string[] {
			return confirm.mock.calls.map(([args]) => args.message);
		}

		async function removeSourcePair(baseName: string): Promise<void> {
			await rm(join(videoRecordingsDir(moduleRoot), `${baseName}.mp4`));
			await rm(join(slideDecksDir(moduleRoot), `${baseName}.pdf`));
		}

		beforeEach(async () => {
			await normaliseTwoLectures();
			await writeInto(finalOutputDir(moduleRoot), `${cellInjuryAsFirst}.pdf`);
			await writeInto(finalOutputDir(moduleRoot), `${vaccinationAsSecond}.pdf`);
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
			{ detail: "the date", fragment: cellInjurySources.date },
		])("should show $detail in the orphaned workspace prompt when a lecture's sources are gone", async ({
			fragment,
		}) => {
			await removeSourcePair(cellInjuryAsFirst);

			await stage.normaliseModule({ moduleRoot });

			expect(promptMessages()).toContainEqual(expect.stringContaining(fragment));
		});

		it("should quote no figure in the orphaned workspace prompt when a lecture's sources are gone", async () => {
			// The cost of a lecture is the sum of its stages, and nothing adds stage
			// costs together (NFR-2.2). `cost-report` gives the cost of each stage
			// while the workspace exists.
			await removeSourcePair(cellInjuryAsFirst);

			await stage.normaliseModule({ moduleRoot });

			for (const message of promptMessages()) {
				expect(message).not.toContain("£");
			}
		});

		it("should delete the workspace and its Final output PDF and renumber the remainder when an orphaned workspace is approved", async () => {
			await removeSourcePair(cellInjuryAsFirst);

			await stage.normaliseModule({ moduleRoot });

			expect(await listNames(processingDir(moduleRoot))).toEqual([vaccinationAsFirst]);
			expect(await listNames(finalOutputDir(moduleRoot))).toEqual([`${vaccinationAsFirst}.pdf`]);
			expect(await listNames(videoRecordingsDir(moduleRoot))).toEqual([
				`${vaccinationAsFirst}.mp4`,
			]);
		});

		it("should take a final confirmation and delete every orphaned workspace when several are all approved", async () => {
			await removeSourcePair(cellInjuryAsFirst);
			await removeSourcePair(vaccinationAsSecond);

			await stage.normaliseModule({ moduleRoot });

			expect(confirm).toHaveBeenCalledTimes(3);
			expect(await listNames(processingDir(moduleRoot))).toEqual([]);
			expect(await listNames(finalOutputDir(moduleRoot))).toEqual([]);
		});

		it("should describe an orphaned workspace as untitled when its manifest carries no title", async () => {
			await amendManifestIn({
				folder: workspaceRootFor({ moduleRoot, baseName: cellInjuryAsFirst }),
				patch: { lectureTitle: "" },
			});
			await removeSourcePair(cellInjuryAsFirst);

			await stage.normaliseModule({ moduleRoot });

			expect(promptMessages()).toContainEqual(expect.stringContaining("(untitled)"));
		});

		it("should delete an orphaned workspace when it has no final output PDF", async () => {
			await rm(join(finalOutputDir(moduleRoot), `${cellInjuryAsFirst}.pdf`));
			await removeSourcePair(cellInjuryAsFirst);

			await stage.normaliseModule({ moduleRoot });

			expect(await listNames(processingDir(moduleRoot))).toEqual([vaccinationAsFirst]);
		});

		it("should log the prior number, title, and date when an orphaned workspace is deleted", async () => {
			await removeSourcePair(cellInjuryAsFirst);

			await stage.normaliseModule({ moduleRoot });

			expect(logsAt("info").map((entry) => entry.payload)).toContainEqual(
				expect.objectContaining({
					lectureNumber: 1,
					lectureTitle: "Cell Injury",
					lectureDate: cellInjurySources.date,
				}),
			);
		});

		it.each([
			{ scenario: "an orphaned workspace deletion is declined", responses: [false] },
			{ scenario: "the final confirmation is declined", responses: [true, false] },
		])("should abort without filesystem changes when $scenario", async ({ responses }) => {
			await removeSourcePair(cellInjuryAsFirst);
			for (const response of responses) {
				confirm.mockResolvedValueOnce(response);
			}

			await expectNormalisationToAbort([cellInjuryAsFirst, vaccinationAsSecond]);

			expect(await listNames(finalOutputDir(moduleRoot))).toEqual([
				`${cellInjuryAsFirst}.pdf`,
				`${vaccinationAsSecond}.pdf`,
			]);
			expect(await listNames(videoRecordingsDir(moduleRoot))).toEqual([
				`${vaccinationAsSecond}.mp4`,
			]);
		});
	});

	it("should rename the Final output PDF when a lecture is renumbered", async () => {
		await normaliseTwoLectures();
		await writeInto(finalOutputDir(moduleRoot), `${vaccinationAsSecond}.pdf`);
		await writeLecture(immunitySources);

		await stage.normaliseModule({ moduleRoot });

		expect(await listNames(finalOutputDir(moduleRoot))).toEqual([`${vaccinationAsThird}.pdf`]);
	});
});
