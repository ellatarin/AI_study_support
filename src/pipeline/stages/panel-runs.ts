/**
 * This module holds what the panel stages share around the model call. It makes a
 * panel whose saved runs survive a failure and a later invocation. See
 * technical-design.md §5, "Dividing the transcript", Panel runs.
 */

import { join, relative } from "node:path";
import type { StageContext, StageCost, StageId, StageResult } from "../../types/pipeline.js";
import { NamedError } from "../../utils/errors.js";
import { configuredStage } from "../../utils/stage-config.js";
import { savedRunFileName, stageDirectoryPath } from "../layout.js";
import type { OwnJsonRequest, StageModelCalls } from "./model-stage.js";
import { readOrMakeSavedFiles, readSavedFile, type SavedFileReader } from "./saved-files.js";

/**
 * A saved run that is not JSON or not a run. A saved run is written whole or not
 * at all, so an unreadable one was changed outside the pipeline. The pipeline
 * reports it and does not make it again (technical-design.md §5, "Dividing the
 * transcript", Panel runs).
 */
export class SavedRunUnreadableError extends NamedError {}

/**
 * The size and the folder of a panel's saved runs, and the reader of one saved run.
 *
 * @typeParam TRun - The contents of one run.
 */
type SavedPanel<TRun> = {
	readonly panelSize: number;
	readonly directory: string;
	/** Reads a parsed saved run as a run, or gives `null` when it is not one. */
	readonly readRun: (value: unknown) => TRun | null;
};

/**
 * The paths of a panel's saved runs, in run order.
 *
 * @param args - The folder of the panel, and its size.
 * @param args.directory - The folder of the panel.
 * @param args.panelSize - The number of runs in the panel.
 * @returns The absolute path of each saved run.
 */
function savedRunPaths({
	directory,
	panelSize,
}: Pick<SavedPanel<unknown>, "directory" | "panelSize">): readonly string[] {
	return [...Array(panelSize).keys()].map((index) =>
		join(directory, savedRunFileName({ runNumber: index + 1 })),
	);
}

/**
 * The reader of one saved run, with the panel's error for an unreadable run.
 *
 * @param readRun - Reads a parsed value as a run.
 * @returns The reader that {@link readSavedFile} and {@link readOrMakeSavedFiles} take.
 * @typeParam TRun - The contents of one run.
 */
function savedRunReader<TRun>(readRun: SavedPanel<TRun>["readRun"]): SavedFileReader<TRun> {
	return {
		readSaved: readRun,
		unreadable: (path) =>
			new SavedRunUnreadableError(
				`${path} holds no readable run. A saved run is written whole, so something else changed it; delete it to make the run again.`,
			),
	};
}

/**
 * Makes a panel of independent runs, a few at a time, and saves each run to its own
 * file when it completes. The runs that an earlier invocation saved are read back,
 * and only the missing runs are made. So a crash loses only the runs in flight.
 *
 * When a run fails, no further run starts. The runs in flight finish and are saved,
 * and then the panel fails. The panel never gives only some of its runs
 * (technical-design.md §5, "Dividing the transcript", Panel runs).
 *
 * @param args - The size and the folder of the panel, and how to make and read a run.
 * @param args.panelSize - The number of runs in the panel.
 * @param args.concurrency - The most runs in flight at the same time. Unset means one at a time.
 * @param args.directory - The folder for the saved runs. It must already exist.
 * @param args.readRun - Reads a parsed saved run as a run.
 * @param args.makeRun - Makes one run, given its number from 1. It also gives the
 *   cost of the run's calls, or `null` for a run that made no call.
 * @returns Every run in run order, the cost of the runs that this invocation made,
 *   and the paths of the saved runs. The cost is `null` when no run made a call.
 * @throws {SavedRunUnreadableError} When a saved run holds no readable run.
 * @typeParam TRun - The contents of one run.
 */
export async function runPanel<TRun>({
	panelSize,
	concurrency,
	directory,
	readRun,
	makeRun,
}: SavedPanel<TRun> & {
	readonly concurrency?: number | undefined;
	readonly makeRun: (args: {
		readonly runNumber: number;
	}) => Promise<{ readonly run: TRun; readonly cost: StageCost | null }>;
}): Promise<{
	readonly runs: readonly TRun[];
	readonly cost: StageCost | null;
	readonly savedRunFiles: readonly string[];
}> {
	const savedRunFiles = savedRunPaths({ directory, panelSize });
	const { contents, cost } = await readOrMakeSavedFiles({
		files: [...savedRunFiles.entries()].map(([index, path]) => ({ path, runNumber: index + 1 })),
		label: "Runs",
		concurrency,
		...savedRunReader(readRun),
		make: async ({ runNumber }) => {
			const made = await makeRun({ runNumber });
			return { content: made.run, cost: made.cost };
		},
	});
	return { runs: contents, cost, savedRunFiles };
}

/**
 * Reads back every run of a panel that an earlier stage made, in run order. A stage
 * that uses a panel needs all of its runs, because a missing run changes the vote
 * (technical-design.md §5, "Dividing the transcript", Panel runs).
 *
 * @param args - The size and the folder of the panel, the reader of a run, and the error to raise.
 * @param args.panelSize - The number of runs in the panel.
 * @param args.directory - The folder of the saved runs.
 * @param args.readRun - Reads a parsed saved run as a run.
 * @param args.fail - Builds the error of the reading stage from a message.
 * @returns Every run, in run order.
 * @throws The error that `fail` builds, with the path, when a run is missing.
 * @throws {SavedRunUnreadableError} When a saved run holds no readable run.
 * @typeParam TRun - The contents of one run.
 */
export async function readPanel<TRun>({
	panelSize,
	directory,
	readRun,
	fail,
}: SavedPanel<TRun> & { readonly fail: (message: string) => Error }): Promise<readonly TRun[]> {
	const runs: TRun[] = [];
	for (const path of savedRunPaths({ directory, panelSize })) {
		const saved = await readSavedFile({ path, ...savedRunReader(readRun) });
		if (saved === null) {
			throw fail(`No run at ${path}: the panel of ${panelSize} runs is not complete`);
		}
		runs.push(saved);
	}
	return runs;
}

/**
 * Makes the panel of a stage in the stage's folder, with as many runs in flight as
 * the stage's `concurrency` allows. The stage result holds every run, the cost of
 * this invocation's calls, and the workspace-relative paths of the saved runs.
 *
 * @param args - The stage, the stage context, the panel size, and how to make and read a run.
 * @param args.stageId - The panel stage. It sets the folder and the concurrency.
 * @param args.context - The stage context of the current lecture.
 * @param args.panelSize - The number of runs in the panel.
 * @param args.readRun - Reads a parsed saved run as a run.
 * @param args.makeRun - Makes one run, given its number from 1.
 * @returns The stage result, with every run in run order.
 * @throws {SavedRunUnreadableError} When a saved run holds no readable run.
 * @typeParam TRun - The contents of one run.
 */
export async function runStagePanel<TRun>({
	stageId,
	context,
	panelSize,
	readRun,
	makeRun,
}: {
	readonly stageId: StageId;
	readonly context: StageContext;
} & Pick<Parameters<typeof runPanel<TRun>>[0], "panelSize" | "readRun" | "makeRun">): Promise<
	StageResult<{ readonly runs: readonly TRun[] }>
> {
	const { runs, cost, savedRunFiles } = await runPanel({
		panelSize,
		concurrency: configuredStage({ config: context.config, stageId })?.concurrency,
		directory: stageDirectoryPath({ workspaceRoot: context.workspaceRoot, stageId }),
		readRun,
		makeRun,
	});
	return {
		output: { runs },
		cost,
		filesWritten: savedRunFiles.map((file) => relative(context.workspaceRoot, file)),
	};
}

/**
 * {@link runStagePanel} for a panel in which each run is one JSON call with the
 * same request, resent until its reply is usable. `initial-subtopic-splitting`
 * and `group-into-topics` use it.
 *
 * @param args - The stage, the stage context, the panel size, the reader of a saved run, and the call of each run.
 * @param args.stageId - The panel stage. It sets the folder, the concurrency, the model and the tuning.
 * @param args.context - The stage context of the current lecture.
 * @param args.panelSize - The number of runs in the panel.
 * @param args.readRun - Reads a parsed saved run as a run.
 * @param args.runName - The name of each run in the log and in a failure, before its number, such as "Grouping run".
 * @param args.calls - The model calls of the stage run.
 * @param args.request - The stage's own part of the call of each run. Its `use` makes the run from the reply.
 * @returns The stage result, with every run in run order.
 * @throws {SavedRunUnreadableError} When a saved run holds no readable run.
 * @throws {ResendsExhaustedError} When the reply of a run's third send is still unusable.
 * @typeParam TReply - The reply that each call expects.
 * @typeParam TRun - The contents of one run.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- the request carries the message-param library type, which is not deeply readonly
export function runOneCallPanel<TReply, TRun>({
	stageId,
	context,
	panelSize,
	readRun,
	runName,
	calls,
	request,
}: {
	readonly stageId: StageId;
	readonly context: StageContext;
	readonly panelSize: number;
	readonly readRun: (value: unknown) => TRun | null;
	readonly runName: string;
	readonly calls: StageModelCalls;
	readonly request: OwnJsonRequest<TReply> & {
		readonly use: (reply: TReply) => { readonly reply: TRun } | { readonly failure: string };
	};
}): Promise<StageResult<{ readonly runs: readonly TRun[] }>> {
	return runStagePanel({
		stageId,
		context,
		panelSize,
		readRun,
		makeRun: async ({ runNumber }) => {
			const sent = await calls.sendJsonWithResends({
				...request,
				what: `${runName} ${runNumber}`,
			});
			return { run: sent.reply, cost: sent.cost };
		},
	});
}
