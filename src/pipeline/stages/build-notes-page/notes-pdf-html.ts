/**
 * The HTML that Chrome prints as the Notes PDF of one lecture (CONTEXT.md,
 * "Notes PDF"). It shows the Notes page view only.
 */

import { readFile } from "node:fs/promises";
import { FIRST_PAGE_VIEW, type NotesPdfSettings } from "../../../types/pipeline.js";
import type { RelocatedSlide } from "../slide-relocations.js";
import type { SlideReading } from "../slides.js";
import { type NotesPageContent, topicSectionsHtml } from "./notes-page-html.js";
import { notesPdfStyle } from "./notes-pdf-style.js";
import {
	entryOf,
	escapeHtml,
	lectureHeadingHtml,
	paragraphsWithSlides,
	slideFigureParts,
	splitParagraphAtSlides,
	textHtml,
} from "./notes-text-html.js";

/** The content of the Notes PDF: the titles, the notes text and the slides of one lecture. */
export type NotesPdfContent = Pick<
	NotesPageContent,
	"lectureTitle" | "lectureDate" | "topics" | "slideRelocations" | "slideReadings"
>;

/** Gives the URL of the image of a slide, from its slide number. */
type SlideImageUrl = (slideNumber: number) => string;

/**
 * Reads a PNG image as a data URL. The PDF HTML holds each slide image this way,
 * so Chrome loads no file and the stage writes no temporary page.
 *
 * @param path - The path of the PNG file.
 * @returns The data URL.
 */
export async function readPngDataUrl(path: string): Promise<string> {
	return `data:image/png;base64,${await readFile(path, "base64")}`;
}

/** The slide readings of the notes, and the source of each slide image. */
type SlideSources = {
	readonly readings: readonly SlideReading[];
	readonly slideImageUrl: SlideImageUrl;
};

/**
 * Gives one slide as a figure: the slide image, then its label and its caption
 * under the image.
 *
 * @param args - The slide, the slide readings and the source of each slide image.
 * @param args.slide - The slide.
 * @param args.readings - The slide readings of the notes.
 * @param args.slideImageUrl - Gives the URL of the image of a slide.
 * @returns The HTML of the figure.
 */
function figureHtml({
	slide,
	readings,
	slideImageUrl,
}: SlideSources & { readonly slide: RelocatedSlide }): string {
	const { captionHtml, imageHtml } = slideFigureParts({
		slide,
		readings,
		imageUrl: slideImageUrl(slide.slideNumber),
	});
	return `<figure>
${imageHtml}
<figcaption>${captionHtml}</figcaption>
</figure>`;
}

/**
 * Gives one paragraph as blocks of text with each slide between them. The
 * paragraph stops at the point of a slide, and continues under the slide. A
 * slide at the end of the paragraph comes after its text.
 *
 * @param args - The paragraph, its slides, the slide readings and the source of each slide image.
 * @param args.paragraph - The text of the paragraph.
 * @param args.slides - The slides of the paragraph, in deck order.
 * @param args.readings - The slide readings of the notes.
 * @param args.slideImageUrl - Gives the URL of the image of a slide.
 * @returns The HTML of the blocks.
 */
function paragraphBlocksHtml({
	readings,
	slideImageUrl,
	...paragraphSlides
}: SlideSources & {
	readonly paragraph: string;
	readonly slides: readonly RelocatedSlide[];
}): string {
	const { opening, parts, slidesAtEnd } = splitParagraphAtSlides(paragraphSlides);
	const slideHtml = (slide: RelocatedSlide): string =>
		figureHtml({ slide, readings, slideImageUrl });
	return [
		`<p>${textHtml(opening)}</p>`,
		...parts.flatMap(({ slide, text }) => [slideHtml(slide), `<p>${textHtml(text)}</p>`]),
		...slidesAtEnd.map(slideHtml),
	].join("\n");
}

/**
 * Gives the HTML that Chrome prints as the Notes PDF.
 *
 * @param args - The content, the page settings and the source of each slide image.
 * @param args.content - The content of the PDF.
 * @param args.settings - The page settings, from `finalOutput.pdf`.
 * @param args.slideImageUrl - Gives the URL of the image of a slide, from its slide number.
 * @returns The whole page, as one HTML text.
 */
export function notesPdfHtml({
	content,
	settings,
	slideImageUrl,
}: {
	readonly content: NotesPdfContent;
	readonly settings: NotesPdfSettings;
	readonly slideImageUrl: SlideImageUrl;
}): string {
	const sections = topicSectionsHtml({
		topics: content.topics,
		view: FIRST_PAGE_VIEW,
		subtopicBody: ({ subtopicId }) => {
			const relocation = entryOf({ entries: content.slideRelocations, subtopicId });
			return paragraphsWithSlides({
				paragraphs: relocation?.paragraphs ?? [],
				slides: relocation?.slides ?? [],
			})
				.map((paragraphSlides) =>
					paragraphBlocksHtml({
						...paragraphSlides,
						readings: content.slideReadings,
						slideImageUrl,
					}),
				)
				.join("\n");
		},
	});
	return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(content.lectureTitle)}</title>
<style>${notesPdfStyle(settings)}</style>
</head>
<body>
<header>
${lectureHeadingHtml(content)}
</header>
<main>
${sections}
</main>
</body>
</html>
`;
}
