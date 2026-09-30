/**
 * Sending a call again when it fails in a way a resend can cure: up to three
 * sends, pausing two seconds and then four between them, every send's cost
 * counted. Shared by the two places a call is resent — a provider refusing a
 * completion (technical-design.md §6), and a panel stage's unusable reply (§5,
 * "Dividing the transcript", Panel runs) — so the two cannot drift apart.
 */

import type { StageCost } from "../types/pipeline.js";
import { accumulateCost } from "./cost.js";

/** How many times one call is sent before its failure is final. */
export const MAX_SENDS = 3;

/**
 * The pause before the first resend; each later pause is twice the one before.
 * Short, because the failures resent here have cleared on a plain resend.
 */
const FIRST_PAUSE_MS = 2000;

/** A send that failed in a way a resend may cure, with what it cost. */
export type FailedSend = { readonly failure: string; readonly cost: StageCost };

/**
 * Waits before a resend.
 *
 * @param args - How long to wait.
 * @param args.milliseconds - The length of the pause.
 * @returns A promise that resolves when the pause is over.
 */
function pause({ milliseconds }: { readonly milliseconds: number }): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, milliseconds);
	});
}

/**
 * Whether a send's outcome is a failure to resend.
 *
 * @param outcome - What one send came back with.
 * @returns `true` when the send failed.
 * @typeParam TSent - What a successful send comes back with.
 */
function isFailedSend<TSent>(outcome: TSent | FailedSend): outcome is FailedSend {
	return typeof outcome === "object" && outcome !== null && "failure" in outcome;
}

/**
 * Sends a call until it succeeds, up to {@link MAX_SENDS} sends, pausing two
 * seconds and then four between them. Every send's cost is counted, failed ones
 * included. An error the send throws passes straight through: only a failure it
 * returns is resent.
 *
 * @param args - The call, and what to do with each failure and the last.
 * @param args.send - Makes the call once.
 * @param args.onFailure - Told of each failed send: which send it was, counting from 1, and why.
 * @param args.exhausted - Builds the error thrown when the last send fails too.
 * @returns The successful send and what every send cost together.
 * @throws The error `exhausted` builds, when every send fails.
 * @typeParam TSent - What a successful send comes back with.
 */
export async function sendUntilAccepted<TSent extends { readonly cost: StageCost }>({
	send,
	onFailure,
	exhausted,
}: {
	readonly send: () => Promise<TSent | FailedSend>;
	readonly onFailure: (args: { readonly send: number; readonly failure: string }) => void;
	readonly exhausted: (args: { readonly failure: string; readonly sends: number }) => Error;
}): Promise<{ readonly sent: TSent; readonly cost: StageCost }> {
	let cost: StageCost | null = null;
	let pauseMs = FIRST_PAUSE_MS;
	for (let sends = 1; ; sends++) {
		const outcome = await send();
		cost = accumulateCost({ current: cost, incoming: outcome.cost });
		if (!isFailedSend(outcome)) {
			return { sent: outcome, cost };
		}
		onFailure({ send: sends, failure: outcome.failure });
		if (sends === MAX_SENDS) {
			throw exhausted({ failure: outcome.failure, sends });
		}
		await pause({ milliseconds: pauseMs });
		pauseMs *= 2;
	}
}
