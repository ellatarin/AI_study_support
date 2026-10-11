/**
 * The slide placements, as `place-slides` writes them. `correct-terms` reads
 * them (technical-design.md §5, `place-slides`).
 */

import { isRecord } from "../../utils/record.js";

/** The fields that a placement in the reply of `place-slides` and a stored placement both have. */
export type PlacedSlideFields = {
	readonly slideNumber: number;
	readonly subtopicId: number;
	readonly placedBecause: string;
};

/** One placed slide, as `place-slides` writes it (technical-design.md §5, `place-slides`). */
export type SlidePlacement = PlacedSlideFields & {
	/** The start words from the reply. `null` for a references slide, which the code places. */
	readonly startWords: string | null;
	/** The number of characters from the start of the subtopic's text to the point where the slide goes. */
	readonly positionInSubtopic: number;
};

/** What `place-slides` writes: the placements, and the version of the prompt that made them. */
export type SlidePlacements = {
	readonly promptVersion: string;
	readonly placements: readonly SlidePlacement[];
};

/**
 * Tells if a value has the fields of {@link PlacedSlideFields}.
 *
 * @param value - One entry of a list of placements.
 * @returns `true` when the value has a `slideNumber` and a `subtopicId`, both
 *   numbers, and a `placedBecause` string.
 */
export function hasPlacedSlideFields(
	value: unknown,
): value is Record<string, unknown> & PlacedSlideFields {
	return (
		isRecord(value) &&
		typeof value.slideNumber === "number" &&
		typeof value.subtopicId === "number" &&
		typeof value.placedBecause === "string"
	);
}

/**
 * Checks that a value is one placed slide.
 *
 * @param value - One entry of the list of placements.
 * @returns `true` when the value is a {@link SlidePlacement}.
 */
function isSlidePlacement(value: unknown): value is SlidePlacement {
	return (
		hasPlacedSlideFields(value) &&
		(typeof value.startWords === "string" || value.startWords === null) &&
		typeof value.positionInSubtopic === "number"
	);
}

/**
 * Reads a parsed value as the slide placements.
 *
 * @param value - The parsed file.
 * @returns The slide placements, or `null` when the value does not have their shape.
 */
export function readSlidePlacements(value: unknown): SlidePlacements | null {
	return isRecord(value) &&
		typeof value.promptVersion === "string" &&
		Array.isArray(value.placements) &&
		value.placements.every(isSlidePlacement)
		? { promptVersion: value.promptVersion, placements: value.placements }
		: null;
}
