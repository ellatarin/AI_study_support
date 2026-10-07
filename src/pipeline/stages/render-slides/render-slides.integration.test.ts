import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StageResult } from "../../../types/pipeline.js";
import {
	captureError,
	driveStage,
	makeStageContext,
	makeStubLogger,
	makeWorkspaceTree,
	testLecture,
} from "../../fixtures.js";
import { moduleDirs, stageDirectoryPaths } from "../../layout.js";
import { createSourceFileStage } from "../pipeline-stage.js";
import type { RenderSlidesOutput } from "./render-slides.js";
import { RenderSlidesError, renderSlidesParts } from "./render-slides.js";

/** The page size of the test slide deck, in PDF points: 10 by 7.5 inches. */
const PAGE_WIDTH_POINTS = 720;
const PAGE_HEIGHT_POINTS = 540;

/**
 * Writes a PDF of blank pages as plain text, so the suite needs no binary
 * fixture and no PDF library.
 */
function blankPagesPdf(pageCount: number): string {
	const pages = Array.from(
		{ length: pageCount },
		() =>
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(PAGE_WIDTH_POINTS)} ${String(PAGE_HEIGHT_POINTS)}] >>`,
	);
	const kids = pages.map((_, index) => `${String(index + 3)} 0 R`).join(" ");
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		`<< /Type /Pages /Kids [${kids}] /Count ${String(pageCount)} >>`,
		...pages,
	];
	let body = "%PDF-1.4\n";
	const offsets: number[] = [];
	for (const [index, object] of objects.entries()) {
		offsets.push(body.length);
		body += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
	}
	const xrefOffset = body.length;
	const entries = offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`);
	return `${body}xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n${entries.join("")}trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xrefOffset)}\n%%EOF\n`;
}

describe("createRenderSlidesStage", () => {
	let moduleRoot: string;
	let workspaceRoot: string;
	let slideDeckPath: string;

	const writeSlideDeck = (pageCount: number): Promise<void> =>
		writeFile(slideDeckPath, blankPagesPdf(pageCount));

	const renderSlides = (): Promise<StageResult<RenderSlidesOutput>> =>
		driveStage({
			stage: createSourceFileStage({ logger: makeStubLogger().logger, ...renderSlidesParts }),
			context: makeStageContext({ workspaceRoot }),
		});

	beforeEach(async () => {
		({ moduleRoot, workspaceRoot } = await makeWorkspaceTree({ prefix: "render-slides-" }));
		const slideDecksDir = moduleDirs({ moduleRoot }).slideDeck;
		await mkdir(slideDecksDir, { recursive: true });
		slideDeckPath = join(slideDecksDir, testLecture.slideDeckFile);
	});

	afterEach(async () => {
		await rm(moduleRoot, { recursive: true, force: true });
	});

	it("should write one image for each page, numbered from 1 in deck order, when the stage completes", async () => {
		await writeSlideDeck(3);

		await renderSlides();

		const [slideImagesDir] = stageDirectoryPaths({ workspaceRoot, stageId: "render-slides" });
		expect(await readdir(slideImagesDir ?? "")).toStrictEqual([
			"slide-001.png",
			"slide-002.png",
			"slide-003.png",
		]);
	});

	it("should render each page at 150 DPI when the stage completes", async () => {
		await writeSlideDeck(1);

		const result = await renderSlides();

		const [slideImagePath] = result.output.slideImagePaths;
		const { width, height } = await sharp(slideImagePath).metadata();
		// 720 by 540 points is 10 by 7.5 inches, so 1500 by 1125 pixels at 150 DPI.
		expect({ width, height }).toStrictEqual({ width: 1500, height: 1125 });
	});

	it("should record no cost when the stage completes", async () => {
		await writeSlideDeck(1);

		const result = await renderSlides();

		expect(result.cost).toBeNull();
	});

	it.each([
		{ problem: "is missing", arrange: async (): Promise<void> => {} },
		{
			problem: "is not a readable PDF",
			arrange: (): Promise<void> => writeFile(slideDeckPath, "not a PDF"),
		},
	])("should fail naming the file when the slide deck $problem", async ({ arrange }) => {
		await arrange();

		const error = await captureError(renderSlides());

		expect(error).toBeInstanceOf(RenderSlidesError);
		expect(error.message).toContain(testLecture.baseName);
	});
});
