/**
 * Spacing a stage's sends: every send waits its turn, and a turn comes no
 * sooner than a set gap after the previous send began (technical-design.md §5,
 * "Dividing the transcript", Panel runs; §6).
 */

import { pause } from "./resend.js";

/** Hands out turns to send. One per stage run, so every send the run makes shares it. */
export type SendGate = {
	/** Resolves when this send may start: at once, or once the gap since the previous send has passed. */
	readonly waitTurn: () => Promise<void>;
};

/** How many milliseconds make a second. */
const MS_PER_SECOND = 1000;

/**
 * Makes a gate spacing sends at least `gapSeconds` apart. Each send's turn
 * follows the one before it, so sends released together go one gap apart, in
 * the order they asked; a send that comes after a long quiet goes at once.
 *
 * @param args - How far apart to space sends.
 * @param args.gapSeconds - The least time between the starts of two sends; `undefined` spaces nothing.
 * @returns The gate.
 */
export function createSendGate({
	gapSeconds,
}: {
	readonly gapSeconds: number | undefined;
}): SendGate {
	if (gapSeconds === undefined) {
		return { waitTurn: () => Promise.resolve() };
	}
	let nextTurn: Promise<void> = Promise.resolve();
	return {
		waitTurn: () => {
			const turn = nextTurn;
			nextTurn = (async (): Promise<void> => {
				await turn;
				await pause({ milliseconds: gapSeconds * MS_PER_SECOND });
			})();
			return turn;
		},
	};
}
