/**
 * What the panel stages share around the model call: resending a reply that
 * came back unusable, and making a panel of runs that survives failure and
 * relaunch (technical-design.md §5, "Dividing the transcript", Panel runs).
 */

import { join } from "node:path";
import type { StageCost } from "../../types/pipeline.js";
import { mapWithConcurrency } from "../../utils/concurrency.js";
import { accumulateCost } from "../../utils/cost.js";
import { NamedError } from "../../utils/errors.js";
import { pathExists, readJsonSafe, writeJsonAtomic } from "../../utils/files.js";
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
 * A run file an earlier launch left that is not JSON or not a run. Every run
 * file is written whole or not at all (technical-design.md §4.3), so one that
 * cannot be read was changed by something outside the pipeline, and is reported
 * rather than silently made again.
 */
export class SavedRunUnreadableError extends NamedError {}

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
		cost = accumulateCost({ current: cost, incoming: outcome.cost });
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

/**
 * The file a run is saved to, numbered from 1 and padded to two digits so the
 * panel's files list in run order.
 *
 * @param args - Where the panel saves, and which run.
 * @param args.directory - The panel's directory.
 * @param args.runNumber - The run, counting from 1.
 * @returns The run file's absolute path.
 */
function runFilePath({
	directory,
	runNumber,
}: {
	readonly directory: string;
	readonly runNumber: number;
}): string {
	return join(directory, `run-${String(runNumber).padStart(2, "0")}.json`);
}

/**
 * The run an earlier launch saved at `path`, or `null` when there is none.
 *
 * @param args - The file, and what counts as a run.
 * @param args.path - The run file.
 * @param args.isRun - Whether a parsed value is a run.
 * @returns The saved run, or `null` when no file is there.
 * @throws {SavedRunUnreadableError} When a file is there but holds no readable run.
 * @typeParam TRun - What a run holds.
 */
async function readSavedRun<TRun>({
	path,
	isRun,
}: {
	readonly path: string;
	readonly isRun: (value: unknown) => value is TRun;
}): Promise<TRun | null> {
	if (!(await pathExists(path))) {
		return null;
	}
	const saved = await readJsonSafe(path);
	if (!isRun(saved)) {
		throw new SavedRunUnreadableError(
			`${path} holds no readable run. A run file is written whole, so something else changed it; delete it to make the run again.`,
		);
	}
	return saved;
}

/**
 * Makes a panel of independent runs, a few at a time, saving each to its own
 * file the moment it completes. A relaunch reads back the runs already saved
 * and makes only the missing ones, so a crash or a failed run loses only the
 * runs in flight, and nothing already paid for is paid for again. The panel is
 * all or nothing: a run that fails fails the panel, and no partial panel is
 * ever returned (technical-design.md §5, "Dividing the transcript", Panel runs).
 *
 * @param args - The panel's size and home, and how to make and recognise a run.
 * @param args.panelSize - How many runs the panel holds.
 * @param args.concurrency - The most runs in flight at once; unset means one at a time.
 * @param args.directory - Where the run files are saved; it must already exist.
 * @param args.isRun - Whether a value read back from a run file is a run.
 * @param args.makeRun - Makes one run, given its number counting from 1.
 * @returns Every run in run order, the cost of the runs made by this launch —
 *   `null` when it made none — and the run files.
 * @throws {SavedRunUnreadableError} When a run file left by an earlier launch holds no readable run.
 * @typeParam TRun - What a run holds.
 */
export async function runPanel<TRun>({
	panelSize,
	concurrency,
	directory,
	isRun,
	makeRun,
}: {
	readonly panelSize: number;
	readonly concurrency?: number | undefined;
	readonly directory: string;
	readonly isRun: (value: unknown) => value is TRun;
	readonly makeRun: (args: {
		readonly runNumber: number;
	}) => Promise<{ readonly run: TRun; readonly cost: StageCost }>;
}): Promise<{
	readonly runs: readonly TRun[];
	readonly cost: StageCost | null;
	readonly runFiles: readonly string[];
}> {
	const runFiles = [...Array(panelSize).keys()].map((index) =>
		runFilePath({ directory, runNumber: index + 1 }),
	);
	const outcomes = await mapWithConcurrency({
		items: runFiles,
		limit: concurrency ?? 1,
		work: async ({ item: path, index }) => {
			const saved = await readSavedRun({ path, isRun });
			if (saved !== null) {
				return { run: saved, cost: null };
			}
			const made = await makeRun({ runNumber: index + 1 });
			await writeJsonAtomic({ path, value: made.run });
			return made;
		},
	});
	let cost: StageCost | null = null;
	for (const outcome of outcomes) {
		if (outcome.cost !== null) {
			cost = accumulateCost({ current: cost, incoming: outcome.cost });
		}
	}
	return { runs: outcomes.map((outcome) => outcome.run), cost, runFiles };
}
