import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getDocument, OPS, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NotesPdfSettings } from "../../../types/pipeline.js";
import {
	exampleConfig,
	makeSlidePng,
	makeTempDir,
	slideReadingReply,
	testLecture,
} from "../../fixtures.js";
import type { RelocatedSlide } from "../slide-relocations.js";
import type { SlideReading } from "../slides.js";
import type { TopicWithSubtopics } from "../structured-transcript.js";
import { type NotesPdfContent, notesPdfHtml, readPngDataUrl } from "./notes-pdf-html.js";
import { printNotesPdf } from "./print-notes-pdf.js";

/** The time that one print with Chrome can take, with a margin. */
const PRINT_TIMEOUT_MS = 30_000;

/**
 * Gives a length in millimetres as points, at 72 points to the inch.
 *
 * @param millimetres - The length, in millimetres.
 * @returns The length, in points.
 */
const mmToPoints = (millimetres: number): number => (millimetres / 25.4) * 72;

/** The size of an A4 page: 210 mm by 297 mm. */
const A4_POINTS = { width: mmToPoints(210), height: mmToPoints(297) };

/** A box on a page, in points from the top left corner of the page. */
type PageBox = {
	readonly left: number;
	readonly right: number;
	readonly top: number;
	readonly bottom: number;
};

/** One line of text on a page. */
type PdfLine = PageBox & { readonly text: string; readonly fontSize: number };

/** One page of a printed PDF, as a reader sees it. */
type PdfPageLayout = {
	readonly width: number;
	readonly height: number;
	/** The lines of text, from the top of the page down. */
	readonly lines: readonly PdfLine[];
	/** The box of each image, in the order that the page draws them. */
	readonly images: readonly PageBox[];
};

/** A transform of PDF user space: `[a, b, c, d, e, f]`. */
type Transform = readonly [number, number, number, number, number, number];

const IDENTITY: Transform = [1, 0, 0, 1, 0, 0];

/**
 * Gives the transform that applies `inner`, then `outer`.
 *
 * @param args - The two transforms.
 * @param args.outer - The current transform.
 * @param args.inner - The transform that the page adds.
 * @returns The product.
 */
function multiply({
	outer,
	inner,
}: {
	readonly outer: Transform;
	readonly inner: Transform;
}): Transform {
	const [a, b, c, d, e, f] = outer;
	const [ia, ib, ic, id, ie, iF] = inner;
	return [
		ia * a + ib * c,
		ia * b + ib * d,
		ic * a + id * c,
		ic * b + id * d,
		ie * a + iF * c + e,
		ie * b + iF * d + f,
	];
}

/**
 * Reads the box of each image that a page draws. An image fills the unit square
 * of the transform at the time that the page draws it.
 *
 * @param args - The page, and its height.
 * @param args.page - The page of pdfjs.
 * @param args.height - The height of the page, in points.
 * @returns The box of each image.
 */
async function readImageBoxes({
	page,
	height,
}: {
	readonly page: Awaited<ReturnType<Awaited<ReturnType<typeof getDocument>["promise"]>["getPage"]>>;
	readonly height: number;
}): Promise<readonly PageBox[]> {
	const { fnArray, argsArray } = await page.getOperatorList();
	const saved: Transform[] = [];
	let current = IDENTITY;
	const boxes: PageBox[] = [];
	for (const [index, operator] of fnArray.entries()) {
		if (operator === OPS.save) {
			saved.push(current);
		} else if (operator === OPS.restore) {
			current = saved.pop() ?? IDENTITY;
		} else if (operator === OPS.transform) {
			current = multiply({ outer: current, inner: argsArray[index] as Transform });
		} else if (operator === OPS.paintImageXObject) {
			const [a, , , d, e, f] = current;
			boxes.push({ left: e, right: e + a, top: height - (f + d), bottom: height - f });
		}
	}
	return boxes;
}

/** One piece of text that pdfjs reads from a page. */
type TextPiece = { readonly str: string; readonly transform: Transform; readonly width: number };

/**
 * Joins the pieces of text of a page into lines. Pieces on one baseline are one
 * line.
 *
 * @param args - The pieces, and the height of the page.
 * @param args.pieces - The pieces of text.
 * @param args.height - The height of the page, in points.
 * @returns The lines, from the top of the page down.
 */
function joinLines({
	pieces,
	height,
}: {
	readonly pieces: readonly TextPiece[];
	readonly height: number;
}): readonly PdfLine[] {
	const byBaseline = new Map<number, TextPiece[]>();
	for (const piece of pieces.filter(({ str }) => str.trim() !== "")) {
		const baseline = Math.round(piece.transform[5]);
		byBaseline.set(baseline, [...(byBaseline.get(baseline) ?? []), piece]);
	}
	return [...byBaseline.entries()]
		.sort(([first], [second]) => second - first)
		.map(([baseline, linePieces]) => {
			const sorted = [...linePieces].sort(
				(first, second) => first.transform[4] - second.transform[4],
			);
			const fontSize = Math.max(...sorted.map(({ transform }) => Math.abs(transform[3])));
			return {
				text: sorted
					.map(({ str }) => str.trim())
					.join(" ")
					.replace(/\s+/gu, " "),
				left: Math.min(...sorted.map(({ transform }) => transform[4])),
				right: Math.max(...sorted.map(({ transform, width }) => transform[4] + width)),
				top: height - baseline - fontSize,
				bottom: height - baseline,
				fontSize,
			};
		});
}

/**
 * Reads the layout of each page of a PDF.
 *
 * @param path - The path of the PDF.
 * @returns The layout of each page, in page order.
 */
async function readPdfLayout(path: string): Promise<readonly PdfPageLayout[]> {
	const loading = getDocument({ url: path, verbosity: VerbosityLevel.ERRORS });
	const pdf = await loading.promise;
	const pages: PdfPageLayout[] = [];
	for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
		const page = await pdf.getPage(pageNumber);
		const { width, height } = page.getViewport({ scale: 1 });
		const { items } = await page.getTextContent();
		const pieces = items.flatMap((item): TextPiece[] =>
			"str" in item
				? [{ str: item.str, width: item.width, transform: item.transform as unknown as Transform }]
				: [],
		);
		pages.push({
			width,
			height,
			lines: joinLines({ pieces, height }),
			images: await readImageBoxes({ page, height }),
		});
	}
	await loading.destroy();
	return pages;
}

/** The marker of an image in {@link readingOrder}. */
const IMAGE = "image";

/**
 * Gives what a reader meets on the pages, in reading order: each line of text,
 * and {@link IMAGE} for each image. A line of paragraph words shows as the
 * paragraph's tag, such as `p3`, and one tag stands for a run of lines of one
 * paragraph. A caption shows as its label, such as `Figure 1.`, and the label
 * stands for all the lines of the caption. The page numbers are not in the order.
 *
 * @param pages - The layout of each page.
 * @returns The things that a reader meets, in order.
 */
function readingOrder(pages: readonly PdfPageLayout[]): readonly string[] {
	const order: string[] = [];
	for (const [index, page] of pages.entries()) {
		for (const label of pageThings({ page, pageNumber: index + 1 })) {
			const continuesCaption =
				CAPTION_LABEL.test(order.at(-1) ?? "") && !LABELLED_LINE.test(label) && label !== IMAGE;
			if ((order.at(-1) !== label || label === IMAGE) && !continuesCaption) {
				order.push(label);
			}
		}
	}
	return order;
}

/**
 * Gives the label of one line of text for {@link readingOrder}.
 *
 * @param text - The text of the line.
 * @returns The paragraph tag of a line of paragraph words, the label of a caption, or the text.
 */
function lineLabel(text: string): string {
	const paragraphTag = /^(?<tag>p\d+)w\d+/u.exec(text)?.groups?.tag;
	const captionLabel = /^(?<label>(?:Figure \d+|References)\.)/u.exec(text)?.groups?.label;
	return paragraphTag ?? captionLabel ?? text;
}

/** The label of the first line of a caption. */
const CAPTION_LABEL = /^(?:Figure \d+|References)\.$/u;

/** A label that is not the next line of a caption: a paragraph tag, a caption label or a title of {@link makeLongLecture}. */
const LABELLED_LINE = /^(?:p\d+|Figure \d+\.|References\.|Topic \d+|Subtopic \d+\.\d+)$/u;

/** Words that make each caption several lines long, so a page break can fall inside a slide. */
const CAPTION_FILLER =
	"It shows the parts of the cell and the way that each part changes after the injury, from the first hour to the last day.".repeat(
		2,
	);

/**
 * Builds a lecture of topics and subtopics. Each word of a paragraph names its
 * paragraph, such as `p3w12`, so a test can find the lines of each paragraph.
 *
 * @param args - The shape of the lecture.
 * @param args.topicCount - The number of topics.
 * @param args.subtopicsPerTopic - The number of subtopics in each topic.
 * @param args.paragraphWords - The number of words of each paragraph of a subtopic.
 * @param args.slideAtWord - The word of the first paragraph of each subtopic where a slide starts, from 0, or `null` for no slides.
 * @returns The content of the PDF.
 */
function makeLongLecture({
	topicCount,
	subtopicsPerTopic,
	paragraphWords,
	slideAtWord,
}: {
	readonly topicCount: number;
	readonly subtopicsPerTopic: number;
	readonly paragraphWords: readonly number[];
	readonly slideAtWord: number | null;
}): NotesPdfContent {
	let paragraphNumber = 0;
	const paragraphOf = (wordCount: number): string => {
		paragraphNumber += 1;
		return Array.from({ length: wordCount }, (_, index) => `p${paragraphNumber}w${index + 1}`).join(
			" ",
		);
	};
	const topics: TopicWithSubtopics[] = Array.from({ length: topicCount }, (_, topicIndex) => ({
		title: `Topic ${topicIndex + 1}`,
		subtopics: Array.from({ length: subtopicsPerTopic }, (_, subtopicIndex) => ({
			subtopicId: topicIndex * subtopicsPerTopic + subtopicIndex + 1,
			title: `Subtopic ${topicIndex + 1}.${subtopicIndex + 1}`,
			text: "",
		})),
	}));
	const slideRelocations = topics.flatMap(({ subtopics }) =>
		subtopics.map(({ subtopicId }) => {
			const paragraphs = paragraphWords.map(paragraphOf);
			const slides: RelocatedSlide[] =
				slideAtWord === null
					? []
					: [
							{
								slideNumber: subtopicId,
								paragraphIndex: 0,
								characterOffset: (paragraphs[0] ?? "").split(" ").slice(0, slideAtWord).join(" ")
									.length,
								figureNumber: subtopicId,
							},
						];
			return { subtopicId, paragraphs, slides };
		}),
	);
	return {
		lectureTitle: testLecture.title,
		lectureDate: testLecture.date,
		topics,
		slideRelocations,
		slideReadings: slideRelocations.flatMap(({ slides }) =>
			slides.map(
				({ slideNumber }) =>
					({
						slideNumber,
						...slideReadingReply({
							caption: `The caption of slide ${slideNumber}. ${CAPTION_FILLER}`,
						}),
					}) as SlideReading,
			),
		),
	};
}

/** A lecture of text only that fills more than one page. */
const severalPagesLecture = makeLongLecture({
	topicCount: 2,
	subtopicsPerTopic: 2,
	paragraphWords: [300],
	slideAtWord: null,
});

/**
 * A lecture of 30 short subtopics, each with one slide. The height of one
 * subtopic does not divide the height of a page, so the slides fall at many
 * heights of the pages, and some fall at a page bottom.
 */
const manySlidesShape = { topicCount: 1, subtopicsPerTopic: 30, paragraphWords: [50] } as const;

const manySlidesLecture = makeLongLecture({ ...manySlidesShape, slideAtWord: 25 });

/**
 * A lecture of text only, with 10 topics of 3 short subtopics. The titles fall
 * at many heights of the pages, and some fall at a page bottom.
 */
const manyTitlesLecture = makeLongLecture({
	topicCount: 10,
	subtopicsPerTopic: 3,
	paragraphWords: [70, 45],
	slideAtWord: null,
});

/** A topic title or a subtopic title of {@link makeLongLecture}. */
const TITLE = /^(?:Topic \d+|Subtopic \d+\.\d+)$/u;

/** The label of a line of paragraph words, from {@link lineLabel}. */
const PARAGRAPH_TAG = /^p\d+$/u;

/**
 * Gives the lines of the text of a page, without the page number.
 *
 * @param args - The page, and its number.
 * @param args.page - The layout of the page.
 * @param args.pageNumber - The number of the page, from 1.
 * @returns The lines, from the top of the page down.
 */
function textLines({
	page,
	pageNumber,
}: {
	readonly page: PdfPageLayout;
	readonly pageNumber: number;
}): readonly PdfLine[] {
	return page.lines.filter(({ text }) => text !== String(pageNumber));
}

/**
 * Gives what a reader meets on one page, from the top down: the label of each
 * line of text from {@link lineLabel}, and {@link IMAGE} for each image. The page
 * number is not in the list.
 *
 * @param args - The page, and its number.
 * @param args.page - The layout of the page.
 * @param args.pageNumber - The number of the page, from 1.
 * @returns The labels, from the top of the page down.
 */
function pageThings({
	page,
	pageNumber,
}: {
	readonly page: PdfPageLayout;
	readonly pageNumber: number;
}): readonly string[] {
	return [
		...textLines({ page, pageNumber }).map(({ top, text }) => ({ top, label: lineLabel(text) })),
		...page.images.map(({ top }) => ({ top, label: IMAGE })),
	]
		.sort((first, second) => first.top - second.top)
		.map(({ label }) => label);
}

/** One block of text: a run of lines of one paragraph, with no slide or title between them. */
type TextBlock = {
	readonly label: string;
	/** The number of lines of the block on each page that it is on, in page order. */
	readonly lineCounts: readonly number[];
};

/**
 * Gives each block of paragraph text, with its number of lines on each page.
 * An image, a caption or a title ends a block.
 *
 * @param pages - The layout of each page.
 * @returns The blocks, in reading order.
 */
function textBlocks(pages: readonly PdfPageLayout[]): readonly TextBlock[] {
	const things = pages.flatMap((page, index) =>
		pageThings({ page, pageNumber: index + 1 }).map((label) => ({ label, pageNumber: index + 1 })),
	);
	const runStarts = things.flatMap(({ label }, index) =>
		things[index - 1]?.label === label ? [] : [index],
	);
	return [...runStarts.entries()]
		.map(([runIndex, start]) => things.slice(start, runStarts[runIndex + 1]))
		.filter((run) => PARAGRAPH_TAG.test(run[0]?.label ?? ""))
		.map((run) => {
			const pageNumbers = run.map(({ pageNumber }) => pageNumber);
			return {
				label: run[0]?.label ?? "",
				lineCounts: [...new Set(pageNumbers)].map(
					(pageNumber) => pageNumbers.filter((onPage) => onPage === pageNumber).length,
				),
			};
		});
}

describe("printNotesPdf", () => {
	let outputDir: string;
	/**
	 * Prints the PDF HTML of some content, with each slide image as a real PNG,
	 * and reads the PDF back.
	 *
	 * @param args - The content, and the page settings.
	 * @param args.content - The content of the PDF.
	 * @param args.settings - The page settings. The default is the settings of the example config.
	 * @returns The layout of each page.
	 */
	const printAndRead = async ({
		content,
		settings = exampleConfig.finalOutput.pdf,
	}: {
		readonly content: NotesPdfContent;
		readonly settings?: NotesPdfSettings;
	}): Promise<readonly PdfPageLayout[]> => {
		const slideNumbers = content.slideReadings.map(({ slideNumber }) => slideNumber);
		const urls = new Map(
			await Promise.all(
				slideNumbers.map(async (slideNumber) => {
					const pngPath = join(outputDir, `slide-${slideNumber}.png`);
					await writeFile(pngPath, await makeSlidePng(slideNumber));
					return [slideNumber, await readPngDataUrl(pngPath)] as const;
				}),
			),
		);
		const path = join(outputDir, "notes.pdf");
		await printNotesPdf({
			html: notesPdfHtml({
				content,
				settings,
				slideImageUrl: (slideNumber) => urls.get(slideNumber) ?? "",
			}),
			path,
		});
		return readPdfLayout(path);
	};

	beforeEach(async () => {
		outputDir = await makeTempDir({ prefix: "print-notes-pdf-" });
	});

	afterEach(async () => {
		await rm(outputDir, { recursive: true, force: true });
	});

	it(
		"should print A4 pages when the PDF HTML is printed",
		async () => {
			const pages = await printAndRead({ content: severalPagesLecture });

			expect(pages.length).toBeGreaterThan(1);
			for (const { width, height } of pages) {
				expect(width).toBeCloseTo(A4_POINTS.width, 0);
				expect(height).toBeCloseTo(A4_POINTS.height, 0);
			}
		},
		PRINT_TIMEOUT_MS,
	);

	it(
		"should show the date, the title, the titles, the text and each slide with its caption in lecture order when the PDF HTML is printed",
		async () => {
			const pages = await printAndRead({
				content: makeLongLecture({
					topicCount: 1,
					subtopicsPerTopic: 2,
					paragraphWords: [60],
					slideAtWord: 30,
				}),
			});

			expect(readingOrder(pages)).toStrictEqual([
				testLecture.date,
				testLecture.title,
				"Topic 1",
				"Subtopic 1.1",
				"p1",
				IMAGE,
				"Figure 1.",
				"p1",
				"Subtopic 1.2",
				"p2",
				IMAGE,
				"Figure 2.",
				"p2",
			]);
		},
		PRINT_TIMEOUT_MS,
	);

	it(
		"should put the page number at the bottom in the middle of each page when the PDF has more than one page",
		async () => {
			const pages = await printAndRead({ content: severalPagesLecture });

			expect(pages.length).toBeGreaterThan(1);
			const bottomMargin = mmToPoints(exampleConfig.finalOutput.pdf.marginMm);
			for (const [index, { width, height, lines }] of pages.entries()) {
				const pageNumber = lines.find(({ text }) => text === String(index + 1));
				expect(pageNumber?.top).toBeGreaterThan(height - bottomMargin);
				expect(((pageNumber?.left ?? 0) + (pageNumber?.right ?? 0)) / 2).toBeCloseTo(width / 2, -1);
			}
		},
		PRINT_TIMEOUT_MS,
	);

	it(
		"should keep each slide image and its caption on one page when slides fall at many heights of the pages",
		async () => {
			const pages = await printAndRead({ content: manySlidesLecture });

			for (const { images, lines } of pages) {
				const captions = lines.filter(({ text }) => /^Figure \d+\./u.test(text));
				expect(captions.length).toBe(images.length);
				for (const [index, caption] of captions.entries()) {
					expect(caption.top).toBeGreaterThan(images[index]?.bottom ?? Number.POSITIVE_INFINITY);
				}
			}
		},
		PRINT_TIMEOUT_MS,
	);

	it(
		"should end no page with a topic title or a subtopic title when the lecture runs over several pages",
		async () => {
			const pages = await printAndRead({ content: manyTitlesLecture });

			const lastLines = pages.map(
				(page, index) => textLines({ page, pageNumber: index + 1 }).at(-1)?.text ?? "",
			);
			expect(lastLines.filter((text) => TITLE.test(text))).toStrictEqual([]);
		},
		PRINT_TIMEOUT_MS,
	);

	it(
		"should put each subtopic title and the first 3 lines of its first paragraph on one page when the lecture runs over several pages",
		async () => {
			const pages = await printAndRead({ content: manyTitlesLecture });

			const titlesWithShortStart = pages.flatMap((page, index) => {
				const labels = textLines({ page, pageNumber: index + 1 }).map(({ text }) =>
					lineLabel(text),
				);
				return labels.flatMap((label, lineIndex) => {
					const start = labels.slice(lineIndex + 1, lineIndex + 4);
					const isWholeStart =
						start.length === 3 &&
						PARAGRAPH_TAG.test(start[0] ?? "") &&
						start.every((startLabel) => startLabel === start[0]);
					return label.startsWith("Subtopic") && !isWholeStart ? [label] : [];
				});
			});
			expect(titlesWithShortStart).toStrictEqual([]);
		},
		PRINT_TIMEOUT_MS,
	);

	it.each([
		{ lecture: "of text only", content: manyTitlesLecture },
		{ lecture: "with a slide in each paragraph", content: manySlidesLecture },
	])(
		"should leave at least 3 lines of a block of text on each page when a block splits across two pages in a lecture $lecture",
		async ({ content }) => {
			const pages = await printAndRead({ content });

			const shortParts = textBlocks(pages).flatMap(({ label, lineCounts }) =>
				lineCounts.length > 1 && lineCounts.some((count) => count < 3)
					? [`${label}: ${lineCounts.join(" + ")}`]
					: [],
			);
			expect(shortParts).toStrictEqual([]);
		},
		PRINT_TIMEOUT_MS,
	);

	it.each([
		{ start: "starts with a slide", slideAtWord: 0 },
		{ start: "has a slide after the first line of its first paragraph", slideAtWord: 3 },
	])(
		"should put a subtopic title, the text before its first slide and the whole slide on one page when the subtopic $start",
		async ({ slideAtWord }) => {
			const pages = await printAndRead({
				content: makeLongLecture({ ...manySlidesShape, slideAtWord }),
			});

			const titlesApartFromSlide = pages.flatMap((page, index) => {
				const things = pageThings({ page, pageNumber: index + 1 });
				return things.flatMap((label, thingIndex) => {
					const after = things.slice(thingIndex + 1);
					const imageIndex = after.indexOf(IMAGE);
					const isWholeStart =
						imageIndex >= 0 &&
						after.slice(0, imageIndex).every((startLabel) => PARAGRAPH_TAG.test(startLabel)) &&
						CAPTION_LABEL.test(after[imageIndex + 1] ?? "");
					return label.startsWith("Subtopic") && !isWholeStart ? [label] : [];
				});
			});
			expect(titlesApartFromSlide).toStrictEqual([]);
		},
		PRINT_TIMEOUT_MS,
	);
});
