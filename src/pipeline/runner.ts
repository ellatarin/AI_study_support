import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "pino";
import type {
	BatchOptions,
	BatchSummary,
	LectureIdentityChanges,
	LectureMatch,
	Manifest,
	PipelineConfig,
	PipelineRunOptions,
	PipelineRunReporter,
	PipelineRunSummary,
	PipelineStage,
	PipelineStageOutcome,
	ReportOptions,
	RunLog,
	RunLogCost,
	RunLogStageEntry,
	RunType,
	SourceNormalisationStage,
	StageConfigUsed,
	StageContext,
	StageCost,
	StageEntry,
	StageId,
	StageResult,
} from "../types/pipeline.js";
import {
	DEFAULT_BATCH_OPTIONS,
	DEFAULT_PIPELINE_RUN_OPTIONS,
	STAGE_IDS,
} from "../types/pipeline.js";
import { mapWithConcurrency } from "../utils/concurrency.js";
import { errorMessage } from "../utils/errors.js";
import {
	listSubdirectoryNames,
	readDirSafe,
	readJsonSafe,
	writeJsonAtomic,
} from "../utils/files.js";
import { createStageLogger } from "../utils/logger.js";
import { isRecord } from "../utils/record.js";
import { configuredStage } from "../utils/stage-config.js";
import { isStageAfter } from "../utils/stage-id.js";
import { moduleDirs, resolveStageOutput, runLogsDirPath, type StageInWorkspace } from "./layout.js";
import { removeLectureFileByDate } from "./lecture-files.js";
import { patchManifest, readManifest, readManifestSafe, writeManifest } from "./manifest.js";
import { createMoneyFormatter, formatCostReport } from "./reports.js";
import {
	isCompletedEntry,
	stageOutcomeStatus,
	summariseLectures,
	summariseOverallStatus,
} from "./run-status.js";
import { assembleContext } from "./stage-context.js";

/**
 * The dependencies of {@link PipelineRunner}. The stages are injected, so tests
 * can drive the runner with stub stages (technical-design.md §4.7).
 */
export type PipelineRunnerDeps = {
	readonly config: PipelineConfig;
	readonly sourceNormalisation: Readonly<SourceNormalisationStage>;
	readonly lectureStages: readonly Readonly<PipelineStage<unknown, unknown>>[];
	/** The debug logger. The runner records each stage failure on it, with the stack (technical-design.md §8, §10). */
	readonly logger: Logger;
	/** Receives the events of a pipeline run as they occur. The CLI decides what the user sees (technical-design.md §10). */
	readonly reporter: PipelineRunReporter;
};

type ModuleScope = { readonly moduleRoots: readonly string[] };

type ModuleScopedArgs<TOptions> = ModuleScope & {
	readonly options?: TOptions;
};

/**
 * Makes a timestamp id from an instant: the ISO 8601 time without milliseconds,
 * with hyphens in place of colons, such as `2025-10-10T09-00-00Z`. The id names a
 * pipeline run and an invocation (technical-design.md §4.6, §4.7).
 *
 * @param args - The instant.
 * @param args.instant - The moment that the pipeline run or the invocation starts.
 * @returns The timestamp id, which is safe in a file name.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- Date has methods that change it, but this function only reads it
export function deriveTimestampId({ instant }: { readonly instant: Date }): string {
	return instant
		.toISOString()
		.replace(/\.\d+Z$/, "Z")
		.replace(/:/g, "-");
}

/**
 * Decides the run type from the stage entry of the `--from-stage` target
 * (technical-design.md §7, "Run Classification").
 *
 * @param args - The pipeline run options and the manifest.
 * @param args.options - The pipeline run options. Only `fromStage` is read.
 * @param args.manifest - The manifest, as read before the reset.
 * @returns `normal` when there is no target, `experiment` when the target's
 *   stage entry is `complete` or `skipped`, and `error-recovery` otherwise.
 */
function decideRunType({
	options,
	manifest,
}: {
	readonly options: PipelineRunOptions;
	readonly manifest: Manifest;
}): RunType {
	const { fromStage } = options;
	if (fromStage === undefined) {
		return "normal";
	}
	if (isCompletedEntry(manifest.stages[fromStage])) {
		return "experiment";
	}
	return "error-recovery";
}

type ModuleQuery = { readonly moduleRoot: string };

async function listWorkspaces({ moduleRoot }: ModuleQuery): Promise<readonly string[]> {
	const processingRoot = moduleDirs({ moduleRoot }).processing;
	const names = await listSubdirectoryNames(processingRoot);
	return names.map((name) => join(processingRoot, name));
}

/** A lecture workspace and its manifest. */
type LocatedWorkspace = {
	readonly workspaceRoot: string;
	readonly manifest: Manifest;
};

/**
 * Lists a module's lectures, earliest first. A lecture is a folder in
 * `Pipeline processing/` that holds a readable manifest. Other folders are skipped
 * (technical-design.md §4.5).
 *
 * The order comes from each manifest's `lectureDate`. A directory listing has no
 * fixed order, and base names do not sort by date: `Lecture 10` sorts before
 * `Lecture 2`. An ISO date sorts by date as text.
 *
 * @param args - The module to list.
 * @param args.moduleRoot - Absolute path to the module directory.
 * @returns The module's lectures with their manifests, earliest first.
 */
async function listLecturesByDate({
	moduleRoot,
}: ModuleQuery): Promise<readonly LocatedWorkspace[]> {
	const located: LocatedWorkspace[] = [];
	for (const workspaceRoot of await listWorkspaces({ moduleRoot })) {
		const manifest = await readManifestSafe({ workspaceRoot });
		if (manifest !== null) {
			located.push({ workspaceRoot, manifest });
		}
	}
	// eslint-disable-next-line max-params -- the language specification sets the parameters of a sort comparator
	located.sort((left, right) =>
		left.manifest.lectureDate.localeCompare(right.manifest.lectureDate),
	);
	return located;
}

/**
 * Finds the module's lecture with the given date. The manifests are read, not the
 * base names, because a base name changes with the lecture number and title
 * (technical-design.md §4.7).
 *
 * `source-normalisation` keeps each date unique in a module, so the first match
 * is the only match.
 *
 * @param args - The module to search and the date to match.
 * @param args.moduleRoot - Absolute path to the module directory.
 * @param args.lectureDate - The `YYYY-MM-DD` date to match.
 * @returns The workspace and its manifest, or `null` when the module holds no such lecture.
 */
async function findLectureByDate({
	moduleRoot,
	lectureDate,
}: {
	readonly moduleRoot: string;
	readonly lectureDate: string;
}): Promise<LocatedWorkspace | null> {
	const located = await listLecturesByDate({ moduleRoot });
	return located.find((entry) => entry.manifest.lectureDate === lectureDate) ?? null;
}

/**
 * Finds the lecture's workspace and reads its manifest. When no manifest reads at
 * the known path, the lecture is found again by its date. `transcript-structuring`
 * moves the workspace when it replaces the lecture title (technical-design.md
 * §4.7, "Following a relocated workspace").
 *
 * @param args - The lecture to find.
 * @param args.workspaceRoot - The workspace path that the runner knows.
 * @param args.moduleRoot - Absolute path to the lecture's module.
 * @param args.lectureDate - The lecture's `YYYY-MM-DD` date, which does not change during a pipeline run.
 * @returns The workspace path now, and the manifest read from it.
 * @throws {Error} If no manifest reads at the path and no workspace in the module has the date.
 */
async function resolveWorkspace({
	workspaceRoot,
	moduleRoot,
	lectureDate,
}: {
	readonly workspaceRoot: string;
	readonly moduleRoot: string;
	readonly lectureDate: string;
}): Promise<LocatedWorkspace> {
	const manifest = await readManifestSafe({ workspaceRoot });
	if (manifest !== null) {
		return { workspaceRoot, manifest };
	}
	const relocated = await findLectureByDate({ moduleRoot, lectureDate });
	if (relocated === null) {
		throw new Error(
			`No manifest at ${workspaceRoot}, and no workspace under ${moduleRoot} carries the date ${lectureDate}`,
		);
	}
	return relocated;
}

function resolveStageRunConfig(args: {
	readonly config: PipelineConfig;
	readonly stageId: StageId;
}): StageConfigUsed | null {
	const stageConfig = configuredStage(args);
	return stageConfig === null ? null : { ...stageConfig };
}

function patchStages({
	stages,
	stageId,
	entry,
}: {
	readonly stages: Manifest["stages"];
	readonly stageId: StageId;
	readonly entry: StageEntry;
}): Manifest["stages"] {
	return { ...stages, [stageId]: entry };
}

/**
 * Writes one stage entry, and any lecture identity that the stage decided, to the
 * manifest in one write (technical-design.md §4.2, §4.7).
 *
 * @param args - The write inputs.
 * @param args.workspaceRoot - Absolute path to the workspace.
 * @param args.manifest - The manifest to change, which the caller already read.
 * @param args.stageId - The stage whose entry is set.
 * @param args.entry - The stage entry.
 * @param args.identityChanges - The lecture identity that the stage decided. Only `transcript-structuring` decides one.
 * @param args.timestamp - The instant to put in `updatedAt`.
 * @returns The manifest as written, so the caller can rebuild the stage context without a second read.
 */
function updateManifest({
	workspaceRoot,
	manifest,
	stageId,
	entry,
	identityChanges,
	timestamp,
}: {
	readonly workspaceRoot: string;
	readonly manifest: Manifest;
	readonly stageId: StageId;
	readonly entry: StageEntry;
	readonly identityChanges: LectureIdentityChanges;
	readonly timestamp: string;
}): Promise<Manifest> {
	return patchManifest({
		workspaceRoot,
		manifest,
		changes: {
			...identityChanges,
			stages: patchStages({ stages: manifest.stages, stageId, entry }),
		},
		updatedAt: timestamp,
	});
}

// A `skipped` entry keeps the time, settings, cost and files of the earlier
// completion (technical-design.md §4.5). If the earlier stage entry is not a
// completed one, the `skipped` entry records this instant and no cost or files.
function skippedEntry({
	context,
	stageId,
	timestamp,
}: {
	readonly context: StageContext;
	readonly stageId: StageId;
	readonly timestamp: string;
}): StageEntry {
	const prior = context.manifest.stages[stageId];
	const completed = isCompletedEntry(prior) ? prior : null;
	return {
		status: "skipped",
		completedAt: completed?.completedAt ?? timestamp,
		configUsed: completed?.configUsed ?? null,
		cost: completed?.cost ?? null,
		filesWritten: completed?.filesWritten ?? [],
	};
}

function runLogCost(cost: StageCost | null): RunLogCost {
	if (cost === null) {
		return { costUsd: null, callCount: 0 };
	}
	return { costUsd: cost.costUsd, callCount: cost.callCount };
}

/**
 * One stage's run log entry, and the context for the next stage. A stage can
 * change the lecture title and move the workspace, so the next context can differ
 * (technical-design.md §4.7).
 */
type StageOutcome = {
	readonly entry: RunLogStageEntry;
	readonly context: StageContext;
};

/**
 * Writes one stage's status changes to the manifest, and keeps the context from
 * the last write (technical-design.md §4.7). Each write finds the workspace
 * first, because the stage can move it.
 */
type StageStatusWriter = {
	/** The stage's output is on disk. The entry keeps the details of the earlier completion. */
	skipped(): Promise<void>;
	/**
	 * The `running` entry is written before the stage starts. If the invocation
	 * stops while the stage runs, `running` stays in the manifest, and the next
	 * pipeline run does the stage again.
	 */
	running(): Promise<void>;
	/** The stage returned. The entry records what it made, with any lecture identity that it decided (technical-design.md §4.2). */
	complete(args: {
		readonly configUsed: StageConfigUsed | null;
		readonly result: StageResult<unknown>;
	}): Promise<void>;
	/** The stage threw. The entry records the error message that the user sees. */
	failed(args: {
		readonly configUsed: StageConfigUsed | null;
		readonly error: string;
	}): Promise<void>;
	/** The context for the next stage, from the last write. */
	context(): StageContext;
};

/**
 * Makes the {@link StageStatusWriter} for one stage of one lecture.
 *
 * @param args - The stage, its lecture and the instant.
 * @param args.stageId - The stage whose entry each write sets.
 * @param args.context - The context that the stage runs against.
 * @param args.config - The pipeline configuration, to rebuild the context.
 * @param args.timestamp - The instant that each write records.
 * @returns The status writer.
 */
function createStageStatusWriter({
	stageId,
	context,
	config,
	timestamp,
}: {
	readonly stageId: StageId;
	readonly context: StageContext;
	readonly config: PipelineConfig;
	readonly timestamp: string;
}): StageStatusWriter {
	// The context for the NEXT stage. The stage that runs keeps the context it was
	// given, so its own entry does not change during its run.
	let nextContext = context;
	const write = async ({
		entry,
		identityChanges,
	}: {
		readonly entry: StageEntry;
		readonly identityChanges: LectureIdentityChanges;
	}): Promise<void> => {
		const located = await resolveWorkspace({
			workspaceRoot: nextContext.workspaceRoot,
			moduleRoot: nextContext.moduleRoot,
			lectureDate: nextContext.lectureDate,
		});
		const manifest = await updateManifest({
			workspaceRoot: located.workspaceRoot,
			manifest: located.manifest,
			stageId,
			entry,
			identityChanges,
			timestamp,
		});
		nextContext = assembleContext({ workspaceRoot: located.workspaceRoot, manifest, config });
	};

	return {
		skipped: () =>
			write({ entry: skippedEntry({ context, stageId, timestamp }), identityChanges: {} }),
		running: () => write({ entry: { status: "running" }, identityChanges: {} }),
		complete: ({ configUsed, result }) =>
			write({
				entry: {
					status: "complete",
					completedAt: timestamp,
					configUsed,
					cost: result.cost,
					filesWritten: result.filesWritten,
				},
				identityChanges: result.identityChanges ?? {},
			}),
		failed: ({ configUsed, error }) =>
			write({
				entry: {
					status: "failed",
					failedAt: timestamp,
					error,
					configUsed,
					cost: null,
					filesWritten: [],
				},
				identityChanges: {},
			}),
		context: () => nextContext,
	};
}

// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger has mutable properties, and this function only writes log entries to it. CLAUDE.md allows a mutable type that a library requires
async function runStage({
	stage,
	context,
	config,
	timestamp,
	logger,
	reporter,
}: {
	readonly stage: Readonly<PipelineStage<unknown, unknown>>;
	readonly context: StageContext;
	readonly config: PipelineConfig;
	readonly timestamp: string;
	readonly logger: Logger;
	readonly reporter: PipelineRunReporter;
}): Promise<StageOutcome> {
	const { stageId } = stage;
	const statusWriter = createStageStatusWriter({ stageId, context, config, timestamp });

	if (await stage.isComplete(context)) {
		reporter({ event: "stage-skipped", stageId });
		await statusWriter.skipped();
		return { entry: { action: "skipped" }, context: statusWriter.context() };
	}
	const configUsed = resolveStageRunConfig({ config, stageId });
	reporter({ event: "stage-started", stageId });
	await statusWriter.running();
	try {
		const input = await stage.getInput(context);
		const result = await stage.run({ input, context });
		await statusWriter.complete({ configUsed, result });
		reporter({ event: "stage-completed", stageId, cost: result.cost });
		return {
			entry: { action: "ran", status: "complete", configUsed, cost: runLogCost(result.cost) },
			context: statusWriter.context(),
		};
	} catch (error: unknown) {
		const message = errorMessage(error);
		// The user sees only the message. The stack goes to the debug log, where an
		// unexpected failure is diagnosed (technical-design.md §8, §10).
		createStageLogger({ logger, stageId }).error({ err: error }, "Stage failed");
		reporter({ event: "stage-failed", stageId });
		await statusWriter.failed({ configUsed, error: message });
		return {
			entry: {
				action: "ran",
				status: "failed",
				error: message,
				configUsed,
				cost: runLogCost(null),
			},
			context: statusWriter.context(),
		};
	}
}

/**
 * Deletes one stage's output for one lecture. A directory in the workspace is
 * deleted whole. In the module's `Final output/`, only the file with this
 * lecture's date is deleted (technical-design.md §4.4, "Stage cleanup boundaries").
 *
 * @param args - The lecture and the stage.
 * @param args.workspaceRoot - Absolute path to the lecture workspace.
 * @param args.stageId - The stage whose output to delete.
 * @param args.lectureDate - The `YYYY-MM-DD` date in this lecture's file names.
 * @returns A promise that resolves when the output is deleted.
 */
async function deleteStageOutput({
	workspaceRoot,
	stageId,
	lectureDate,
}: StageInWorkspace & { readonly lectureDate: string }): Promise<void> {
	const output = resolveStageOutput({ workspaceRoot, stageId });
	if (output.root === "module") {
		await removeLectureFileByDate({ dir: output.directory, lectureDate });
		return;
	}
	for (const path of output.directories) {
		await rm(path, { recursive: true, force: true });
	}
}

// The reset walks `STAGE_IDS`, from `fromStage` to the last stage.
async function resetFromStage({
	workspaceRoot,
	manifest,
	fromStage,
	timestamp,
}: {
	readonly workspaceRoot: string;
	readonly manifest: Manifest;
	readonly fromStage: StageId;
	readonly timestamp: string;
}): Promise<Manifest> {
	let stages = manifest.stages;
	for (const stageId of STAGE_IDS.slice(STAGE_IDS.indexOf(fromStage))) {
		stages = patchStages({ stages, stageId, entry: { status: "pending" } });
		await deleteStageOutput({ workspaceRoot, stageId, lectureDate: manifest.lectureDate });
	}
	const updated: Manifest = { ...manifest, stages, updatedAt: timestamp };
	await writeManifest({ workspaceRoot, manifest: updated });
	return updated;
}

/**
 * Tells if a stage comes after the `--to-stage` bound. The position in `STAGE_IDS`
 * is compared, so a bound on a stage that is not built, or on
 * `source-normalisation`, still stops the run (technical-design.md §4.7).
 *
 * @param args - The stage and the bound.
 * @param args.stageId - The stage that the run comes to next.
 * @param args.toStage - The last stage that the run does, or `undefined` when the run has no bound.
 * @returns `true` when the stage comes after the bound.
 */
function beyondBound({
	stageId,
	toStage,
}: {
	readonly stageId: StageId;
	readonly toStage: StageId | undefined;
}): boolean {
	return toStage !== undefined && isStageAfter({ stageId, other: toStage });
}

function buildRunLog({
	pipelineRunId,
	startedAt,
	endedAt,
	options,
	runType,
	outcomes,
}: {
	readonly pipelineRunId: string;
	readonly startedAt: string;
	readonly endedAt: string;
	readonly options: PipelineRunOptions;
	readonly runType: RunType;
	readonly outcomes: readonly PipelineStageOutcome[];
}): RunLog {
	const stages: Record<string, RunLogStageEntry> = {};
	for (const { stageId, entry } of outcomes) {
		stages[stageId] = entry;
	}
	return {
		pipelineRunId,
		startedAt,
		endedAt,
		triggeredBy: options.fromStage === undefined ? "manual" : "from-stage",
		runType,
		fromStage: options.fromStage ?? null,
		toStage: options.toStage ?? null,
		stages,
	};
}

async function writeRunLog({
	workspaceRoot,
	runLog,
}: {
	readonly workspaceRoot: string;
	readonly runLog: RunLog;
}): Promise<void> {
	const runsDir = runLogsDirPath({ workspaceRoot });
	await mkdir(runsDir, { recursive: true });
	await writeJsonAtomic({ path: join(runsDir, `${runLog.pipelineRunId}.json`), value: runLog });
}

/**
 * Tells if a parsed file from `Run logs/` is a run log (technical-design.md §4.6).
 * It checks only `pipelineRunId` and the stage map, which every reader uses. So
 * the cost report still reads a run log that an older version wrote without a
 * newer field.
 *
 * @param value - The parsed file contents.
 * @returns `true` when the value is a run log.
 */
function isRunLog(value: unknown): value is RunLog {
	return isRecord(value) && typeof value.pipelineRunId === "string" && isRecord(value.stages);
}

async function readRunLogs(workspaceRoot: string): Promise<readonly RunLog[]> {
	const runsDir = runLogsDirPath({ workspaceRoot });
	const runLogs: RunLog[] = [];
	for (const entry of await readDirSafe(runsDir)) {
		if (!entry.isFile()) {
			continue;
		}
		const parsed = await readJsonSafe(join(runsDir, entry.name));
		if (isRunLog(parsed)) {
			runLogs.push(parsed);
		}
	}
	return runLogs;
}

/**
 * Runs the pipeline. It normalises a module's sources, does a pipeline run on one
 * lecture or a batch, finds lectures by date and builds cost reports. The stages
 * are injected (technical-design.md §4.7).
 */
export class PipelineRunner {
	readonly #config: PipelineConfig;
	readonly #sourceNormalisation: Readonly<SourceNormalisationStage>;
	readonly #lectureStages: readonly Readonly<PipelineStage<unknown, unknown>>[];
	readonly #logger: Logger;
	readonly #reporter: PipelineRunReporter;

	/**
	 * @param deps - The runner's configuration and stages.
	 * @param deps.config - The pipeline configuration, after the config loader checks it.
	 * @param deps.sourceNormalisation - The `source-normalisation` stage, which acts on a module.
	 * @param deps.lectureStages - The lecture stages, in the order that they run.
	 * @param deps.logger - The debug logger.
	 */
	// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- PipelineRunnerDeps holds pino's Logger, which has mutable properties, and the runner only writes log entries to it. CLAUDE.md allows a mutable type that a library requires
	public constructor(deps: PipelineRunnerDeps) {
		this.#config = deps.config;
		this.#sourceNormalisation = deps.sourceNormalisation;
		this.#lectureStages = deps.lectureStages;
		this.#logger = deps.logger;
		this.#reporter = deps.reporter;
	}

	/**
	 * Runs `source-normalisation` on each module, one module at a time.
	 *
	 * @param args - The modules to normalise.
	 * @param args.moduleRoots - Absolute paths to the module directories.
	 * @returns A promise that resolves when each module is normalised.
	 */
	public async normaliseSources({ moduleRoots }: ModuleScope): Promise<void> {
		for (const moduleRoot of moduleRoots) {
			await this.#sourceNormalisation.normaliseModule({ moduleRoot });
		}
	}

	/**
	 * Does one pipeline run on one lecture, and writes its run log
	 * (technical-design.md §4.7).
	 *
	 * A stage whose output is on disk is skipped. A failed stage stops the run,
	 * unless `onStageFailure` is `continue`. `fromStage` first resets that stage and
	 * each later stage. `toStage` is the last stage that the run does. The stages
	 * after a stop or a bound are `not-reached`, and their stage entries do not change.
	 *
	 * @param args - The lecture and the options.
	 * @param args.workspaceRoot - Absolute path to the lecture workspace.
	 * @param args.options - The pipeline run options. {@link DEFAULT_PIPELINE_RUN_OPTIONS} when not given.
	 * @returns The run summary.
	 */
	public async runLecture({
		workspaceRoot,
		options = DEFAULT_PIPELINE_RUN_OPTIONS,
	}: {
		readonly workspaceRoot: string;
		readonly options?: PipelineRunOptions;
	}): Promise<PipelineRunSummary> {
		const startedAt = new Date();
		const pipelineRunId = deriveTimestampId({ instant: startedAt });
		const startedIso = startedAt.toISOString();
		// One invocation writes one debug log and can do many pipeline runs. So the
		// debug log records the id of each pipeline run. With the id, a reader can
		// find the debug output of a run log (technical-design.md §10).
		this.#logger.debug({ pipelineRunId, workspaceRoot }, "Pipeline run started");
		const initialManifest = await readManifest({ workspaceRoot });
		// The notice names the lecture, so it comes after the manifest read. It comes
		// before the reset, so the notices that follow appear under this lecture.
		this.#reporter({ event: "lecture-started", manifest: initialManifest });
		const runType = decideRunType({ options, manifest: initialManifest });
		const manifest =
			options.fromStage === undefined
				? initialManifest
				: await resetFromStage({
						workspaceRoot,
						manifest: initialManifest,
						fromStage: options.fromStage,
						timestamp: startedIso,
					});
		const context = assembleContext({ workspaceRoot, manifest, config: this.#config });

		const { outcomes, context: finalContext } = await this.#runStages({ context, options });
		const endedIso = new Date().toISOString();
		const runLog = buildRunLog({
			pipelineRunId,
			startedAt: startedIso,
			endedAt: endedIso,
			options,
			runType,
			outcomes,
		});
		// The run log and the summary use the workspace path at the end of the run.
		// If a stage moved the workspace, the run log is still beside the work
		// (technical-design.md §4.7).
		await writeRunLog({ workspaceRoot: finalContext.workspaceRoot, runLog });
		return {
			workspaceRoot: finalContext.workspaceRoot,
			pipelineRunId,
			startedAt: startedIso,
			endedAt: endedIso,
			stageOutcomes: outcomes,
			overallStatus: summariseOverallStatus({
				statuses: outcomes.map(({ entry }) => stageOutcomeStatus(entry)),
			}),
		};
	}

	async #runStages({
		context,
		options,
	}: {
		readonly context: StageContext;
		readonly options: PipelineRunOptions;
	}): Promise<{
		readonly outcomes: readonly PipelineStageOutcome[];
		readonly context: StageContext;
	}> {
		const outcomes: PipelineStageOutcome[] = [];
		// Each stage gives its context to the next. So when a stage changes the
		// lecture identity or moves the workspace, the next stage sees the change
		// (technical-design.md §4.7).
		let current = context;
		let halted = false;
		for (const stage of this.#lectureStages) {
			if (halted || beyondBound({ stageId: stage.stageId, toStage: options.toStage })) {
				outcomes.push({ stageId: stage.stageId, entry: { action: "not-reached" } });
				continue;
			}
			const { entry, context: nextContext } = await runStage({
				stage,
				context: current,
				config: this.#config,
				timestamp: new Date().toISOString(),
				logger: this.#logger,
				reporter: this.#reporter,
			});
			current = nextContext;
			outcomes.push({ stageId: stage.stageId, entry });
			if (
				entry.action === "ran" &&
				entry.status === "failed" &&
				options.onStageFailure === "halt"
			) {
				halted = true;
			}
		}
		return { outcomes, context: current };
	}

	/**
	 * Counts the lectures that a batch over these modules would run. The CLI gives
	 * the count before a `--from-stage` batch deletes work (technical-design.md
	 * §4.7, "Counting a batch's scope", NFR-4.3).
	 *
	 * Normalise the sources first. A lecture whose source pair was just added has
	 * no workspace until then, so it is not counted.
	 *
	 * @param args - The modules.
	 * @param args.moduleRoots - Absolute paths to the modules that a batch would run.
	 * @returns The number of lectures in those modules.
	 */
	public async countLectures({ moduleRoots }: ModuleScope): Promise<number> {
		return (await this.#collectLectures(moduleRoots)).length;
	}

	/**
	 * Normalises each module, then does a pipeline run on each of their lectures,
	 * at most `concurrency` at once (technical-design.md §4.7, "Batch mode").
	 *
	 * @param args - The modules and the options.
	 * @param args.moduleRoots - Absolute paths to the modules to run.
	 * @param args.options - The batch options. {@link DEFAULT_BATCH_OPTIONS} when not given.
	 * @returns The batch summary.
	 */
	public async runBatch({
		moduleRoots,
		options = DEFAULT_BATCH_OPTIONS,
	}: ModuleScopedArgs<BatchOptions>): Promise<BatchSummary> {
		const startedAt = new Date().toISOString();
		await this.normaliseSources({ moduleRoots });
		const workspaces = (await this.#collectLectures(moduleRoots)).map(
			(lecture) => lecture.workspaceRoot,
		);
		const lectures = await mapWithConcurrency({
			items: workspaces,
			limit: options.concurrency,
			work: ({ item: workspaceRoot }) => this.runLecture({ workspaceRoot, options }),
		});
		const endedAt = new Date().toISOString();
		return { startedAt, endedAt, lectures, overallStatus: summariseLectures({ lectures }) };
	}

	// The modules in the given order, and the lectures of each module in date order.
	async #collectLectures(moduleRoots: readonly string[]): Promise<readonly LocatedWorkspace[]> {
		const lectures: LocatedWorkspace[] = [];
		for (const moduleRoot of moduleRoots) {
			lectures.push(...(await listLecturesByDate({ moduleRoot })));
		}
		return lectures;
	}

	/**
	 * Finds each lecture in the given modules whose manifest has the date. A module
	 * with no `Pipeline processing/` folder, and a folder with no manifest, are
	 * skipped (technical-design.md §4.7).
	 *
	 * @param args - The modules and the date.
	 * @param args.moduleRoots - Absolute paths to the modules to search.
	 * @param args.lectureDate - The `YYYY-MM-DD` date to match.
	 * @returns The matching lectures, each with its module and workspace.
	 */
	public async resolveLecturesByDate({
		moduleRoots,
		lectureDate,
	}: ModuleScope & { readonly lectureDate: string }): Promise<readonly LectureMatch[]> {
		const matches: LectureMatch[] = [];
		for (const moduleRoot of moduleRoots) {
			const found = await findLectureByDate({ moduleRoot, lectureDate });
			if (found !== null) {
				matches.push({
					moduleRoot,
					workspaceRoot: found.workspaceRoot,
					lectureNumber: found.manifest.lectureNumber,
					lectureTitle: found.manifest.lectureTitle,
				});
			}
		}
		return matches;
	}

	/**
	 * Builds a cost report for each lecture in the modules, or only for the
	 * lectures with `lectureDate` (technical-design.md §7).
	 *
	 * The reports are returned, not printed. The CLI writes them to its injected
	 * output, as it does with all other output (technical-design.md §4.7, §8). So
	 * the output can go to a file, and a test can read it without a capture of the
	 * process output.
	 *
	 * @param args - The modules and the options.
	 * @param args.moduleRoots - Absolute paths to the modules to report on.
	 * @param args.options - The report options, such as `lectureDate`.
	 * @returns One report for each lecture, or none when no lecture matches.
	 */
	public async costReport({
		moduleRoots,
		options = {},
	}: ModuleScopedArgs<ReportOptions>): Promise<readonly string[]> {
		const lectures = await this.#collectLectures(moduleRoots);
		const reported =
			options.lectureDate === undefined
				? lectures
				: lectures.filter((lecture) => lecture.manifest.lectureDate === options.lectureDate);
		// One money formatter for all the reports, so the exchange rate is read once
		// and all the reports show money in the same way.
		const formatMoney = createMoneyFormatter({ gbpPerUsd: this.#config.currency.gbpPerUsd });
		const reports: string[] = [];
		for (const { workspaceRoot, manifest } of reported) {
			const runLogs = await readRunLogs(workspaceRoot);
			reports.push(formatCostReport({ runLogs, manifest, formatMoney }));
		}
		return reports;
	}
}
