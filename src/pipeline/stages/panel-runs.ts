/**
 * What the panel stages share around the model call: resending a reply that
 * came back unusable, and making a panel of runs that survives failure and
 * relaunch (technical-design.md §5, "Dividing the transcript", Panel runs).
 */

import { join, relative } from "node:path";
import type { Logger } from "pino";
import type { StageContext, StageCost, StageId, StageResult } from "../../types/pipeline.js";
import { mapWithConcurrency } from "../../utils/concurrency.js";
import { totalCost } from "../../utils/cost.js";
import { NamedError } from "../../utils/errors.js";
import { pathExists, readJsonSafe, writeJsonAtomic } from "../../utils/files.js";
import { sendUntilAccepted } from "../../utils/resend.js";
import { configuredStage } from "../../utils/stage-config.js";
import { type StageInWorkspace, stageDirectoryPaths } from "../layout.js";
import type { JsonReplyOutcome, UsableJsonReply } from "./model-stage.js";

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
 * Sends one call until its reply is usable, up to three sends, pausing two
 * seconds and then four between them. Every send's cost is counted, failed ones
 * included, because each was billed.
 *
 * Only an unusable reply is resent — empty, not JSON, the wrong shape. An error
 * thrown by the call itself passes straight through: the SDK has already
 * retried what is worth retrying at the HTTP level, a provider's refusal has
 * already been resent by the completion call (technical-design.md §6, §8), and
 * the rest, such as a prompt too long for the model, would fail the same way again.
 *
 * Every unusable reply is logged as a warning naming the call, which send it
 * was and why, so how often a model's replies are unusable, and in what way,
 * can be read back from the run's log even when a later send succeeds.
 *
 * @param args - The call, what to call it, and where to log.
 * @param args.send - Makes the call once.
 * @param args.what - Names the call in the log and in a failure, e.g. "run 3".
 * @param args.logger - The stage's logger, on which each unusable reply is recorded.
 * @returns The usable reply and what every send cost together.
 * @throws {ResendsExhaustedError} When the third send is still unusable.
 * @typeParam TReply - The reply the call expects back.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger carries mutable properties the rule cannot see past; it is only logged to here (CLAUDE.md permits dropping readonly where a library requires a mutable type)
export async function sendWithResends<TReply>({
	send,
	what,
	logger,
}: {
	readonly send: () => Promise<JsonReplyOutcome<TReply>>;
	readonly what: string;
	readonly logger: Logger;
}): Promise<UsableJsonReply<TReply>> {
	const { sent, cost } = await sendUntilAccepted({
		send,
		onFailure: ({ send: sends, failure }) => {
			logger.warn({ what, send: sends, reason: failure }, "Unusable reply");
		},
		exhausted: ({ failure, sends }) =>
			new ResendsExhaustedError(`${what} failed after ${sends} sends: ${failure}`),
	});
	return { reply: sent.reply, cost };
}

/**
 * Where a panel's runs are saved and how to recognise one: what both making a
 * panel and reading a finished one need to know.
 *
 * @typeParam TRun - What a run holds.
 */
type SavedPanel<TRun> = {
	/** How many runs the panel holds. */
	readonly panelSize: number;
	/** Where the run files are saved. */
	readonly directory: string;
	/** Whether a value read back from a run file is a run. */
	readonly isRun: (value: unknown) => value is TRun;
};

/**
 * The directory a panel stage saves its runs in: the one directory it works in.
 *
 * @param args - The workspace and the panel stage.
 * @param args.workspaceRoot - Absolute path to the lecture workspace.
 * @param args.stageId - The panel stage.
 * @returns The directory's absolute path.
 */
export function panelDirectory({ workspaceRoot, stageId }: StageInWorkspace): string {
	const [directory = workspaceRoot] = stageDirectoryPaths({ workspaceRoot, stageId });
	return directory;
}

/**
 * The files a panel's runs are saved to, in run order: numbered from 1 and
 * padded to two digits so they list in that order.
 *
 * @param args - Where the panel saves, and how many runs it holds.
 * @param args.directory - The panel's directory.
 * @param args.panelSize - How many runs the panel holds.
 * @returns Each run file's absolute path.
 */
function panelRunFiles({
	directory,
	panelSize,
}: Pick<SavedPanel<unknown>, "directory" | "panelSize">): readonly string[] {
	return [...Array(panelSize).keys()].map((index) =>
		join(directory, `run-${String(index + 1).padStart(2, "0")}.json`),
	);
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
 * @param args.makeRun - Makes one run, given its number counting from 1, with
 *   what its calls cost — `null` for a run that needed none.
 * @returns Every run in run order, the cost of the runs made by this launch —
 *   `null` when none of them made a call — and the run files.
 * @throws {SavedRunUnreadableError} When a run file left by an earlier launch holds no readable run.
 * @typeParam TRun - What a run holds.
 */
export async function runPanel<TRun>({
	panelSize,
	concurrency,
	directory,
	isRun,
	makeRun,
}: SavedPanel<TRun> & {
	readonly concurrency?: number | undefined;
	readonly makeRun: (args: {
		readonly runNumber: number;
	}) => Promise<{ readonly run: TRun; readonly cost: StageCost | null }>;
}): Promise<{
	readonly runs: readonly TRun[];
	readonly cost: StageCost | null;
	readonly runFiles: readonly string[];
}> {
	const runFiles = panelRunFiles({ directory, panelSize });
	const outcomes = await mapWithConcurrency({
		items: runFiles,
		limit: concurrency,
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
	return {
		runs: outcomes.map((outcome) => outcome.run),
		cost: totalCost(outcomes.map((outcome) => outcome.cost)),
		runFiles,
	};
}

/**
 * Reads back a panel an earlier stage finished, every run in run order. A stage
 * that goes on from a panel needs all of it, because a missing run changes what
 * the vote or the modal grouping means (technical-design.md §5, "Dividing the
 * transcript", Panel runs).
 *
 * @param args - Where the panel was saved, its size, what counts as a run, and how to fail.
 * @param args.panelSize - How many runs the panel holds.
 * @param args.directory - Where the run files were saved.
 * @param args.isRun - Whether a value read back from a run file is a run.
 * @param args.fail - Builds the reading stage's own error from a message.
 * @returns Every run, in run order.
 * @throws The error `fail` builds, naming the file, when a run is missing.
 * @throws {SavedRunUnreadableError} When a run file holds no readable run.
 * @typeParam TRun - What a run holds.
 */
export async function readPanel<TRun>({
	panelSize,
	directory,
	isRun,
	fail,
}: SavedPanel<TRun> & { readonly fail: (message: string) => Error }): Promise<readonly TRun[]> {
	const runs: TRun[] = [];
	for (const path of panelRunFiles({ directory, panelSize })) {
		const saved = await readSavedRun({ path, isRun });
		if (saved === null) {
			throw fail(`No run at ${path}: the panel of ${panelSize} runs is not complete`);
		}
		runs.push(saved);
	}
	return runs;
}

/**
 * Makes a stage's panel in the stage's own directory, with as many runs in
 * flight as the stage's `concurrency` allows, and reports it as the stage's
 * result: every run, what this launch's calls cost, and the run files as
 * workspace-relative paths.
 *
 * @param args - The stage, its lecture, and how to make and recognise a run.
 * @param args.stageId - The panel stage; picks its directory and its concurrency.
 * @param args.context - The current lecture run context.
 * @param args.isRun - Whether a value read back from a run file is a run.
 * @param args.makeRun - Makes one run, given its number counting from 1.
 * @returns The stage's result, holding every run in run order.
 * @throws {SavedRunUnreadableError} When a run file left by an earlier launch holds no readable run.
 * @typeParam TRun - What a run holds.
 */
export async function runStagePanel<TRun>({
	stageId,
	context,
	isRun,
	makeRun,
}: {
	readonly stageId: StageId;
	readonly context: StageContext;
} & Pick<Parameters<typeof runPanel<TRun>>[0], "isRun" | "makeRun">): Promise<
	StageResult<{ readonly runs: readonly TRun[] }>
> {
	const { runs, cost, runFiles } = await runPanel({
		panelSize: context.config.division.panelSize,
		concurrency: configuredStage({ config: context.config, stageId })?.concurrency,
		directory: panelDirectory({ workspaceRoot: context.workspaceRoot, stageId }),
		isRun,
		makeRun,
	});
	return {
		output: { runs },
		cost,
		filesWritten: runFiles.map((file) => relative(context.workspaceRoot, file)),
	};
}
