import { mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Logger } from "pino";
import type {
	BatchSummary,
	CurrentPipelineCost,
	LectureMatch,
	ManifestStageEntry,
	OverallStatus,
	PipelineConfig,
	PipelineStage,
	ReportOptions,
	RunLog,
	RunLogStageEntry,
	RunManifest,
	RunOptions,
	RunStageOutcome,
	RunSummary,
	RunType,
	SourceNormalisationStage,
	StageContext,
	StageCost,
	StageId,
	StageRunConfig,
} from "../types/pipeline.js";
import { formatCostReport } from "../utils/cost.js";
import { errorMessage } from "../utils/errors.js";
import { listSubdirectoryNames, readDirSafe, writeFileAtomic } from "../utils/files.js";
import { createStageLogger } from "../utils/logger.js";
import { readManifest, readManifestSafe, writeManifest } from "./manifest.js";
import { stageOutcomeStatus, summariseOverallStatus } from "./run-status.js";

/**
 * Constructor dependencies for {@link PipelineRunner}. Stages are injected so the
 * runner can be driven by stub stages under test and by the real stages in
 * production (technical-design.md §4.7).
 */
export type PipelineRunnerDeps = {
	readonly config: PipelineConfig;
	readonly sourceNormalisation: SourceNormalisationStage;
	readonly lectureStages: readonly PipelineStage<unknown, unknown>[];
	/** The run's logger; a stage failure is recorded on it with its stack (technical-design.md §8, §10). */
	readonly logger: Logger;
};

// Inputs addressing a set of modules with optional run- or report-specific options.
type ModuleScopedArgs<TOptions> = {
	readonly moduleRoots: readonly string[];
	readonly options?: TOptions;
};

/**
 * The output directory each stage owns, relative to the workspace root. A
 * `--from-stage` re-run deletes exactly these directories for the nominated
 * stage and everything downstream — never the manifest's recorded `filesWritten`
 * (technical-design.md §4.4, §4.5). `source-normalisation` owns no per-workspace
 * directory; `pdf-generation`'s module-level `Final output/` is cleaned by the
 * stage itself, not here.
 */
const STAGE_OUTPUT_DIRS: Readonly<Record<StageId, readonly string[]>> = {
	"source-normalisation": [],
	"audio-extraction": ["Audio"],
	transcription: ["Transcript"],
	"transcript-structuring": ["Structured transcript"],
	"slide-conversion": ["Slide content"],
	"image-extraction": ["Slide images"],
	synthesis: ["Synthesised notes"],
	"qa-loop": ["QA iterations"],
	"pdf-generation": ["Output"],
};

const STAGE_ORDER = Object.keys(STAGE_OUTPUT_DIRS) as readonly StageId[];

const RUNS_DIR = "runs";
const PROCESSING_DIR = "Pipeline processing";

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
export function deriveRunId({ instant }: { readonly instant: Date }): string {
	return instant
		.toISOString()
		.replace(/\.\d+Z$/, "Z")
		.replace(/:/g, "-");
}

/**
 * Classifies a run from the manifest state of its `--from-stage` target: a run
 * with no target is `normal`; re-running a stage whose output already exists
 * (`complete` or `skipped`) is an `experiment`; anything else — a failed,
 * pending, running, or absent target — is `error-recovery` (technical-design.md
 * §7).
 *
 * @param args - The classification inputs.
 * @param args.options - The run options; `fromStage` drives the classification.
 * @param args.manifest - The manifest whose target-stage status is inspected.
 * @returns The run classification.
 */
export function classifyRunType({
	options,
	manifest,
}: {
	readonly options: RunOptions;
	readonly manifest: RunManifest;
}): RunType {
	const { fromStage } = options;
	if (fromStage === undefined) {
		return "normal";
	}
	const status = manifest.stages[fromStage]?.status;
	if (status === "complete" || status === "skipped") {
		return "experiment";
	}
	return "error-recovery";
}

/**
 * Builds the immutable {@link StageContext} for a lecture run from its manifest,
 * deriving `moduleRoot` two levels up from the workspace
 * (`moduleRoot/Pipeline processing/<folder>`) and freezing the result so no stage
 * can mutate shared run state (technical-design.md §4.7).
 *
 * @param args - The context inputs.
 * @param args.workspaceRoot - Absolute path to the lecture workspace folder.
 * @param args.manifest - The lecture's run manifest, the source of lecture identity.
 * @param args.config - The validated pipeline configuration.
 * @returns The frozen stage context shared by every stage in the run.
 */
export function assembleContext({
	workspaceRoot,
	manifest,
	config,
}: {
	readonly workspaceRoot: string;
	readonly manifest: RunManifest;
	readonly config: PipelineConfig;
}): StageContext {
	return Object.freeze({
		workspaceRoot,
		moduleRoot: resolve(workspaceRoot, "..", ".."),
		config,
		manifest,
		lectureNumber: manifest.lectureNumber,
		lectureDate: manifest.lectureDate,
		provisionalTitle: manifest.provisionalTitle,
		lectureTitle: manifest.lectureTitle,
	});
}

async function readJsonFile<TValue>(path: string): Promise<TValue | null> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as TValue;
	} catch {
		return null;
	}
}

/** A single module, addressed by the root directory that contains it. */
type ModuleQuery = { readonly moduleRoot: string };

async function listWorkspaces({ moduleRoot }: ModuleQuery): Promise<readonly string[]> {
	const processingRoot = join(moduleRoot, PROCESSING_DIR);
	const names = await listSubdirectoryNames(processingRoot);
	return names.map((name) => join(processingRoot, name));
}

/**
 * A module's lecture workspaces in date order (technical-design.md §4.7).
 *
 * The directory listing they come from is in whatever order the filesystem
 * chooses, and their names cannot stand in for the date either — `Lecture 10`
 * precedes `Lecture 2` lexicographically. So the order comes from the manifests,
 * whose `lectureDate` is ISO and therefore sorts chronologically as text.
 *
 * A folder with no readable manifest keeps its place at the end rather than
 * being dropped: it will fail when it is run, which is the right way to hear
 * about a corrupt workspace — ordering is not the place to start hiding one.
 *
 * @param args - The module to list.
 * @param args.moduleRoot - Absolute path to the module directory.
 * @returns The workspace paths, earliest lecture first.
 */
async function listWorkspacesByDate({ moduleRoot }: ModuleQuery): Promise<readonly string[]> {
	const dated = await Promise.all(
		(await listWorkspaces({ moduleRoot })).map(async (workspaceRoot) => ({
			workspaceRoot,
			lectureDate: (await readManifestSafe({ workspaceRoot }))?.lectureDate ?? null,
		})),
	);
	const withDate = dated.filter((entry) => entry.lectureDate !== null);
	// eslint-disable-next-line max-params -- Array.prototype.sort's comparator is spec-defined
	withDate.sort((left, right) =>
		(left.lectureDate as string).localeCompare(right.lectureDate as string),
	);
	return [...withDate, ...dated.filter((entry) => entry.lectureDate === null)].map(
		(entry) => entry.workspaceRoot,
	);
}

/** A lecture workspace paired with the manifest that identifies it. */
type LocatedWorkspace = {
	readonly workspaceRoot: string;
	readonly manifest: RunManifest;
};

/**
 * Finds a module's lecture with the given date, by reading the manifests rather
 * than the folder names — the folder is named for the lecture's number and
 * title, both of which change, while the date is what identifies it.
 *
 * A module holds at most one lecture per date (Stage 0 guarantees it), so the
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
	for (const workspaceRoot of await listWorkspaces({ moduleRoot })) {
		const manifest = await readManifestSafe({ workspaceRoot });
		if (manifest !== null && manifest.lectureDate === lectureDate) {
			return { workspaceRoot, manifest };
		}
	}
	return null;
}

/**
 * Where a lecture's workspace is now, and what its manifest says.
 *
 * Normally the answer is the path already held, and this costs the one manifest
 * read the caller needed anyway. But Stage 3 renames the workspace when it
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

function resolveStageRunConfig({
	config,
	stageId,
}: {
	readonly config: PipelineConfig;
	readonly stageId: StageId;
}): StageRunConfig | null {
	const stageConfig = config.stages[stageId];
	if (stageConfig === undefined) {
		return null;
	}
	return { ...stageConfig };
}

function patchStages({
	stages,
	stageId,
	entry,
}: {
	readonly stages: RunManifest["stages"];
	readonly stageId: StageId;
	readonly entry: ManifestStageEntry;
}): RunManifest["stages"] {
	return { ...stages, [stageId]: entry } as RunManifest["stages"];
}

function resolvedStageCost(entry: ManifestStageEntry): number | null {
	if (entry.status !== "complete" && entry.status !== "skipped") {
		return null;
	}
	return entry.cost?.totalCostUsd ?? null;
}

function recomputeCost({
	current,
	stageId,
	entry,
}: {
	readonly current: CurrentPipelineCost;
	readonly stageId: StageId;
	readonly entry: ManifestStageEntry;
}): CurrentPipelineCost {
	const stageCost = resolvedStageCost(entry);
	if (stageCost === null) {
		return current;
	}
	const byStage = { ...current.byStage, [stageId]: stageCost };
	let total = 0;
	for (const value of Object.values(byStage) as readonly number[]) {
		total += value;
	}
	return { totalCostUsd: total, byStage };
}

async function writeJsonAtomic({
	path,
	value,
}: {
	readonly path: string;
	readonly value: unknown;
}): Promise<void> {
	await writeFileAtomic({ path, content: JSON.stringify(value, null, 2) });
}

/**
 * Patches one stage's entry into a manifest and writes it back, returning what
 * it wrote so the caller can rebuild the stage context without a second read
 * (technical-design.md §4.5).
 *
 * @param args - The write inputs.
 * @param args.workspaceRoot - Absolute path to the workspace to write into.
 * @param args.manifest - The manifest to patch, already read by the caller.
 * @param args.stageId - The stage whose entry is being set.
 * @param args.entry - The entry to record for that stage.
 * @param args.timestamp - The instant to stamp the manifest with.
 * @returns The manifest as written.
 */
async function updateManifest({
	workspaceRoot,
	manifest,
	stageId,
	entry,
	timestamp,
}: {
	readonly workspaceRoot: string;
	readonly manifest: RunManifest;
	readonly stageId: StageId;
	readonly entry: ManifestStageEntry;
	readonly timestamp: string;
}): Promise<RunManifest> {
	const updated: RunManifest = {
		...manifest,
		stages: patchStages({ stages: manifest.stages, stageId, entry }),
		currentPipelineCost: recomputeCost({ current: manifest.currentPipelineCost, stageId, entry }),
		updatedAt: timestamp,
	};
	await writeManifest({ workspaceRoot, manifest: updated });
	return updated;
}

function skippedEntry({
	context,
	stageId,
	timestamp,
}: {
	readonly context: StageContext;
	readonly stageId: StageId;
	readonly timestamp: string;
}): ManifestStageEntry {
	const prior = context.manifest.stages[stageId];
	const completed = prior?.status === "complete" ? prior : null;
	return {
		status: "skipped",
		completedAt: completed?.completedAt ?? timestamp,
		configUsed: completed?.configUsed ?? null,
		cost: completed?.cost ?? null,
		filesWritten: completed?.filesWritten ?? [],
	};
}

function runLogCost(cost: StageCost | null): {
	readonly totalCostUsd: number | null;
	readonly callCount: number;
} {
	if (cost === null) {
		return { totalCostUsd: null, callCount: 0 };
	}
	return { totalCostUsd: cost.totalCostUsd, callCount: cost.callCount };
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

// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- PipelineStage and Logger carry method signatures; CLAUDE.md permits dropping readonly for such method-bearing types
async function runStage({
	stage,
	context,
	config,
	timestamp,
	logger,
}: {
	readonly stage: PipelineStage<unknown, unknown>;
	readonly context: StageContext;
	readonly config: PipelineConfig;
	readonly timestamp: string;
	readonly logger: Logger;
}): Promise<StageOutcome> {
	const { stageId } = stage;
	// The context the NEXT stage runs against. The stage itself is handed the one
	// passed in, so it never sees its own entry change under it.
	let nextContext = context;
	// Every write in this function patches the same stage of the same manifest at
	// the same instant; only the entry differs. Each locates the workspace first,
	// since the stage may have moved it (§4.7).
	const record = async (entry: ManifestStageEntry): Promise<void> => {
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
			timestamp,
		});
		nextContext = assembleContext({ workspaceRoot: located.workspaceRoot, manifest, config });
	};

	if (await stage.isComplete(context)) {
		await record(skippedEntry({ context, stageId, timestamp }));
		return { entry: { action: "skipped" }, context: nextContext };
	}
	const configUsed = resolveStageRunConfig({ config, stageId });
	// Written before the stage begins, so a crash leaves `running` behind for the
	// next launch to treat as failed rather than as never attempted (§4.5).
	await record({ status: "running" });
	try {
		const input = await stage.getInput(context);
		const result = await stage.run({ input, context });
		await record({
			status: "complete",
			completedAt: timestamp,
			configUsed,
			cost: result.cost,
			filesWritten: result.filesWritten,
		});
		return {
			entry: { action: "ran", status: "complete", configUsed, cost: runLogCost(result.cost) },
			context: nextContext,
		};
	} catch (error: unknown) {
		const message = errorMessage(error);
		// The message alone reaches the user; the stack goes to the debug log, which
		// is where an unanticipated failure is actually diagnosed (§8, §10).
		createStageLogger({ logger, stageId }).error({ err: error }, "Stage failed");
		await record({
			status: "failed",
			failedAt: timestamp,
			error: message,
			configUsed,
			cost: null,
			filesWritten: [],
		});
		return {
			entry: {
				action: "ran",
				status: "failed",
				error: message,
				configUsed,
				cost: { totalCostUsd: null, callCount: 0 },
			},
			context: nextContext,
		};
	}
}

async function deleteStageOutput({
	workspaceRoot,
	stageId,
}: {
	readonly workspaceRoot: string;
	readonly stageId: StageId;
}): Promise<void> {
	for (const dir of STAGE_OUTPUT_DIRS[stageId]) {
		await rm(join(workspaceRoot, dir), { recursive: true, force: true });
	}
}

async function resetFromStage({
	workspaceRoot,
	manifest,
	fromStage,
	timestamp,
}: {
	readonly workspaceRoot: string;
	readonly manifest: RunManifest;
	readonly fromStage: StageId;
	readonly timestamp: string;
}): Promise<RunManifest> {
	let stages = manifest.stages;
	for (const stageId of STAGE_ORDER.slice(STAGE_ORDER.indexOf(fromStage))) {
		stages = patchStages({ stages, stageId, entry: { status: "pending" } });
		await deleteStageOutput({ workspaceRoot, stageId });
	}
	const updated: RunManifest = { ...manifest, stages, updatedAt: timestamp };
	await writeManifest({ workspaceRoot, manifest: updated });
	return updated;
}

function buildRunLog({
	runId,
	startedAt,
	endedAt,
	options,
	runType,
	outcomes,
}: {
	readonly runId: string;
	readonly startedAt: string;
	readonly endedAt: string;
	readonly options: RunOptions;
	readonly runType: RunType;
	readonly outcomes: readonly RunStageOutcome[];
}): RunLog {
	const stages: Record<string, RunLogStageEntry> = {};
	let totalCostThisRun = 0;
	for (const { stageId, entry } of outcomes) {
		stages[stageId] = entry;
		if (entry.action === "ran" && entry.cost.totalCostUsd !== null) {
			totalCostThisRun += entry.cost.totalCostUsd;
		}
	}
	return {
		runId,
		startedAt,
		endedAt,
		triggeredBy: options.fromStage === undefined ? "manual" : "from-stage",
		runType,
		fromStage: options.fromStage ?? null,
		stages: stages as RunLog["stages"],
		totalCostThisRun,
	};
}

function overallStatus(outcomes: readonly RunStageOutcome[]): OverallStatus {
	return summariseOverallStatus({
		statuses: outcomes.map(({ entry }) => stageOutcomeStatus(entry)),
	});
}

function aggregateStatus(lectures: readonly RunSummary[]): OverallStatus {
	return summariseOverallStatus({ statuses: lectures.map((lecture) => lecture.overallStatus) });
}

async function writeRunLog({
	workspaceRoot,
	runLog,
}: {
	readonly workspaceRoot: string;
	readonly runLog: RunLog;
}): Promise<void> {
	const runsDir = join(workspaceRoot, RUNS_DIR);
	await mkdir(runsDir, { recursive: true });
	await writeJsonAtomic({ path: join(runsDir, `${runLog.runId}.json`), value: runLog });
}

async function readRunLogs(workspaceRoot: string): Promise<readonly RunLog[]> {
	const runsDir = join(workspaceRoot, RUNS_DIR);
	const logs: RunLog[] = [];
	for (const entry of await readDirSafe(runsDir)) {
		if (!entry.isFile()) {
			continue;
		}
		const log = await readJsonFile<RunLog>(join(runsDir, entry.name));
		if (log !== null) {
			logs.push(log);
		}
	}
	return logs;
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
	readonly #sourceNormalisation: SourceNormalisationStage;
	readonly #lectureStages: readonly PipelineStage<unknown, unknown>[];
	readonly #logger: Logger;

	/**
	 * @param deps - The runner's injected configuration and stages.
	 * @param deps.config - The validated pipeline configuration.
	 * @param deps.sourceNormalisation - The per-module Stage 0 implementation.
	 * @param deps.lectureStages - The per-lecture stages, in execution order.
	 * @param deps.logger - The run's logger, which records each stage failure with its stack.
	 */
	// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- lectureStages holds method-bearing PipelineStage values; CLAUDE.md permits dropping readonly
	public constructor(deps: PipelineRunnerDeps) {
		this.#config = deps.config;
		this.#sourceNormalisation = deps.sourceNormalisation;
		this.#lectureStages = deps.lectureStages;
		this.#logger = deps.logger;
	}

	/**
	 * Runs Stage 0 for each module, creating or refreshing its lecture workspaces.
	 *
	 * @param args - The modules to normalise.
	 * @param args.moduleRoots - Absolute paths to the module directories.
	 * @returns A promise that resolves once every module is normalised.
	 */
	public async normaliseSources({
		moduleRoots,
	}: {
		readonly moduleRoots: readonly string[];
	}): Promise<void> {
		for (const moduleRoot of moduleRoots) {
			await this.#sourceNormalisation.normaliseModule({ moduleRoot });
		}
	}

	/**
	 * Runs one lecture's stages in order against its workspace. Each stage is
	 * skipped when its output already exists, run otherwise; a failure halts the
	 * run (marking downstream stages `not-reached`) unless `continueOnError` is
	 * set. A `--from-stage` option resets the nominated stage and everything
	 * downstream first. Writes a timestamped run log and returns the run summary
	 * (technical-design.md §4.7).
	 *
	 * @param args - The run inputs.
	 * @param args.workspaceRoot - Absolute path to the lecture workspace.
	 * @param args.options - Options controlling the run (`fromStage`, `continueOnError`).
	 * @returns The summary of the lecture run.
	 */
	public async runLecture({
		workspaceRoot,
		options = {},
	}: {
		readonly workspaceRoot: string;
		readonly options?: RunOptions;
	}): Promise<RunSummary> {
		const startedAt = new Date();
		const runId = deriveRunId({ instant: startedAt });
		const startedIso = startedAt.toISOString();
		const initialManifest = await readManifest({ workspaceRoot });
		const runType = classifyRunType({ options, manifest: initialManifest });
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
			runId,
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
			runId,
			startedAt: startedIso,
			endedAt: endedIso,
			totalCostUsd: runLog.totalCostThisRun,
			stageOutcomes: outcomes,
			overallStatus: overallStatus(outcomes),
		};
	}

	async #runStages({
		context,
		options,
	}: {
		readonly context: StageContext;
		readonly options: RunOptions;
	}): Promise<{
		readonly outcomes: readonly RunStageOutcome[];
		readonly context: StageContext;
	}> {
		const outcomes: RunStageOutcome[] = [];
		// Carried from stage to stage rather than assembled once, so a stage that
		// rewrites the lecture's identity hands the next stage the lecture as it now
		// stands — including a workspace it has moved (§4.7).
		let current = context;
		let halted = false;
		for (const stage of this.#lectureStages) {
			if (halted) {
				outcomes.push({ stageId: stage.stageId, entry: { action: "not-reached" } });
				continue;
			}
			const { entry, context: nextContext } = await runStage({
				stage,
				context: current,
				config: this.#config,
				timestamp: new Date().toISOString(),
				logger: this.#logger,
			});
			current = nextContext;
			outcomes.push({ stageId: stage.stageId, entry });
			if (entry.action === "ran" && entry.status === "failed" && options.continueOnError !== true) {
				halted = true;
			}
		}
		return { outcomes, context: current };
	}

	/**
	 * Normalises every module then runs all their lectures with bounded
	 * concurrency, aggregating each lecture's summary into a batch summary
	 * (technical-design.md §4.7).
	 *
	 * @param args - The batch inputs.
	 * @param args.moduleRoots - Absolute paths to the modules to run.
	 * @param args.options - Options controlling the run, including `concurrency`.
	 * @returns The aggregated batch summary.
	 */
	public async runBatch({
		moduleRoots,
		options = {},
	}: ModuleScopedArgs<RunOptions>): Promise<BatchSummary> {
		const startedAt = new Date().toISOString();
		await this.normaliseSources({ moduleRoots });
		const workspaces = await this.#collectWorkspaces(moduleRoots);
		const lectures = await this.#runLecturesConcurrently({ workspaces, options });
		const endedAt = new Date().toISOString();
		let totalCostUsd = 0;
		for (const lecture of lectures) {
			totalCostUsd += lecture.totalCostUsd;
		}
		return {
			startedAt,
			endedAt,
			lectures,
			totalCostUsd,
			overallStatus: aggregateStatus(lectures),
		};
	}

	// Modules in the order given, and each module's lectures in date order.
	async #collectWorkspaces(moduleRoots: readonly string[]): Promise<readonly string[]> {
		const workspaces: string[] = [];
		for (const moduleRoot of moduleRoots) {
			workspaces.push(...(await listWorkspacesByDate({ moduleRoot })));
		}
		return workspaces;
	}

	async #runLecturesConcurrently({
		workspaces,
		options,
	}: {
		readonly workspaces: readonly string[];
		readonly options: RunOptions;
	}): Promise<readonly RunSummary[]> {
		const results: RunSummary[] = new Array(workspaces.length);
		const limit = Math.max(1, options.concurrency ?? 1);
		let next = 0;
		const worker = async (): Promise<void> => {
			while (next < workspaces.length) {
				const index = next;
				next += 1;
				results[index] = await this.runLecture({ workspaceRoot: workspaces[index], options });
			}
		};
		const workers: Promise<void>[] = [];
		for (let count = 0; count < Math.min(limit, workspaces.length); count += 1) {
			workers.push(worker());
		}
		await Promise.all(workers);
		return results;
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
	}: {
		readonly moduleRoots: readonly string[];
		readonly lectureDate: string;
	}): Promise<readonly LectureMatch[]> {
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
	 * Prints the per-lecture cost report to stdout: all lectures across the given
	 * modules, or only those matching `lectureDate` when supplied
	 * (technical-design.md §7).
	 *
	 * @param args - The report inputs.
	 * @param args.moduleRoots - Absolute paths to the modules to report on.
	 * @param args.options - Options narrowing the report, e.g. `lectureDate`.
	 * @returns A promise that resolves once the report is written.
	 */
	public async costReport({
		moduleRoots,
		options = {},
	}: ModuleScopedArgs<ReportOptions>): Promise<void> {
		const workspaces =
			options.lectureDate === undefined
				? await this.#collectWorkspaces(moduleRoots)
				: (await this.resolveLecturesByDate({ moduleRoots, lectureDate: options.lectureDate })).map(
						(match) => match.workspaceRoot,
					);
		for (const workspaceRoot of workspaces) {
			const manifest = await readManifestSafe({ workspaceRoot });
			if (manifest === null) {
				continue;
			}
			const runLogs = await readRunLogs(workspaceRoot);
			const { gbpPerUsd } = this.#config.currency;
			process.stdout.write(`${formatCostReport({ runLogs, manifest, gbpPerUsd })}\n`);
		}
	}
}
