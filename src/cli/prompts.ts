/**
 * The CLI's terminal prompts.
 *
 * Every question the pipeline asks is asked here. Stage 0 takes a
 * {@link ConfirmPrompt} rather than reaching for stdin itself, and the runner
 * returns date matches rather than choosing between them, so the only code that
 * touches the terminal is this module — which is what lets both be driven by
 * stubs under test (technical-design.md §4.7, §5).
 */

import { basename } from "node:path";
import { checkbox, confirm, select } from "@inquirer/prompts";
import type { ConfirmPrompt } from "../pipeline/stages/source-normalisation.js";
import type { LectureMatch } from "../types/pipeline.js";

/** The choice values standing for "every match" and "none of them". */
const ALL_MATCHES = -1;
const CANCEL = -2;

/** The way out of either picker, offered last in both. */
const CANCEL_CHOICE = { name: "Cancel", value: CANCEL };

/** What either picker is handed: the lectures a date turned out to name. */
type MatchQuery = { readonly matches: readonly LectureMatch[] };

/**
 * One choice per lecture, labelled by module, number, and title, and valued by
 * its position in the list both pickers were given.
 *
 * @param matches - The lectures sharing the requested date.
 * @returns The choices to offer.
 */
function lectureChoices(
	matches: readonly LectureMatch[],
): readonly { readonly name: string; readonly value: number }[] {
	return Array.from(matches.entries(), ([index, match]) => ({
		name: `${basename(match.moduleRoot)} — Lecture ${match.lectureNumber} — ${match.lectureTitle}`,
		value: index,
	}));
}

/**
 * Asks the user to approve an action, defaulting to declining so that pressing
 * enter never destroys anything.
 *
 * @param args - The question to ask.
 * @param args.message - The question, phrased so both answers are meaningful.
 * @returns The user's answer.
 */
export const confirmPrompt: ConfirmPrompt = ({ message }) => confirm({ message, default: false });

/**
 * Asks which of several same-dated lectures to act on.
 *
 * Lecture dates are unique within a module but may collide across them, so a
 * date can name more than one lecture. Each is labelled by module, number, and
 * title; "All matches" takes every one and "Cancel" takes none
 * (technical-design.md §4.7).
 *
 * @param args - The lectures to choose between.
 * @param args.matches - The lectures sharing the requested date.
 * @returns The chosen lectures, empty when the user cancels or chooses none.
 */
export async function selectLectureMatches({
	matches,
}: MatchQuery): Promise<readonly LectureMatch[]> {
	const chosen = await checkbox({
		message: "Several lectures share that date. Which do you mean?",
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
	return chosen.map((index) => matches[index] as LectureMatch);
}

/**
 * Asks which one of several same-dated lectures to act on.
 *
 * Used where acting on several at once would be meaningless rather than merely
 * bulk: renaming is the case — one new title applied to two lectures in
 * different modules is never what "rename the lecture on the 10th" means. So
 * this prompt offers no "All matches" (technical-design.md §4.7).
 *
 * @param args - The lectures to choose between.
 * @param args.matches - The lectures sharing the requested date.
 * @returns The chosen lecture, or `null` when the user cancels.
 */
export async function selectLectureMatch({ matches }: MatchQuery): Promise<LectureMatch | null> {
	const chosen = await select({
		message: "Several lectures share that date. Which one do you mean?",
		choices: [...lectureChoices(matches), CANCEL_CHOICE],
	});
	return chosen === CANCEL ? null : (matches[chosen] as LectureMatch);
}
