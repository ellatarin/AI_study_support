/**
 * This module resends a call after a failure that a resend can fix. A call is
 * sent at most three times, with pauses of two seconds and then four. Two
 * failures are resent with it: a provider error (technical-design.md §6), and an
 * unusable reply in a panel stage (§5, "Dividing the transcript", Panel runs). So
 * the resend of a provider error and the resend of an unusable reply cannot
 * become different. Each send adds its own cost to the cost tally (§7).
 */

/** The most sends of one call. After the last failed send, the failure is final. */
export const MAX_SENDS = 3;

/**
 * The pause before the first resend. Each later pause is twice the one before.
 * The pause is short, because a plain resend has fixed the failures that this
 * module resends.
 */
const FIRST_PAUSE_MS = 2000;

/** A send that failed in a way a resend can fix. */
export type FailedSend = { readonly failure: string };

/**
 * Waits for a time: before a resend here, and before a turn in `send-gate.ts`.
 *
 * @param args - The length of the wait.
 * @param args.milliseconds - The length of the pause.
 * @returns A promise that resolves when the pause is over.
 */
export function pause({ milliseconds }: { readonly milliseconds: number }): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, milliseconds);
	});
}

/**
 * Checks that the outcome of a send is a failure to resend.
 *
 * @param outcome - The value that one send came back with.
 * @returns `true` when the send failed.
 * @typeParam TSent - The value that a successful send comes back with.
 */
function isFailedSend<TSent, TFailed extends FailedSend>(
	outcome: TSent | TFailed,
): outcome is TFailed {
	return typeof outcome === "object" && outcome !== null && "failure" in outcome;
}

/**
 * Sends a call until it succeeds, at most {@link MAX_SENDS} times. Only a failure
 * that `send` returns is resent. An error that `send` throws goes to the caller
 * at once.
 *
 * @param args - The call, and what to do with each failure and the last.
 * @param args.send - Sends the call once.
 * @param args.onFailure - Gets each failed send: its number, counting from 1, and the failed send.
 * @param args.exhausted - Builds the error that is thrown when the last send fails too.
 * @returns The successful send, and its number counting from 1.
 * @throws The error `exhausted` builds, when every send fails.
 * @typeParam TSent - The value that a successful send comes back with.
 * @typeParam TFailed - The value that a failed send comes back with.
 */
export async function sendUntilAccepted<TSent, TFailed extends FailedSend = FailedSend>({
	send,
	onFailure,
	exhausted,
}: {
	readonly send: () => Promise<TSent | TFailed>;
	readonly onFailure: (args: TFailed & { readonly send: number }) => void;
	readonly exhausted: (args: { readonly failure: string; readonly sends: number }) => Error;
}): Promise<{ readonly sent: TSent; readonly sends: number }> {
	let pauseMs = FIRST_PAUSE_MS;
	for (let sends = 1; ; sends++) {
		const outcome = await send();
		if (!isFailedSend<TSent, TFailed>(outcome)) {
			return { sent: outcome, sends };
		}
		onFailure({ ...outcome, send: sends });
		if (sends === MAX_SENDS) {
			throw exhausted({ failure: outcome.failure, sends });
		}
		await pause({ milliseconds: pauseMs });
		pauseMs *= 2;
	}
}
