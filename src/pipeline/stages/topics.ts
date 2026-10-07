/**
 * The topics of a lecture, as `group-into-topics` writes them. `judge-lecture-title`
 * reads them (technical-design.md §5, `group-into-topics` and `judge-lecture-title`).
 */

import { isRecord } from "../../utils/record.js";

/** One topic: its title, its reason, and where it starts. */
export type Topic = {
	readonly title: string;
	readonly groupedBecause: string;
	/** The subtopic id of the first subtopic of the topic, counting from 1. */
	readonly firstSubtopicId: number;
};

/**
 * Checks that a value is one topic.
 *
 * @param value - One entry of a list of topics.
 * @returns `true` when it has a string `title`, a string `groupedBecause` and a number `firstSubtopicId`.
 */
export function isTopic(value: unknown): value is Topic {
	return (
		isRecord(value) &&
		typeof value.title === "string" &&
		typeof value.groupedBecause === "string" &&
		typeof value.firstSubtopicId === "number"
	);
}

/**
 * Reads a parsed value as a list of topics.
 *
 * @param value - The parsed file.
 * @returns The topics, or `null` when the value is not a list or an entry is not a topic.
 */
export function readTopics(value: unknown): readonly Topic[] | null {
	return Array.isArray(value) && value.every(isTopic) ? value : null;
}
