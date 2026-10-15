/**
 * The stylesheet of the HTML that Chrome prints as the Notes PDF (CONTEXT.md,
 * "Notes PDF").
 */

import type { NotesPdfSettings } from "../../../types/pipeline.js";
import { LIGHT_COLOURS_AND_FONTS } from "./notes-page-style.js";

/**
 * Gives the stylesheet of the Notes PDF, with the page settings of the config.
 * The sizes and the spaces of the text are those of the agreed look. The break
 * rules keep each slide on one page, and keep each title with the start of its
 * text. A subtopic's text block before its first slide stays whole and with that
 * slide. A block of text that splits keeps at least 3 lines on each page.
 *
 * @param settings - The page settings, from `finalOutput.pdf`.
 * @returns The CSS.
 */
export function notesPdfStyle(settings: NotesPdfSettings): string {
	return `
@page { size: A4; margin: ${settings.marginMm}mm; }
${LIGHT_COLOURS_AND_FONTS}
body { margin: 0; color: var(--ink); font-family: var(--font-text); font-size: ${settings.fontSizePt}pt; line-height: 1.45; }
.eyebrow { font-family: var(--font-ui); font-size: 0.75em; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin: 0; }
h1 { font-weight: 600; font-size: 2em; line-height: 1.15; margin: 0.2em 0 1em; }
h2 { font-weight: 600; font-size: 1.45em; line-height: 1.25; margin: 1.2em 0 0.6em; padding-top: 0.4em; border-top: 2px solid var(--accent); }
h3 { font-weight: 600; font-size: 1.15em; line-height: 1.3; margin: 1em 0 0.4em; }
h2, h3 { break-inside: avoid; break-after: avoid; }
.subtopic { display: flow-root; }
p { margin: 0 0 0.7em; text-align: justify; hyphens: auto; orphans: 3; widows: 3; }
h3 + p:has(+ figure) { break-inside: avoid; break-after: avoid; }
.nowrap { white-space: nowrap; }
figure {
  break-inside: avoid;
  width: ${settings.slideWidthPercent}%;
  margin: ${settings.slideSpaceBeforeMm}mm auto ${settings.slideSpaceAfterMm}mm;
  font-size: 0.85em;
  line-height: 1.35;
  text-align: left;
}
figure img { display: block; box-sizing: border-box; width: 100%; height: auto; border: 1px solid var(--rule); }
figcaption { margin-top: 1.5mm; }
.figure-label { font-family: var(--font-ui); font-weight: 700; color: var(--figure-label); }
`;
}
