/**
 * The stylesheet of the HTML that Chrome prints as the Notes PDF (CONTEXT.md,
 * "Notes PDF").
 */

/**
 * Gives the stylesheet of the Notes PDF.
 *
 * @returns The CSS.
 */
export function notesPdfStyle(): string {
	return `
@page { size: A4; }
`;
}
