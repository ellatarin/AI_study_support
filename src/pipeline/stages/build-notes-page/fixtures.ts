/**
 * Test support for the suites of the Notes PDF: a reader of a printed PDF that
 * gives what a reader sees on each page.
 */

import { getDocument, OPS, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * The time that one test can take when it prints with Chrome. A test takes under
 * 2 seconds alone, but the commit gate runs every suite at once with coverage,
 * and one test then took 30 seconds.
 */
export const PRINT_TIMEOUT_MS = 120_000;

/** A box on a page, in points from the top left corner of the page. */
export type PageBox = {
	readonly left: number;
	readonly right: number;
	readonly top: number;
	readonly bottom: number;
};

/** One line of text on a page. */
export type PdfLine = PageBox & { readonly text: string; readonly fontSize: number };

/** One page of a printed PDF, as a reader sees it. */
export type PdfPageLayout = {
	readonly width: number;
	readonly height: number;
	/** The lines of text, from the top of the page down. */
	readonly lines: readonly PdfLine[];
	/** The box of each image, in the order that the page draws them. */
	readonly images: readonly PageBox[];
};

/**
 * A transform of PDF user space, which the PDF format writes as `[a b c d e f]`:
 * the x scale, the y skew, the x skew, the y scale, the x move and the y move.
 */
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
	const [scaleX, skewY, skewX, scaleY, moveX, moveY] = outer;
	const [innerScaleX, innerSkewY, innerSkewX, innerScaleY, innerMoveX, innerMoveY] = inner;
	return [
		innerScaleX * scaleX + innerSkewY * skewX,
		innerScaleX * skewY + innerSkewY * scaleY,
		innerSkewX * scaleX + innerScaleY * skewX,
		innerSkewX * skewY + innerScaleY * scaleY,
		innerMoveX * scaleX + innerMoveY * skewX + moveX,
		innerMoveX * skewY + innerMoveY * scaleY + moveY,
	];
}

/**
 * Gives the box of each image that a page draws. An image fills the unit square
 * of the transform at the time that the page draws it.
 *
 * @param args - The operator list of the page, and the height of the page.
 * @param args.fnArray - The operators of the page, as pdfjs gives them.
 * @param args.argsArray - The arguments of each operator, as pdfjs gives them.
 * @param args.height - The height of the page, in points.
 * @returns The box of each image.
 */
function imageBoxes({
	fnArray,
	argsArray,
	height,
}: {
	readonly fnArray: readonly number[];
	readonly argsArray: readonly unknown[];
	readonly height: number;
}): readonly PageBox[] {
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
			const [scaleX, , , scaleY, moveX, moveY] = current;
			boxes.push({
				left: moveX,
				right: moveX + scaleX,
				top: height - (moveY + scaleY),
				bottom: height - moveY,
			});
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
	return (
		[...byBaseline.entries()]
			// eslint-disable-next-line max-params -- the language specification sets the parameters of a sort comparator
			.sort(([first], [second]) => second - first)
			.map(([baseline, linePieces]) => {
				const sorted = [...linePieces].sort(
					// eslint-disable-next-line max-params -- the language specification sets the parameters of a sort comparator
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
			})
	);
}

/**
 * Reads the layout of each page of a PDF.
 *
 * @param path - The path of the PDF.
 * @returns The layout of each page, in page order.
 */
export async function readPdfLayout(path: string): Promise<readonly PdfPageLayout[]> {
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
			images: imageBoxes({ ...(await page.getOperatorList()), height }),
		});
	}
	await loading.destroy();
	return pages;
}
