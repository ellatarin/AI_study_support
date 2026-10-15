/**
 * The printer of the Notes PDF. Chrome prints the PDF from its HTML, through
 * puppeteer (CONTEXT.md, "Notes PDF").
 */

import puppeteer from "puppeteer";
import { produceFileAtomic } from "../../../utils/files.js";
import { escapeHtml } from "./notes-text-html.js";

/**
 * Gives a line of the top or the bottom margin of each page: in the middle, in 8 pt grey, as in the agreed look.
 *
 * @param innerHtml - The HTML of the line.
 * @returns The template of the line.
 */
function marginLine(innerHtml: string): string {
	return `<div style="width: 100%; font-size: 8pt; text-align: center; color: gray;">${innerHtml}</div>`;
}

/** The footer of each page: the page number. */
const PAGE_NUMBER_FOOTER = marginLine('<span class="pageNumber"></span>');

/** One print of a Notes PDF: its HTML, the fact-check line for the top margin, and the path of the PDF. */
export type NotesPdfPrint = {
	readonly html: string;
	readonly factCheckLine: string;
	readonly path: string;
};

/** Prints the HTML of a Notes PDF to a PDF file at a path. */
export type NotesPdfPrinter = (print: NotesPdfPrint) => Promise<void>;

/**
 * Prints the HTML of a Notes PDF to a PDF file with Chrome. The page size and the
 * margins come from the `@page` rule of the HTML. Chrome writes the fact-check
 * line in the top margin and the page number in the bottom margin of each page.
 * Chrome cannot write a margin line on the first page only. The file is put in
 * place only when the print is complete.
 *
 * @param args - The HTML, the fact-check line, and the path of the PDF.
 * @param args.html - The whole HTML of the Notes PDF. It loads nothing from a file or from the internet.
 * @param args.factCheckLine - The fact-check line (CONTEXT.md, "Fact-check line").
 * @param args.path - The absolute path of the PDF file.
 * @returns A promise that resolves when the PDF is on disk.
 * @throws The error of Chrome when Chrome cannot start or cannot print the page.
 */
export const printNotesPdf: NotesPdfPrinter = async ({ html, factCheckLine, path }) => {
	const browser = await puppeteer.launch();
	try {
		const page = await browser.newPage();
		await page.setContent(html, { waitUntil: "load" });
		await produceFileAtomic({
			path,
			produce: async (tmpPath) => {
				await page.pdf({
					path: tmpPath,
					preferCSSPageSize: true,
					printBackground: true,
					displayHeaderFooter: true,
					headerTemplate: marginLine(escapeHtml(factCheckLine)),
					footerTemplate: PAGE_NUMBER_FOOTER,
				});
			},
		});
	} finally {
		await browser.close();
	}
};
