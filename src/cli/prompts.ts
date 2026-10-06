/**
 * This module asks the user every question that the pipeline asks, in the
 * terminal. No other code reads from the terminal. Normalisation gets a
 * {@link ConfirmPrompt}, and the runner returns the lectures that a date names
 * without a choice. So a test can give normalisation a stub {@link ConfirmPrompt},
 * and a test of the runner needs no prompt (technical-design.md §4.7,
 * "CLI Structure").
 */

import { basename } from "node:path";
import { checkbox, confirm, select } from "@inquirer/prompts";
import type { ConfirmPrompt } from "../pipeline/stages/source-normalisation/orphaned-workspaces.js";
import type { LectureMatch } from "../types/pipeline.js";
import type { LecturePicker, SingleLecturePicker } from "./commands.js";

/** The choice values for "every lecture" and "no lecture". */
const ALL_MATCHES = "all-matches";
const CANCEL = "cancel";

/** A choice value in the picker for one lecture. */
type SingleChoice = LectureMatch | typeof CANCEL;

/** A choice value in the picker for several lectures. */
type MultipleChoice = SingleChoice | typeof ALL_MATCHES;

/** The "Cancel" choice. Both pickers show it last. */
const CANCEL_CHOICE = { name: "Cancel", value: CANCEL } as const;

/** The first sentence of both pickers. Each picker adds its own question. */
const SEVERAL_LECTURES = "Several lectures share that date.";

/**
 * Makes one choice for each lecture. The label gives the module, the lecture
 * number and the lecture title.
 *
 * The value is the lecture, not its index in the list. An index would need a
 * look-up in the list, and only a type assertion could say that the index is in range.
 *
 * @param matches - The lectures that have the date.
 * @returns The choices.
 */
function lectureChoices(
	matches: readonly LectureMatch[],
): readonly { readonly name: string; readonly value: LectureMatch }[] {
	return matches.map((match) => ({
		name: `${basename(match.moduleRoot)} — Lecture ${match.lectureNumber} — ${match.lectureTitle}`,
		value: match,
	}));
}

/**
 * Asks the user to approve an action. The default answer is no, so the Enter
 * key alone never deletes anything.
 *
 * @param args - The question.
 * @param args.message - A question that "yes" and "no" can both answer.
 * @returns `true` when the user approves.
 */
export const confirmPrompt: ConfirmPrompt = ({ message }) => confirm({ message, default: false });

/**
 * Asks the user which lectures with the same date to act on. Two modules can
 * have a lecture on the same date. "All matches" chooses every lecture, and
 * "Cancel" chooses none (technical-design.md §4.7, "`resolveLecturesByDate`").
 *
 * @param args - The lectures.
 * @param args.matches - The lectures that have the date.
 * @returns The chosen lectures, or an empty list when the user cancels or chooses none.
 */
export const selectLectureMatches: LecturePicker = async ({ matches }) => {
	const chosen = await checkbox<MultipleChoice>({
		message: `${SEVERAL_LECTURES} Which do you mean?`,
		choices: [
			{ name: "All matches", value: ALL_MATCHES },
			...lectureChoices(matches),
			CANCEL_CHOICE,
		],
	});
	if (chosen.includes(CANCEL)) {
		return [];
	}
	if (chosen.includes(ALL_MATCHES)) {
		return matches;
	}
	return chosen.filter((choice): choice is LectureMatch => typeof choice !== "string");
};

/**
 * Asks the user which one lecture with the same date to act on. The identity
 * changes use this picker, because each acts on one lecture only. So it has no
 * "All matches" (technical-design.md §4.7, "An identity change acts on exactly
 * one lecture").
 *
 * @param args - The lectures.
 * @param args.matches - The lectures that have the date.
 * @returns The chosen lecture, or `null` when the user cancels.
 */
export const selectLectureMatch: SingleLecturePicker = async ({ matches }) => {
	const chosen = await select<SingleChoice>({
		message: `${SEVERAL_LECTURES} Which one do you mean?`,
		choices: [...lectureChoices(matches), CANCEL_CHOICE],
	});
	return chosen === CANCEL ? null : chosen;
};
