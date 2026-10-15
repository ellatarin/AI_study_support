/**
 * The stylesheet of the HTML that Chrome prints as the Notes PDF (CONTEXT.md,
 * "Notes PDF").
 */

import type { NotesPdfSettings } from "../../../types/pipeline.js";

/**
 * Gives the stylesheet of the Notes PDF, with the page settings of the config.
 * The page number is in the middle of the bottom margin. The break rules keep
 * each slide on one page, and keep each title with the start of its text. A
 * subtopic's text block before its first slide stays whole and with that slide.
 * A block of text that splits keeps at least 3 lines on each page.
 *
 * @param settings - The page settings, from `finalOutput.pdf`.
 * @returns The CSS.
 */
export function notesPdfStyle(settings: NotesPdfSettings): string {
	return `
@page {
  size: A4;
  margin: ${settings.marginMm}mm;
  @bottom-center { content: counter(page); }
}
body { margin: 0; }
figure {
  break-inside: avoid;
  width: ${settings.slideWidthPercent}%;
  margin: ${settings.slideSpaceBeforeMm}mm auto ${settings.slideSpaceAfterMm}mm;
}
figure img { display: block; width: 100%; height: auto; }
h2, h3 { break-inside: avoid; break-after: avoid; }
p { orphans: 3; widows: 3; }
h3 + p:has(+ figure) { break-inside: avoid; break-after: avoid; }
`;
}
