import { join, relative } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import {
	getDocument,
	type PDFDocumentProxy,
	VerbosityLevel,
} from "pdfjs-dist/legacy/build/pdf.mjs";
// jscpd:ignore-start -- these two imports match the imports of audio-extraction.ts. Each stage names the stage types and the error helpers that its own code uses, so no shared module can remove the match.
import type { StageContext, StageResult } from "../../../types/pipeline.js";
import { errorMessage, NamedError } from "../../../utils/errors.js";
// jscpd:ignore-end
import { writeFileAtomic } from "../../../utils/files.js";
import { slideFileName, stageDirectoryPaths } from "../../layout.js";
import type { SourceFileInput, SourceFileStageParts } from "../pipeline-stage.js";

/**
 * The error when the slide deck of the lecture is missing, not unique, or not a
 * readable PDF (technical-design.md §5, `render-slides`).
 */
export class RenderSlidesError extends NamedError {}

/** The output of `render-slides`. */
export type RenderSlidesOutput = {
	/** The absolute path of each slide image, in deck order. */
	readonly slideImagePaths: readonly string[];
};

const STAGE_ID = "render-slides";
const SLIDE_IMAGE_EXTENSION = "png";
const POINTS_PER_INCH = 72;
const DOTS_PER_INCH = 150;

/**
 * Opens the slide deck as a PDF.
 *
 * @param slideDeckPath - The absolute path of the slide deck.
 * @returns The opened PDF.
 * @throws {RenderSlidesError} If the slide deck is not a readable PDF.
 */
async function openSlideDeck(slideDeckPath: string): Promise<PDFDocumentProxy> {
	try {
		return await getDocument({ url: slideDeckPath, verbosity: VerbosityLevel.ERRORS }).promise;
	} catch (error: unknown) {
		throw new RenderSlidesError(
			`The slide deck at ${slideDeckPath} is not a readable PDF (${errorMessage(error)})`,
		);
	}
}

/**
 * Renders each page of the slide deck as one PNG image at 150 DPI, in
 * `Slide images/`.
 *
 * @param args - The input and the stage context.
 * @param args.input - The slide deck.
 * @param args.context - The stage context.
 * @returns The paths of the images, a `null` cost, and the files written.
 */
async function renderSlides({
	input,
	context,
}: {
	readonly input: SourceFileInput;
	readonly context: StageContext;
}): Promise<StageResult<RenderSlidesOutput>> {
	const [slideImagesDir = context.workspaceRoot] = stageDirectoryPaths({
		workspaceRoot: context.workspaceRoot,
		stageId: STAGE_ID,
	});
	const deck = await openSlideDeck(input.sourceFilePath);
	const slideImagePaths: string[] = [];
	for (let slideNumber = 1; slideNumber <= deck.numPages; slideNumber++) {
		const page = await deck.getPage(slideNumber);
		const viewport = page.getViewport({ scale: DOTS_PER_INCH / POINTS_PER_INCH });
		const canvas = createCanvas(viewport.width, viewport.height);
		// @ts-expect-error -- pdfjs-dist types the canvas as a browser HTMLCanvasElement. In Node, pdfjs-dist renders to an @napi-rs/canvas canvas, which has no DOM type.
		await page.render({ canvas, viewport }).promise;
		const path = join(
			slideImagesDir,
			slideFileName({ slideNumber, extension: SLIDE_IMAGE_EXTENSION }),
		);
		await writeFileAtomic({ path, content: canvas.toBuffer("image/png") });
		slideImagePaths.push(path);
	}
	// The stage makes no billable call, so it records no cost.
	return {
		output: { slideImagePaths },
		cost: null,
		filesWritten: slideImagePaths.map((path) => relative(context.workspaceRoot, path)),
	};
}

/**
 * The parts of the `render-slides` stage. It renders each page of the slide deck
 * as one image (technical-design.md §5, `render-slides`).
 */
export const renderSlidesParts: SourceFileStageParts<RenderSlidesOutput> = {
	stageId: STAGE_ID,
	source: "slideDeck",
	fail: (message) => new RenderSlidesError(message),
	run: renderSlides,
};
