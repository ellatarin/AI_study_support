import { rm } from "node:fs/promises";
import { join } from "node:path";
import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NotesPdfSettings } from "../../../types/pipeline.js";
import { exampleConfig, makeTempDir, testLecture } from "../../fixtures.js";
import type { TopicWithSubtopics } from "../structured-transcript.js";
import { type NotesPdfContent, notesPdfHtml } from "./notes-pdf-html.js";
import { printNotesPdf } from "./print-notes-pdf.js";

/** The time that one print with Chrome can take, with a margin. */
const PRINT_TIMEOUT_MS = 30_000;

/** The size of an A4 page in points: 210 mm by 297 mm, at 72 points to the inch. */
const A4_POINTS = { width: (210 / 25.4) * 72, height: (297 / 25.4) * 72 };

/** One page of a printed PDF, as a reader sees it. */
type PdfPageLayout = { readonly width: number; readonly height: number };

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
		const { width, height } = (await pdf.getPage(pageNumber)).getViewport({ scale: 1 });
		pages.push({ width, height });
	}
	await loading.destroy();
	return pages;
}

/**
 * Builds a lecture of topics and subtopics. Each word of a paragraph names its
 * paragraph, such as `p3w12`, so a test can find the lines of each paragraph.
 *
 * @param args - The shape of the lecture.
 * @param args.topicCount - The number of topics.
 * @param args.subtopicsPerTopic - The number of subtopics in each topic.
 * @param args.paragraphWords - The number of words of each paragraph of a subtopic.
 * @returns The content of the PDF.
 */
function makeLongLecture({
	topicCount,
	subtopicsPerTopic,
	paragraphWords,
}: {
	readonly topicCount: number;
	readonly subtopicsPerTopic: number;
	readonly paragraphWords: readonly number[];
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
	return {
		lectureTitle: testLecture.title,
		lectureDate: testLecture.date,
		topics,
		slideRelocations: topics.flatMap(({ subtopics }) =>
			subtopics.map(({ subtopicId }) => ({
				subtopicId,
				paragraphs: paragraphWords.map(paragraphOf),
				slides: [],
			})),
		),
		slideReadings: [],
	};
}

describe("printNotesPdf", () => {
	let outputDir: string;
	/**
	 * Prints the PDF HTML of some content, and reads the PDF back.
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
		const path = join(outputDir, "notes.pdf");
		await printNotesPdf({
			html: notesPdfHtml({ content, settings, slideImageUrl: () => "" }),
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
			const pages = await printAndRead({
				content: makeLongLecture({ topicCount: 2, subtopicsPerTopic: 2, paragraphWords: [300] }),
			});

			expect(pages.length).toBeGreaterThan(1);
			for (const { width, height } of pages) {
				expect(width).toBeCloseTo(A4_POINTS.width, 0);
				expect(height).toBeCloseTo(A4_POINTS.height, 0);
			}
		},
		PRINT_TIMEOUT_MS,
	);
});
