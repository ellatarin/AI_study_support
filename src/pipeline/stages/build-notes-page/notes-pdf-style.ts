/**
 * The stylesheet of the HTML that Chrome prints as the Notes PDF (CONTEXT.md,
 * "Notes PDF").
 */

import type { NotesPdfSettings } from "../../../types/pipeline.js";

/**
 * Gives the stylesheet of the Notes PDF, with the page settings of the config.
 * The page number is in the middle of the bottom margin.
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
figure { break-inside: avoid; }
`;
}
