/**
 * What the panel stages share around the model call: resending a reply that
 * came back unusable, and making a panel of runs that survives failure and
 * relaunch (technical-design.md §5, "Dividing the transcript", Panel runs).
 */

import type { StageCost } from "../../types/pipeline.js";
import { accumulateCost } from "../../utils/cost.js";
import { NamedError } from "../../utils/errors.js";
import type { JsonReplyOutcome } from "./model-stage.js";

/** How many times one call is sent before its failure fails the stage. */
const MAX_SENDS = 3;

/**
 * The pause before the first resend; each later pause is twice the one before.
 * Short, because a provider's empty reply has always succeeded when resent.
 */
const FIRST_PAUSE_MS = 2000;

/** A call still unusable after its last send. Names what was sent and why the last send failed. */
export class ResendsExhaustedError extends NamedError {}

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
 * Sends one call until its reply is usable, up to three sends, pausing two
 * seconds and then four between them. Every send's cost is counted, failed ones
 * included, because each was billed.
 *
 * Only an unusable reply is resent — empty, not JSON, the wrong shape. An error
 * thrown by the call itself passes straight through: the SDK has already
 * retried what is worth retrying at the HTTP level (technical-design.md §8), and
 * the rest, such as a prompt too long for the model, would fail the same way again.
 *
 * @param args - The call, and what to call it in a failure.
 * @param args.send - Makes the call once.
 * @param args.what - Names the call for a failure, e.g. "run 3".
 * @returns The usable reply and what every send cost together.
 * @throws {ResendsExhaustedError} When the third send is still unusable.
 * @typeParam TReply - The reply the call expects back.
 */
export async function sendWithResends<TReply>({
	send,
	what,
}: {
	readonly send: () => Promise<JsonReplyOutcome<TReply>>;
	readonly what: string;
}): Promise<{ readonly reply: TReply; readonly cost: StageCost }> {
	let cost: StageCost | null = null;
	let pauseMs = FIRST_PAUSE_MS;
	for (let sends = 1; ; sends++) {
		const outcome = await send();
		cost = cost === null ? outcome.cost : accumulateCost({ current: cost, incoming: outcome.cost });
		if (!("failure" in outcome)) {
			return { reply: outcome.reply, cost };
		}
		if (sends === MAX_SENDS) {
			throw new ResendsExhaustedError(
				`${what} failed after ${MAX_SENDS} sends: ${outcome.failure}`,
			);
		}
		await pause({ milliseconds: pauseMs });
		pauseMs *= 2;
	}
}
