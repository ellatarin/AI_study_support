/**
 * The printer of the Notes PDF. Chrome prints the PDF from its HTML, through
 * puppeteer (CONTEXT.md, "Notes PDF").
 */

import puppeteer from "puppeteer";
import { produceFileAtomic } from "../../../utils/files.js";

/** The footer of each page: the page number in the middle, in 8 pt grey, as in the agreed look. */
const PAGE_NUMBER_FOOTER =
	'<div style="width: 100%; font-size: 8pt; text-align: center; color: gray;"><span class="pageNumber"></span></div>';

/** Prints the HTML of a Notes PDF to a PDF file at a path. */
export type NotesPdfPrinter = (args: {
	readonly html: string;
	readonly path: string;
}) => Promise<void>;

/**
 * Prints the HTML of a Notes PDF to a PDF file with Chrome. The page size and the
 * margins come from the `@page` rule of the HTML. Chrome writes the page number
 * in the bottom margin, with no header. The file is put in place only when the
 * print is complete.
 *
 * @param args - The HTML, and the path of the PDF.
 * @param args.html - The whole HTML of the Notes PDF. It loads nothing from a file or from the internet.
 * @param args.path - The absolute path of the PDF file.
 * @returns A promise that resolves when the PDF is on disk.
 * @throws The error of Chrome when Chrome cannot start or cannot print the page.
 */
export const printNotesPdf: NotesPdfPrinter = async ({ html, path }) => {
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
					headerTemplate: "<span></span>",
					footerTemplate: PAGE_NUMBER_FOOTER,
				});
			},
		});
	} finally {
		await browser.close();
	}
};
