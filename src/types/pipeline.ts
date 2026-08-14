/**
 * Shared type contracts for the lecture-notes pipeline, plus the one runtime
 * constant the contracts are derived from ({@link STAGE_IDS}).
 *
 * Every stage, the runner, the config loader, and the cost tooling depend on
 * these definitions. All data types are declared `readonly` throughout: the
 * pipeline treats state as immutable and produces new objects rather than
 * mutating in place (manifest updates flow through the runner's
 * `updateManifest`, never by field assignment).
 *
 * See technical-design.md §4 (architecture), §6 (config), §7 (cost).
 */

/**
 * Every pipeline stage, in execution order (technical-design.md §4.1).
 *
 * This is the one runtime value in an otherwise type-only module, and it is the
 * source of truth for {@link StageId}: the union is derived from it, so a stage
 * cannot be added to one and forgotten in the other.
 */
export const STAGE_IDS = [
	"source-normalisation",
	"audio-extraction",
	"transcription",
	"transcript-structuring",
	"slide-conversion",
	"image-extraction",
	"synthesis",
	"qa-loop",
	"pdf-generation",
] as const;

/**
 * Canonical identifier for each pipeline stage, in execution order
 * (technical-design.md §4.1). Derived from {@link STAGE_IDS}.
 */
export type StageId = (typeof STAGE_IDS)[number];

/**
 * Lifecycle status of a stage as recorded in the run manifest.
 *
 * `running` is written before a stage begins; a crash therefore leaves
 * `running` behind, which the next launch treats as `failed`
 * (technical-design.md §4.2, stage status semantics).
 */
export type StageStatus = "pending" | "running" | "complete" | "failed" | "skipped";

/**
 * Token counts and resolved cost for the billable calls a stage made.
 *
 * Modelled as a discriminated union on `totalCostUsd`: a resolved cost carries
 * a number; a failed lookup carries `null` together with the
 * `costResolutionError` explaining why (every retry of the OpenRouter
 * generation lookup failed). Tokens and `callCount` are always populated (technical-design.md §7).
 */
export type StageCost = {
	readonly promptTokens: number;
	readonly completionTokens: number;
	readonly callCount: number;
} & (
	| { readonly totalCostUsd: number }
	| { readonly totalCostUsd: null; readonly costResolutionError: string }
);

/** Optional model tuning parameters shared by resolved and configured stage configs. */
type StageParams = {
	readonly temperature?: number;
	readonly maxTokens?: number;
	readonly concurrency?: number;
	readonly maxIterations?: number;
};

/**
 * The resolved per-stage configuration actually used for a run, recorded in the
 * manifest and run log so cost data can be attributed to a specific model and
 * parameter set. `modelId` is `null` only for stages that make no LLM calls (in
 * which case the whole `StageRunConfig` is typically `null`). Recorded per stage
 * in the manifest and run log (technical-design.md §4.5, §4.6).
 */
export type StageRunConfig = {
	readonly modelId: string | null;
} & StageParams;

/**
 * Per-stage model and parameter configuration as declared in
 * `pipeline-config.json`. Unlike {@link StageRunConfig}, `modelId` is required
 * here — a configured stage always names a model (technical-design.md §6).
 */
export type StageConfig = {
	readonly modelId: string;
} & StageParams;

/**
 * Validated contents of `pipeline-config.json` (technical-design.md §6).
 */
export type PipelineConfig = {
	readonly version: string;
	readonly moduleRoots: readonly string[];
	readonly openRouter: {
		/**
		 * The address every OpenRouter call is made against — the SDK's `baseURL`,
		 * the model-list endpoint, and the models page a failed model-ID check
		 * links to are all derived from it. Configuration rather than a constant
		 * for the same reason a model ID is: it describes the service being
		 * called, not this codebase, so a gateway or regional endpoint is a config
		 * edit (technical-design.md §6).
		 */
		readonly baseUrl: string;
		readonly rateLimitRpm: number;
	};
	readonly elevenLabs: {
		/**
		 * The rate Stage 2 multiplies by audio duration to attribute transcription
		 * spend, since the Scribe API returns no price with a transcript. Accurate
		 * only for the call this pipeline makes — batch Scribe v2 with no
		 * diarization, entity detection, or keyterm prompting, each of which
		 * ElevenLabs bills as a surcharge on top of the base rate.
		 */
		readonly costPerAudioHourUsd: number;
	};
	readonly currency: {
		/**
		 * The USD→GBP rate applied when presenting costs. Every provider bills in
		 * US dollars, so costs are stored in USD and converted only at display
		 * time (NFR-2.3): correcting a stale rate re-renders every historical
		 * report consistently, and no stored figure ever mixes rates.
		 */
		readonly gbpPerUsd: number;
	};
	readonly modelIdCheck: {
		/**
		 * Provider prefixes — the part of a model ID before the `/` — that the
		 * OpenRouter model-ID check skips, so a stage on a non-OpenRouter provider
		 * can still declare its model in config. Exempting a provider trades away
		 * typo protection for its IDs.
		 */
		readonly exemptProviders: readonly string[];
	};
	readonly stages: Readonly<Partial<Record<StageId, StageConfig>>>;
	readonly output: {
		readonly language: string;
		readonly pandocEngine: string;
	};
};

/**
 * The checker's verdict for a single QA iteration (technical-design.md Stage 7).
 */
export type QaVerdict = "pass" | "fail";

/**
 * A single QA iteration's outcome, summarised for the manifest
 * (technical-design.md Stage 7).
 */
export type QaIterationSummary = {
	readonly iteration: number;
	readonly verdict: QaVerdict;
	readonly deficiencyCount: number;
	readonly criticalCount: number;
	readonly costUsd: number;
};

/**
 * The condition that terminated the QA loop (technical-design.md Stage 7).
 */
export type TerminationReason = "qa-passed" | "max-iterations-reached" | "stalled";

/**
 * The overall cost of the outputs currently on disk for a lecture, broken down
 * by stage. Mirrors `manifest.currentPipelineCost` (technical-design.md §4.5).
 */
export type CurrentPipelineCost = {
	readonly totalCostUsd: number;
	readonly byStage: Readonly<Partial<Record<StageId, number>>>;
};

/** Output-related fields common to every terminal stage entry. */
type StageOutputData = {
	readonly configUsed: StageRunConfig | null;
	readonly cost: StageCost | null;
	readonly filesWritten: readonly string[];
};

/** Fields carried by a successfully completed or skipped stage entry. */
type CompletedStageData = StageOutputData & {
	readonly completedAt: string;
};

/** A stage that has not yet run in this pipeline configuration. */
type StageEntryPending = { readonly status: "pending" };

/** A stage currently executing, or crashed mid-run (treated as failed next launch). */
type StageEntryRunning = { readonly status: "running" };

/** A stage whose `run()` threw; `error` and `failedAt` are set. */
type StageEntryFailed = {
	readonly status: "failed";
	readonly failedAt: string;
	readonly error: string;
} & StageOutputData;

/** A stage whose `run()` succeeded and whose output files are on disk. */
type StageEntryComplete = { readonly status: "complete" } & CompletedStageData;

/** A stage skipped because its output already existed from a prior run. */
type StageEntrySkipped = { readonly status: "skipped" } & CompletedStageData;

/** The `qa-loop` completed entry, carrying per-iteration QA data. */
type StageEntryQaComplete = StageEntryComplete & {
	readonly qaIterations: readonly QaIterationSummary[];
	readonly terminationReason: TerminationReason;
};

/**
 * The stage-entry states that are identical for every stage. Only the completed
 * shape differs between a standard stage and `qa-loop`, so that variant is added
 * separately by each exported entry type.
 */
type SharedStageEntry =
	| StageEntryPending
	| StageEntryRunning
	| StageEntrySkipped
	| StageEntryFailed;

/**
 * A stage's entry in the run manifest, discriminated by `status` so that
 * status-specific fields (`completedAt`, `failedAt`, `error`) are present only
 * when they are meaningful. Applies to every stage except `qa-loop`, which
 * carries additional data — see {@link QaManifestStageEntry}. Defined in technical-design.md §4.5.
 */
export type ManifestStageEntry = SharedStageEntry | StageEntryComplete;

/**
 * The `qa-loop` stage's manifest entry. Identical to {@link ManifestStageEntry}
 * except that a completed entry additionally records the per-iteration
 * summaries and the reason the loop terminated (technical-design.md Stage 7).
 */
export type QaManifestStageEntry = SharedStageEntry | StageEntryQaComplete;

/**
 * The per-stage map in the manifest: `qa-loop` maps to its richer entry type,
 * every other stage to the standard entry. Keyed by `StageId`, so indexing by a
 * dynamic stage id yields the union of both entry types.
 */
type ManifestStages = {
	readonly "qa-loop"?: QaManifestStageEntry;
} & Readonly<Partial<Record<Exclude<StageId, "qa-loop">, ManifestStageEntry>>>;

/** The lecture-identity fields common to the manifest and the stage context. */
type LectureIdentity = {
	readonly lectureNumber: number;
	/**
	 * `YYYY-MM-DD`. Unique within its `moduleRoot` (guaranteed by Stage 0) and
	 * the user-facing identifier the CLI accepts, e.g. `run <date>`
	 * (technical-design.md §4.7).
	 */
	readonly lectureDate: string;
	/** Best-effort title from the source filename; may be thin (see naming.ts). */
	readonly provisionalTitle: string;
	/**
	 * The final title. Seeded at Stage 0 to `provisionalTitle`; replaced by
	 * `aiDerivedTitle` at Stage 3 only when the LLM judges the lecturer's
	 * provisional title not meaningful for the content. Always non-null so
	 * downstream stages read it without a guard.
	 */
	readonly lectureTitle: string;
};

/**
 * The complete `manifest.json` for a single lecture. All paths within are
 * relative to `workspaceRoot` so the manifest survives a folder rename
 * (technical-design.md §4.5).
 */
export type RunManifest = {
	readonly version: string;
} & LectureIdentity & {
		/**
		 * The title the user set explicitly through the CLI `rename` command.
		 * `null` until they rename the lecture. It wins the title precedence
		 * outright — `userTitle` › `aiDerivedTitle` › `provisionalTitle` — so once
		 * set, neither Stage 0 nor Stage 3 overwrites `lectureTitle`
		 * (technical-design.md §5, Stage 0).
		 */
		readonly userTitle: string | null;
		/**
		 * The replacement title Stage 3's LLM proposes from the transcript.
		 * `null` before Stage 3 runs, and `null` afterwards when Stage 3 keeps the
		 * lecturer's provisional title (the LLM prefers a meaningful original and
		 * proposes nothing). Set only when the provisional is judged not
		 * meaningful, in which case `lectureTitle` becomes this value and the
		 * source files, workspace folder, and any PDF are renamed accordingly.
		 */
		readonly aiDerivedTitle: string | null;
		readonly workspaceFolderName: string;
		readonly createdAt: string;
		readonly updatedAt: string;
		readonly stages: ManifestStages;
		readonly currentPipelineCost: CurrentPipelineCost;
	};

/**
 * Immutable context handed to every stage for a single lecture run
 * (technical-design.md §4.2). Stages read
 * from it but never mutate it; all manifest changes flow through the runner.
 */
export type StageContext = LectureIdentity & {
	readonly workspaceRoot: string; // canonical internal handle; absolute path to workspace folder
	readonly moduleRoot: string; // absolute path to the containing module (e.g. Biology of Disease/)
	readonly config: PipelineConfig;
	readonly manifest: RunManifest;
};

/**
 * The result of a successful stage run.
 *
 * `filesWritten` entries are relative to `workspaceRoot` and MAY escape upward
 * with `..` (e.g. `pdf-generation` writes to `../../Final output/`) but MUST
 * resolve to a location under `moduleRoot` — enforced by path validation
 * (technical-design.md §4.4).
 *
 * @typeParam TOutput - The stage-specific output payload.
 */
export type StageResult<TOutput> = {
	readonly output: TOutput;
	readonly cost: StageCost | null;
	readonly filesWritten: readonly string[];
};

/**
 * The interface every pipeline stage implements (technical-design.md §4.2).
 *
 * @typeParam TInput - The input the stage consumes, produced by `getInput`.
 * @typeParam TOutput - The output the stage's `run` produces.
 */
export type PipelineStage<TInput, TOutput> = {
	readonly stageId: StageId;

	/**
	 * Whether the stage's work already exists on disk and need not re-run.
	 * @param context - The current lecture run context.
	 * @returns `true` when the manifest marks the stage complete and every
	 * recorded output file exists.
	 */
	isComplete(context: StageContext): Promise<boolean>;

	/**
	 * Gathers and validates the stage's input from prior stages' outputs.
	 * @param context - The current lecture run context.
	 * @returns The resolved input payload.
	 */
	getInput(context: StageContext): Promise<TInput>;

	/**
	 * Executes the stage.
	 * @param args - The resolved input and the current lecture run context.
	 * @returns The stage output, cost, and files written.
	 */
	run(args: {
		readonly input: TInput;
		readonly context: StageContext;
	}): Promise<StageResult<TOutput>>;
};

/**
 * Stage 0's per-module contract. Unlike a per-lecture {@link PipelineStage}, it
 * processes ALL of a module's currently-present raw sources together in one batch
 * pass, not one lecture at a time. It is re-run over the module's life as further
 * lectures are added (they arrive weekly): each run picks up new sources, leaves
 * already-normalised lectures untouched, and renumbers existing lectures when a
 * newly added lecture sorts earlier by date. Whole-module scope is required
 * precisely because sequential date-ordered numbering means a new earlier lecture
 * shifts later numbers — which demands collision-safe (temp-first) renames across
 * the whole module, impossible to do lecture-in-isolation (technical-design.md §5,
 * Stage 0).
 */
export type SourceNormalisationStage = {
	readonly stageId: "source-normalisation";
	/**
	 * Normalises every raw source under a module into lecture workspaces.
	 * @param args - The module to normalise.
	 * @param args.moduleRoot - Absolute path to the module directory.
	 * @returns A promise that resolves once the module's workspaces exist.
	 */
	normaliseModule(args: { readonly moduleRoot: string }): Promise<void>;
};

/**
 * Severity of a single QA deficiency (technical-design.md Stage 7).
 */
export type QaSeverity = "critical" | "major" | "minor";

/**
 * Category of a single QA deficiency. Each value maps to a functional
 * requirement and drives a specific reviser action (technical-design.md
 * Stage 7).
 */
export type QaDeficiencyType =
	| "omission" // source content is entirely absent from the notes (FR-4.2)
	| "inadequate-coverage" // source content is mentioned but under-developed (FR-4.2)
	| "factual-error" // a claim in the notes contradicts the source (FR-4.3)
	| "unsupported-claim" // a claim in the notes is not supported by any source (FR-4.3)
	| "clarity" // factually correct but ambiguous, muddled, or hard to follow (FR-4.3)
	| "british-english" // spelling, punctuation, or idiom deviating from en-GB
	| "formatting" // heading level, list structure, table structure, or LaTeX rendering
	| "figure-reference"; // wrong image, missing image, or broken relative path

/**
 * A single issue found by the QA checker, with the evidence and the suggested
 * remedy the reviser will act on (technical-design.md Stage 7).
 */
export type QaDeficiency = {
	readonly severity: QaSeverity;
	readonly type: QaDeficiencyType;
	readonly description: string;
	readonly sourceEvidence: string; // direct quote from the source material
	readonly suggestedFix: string;
	readonly location: string; // section heading, "Glossary", or "throughout"
};

/**
 * The structured report returned by the QA checker for one iteration
 * (technical-design.md Stage 7).
 */
export type QaDeficienciesReport = {
	readonly iteration: number;
	readonly overallVerdict: QaVerdict;
	readonly coverageScore: number; // 0–100, LLM self-assessed
	readonly deficiencies: readonly QaDeficiency[];
};

/**
 * How a run was initiated: a normal manual invocation or a `--from-stage`
 * re-run (technical-design.md §4.6).
 */
export type RunTrigger = "manual" | "from-stage";

/**
 * Automatic classification of a run, derived from manifest state at start, used
 * to lay out the cost report (technical-design.md §7).
 */
export type RunType = "normal" | "error-recovery" | "experiment";

/** Cost fields recorded per stage in a run log. */
type RunLogCost = {
	readonly totalCostUsd: number | null;
	readonly callCount: number;
};

/** Fields common to every `ran` run-log entry, before status discrimination. */
type RanStageBase = {
	readonly action: "ran";
	readonly configUsed: StageRunConfig | null;
	readonly cost: RunLogCost;
};

/**
 * What happened to a stage during a run, as recorded in the run log
 * (technical-design.md §4.6).
 *
 * `skipped` means the stage was eligible but its output already existed;
 * `not-reached` means an upstream failure prevented it from being attempted. A
 * `ran` entry is further discriminated by `status`, so `error` is present only
 * on a failed run.
 */
export type RunLogStageEntry =
	| { readonly action: "skipped" }
	| { readonly action: "not-reached" }
	| (RanStageBase & { readonly status: "complete" })
	| (RanStageBase & { readonly status: "failed"; readonly error: string });

/**
 * A single append-only run log written to `runs/<timestamp>.json`. Records the
 * complete financial audit trail for one pipeline invocation, including failed
 * attempts (technical-design.md §4.6).
 */
export type RunLog = {
	readonly runId: string;
	readonly startedAt: string;
	readonly endedAt: string;
	readonly triggeredBy: RunTrigger;
	readonly runType: RunType;
	readonly fromStage: StageId | null;
	readonly stages: Readonly<Partial<Record<StageId, RunLogStageEntry>>>;
	readonly totalCostThisRun: number;
};

/**
 * The overall outcome of a run or batch: every attempted stage complete
 * (`success`), some skipped or not reached (`partial`), or at least one failure
 * (`failed`) (technical-design.md §4.7).
 */
export type OverallStatus = "success" | "partial" | "failed";

/**
 * A lecture located by `resolveLecturesByDate`, identifying its module and
 * workspace (technical-design.md §4.7).
 */
export type LectureMatch = {
	readonly moduleRoot: string;
	readonly workspaceRoot: string;
	readonly lectureNumber: number;
	readonly lectureTitle: string;
};

/**
 * Options controlling a single lecture or batch run (technical-design.md §4.7).
 */
export type RunOptions = {
	readonly fromStage?: StageId; // reset this stage + all downstream to pending before running
	/**
	 * How many lectures `runBatch` processes at once, drawn from one queue across
	 * every module in the batch. Defaults to 1, i.e. sequential. Only `batch`
	 * offers it: `run` addresses a single lecture, so the CLI rejects
	 * `--concurrency` there rather than accepting an option it would ignore
	 * (technical-design.md §4.7). Distinct from `StageConfig.concurrency`, which
	 * bounds the parallel API calls made *within* one stage.
	 */
	readonly concurrency?: number;
	/**
	 * When `true`, a stage failure is logged and the runner moves to the next
	 * stage rather than aborting the run; when unset (default), the run stops at
	 * the first failed stage (technical-design.md §8, Stage Failure Protocol).
	 */
	readonly continueOnError?: boolean;
};

/**
 * Options narrowing a cost report (technical-design.md §4.7).
 */
export type ReportOptions = {
	readonly lectureDate?: string; // narrow the report to this date (via resolveLecturesByDate)
};

/**
 * What one stage did during a run, paired with the stage it happened to. The run
 * log keys its entries by stage id; a summary is an ordered list, so it carries
 * the id alongside each entry — without it a caller (the CLI's end-of-run
 * summary) could not say which stage an outcome belongs to
 * (technical-design.md §4.7, §7).
 */
export type RunStageOutcome = {
	readonly stageId: StageId;
	readonly entry: RunLogStageEntry;
};

/**
 * The outcome of running one lecture through the pipeline (technical-design.md §4.7).
 */
export type RunSummary = {
	readonly workspaceRoot: string;
	readonly runId: string; // matches the run log created for this run
	readonly startedAt: string; // ISO 8601
	readonly endedAt: string; // ISO 8601
	readonly totalCostUsd: number;
	readonly stageOutcomes: readonly RunStageOutcome[]; // in execution order
	readonly overallStatus: OverallStatus;
};

/**
 * The outcome of running a batch of lectures across one or more modules
 * (technical-design.md §4.7).
 */
export type BatchSummary = {
	readonly startedAt: string;
	readonly endedAt: string;
	readonly lectures: readonly RunSummary[]; // one entry per lecture attempted, in the order they ran
	readonly totalCostUsd: number;
	readonly overallStatus: OverallStatus;
};
