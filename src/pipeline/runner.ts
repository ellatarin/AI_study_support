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
 * Constructor dependencies for {@link PipelineRunner}. Stages are injected so the
 * runner can be driven by stub stages under test and by the real stages in
 * production (technical-design.md §4.7).
 */
export type PipelineRunnerDeps = {
	readonly config: PipelineConfig;
	readonly sourceNormalisation: Readonly<SourceNormalisationStage>;
	readonly lectureStages: readonly Readonly<PipelineStage<unknown, unknown>>[];
	/** The run's logger; a stage failure is recorded on it with its stack (technical-design.md §8, §10). */
	readonly logger: Logger;
	/**
	 * Where the run says what it is doing, stage by stage, as it happens. Injected
	 * like the logger and for the same reason: the runner reports the facts and the
	 * CLI decides how — and whether — a user sees them (technical-design.md §10).
	 */
	readonly reporter: PipelineRunReporter;
};

// Inputs addressing a set of modules with optional run- or report-specific options.
/**
 * The modules a call is scoped to — every public operation on the runner is
 * addressed by a set of module roots, whatever else it also takes.
 */
type ModuleScope = { readonly moduleRoots: readonly string[] };

type ModuleScopedArgs<TOptions> = ModuleScope & {
	readonly options?: TOptions;
};

// Pipeline order comes from STAGE_IDS, the declared source of truth, rather than
// from the key order of some lookup map — a map is keyed *by* stage, and reading
// its keys as the sequence means a stage added to one map and not another
// silently changes the order (technical-design.md §4.7).

/**
 * Derives a filesystem-safe run identifier from a timestamp: the ISO 8601 string
 * with milliseconds removed and colons replaced by hyphens, e.g.
 * `2025-10-10T09-00-00Z` (technical-design.md §4.6).
 *
 * @param args - The timestamp source.
 * @param args.instant - The moment the run began.
 * @returns The filesystem-safe run identifier.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- Date is a built-in with mutating methods, but is only read here
export function deriveTimestampId({ instant }: { readonly instant: Date }): string {
	return instant
		.toISOString()
		.replace(/\.\d+Z$/, "Z")
		.replace(/:/g, "-");
}

/**
 * Decides a run's run type from the manifest state of its `--from-stage` target: a run
 * with no target is `normal`; re-running a stage whose output already exists
 * (`complete` or `skipped`) is an `experiment`; anything else — a failed,
 * pending, running, or absent target — is `error-recovery` (technical-design.md
 * §7).
 *
 * @param args - What the run type is decided from.
 * @param args.options - The run options; `fromStage` decides the run type.
 * @param args.manifest - The manifest whose target-stage status is inspected.
 * @returns The run type.
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

/** A single module, addressed by the root directory that contains it. */
type ModuleQuery = { readonly moduleRoot: string };

async function listWorkspaces({ moduleRoot }: ModuleQuery): Promise<readonly string[]> {
	const processingRoot = moduleDirs({ moduleRoot }).processing;
	const names = await listSubdirectoryNames(processingRoot);
	return names.map((name) => join(processingRoot, name));
}

/** A lecture workspace paired with the manifest that identifies it. */
type LocatedWorkspace = {
	readonly workspaceRoot: string;
	readonly manifest: Manifest;
};

/**
 * A module's lectures in date order: every folder under its
 * `Pipeline processing/` that holds a readable manifest, paired with it
 * (technical-design.md §4.7).
 *
 * A folder without one is passed over. Both `source-normalisation` and the runner scan those
 * folders speculatively, so anything else the user has left in there is not a
 * lecture rather than a fault (technical-design.md §4.5).
 *
 * The directory listing they come from is in whatever order the filesystem
 * chooses, and their names cannot stand in for the date either — `Lecture 10`
 * precedes `Lecture 2` lexicographically. So the order comes from the manifests,
 * whose `lectureDate` is ISO and therefore sorts chronologically as text.
 *
 * @param args - The module to list.
 * @param args.moduleRoot - Absolute path to the module directory.
 * @returns The module's lectures, earliest first.
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
	// eslint-disable-next-line max-params -- Array.prototype.sort's comparator is spec-defined
	located.sort((left, right) =>
		left.manifest.lectureDate.localeCompare(right.manifest.lectureDate),
	);
	return located;
}

/**
 * Finds a module's lecture with the given date, by reading the manifests rather
 * than the folder names — the folder is named for the lecture's number and
 * title, both of which change, while the date is what identifies it.
 *
 * A module holds at most one lecture per date (`source-normalisation` guarantees it), so the
 * first match is the match. Shared by {@link resolveWorkspace} and
 * `resolveLecturesByDate`, which apply that same identity rule to different ends
 * (technical-design.md §4.7).
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
 * Where a lecture's workspace is now, and what its manifest says.
 *
 * Normally the answer is the path already held, and this costs the one manifest
 * read the caller needed anyway. But `transcript-structuring` renames the workspace when it
 * replaces the lecture's title, which invalidates that path mid-run — so a path
 * with no readable manifest sends the runner to look the lecture up by date
 * instead, rather than obliging every stage to report a move only one of them
 * ever makes (technical-design.md §4.7).
 *
 * @param args - The lecture to locate.
 * @param args.workspaceRoot - The workspace path last known to the runner.
 * @param args.moduleRoot - Absolute path to the containing module.
 * @param args.lectureDate - The lecture's `YYYY-MM-DD` date, which does not change mid-run.
 * @returns The current workspace path and the manifest read from it.
 * @throws {Error} If the workspace is gone and no workspace in the module carries the date.
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
 * Patches one stage's entry — and any lecture identity the stage decided — into
 * a manifest and writes it back, returning what it wrote so the caller can
 * rebuild the stage context without a second read (technical-design.md §4.5).
 *
 * A stage's entry and the identity it decided describe one moment in the run,
 * and this is the only place either is written, so the two land in a single
 * write (§4.2).
 *
 * @param args - The write inputs.
 * @param args.workspaceRoot - Absolute path to the workspace to write into.
 * @param args.manifest - The manifest to patch, already read by the caller.
 * @param args.stageId - The stage whose entry is being set.
 * @param args.entry - The entry to record for that stage.
 * @param args.identityChanges - The lecture-identity fields the stage decided; empty for every stage but `transcript-structuring`.
 * @param args.timestamp - The instant to stamp the manifest with.
 * @returns The manifest as written.
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
 * What one stage did, and the context the stage after it runs against. The two
 * travel together because a stage may change the lecture the next one sees — its
 * title, and with it the workspace path (technical-design.md §4.7).
 */
type StageOutcome = {
	readonly entry: RunLogStageEntry;
	readonly context: StageContext;
};

/**
 * One stage's manifest transitions, and the context that follows from the last
 * of them (technical-design.md §4.7).
 *
 * Every transition patches the same stage of the same manifest at the same
 * instant; only what is recorded differs. Each locates the workspace first,
 * since the stage may have moved it, so the status writer is what tracks where
 * the lecture currently stands.
 */
type StageStatusWriter = {
	/** The stage's output already exists: keep the earlier completion's record of it. */
	skipped(): Promise<void>;
	/** Written before the stage begins, so a crash leaves `running` behind for the next launch to treat as failed rather than as never attempted (§4.5). */
	running(): Promise<void>;
	/** The stage returned: record what it produced, and any lecture identity it decided (§4.2). */
	complete(args: {
		readonly configUsed: StageConfigUsed | null;
		readonly result: StageResult<unknown>;
	}): Promise<void>;
	/** The stage threw: record the message the user will see. */
	failed(args: {
		readonly configUsed: StageConfigUsed | null;
		readonly error: string;
	}): Promise<void>;
	/** The context the next stage runs against, as of the last transition recorded. */
	context(): StageContext;
};

/**
 * Builds the {@link StageStatusWriter} for one stage of one lecture.
 *
 * @param args - The stage whose status is written, and its lecture.
 * @param args.stageId - The stage whose entry every write patches.
 * @param args.context - The context the stage was invoked with.
 * @param args.config - The validated pipeline configuration, for rebuilding the context.
 * @param args.timestamp - The instant every write is stamped with.
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
	// The context the NEXT stage runs against. The stage itself is handed the one
	// passed in, so it never sees its own entry change under it.
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

// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger carries mutable properties the rule cannot see past; it is only logged to here (CLAUDE.md permits dropping readonly where a library requires a mutable type)
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
		// The message alone reaches the user; the stack goes to the debug log, which
		// is where an unanticipated failure is actually diagnosed (§8, §10).
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
 * Clears one stage's work for one lecture.
 *
 * A stage's workspace directories hold that lecture's work and nothing else, so
 * they go whole. `pdf-generation` deposits into the module's `Final output/`,
 * which holds every lecture in the module — there, only the file carrying this
 * lecture's date is taken (technical-design.md §4.7).
 *
 * @param args - The lecture, and the stage whose work to clear.
 * @param args.workspaceRoot - Absolute path to the lecture workspace.
 * @param args.stageId - The stage whose work to clear.
 * @param args.lectureDate - The `YYYY-MM-DD` date this lecture's files carry.
 * @returns A promise that resolves once the stage's work is gone.
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
 * Whether a stage lies past the run's `--to-stage` bound, and so should not be
 * reached.
 *
 * Position is compared against the declared pipeline order rather than against
 * the stages the runner happens to hold, so a bound naming a stage that has no
 * implementation — or one that runs before every lecture stage — still stops the
 * run where it was told to (technical-design.md §4.7).
 *
 * @param args - The stage, and the bound it is measured against.
 * @param args.stageId - The stage the run is about to reach.
 * @param args.toStage - The last stage the run may perform, or `undefined` when the run is unbounded.
 * @returns `true` when the stage lies beyond the bound.
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
 * Whether a parsed file from `Run logs/` is a run log.
 *
 * `Run logs/` is scanned rather than indexed, so whatever lands in it is offered to
 * this reader, and parsing as JSON is not the same as being a run. Shallow for
 * the reason the manifest reader's own guard is: it checks what every consumer reads —
 * the id a run is filed under, and the stage map the cost report iterates — and
 * no more, so a run log written by an older version is not discarded over a field it
 * predates.
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
 * Orchestrates the lecture-notes pipeline: normalising a module's sources,
 * running a single lecture's stages in order, running batches of lectures with
 * bounded concurrency, resolving lectures by date, and printing cost reports.
 * Stage implementations are injected via the constructor
 * (technical-design.md §4.7).
 */
export class PipelineRunner {
	readonly #config: PipelineConfig;
	readonly #sourceNormalisation: Readonly<SourceNormalisationStage>;
	readonly #lectureStages: readonly Readonly<PipelineStage<unknown, unknown>>[];
	readonly #logger: Logger;
	readonly #reporter: PipelineRunReporter;

	/**
	 * @param deps - The runner's injected configuration and stages.
	 * @param deps.config - The validated pipeline configuration.
	 * @param deps.sourceNormalisation - The per-module `source-normalisation` implementation.
	 * @param deps.lectureStages - The per-lecture stages, in execution order.
	 * @param deps.logger - The run's logger, which records each stage failure with its stack.
	 */
	// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- PipelineRunnerDeps carries pino's Logger, which has mutable properties the rule cannot see past; it is only logged to (CLAUDE.md permits dropping readonly where a library requires a mutable type)
	public constructor(deps: PipelineRunnerDeps) {
		this.#config = deps.config;
		this.#sourceNormalisation = deps.sourceNormalisation;
		this.#lectureStages = deps.lectureStages;
		this.#logger = deps.logger;
		this.#reporter = deps.reporter;
	}

	/**
	 * Runs `source-normalisation` for each module, creating or refreshing its lecture workspaces.
	 *
	 * @param args - The modules to normalise.
	 * @param args.moduleRoots - Absolute paths to the module directories.
	 * @returns A promise that resolves once every module is normalised.
	 */
	public async normaliseSources({ moduleRoots }: ModuleScope): Promise<void> {
		for (const moduleRoot of moduleRoots) {
			await this.#sourceNormalisation.normaliseModule({ moduleRoot });
		}
	}

	/**
	 * Runs one lecture's stages in order against its workspace. Each stage is
	 * skipped when its output already exists, run otherwise; a failure ends the
	 * run (marking downstream stages `not-reached`) unless `onStageFailure` says
	 * to continue. A `fromStage` option resets the nominated stage and everything
	 * downstream first; a `toStage` option bounds the run at that stage, leaving
	 * the stages after it `not-reached` and their manifest entries untouched, so a
	 * bounded run is resumable rather than finished. Writes a timestamped run log
	 * and returns the run summary
	 * (technical-design.md §4.7).
	 *
	 * @param args - The run inputs.
	 * @param args.workspaceRoot - Absolute path to the lecture workspace.
	 * @param args.options - Options controlling the run; {@link DEFAULT_PIPELINE_RUN_OPTIONS} when omitted.
	 * @returns The summary of the lecture run.
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
		// One invocation writes one debug log and may run many lectures, so the log
		// cannot be named for a run. Naming each run inside it is what gets a reader
		// from a run log back to the debug output that produced it (§10).
		this.#logger.debug({ pipelineRunId, workspaceRoot }, "Pipeline run started");
		const initialManifest = await readManifest({ workspaceRoot });
		// After the manifest is read, because naming the lecture is the point of the
		// notice, and before anything is reset: what follows belongs under this name.
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
		// Both address the workspace where it ended up, not where it began, so a run
		// that renamed its own workspace still leaves its log beside the work (§4.7).
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
		// Carried from stage to stage rather than assembled once, so a stage that
		// rewrites the lecture's identity hands the next stage the lecture as it now
		// stands — including a workspace it has moved (§4.7).
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
	 * How many lectures a batch over these modules would cover.
	 *
	 * Nothing the user types says how wide a batch is, so the CLI asks before it
	 * warns them that a `--from-stage` batch is about to discard work — the
	 * warning has to carry the number to be worth reading (§4.7, NFR-4.3). A
	 * folder holding no manifest is not a lecture, and a module the pipeline has
	 * never processed holds none, so neither is counted.
	 *
	 * Sources should be normalised first: a lecture whose video and slides were
	 * only just added has no workspace until they are, and so would go uncounted.
	 *
	 * @param args - The scope to measure.
	 * @param args.moduleRoots - Absolute paths to the modules a batch would cover.
	 * @returns The number of lectures standing across those modules.
	 */
	public async countLectures({ moduleRoots }: ModuleScope): Promise<number> {
		return (await this.#collectLectures(moduleRoots)).length;
	}

	/**
	 * Normalises every module then runs all their lectures with bounded
	 * concurrency, aggregating each lecture's summary into a batch summary
	 * (technical-design.md §4.7).
	 *
	 * @param args - The batch inputs.
	 * @param args.moduleRoots - Absolute paths to the modules to run.
	 * @param args.options - Options controlling the run; {@link DEFAULT_BATCH_OPTIONS} when omitted.
	 * @returns The aggregated batch summary.
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

	// Modules in the order given, and each module's lectures in date order.
	async #collectLectures(moduleRoots: readonly string[]): Promise<readonly LocatedWorkspace[]> {
		const lectures: LocatedWorkspace[] = [];
		for (const moduleRoot of moduleRoots) {
			lectures.push(...(await listLecturesByDate({ moduleRoot })));
		}
		return lectures;
	}

	/**
	 * Finds every lecture across the given modules whose manifest records the
	 * requested date, skipping modules without a `Pipeline processing/` directory
	 * and workspaces without a manifest (technical-design.md §4.7).
	 *
	 * @param args - The resolution inputs.
	 * @param args.moduleRoots - Absolute paths to the modules to search.
	 * @param args.lectureDate - The `YYYY-MM-DD` date to match.
	 * @returns The matching lectures, each identifying its module and workspace.
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
	 * Renders the per-lecture cost report: all lectures across the given modules,
	 * or only those matching `lectureDate` when supplied (technical-design.md §7).
	 *
	 * Handed back rather than printed. Showing text to a user is the CLI's job
	 * (§8), and the CLI is given somewhere to write to, so a report that printed
	 * itself would be the one output in the pipeline that could not be redirected,
	 * captured, or read back by a test without intercepting the process's own
	 * output stream.
	 *
	 * @param args - The report inputs.
	 * @param args.moduleRoots - Absolute paths to the modules to report on.
	 * @param args.options - Options narrowing the report, e.g. `lectureDate`.
	 * @returns One rendered report per reported lecture, empty when none match.
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
		// One formatter for every lecture reported, so the rate is read once and no
		// two blocks in the same output could show money differently.
		const formatMoney = createMoneyFormatter({ gbpPerUsd: this.#config.currency.gbpPerUsd });
		const reports: string[] = [];
		for (const { workspaceRoot, manifest } of reported) {
			const runLogs = await readRunLogs(workspaceRoot);
			reports.push(formatCostReport({ runLogs, manifest, formatMoney }));
		}
		return reports;
	}
}
