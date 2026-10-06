/**
 * This module separates the sends of a stage in time. Each send waits for its
 * turn. A turn comes no sooner than a set gap after the previous send began
 * (technical-design.md §5, "Dividing the transcript", Panel runs, and §6).
 */

import { pause } from "./resend.js";

/** The send gate. Each stage run has one, which all of its sends share. */
export type SendGate = {
	/** Resolves when this send can start: at once, or when the gap after the previous send has passed. */
	readonly waitTurn: () => Promise<void>;
};

const MS_PER_SECOND = 1000;

/**
 * Creates a send gate that starts sends at least `gapSeconds` apart. Each turn
 * follows the turn before it. So sends that ask together go one gap apart, in
 * the order that they asked. A send after a long quiet time goes at once.
 *
 * @param args - The gap between the sends.
 * @param args.gapSeconds - The least time between the starts of two sends. `undefined` keeps no gap.
 * @returns The send gate.
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
