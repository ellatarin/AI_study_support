/**
 * The structured transcript, as `structure-transcript` writes it. `place-slides`
 * reads it (technical-design.md §5, `structure-transcript`).
 */

import { isRecord } from "../../utils/record.js";
import type { SubtopicWithIdAndText } from "./division.js";

/** One topic with its title, and its subtopics in order. */
export type TopicWithSubtopics = {
	readonly title: string;
	readonly subtopics: readonly SubtopicWithIdAndText[];
};

/** The structured transcript (CONTEXT.md, "Structured transcript"). */
export type StructuredTranscript = {
	readonly lectureTitle: string;
	readonly topics: readonly TopicWithSubtopics[];
};

/**
 * Checks that a value is one subtopic with its subtopic id, its title and its text.
 *
 * @param value - One entry of a topic's list of subtopics.
 * @returns `true` when it has a number `subtopicId`, a string `title` and a string `text`.
 */
function isSubtopicWithIdAndText(value: unknown): value is SubtopicWithIdAndText {
	return (
		isRecord(value) &&
		typeof value.subtopicId === "number" &&
		typeof value.title === "string" &&
		typeof value.text === "string"
	);
}

/**
 * Checks that a value is one topic with its subtopics.
 *
 * @param value - One entry of the list of topics.
 * @returns `true` when it has a string `title` and a list `subtopics` of subtopics with id and text.
 */
function isTopicWithSubtopics(value: unknown): value is TopicWithSubtopics {
	return (
		isRecord(value) &&
		typeof value.title === "string" &&
		Array.isArray(value.subtopics) &&
		value.subtopics.every(isSubtopicWithIdAndText)
	);
}

/**
 * Reads a parsed value as a structured transcript.
 *
 * @param value - The parsed file.
 * @returns The structured transcript, or `null` when the value does not have its shape.
 */
export function readStructuredTranscript(value: unknown): StructuredTranscript | null {
	return isRecord(value) &&
		typeof value.lectureTitle === "string" &&
		Array.isArray(value.topics) &&
		value.topics.every(isTopicWithSubtopics)
		? { lectureTitle: value.lectureTitle, topics: value.topics }
		: null;
}
