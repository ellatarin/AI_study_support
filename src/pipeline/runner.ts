import { mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
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

/**
 * Constructor dependencies for {@link PipelineRunner}. Stages are injected so the
 * runner can be driven by stub stages under test and by the real stages in
 * production (technical-design.md §4.7).
 */
export type PipelineRunnerDeps = {
	readonly config: PipelineConfig;
	readonly sourceNormalisation: SourceNormalisationStage;
	readonly lectureStages: readonly PipelineStage<unknown, unknown>[];
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

const MANIFEST_FILE = "manifest.json";
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

function readManifestFile(workspaceRoot: string): Promise<RunManifest | null> {
	return readJsonFile<RunManifest>(join(workspaceRoot, MANIFEST_FILE));
}

async function listWorkspaces({
	moduleRoot,
}: {
	readonly moduleRoot: string;
}): Promise<readonly string[]> {
	const processingRoot = join(moduleRoot, PROCESSING_DIR);
	const names = await listSubdirectoryNames(processingRoot);
	return names.map((name) => join(processingRoot, name));
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

async function updateManifest({
	workspaceRoot,
	stageId,
	entry,
	timestamp,
}: {
	readonly workspaceRoot: string;
	readonly stageId: StageId;
	readonly entry: ManifestStageEntry;
	readonly timestamp: string;
}): Promise<void> {
	const manifestPath = join(workspaceRoot, MANIFEST_FILE);
	const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as RunManifest;
	const updated: RunManifest = {
		...manifest,
		stages: patchStages({ stages: manifest.stages, stageId, entry }),
		currentPipelineCost: recomputeCost({ current: manifest.currentPipelineCost, stageId, entry }),
		updatedAt: timestamp,
	};
	await writeJsonAtomic({ path: manifestPath, value: updated });
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

// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- PipelineStage carries method signatures; CLAUDE.md permits dropping readonly for such method-bearing types
async function runStage({
	stage,
	context,
	config,
	timestamp,
}: {
	readonly stage: PipelineStage<unknown, unknown>;
	readonly context: StageContext;
	readonly config: PipelineConfig;
	readonly timestamp: string;
}): Promise<RunLogStageEntry> {
	const { stageId } = stage;
	if (await stage.isComplete(context)) {
		await updateManifest({
			workspaceRoot: context.workspaceRoot,
			stageId,
			entry: skippedEntry({ context, stageId, timestamp }),
			timestamp,
		});
		return { action: "skipped" };
	}
	const configUsed = resolveStageRunConfig({ config, stageId });
	try {
		const input = await stage.getInput(context);
		const result = await stage.run({ input, context });
		await updateManifest({
			workspaceRoot: context.workspaceRoot,
			stageId,
			entry: {
				status: "complete",
				completedAt: timestamp,
				configUsed,
				cost: result.cost,
				filesWritten: result.filesWritten,
			},
			timestamp,
		});
		return { action: "ran", status: "complete", configUsed, cost: runLogCost(result.cost) };
	} catch (error: unknown) {
		const message = errorMessage(error);
		await updateManifest({
			workspaceRoot: context.workspaceRoot,
			stageId,
			entry: {
				status: "failed",
				failedAt: timestamp,
				error: message,
				configUsed,
				cost: null,
				filesWritten: [],
			},
			timestamp,
		});
		return {
			action: "ran",
			status: "failed",
			error: message,
			configUsed,
			cost: { totalCostUsd: null, callCount: 0 },
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
	await writeJsonAtomic({ path: join(workspaceRoot, MANIFEST_FILE), value: updated });
	return updated;
}

type StageOutcome = { readonly stageId: StageId; readonly entry: RunLogStageEntry };

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
	readonly outcomes: readonly StageOutcome[];
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

function summariseStatus({
	hasFailure,
	hasPartial,
}: {
	readonly hasFailure: boolean;
	readonly hasPartial: boolean;
}): OverallStatus {
	if (hasFailure) {
		return "failed";
	}
	if (hasPartial) {
		return "partial";
	}
	return "success";
}

function overallStatus(outcomes: readonly RunLogStageEntry[]): OverallStatus {
	return summariseStatus({
		hasFailure: outcomes.some((entry) => entry.action === "ran" && entry.status === "failed"),
		hasPartial: outcomes.some(
			(entry) => entry.action === "skipped" || entry.action === "not-reached",
		),
	});
}

function aggregateStatus(lectures: readonly RunSummary[]): OverallStatus {
	return summariseStatus({
		hasFailure: lectures.some((lecture) => lecture.overallStatus === "failed"),
		hasPartial: lectures.some((lecture) => lecture.overallStatus === "partial"),
	});
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

	/**
	 * @param deps - The runner's injected configuration and stages.
	 * @param deps.config - The validated pipeline configuration.
	 * @param deps.sourceNormalisation - The per-module Stage 0 implementation.
	 * @param deps.lectureStages - The per-lecture stages, in execution order.
	 */
	// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- lectureStages holds method-bearing PipelineStage values; CLAUDE.md permits dropping readonly
	public constructor(deps: PipelineRunnerDeps) {
		this.#config = deps.config;
		this.#sourceNormalisation = deps.sourceNormalisation;
		this.#lectureStages = deps.lectureStages;
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
		const initialManifest = JSON.parse(
			await readFile(join(workspaceRoot, MANIFEST_FILE), "utf8"),
		) as RunManifest;
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

		const outcomes = await this.#runStages({ context, options });
		const endedIso = new Date().toISOString();
		const runLog = buildRunLog({
			runId,
			startedAt: startedIso,
			endedAt: endedIso,
			options,
			runType,
			outcomes,
		});
		await writeRunLog({ workspaceRoot, runLog });
		return {
			workspaceRoot,
			runId,
			startedAt: startedIso,
			endedAt: endedIso,
			totalCostUsd: runLog.totalCostThisRun,
			stageOutcomes: outcomes.map((outcome) => outcome.entry),
			overallStatus: overallStatus(outcomes.map((outcome) => outcome.entry)),
		};
	}

	async #runStages({
		context,
		options,
	}: {
		readonly context: StageContext;
		readonly options: RunOptions;
	}): Promise<readonly StageOutcome[]> {
		const outcomes: StageOutcome[] = [];
		let halted = false;
		for (const stage of this.#lectureStages) {
			if (halted) {
				outcomes.push({ stageId: stage.stageId, entry: { action: "not-reached" } });
				continue;
			}
			const entry = await runStage({
				stage,
				context,
				config: this.#config,
				timestamp: new Date().toISOString(),
			});
			outcomes.push({ stageId: stage.stageId, entry });
			if (entry.action === "ran" && entry.status === "failed" && options.continueOnError !== true) {
				halted = true;
			}
		}
		return outcomes;
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

	async #collectWorkspaces(moduleRoots: readonly string[]): Promise<readonly string[]> {
		const workspaces: string[] = [];
		for (const moduleRoot of moduleRoots) {
			workspaces.push(...(await listWorkspaces({ moduleRoot })));
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
			for (const workspaceRoot of await listWorkspaces({ moduleRoot })) {
				const manifest = await readManifestFile(workspaceRoot);
				if (manifest === null || manifest.lectureDate !== lectureDate) {
					continue;
				}
				matches.push({
					moduleRoot,
					workspaceRoot,
					lectureNumber: manifest.lectureNumber,
					lectureTitle: manifest.lectureTitle,
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
			const manifest = await readManifestFile(workspaceRoot);
			if (manifest === null) {
				continue;
			}
			const runLogs = await readRunLogs(workspaceRoot);
			const { gbpPerUsd } = this.#config.currency;
			process.stdout.write(`${formatCostReport({ runLogs, manifest, gbpPerUsd })}\n`);
		}
	}
}
