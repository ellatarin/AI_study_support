import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunManifest } from "../../types/pipeline.js";
import type { LectureSources, LoggedEntry, LoggedLevel } from "../fixtures.js";
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
} from "../fixtures.js";
import { moduleDirs, workspaceRootFor } from "../layout.js";
import { patchManifest, readManifest } from "../manifest.js";
import {
	createSourceNormalisationStage,
	SourceNormalisationError,
} from "./source-normalisation.js";

// The raw sources and the canonical names Stage 0 gives them are fixtures. They
// are still written out rather than derived — this suite tests the naming rule,
// so deriving them would assert it against itself — but they are written out in
// one place, because the unit suite over the resolution rules asserts the same
// names without a directory tree and the two must not disagree. The directories
// they live in are the layout's business, not this suite's, and come from
// moduleDirs.
//
// The suffix below is written out for the same reason: these tests arrange the
// on-disk state a crash mid-rename leaves, so taking it from the stage would
// assert the convention against itself. It stays here because nothing else
// arranges that state.
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

/** This suite's folders are workspace roots; naming that once keeps the reads short. */
function readManifestIn(folder: string): Promise<RunManifest> {
	return readManifest({ workspaceRoot: folder });
}

async function amendManifestIn({
	folder,
	patch,
}: {
	readonly folder: string;
	readonly patch: Partial<RunManifest>;
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
	 * Rebuilds the stage against an empty log. Called again by a test whose arrange
	 * step already normalised the module, so its assertions see only what the run
	 * under test logged.
	 */
	function freshStage(): void {
		logged = makeStubLogger();
		stage = createSourceNormalisationStage({
			logger: logged.logger,
			confirm,
			modulePrefixes: exampleConfig.naming.modulePrefixes,
		});
	}

	/** What the stage logged at one level. */
	function logsAt(level: LoggedLevel): readonly LoggedEntry[] {
		return loggedAt({ entries: logged.entries, level });
	}

	afterEach(async () => {
		vi.restoreAllMocks();
		await rm(tempDir, { recursive: true, force: true });
	});

	async function writeLecture({
		video,
		slide,
	}: Pick<LectureSources, "video" | "slide">): Promise<void> {
		await writeInto(videoDir(moduleRoot), video);
		await writeInto(slideDir(moduleRoot), slide);
	}

	/** Normalises a single new lecture and returns the manifest Stage 0 wrote. */
	async function normaliseNewLecture(): Promise<RunManifest> {
		await writeLecture(cellInjurySources);
		await stage.normaliseModule({ moduleRoot });
		return readManifestIn(workspaceRootFor({ moduleRoot, folderName: cellInjuryAsFirst }));
	}

	/** Normalises a two-lecture module, the starting point for renumbering cases. */
	async function normaliseTwoLectures(): Promise<void> {
		await writeLecture(cellInjurySources);
		await writeLecture(vaccinationSources);
		await stage.normaliseModule({ moduleRoot });
	}

	/** The module's raw sources: what stands in the video and slide directories. */
	async function sourceNames(): Promise<{
		readonly videos: readonly string[];
		readonly slides: readonly string[];
	}> {
		return {
			videos: await listNames(videoDir(moduleRoot)),
			slides: await listNames(slideDir(moduleRoot)),
		};
	}

	/** The pair of names Stage 0 renames a lecture's sources to. */
	function sourcesNamed(baseName: string): {
		readonly videos: string[];
		readonly slides: string[];
	} {
		return { videos: [`${baseName}.mp4`], slides: [`${baseName}.pdf`] };
	}

	/**
	 * Runs normalisation and asserts that it aborts: it throws, logs the failure,
	 * and leaves exactly the given workspaces behind.
	 *
	 * This is the act as well as the assertion, which is why every caller puts it
	 * in the act position. A rejection cannot be acted on and then asserted
	 * separately — `expect(...).rejects` is what handles it — so splitting the two
	 * apart would mean catching the error by hand to re-assert it later.
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
		// Immunity's date written the other way round, so the ordering is decided by
		// the date the name carries rather than by the form it is written in.
		await writeLecture({ ...immunitySources, video: "13 Oct 2025 BOD_Immunity to Infection.mp4" });
		await writeLecture(cellInjurySources);

		await stage.normaliseModule({ moduleRoot });

		expect(await listNames(processingDir(moduleRoot))).toEqual([
			cellInjuryAsFirst,
			immunityAsSecond,
		]);
		const first = await readManifestIn(
			workspaceRootFor({ moduleRoot, folderName: cellInjuryAsFirst }),
		);
		expect(first).toMatchObject({ lectureNumber: 1, lectureDate: "2025-10-10" });
	});

	it("should rename the source video and matched slide to canonical names when normalisation runs", async () => {
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
			workspaceFolderName: cellInjuryAsFirst,
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
		const retitled = "Lecture 1 - Innate Immune Response - 2025-10-10";
		await writeLecture(cellInjurySources);
		await stage.normaliseModule({ moduleRoot });
		await amendManifestIn({
			folder: workspaceRootFor({ moduleRoot, folderName: cellInjuryAsFirst }),
			patch: { lectureTitle: "Innate Immune Response" },
		});

		await stage.normaliseModule({ moduleRoot });

		expect(await listNames(processingDir(moduleRoot))).toEqual([retitled]);
		expect(await listNames(videoDir(moduleRoot))).toEqual([`${retitled}.mp4`]);
	});

	it("should fall back to a bare Lecture N name when the video filename has no descriptive title", async () => {
		const untitled = "Lecture 1 - 2025-10-10";
		await writeLecture({
			video: `${cellInjurySources.date} Lecture 1.mp4`,
			slide: `${cellInjurySources.date} deck.pdf`,
		});

		await stage.normaliseModule({ moduleRoot });

		expect(await listNames(processingDir(moduleRoot))).toEqual([untitled]);
		const manifest = await readManifestIn(workspaceRootFor({ moduleRoot, folderName: untitled }));
		expect(manifest.provisionalTitle).toBe("");
		expect(manifest.lectureTitle).toBe("");
	});

	it("should record actions on the run logger when normalisation succeeds", async () => {
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
				videoName: cellInjurySources.video,
				slideName: cellInjurySources.slide,
				provisionalTitle: "Cell Injury",
			},
			{
				lectureNumber: 2,
				lectureDate: vaccinationSources.date,
				videoName: vaccinationSources.video,
				slideName: vaccinationSources.slide,
				provisionalTitle: "Vaccination",
			},
		]);
	});

	it("should ignore dotfiles in the source directories when normalising", async () => {
		await writeLecture(cellInjurySources);
		await writeInto(videoDir(moduleRoot), ".DS_Store");
		await writeInto(slideDir(moduleRoot), ".DS_Store");

		await stage.normaliseModule({ moduleRoot });

		expect(logsAt("error")).toHaveLength(0);
		expect(await listNames(processingDir(moduleRoot))).toEqual([cellInjuryAsFirst]);
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
					await writeInto(videoDir(moduleRoot), cellInjurySources.video);
				},
			},
			{
				scenario: "a slide has no matching video",
				setup: async (): Promise<void> => {
					await writeInto(slideDir(moduleRoot), `${cellInjurySources.date} Orphan deck.pdf`);
				},
			},
			{
				scenario: "two videos share a date",
				setup: async (): Promise<void> => {
					await writeInto(videoDir(moduleRoot), cellInjurySources.video);
					await writeInto(videoDir(moduleRoot), `${cellInjurySources.date} BOD_Immunity.mp4`);
					await writeInto(slideDir(moduleRoot), `${cellInjurySources.date} deck.pdf`);
				},
			},
			{
				scenario: "two slides share a date",
				setup: async (): Promise<void> => {
					await writeInto(videoDir(moduleRoot), cellInjurySources.video);
					await writeInto(slideDir(moduleRoot), cellInjurySources.slide);
					await writeInto(slideDir(moduleRoot), `${cellInjurySources.date} Extra deck.pdf`);
				},
			},
		])("should log an error and make no filesystem changes when $scenario", async ({ setup }) => {
			await setup();
			const before = await sourceNames();

			await expectNormalisationToAbort([]);

			expect(await sourceNames()).toEqual(before);
		});

		it("should report every anomaly in a single error when several sources are wrong", async () => {
			await writeInto(videoDir(moduleRoot), "BOD_no date.mp4");
			await writeInto(slideDir(moduleRoot), `${cellInjurySources.date} Orphan deck.pdf`);

			const rejection = stage.normaliseModule({ moduleRoot });

			await expect(rejection).rejects.toThrow(/no date.*mp4|Orphan/s);
		});
	});

	it("should produce no filesystem changes when re-run on already-normalised sources", async () => {
		await writeLecture(cellInjurySources);
		await stage.normaliseModule({ moduleRoot });
		const folder = workspaceRootFor({ moduleRoot, folderName: cellInjuryAsFirst });
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
			workspaceRootFor({ moduleRoot, folderName: vaccinationAsThird }),
		);
		expect(renumbered.lectureNumber).toBe(3);
		expect(renumbered.workspaceFolderName).toBe(vaccinationAsThird);
		expect(await listNames(videoDir(moduleRoot))).toContain(`${vaccinationAsThird}.mp4`);
	});

	it("should leave an undateable file in Final output untouched when normalisation runs", async () => {
		await writeLecture(cellInjurySources);
		await writeInto(finalOutputDir(moduleRoot), "Module handbook.pdf");

		await stage.normaliseModule({ moduleRoot });

		expect(logsAt("error")).toHaveLength(0);
		expect(await listNames(finalOutputDir(moduleRoot))).toEqual(["Module handbook.pdf"]);
	});

	it("should leave a workspace folder untouched when it has no readable manifest", async () => {
		await writeLecture(cellInjurySources);
		await mkdir(workspaceRootFor({ moduleRoot, folderName: "Notes I dropped in here" }), {
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
		it("should restore a temporary source file to its target name when a previous run was interrupted", async () => {
			await writeInto(videoDir(moduleRoot), `${cellInjuryAsFirst}.mp4${TEMP_SUFFIX}`);
			await writeInto(slideDir(moduleRoot), `${cellInjuryAsFirst}.pdf${TEMP_SUFFIX}`);

			await stage.normaliseModule({ moduleRoot });

			expect(await sourceNames()).toEqual(sourcesNamed(cellInjuryAsFirst));
			expect(await listNames(processingDir(moduleRoot))).toEqual([cellInjuryAsFirst]);
		});

		it("should restore a temporary workspace folder to its target name when a previous run was interrupted", async () => {
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
			await writeInto(videoDir(moduleRoot), `${cellInjuryAsFirst}.mp4`);
			await writeInto(videoDir(moduleRoot), `${cellInjuryAsFirst}.mp4${TEMP_SUFFIX}`);
			await writeInto(slideDir(moduleRoot), `${cellInjuryAsFirst}.pdf`);

			await expectNormalisationToAbort([]);

			expect(logsAt("error").map((entry) => entry.payload)).toContainEqual(
				expect.objectContaining({
					anomalies: [expect.stringContaining(`${cellInjuryAsFirst}.mp4${TEMP_SUFFIX}`)],
				}),
			);
			expect(await listNames(videoDir(moduleRoot))).toEqual([
				`${cellInjuryAsFirst}.mp4`,
				`${cellInjuryAsFirst}.mp4${TEMP_SUFFIX}`,
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
		])("should show $detail in the orphan prompt when a lecture's sources are gone", async ({
			fragment,
		}) => {
			await removeSourcePair(cellInjuryAsFirst);

			await stage.normaliseModule({ moduleRoot });

			expect(promptMessages()).toContainEqual(expect.stringContaining(fragment));
		});

		it("should quote no figure in the orphan prompt when a lecture's sources are gone", async () => {
			// What a lecture has cost is the sum of its stages, and stage costs are
			// not summed (NFR-2.2). `cost-report` still has the per-stage figures for
			// as long as the workspace stands.
			await removeSourcePair(cellInjuryAsFirst);

			await stage.normaliseModule({ moduleRoot });

			for (const message of promptMessages()) {
				expect(message).not.toContain("£");
			}
		});

		it("should delete the workspace and its Final output PDF and renumber the remainder when an orphan is approved", async () => {
			await removeSourcePair(cellInjuryAsFirst);

			await stage.normaliseModule({ moduleRoot });

			expect(await listNames(processingDir(moduleRoot))).toEqual([vaccinationAsFirst]);
			expect(await listNames(finalOutputDir(moduleRoot))).toEqual([`${vaccinationAsFirst}.pdf`]);
			expect(await listNames(videoDir(moduleRoot))).toEqual([`${vaccinationAsFirst}.mp4`]);
		});

		it("should take a final confirmation and delete every orphan when several are all approved", async () => {
			await removeSourcePair(cellInjuryAsFirst);
			await removeSourcePair(vaccinationAsSecond);

			await stage.normaliseModule({ moduleRoot });

			expect(confirm).toHaveBeenCalledTimes(3);
			expect(await listNames(processingDir(moduleRoot))).toEqual([]);
			expect(await listNames(finalOutputDir(moduleRoot))).toEqual([]);
		});

		it("should describe an orphan as untitled when its manifest carries no title", async () => {
			await amendManifestIn({
				folder: workspaceRootFor({ moduleRoot, folderName: cellInjuryAsFirst }),
				patch: { lectureTitle: "" },
			});
			await removeSourcePair(cellInjuryAsFirst);

			await stage.normaliseModule({ moduleRoot });

			expect(promptMessages()).toContainEqual(expect.stringContaining("(untitled)"));
		});

		it("should delete the workspace when an orphan has no final output PDF", async () => {
			await rm(join(finalOutputDir(moduleRoot), `${cellInjuryAsFirst}.pdf`));
			await removeSourcePair(cellInjuryAsFirst);

			await stage.normaliseModule({ moduleRoot });

			expect(await listNames(processingDir(moduleRoot))).toEqual([vaccinationAsFirst]);
		});

		it("should log the prior number, title, and date when an orphan is deleted", async () => {
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
			{ scenario: "an orphan deletion is declined", responses: [false] },
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
			expect(await listNames(videoDir(moduleRoot))).toEqual([`${vaccinationAsSecond}.mp4`]);
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
