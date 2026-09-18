/**
 * Shared type contracts for the lecture-notes pipeline, plus the two runtime
 * constants every layer names: the stage list the contracts are derived from
 * ({@link STAGE_IDS}) and the configuration file they are configured by
 * ({@link CONFIG_FILENAME}).
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
 * The configuration file's name within the project root.
 *
 * It sits with the contracts rather than with the loader that reads it because
 * the parties that name the file are not all downstream of the loader: two stages
 * tell the user to edit it when their configuration is wrong, and the suites write
 * one for the CLI to find. `config.ts` imports from `openrouter.ts`, so a stage
 * importing back from `config.ts` would cycle; this module imports nothing, so
 * everyone can reach it (technical-design.md §6).
 */
export const CONFIG_FILENAME = "pipeline-config.json";

/**
 * Every pipeline stage, in execution order (technical-design.md §4.1).
 *
 * It is the source of truth for {@link StageId}: the union is derived from it, so
 * a stage cannot be added to one and forgotten in the other.
 */
export const STAGE_IDS = [
	"source-normalisation",
	"audio-extraction",
	"transcription",
	"transcript-structuring",
	"transcript-verification",
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
 * Every language the pipeline can be configured to write, as a BCP-47 tag
 * mapped to the name a prompt calls it by.
 *
 * A tag identifies the language, and the name beside it is what an LLM is
 * actually told — "Write in en-GB" is not an instruction a model can follow
 * reliably, so the two are declared together and neither can be added without
 * the other. Regional variants are the whole point of the setting: the language
 * every prose stage writes differs from the language spoken in the lectures,
 * which is the transcriber's concern and takes a different form entirely
 * ({@link PipelineConfig.elevenLabs.languageCode}).
 *
 * It is the source of truth for {@link OutputLanguage}, so a language cannot be
 * offered in config without a name for the prompts to use
 * (technical-design.md §6).
 */
export const OUTPUT_LANGUAGES = {
	"en-GB": "British English",
	"en-US": "American English",
} as const;

/**
 * The configured language every prose stage writes in
 * (technical-design.md §6). Derived from {@link OUTPUT_LANGUAGES}.
 */
export type OutputLanguage = keyof typeof OUTPUT_LANGUAGES;

/**
 * Lifecycle status of a stage as recorded in the run manifest.
 *
 * `running` is written before a stage begins; a crash therefore leaves
 * `running` behind, which the next launch treats as `failed`
 * (technical-design.md §4.2, stage status semantics).
 */
export type StageStatus = "pending" | "running" | "complete" | "failed" | "skipped";

/**
 * What establishing a call's cost came to.
 *
 * A discriminated union on `costUsd`: a resolved cost carries a number; a failed
 * lookup carries `null` together with the `costResolutionError` explaining why.
 * Never zero for an unestablished cost, and never simply absent — a cost that
 * could not be established is reported as unknown (NFR-2.2).
 *
 * Declared apart from {@link StageCost} because the two parties that establish a
 * cost answer in exactly this shape before any token count joins it: the
 * OpenRouter generation lookup, and Stage 2's reading of the audio's duration.
 */
export type CostResolution =
	| { readonly costUsd: number }
	| { readonly costUsd: null; readonly costResolutionError: string };

/**
 * Token counts and resolved cost for the billable calls a stage made.
 *
 * Tokens and `callCount` are always populated; what the calls cost is a
 * {@link CostResolution} (technical-design.md §7).
 */
export type StageCost = {
	readonly promptTokens: number;
	readonly completionTokens: number;
	readonly callCount: number;
} & CostResolution;

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
		/** How long one completion attempt may take before it is abandoned. */
		readonly completionTimeoutMs: number;
		/** How many times a failed completion is retried before giving up. */
		readonly completionMaxRetries: number;
		/**
		 * How long one `/generation` cost lookup may take. Shorter than a
		 * completion's budget on purpose: cost is telemetry, and must never hold up
		 * a run that has already produced its output (technical-design.md §7).
		 */
		readonly costLookupTimeoutMs: number;
		/** How many times a failed cost lookup is retried before it resolves to `null`. */
		readonly costLookupMaxRetries: number;
	};
	readonly elevenLabs: {
		/**
		 * The address every ElevenLabs call is made against, handed to the SDK's
		 * own `baseUrl` option. Configuration for the same reason
		 * {@link PipelineConfig.openRouter.baseUrl} is, and more pressingly:
		 * ElevenLabs serves the same API from several regional residency hosts,
		 * and which one an account must use is a fact about that account rather
		 * than about this codebase (technical-design.md §6).
		 */
		readonly baseUrl: string;
		/**
		 * The language spoken in the lectures, as the ISO-639-3 code Scribe expects
		 * (`eng`). Deliberately not {@link PipelineConfig.output.language}, which is
		 * the language the *notes* are written in: a lecture delivered in one
		 * language may want notes in another, and the two take different forms
		 * anyway (technical-design.md §6).
		 */
		readonly languageCode: string;
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
	readonly naming: {
		/**
		 * How a lecturer names their module at the front of a filename, stripped
		 * from the title Stage 0 derives. Either a code (`BOD_Cell injury`) or the
		 * module written out (`Biology of Disease - Cell injury`), since lecturers
		 * do both, and matched without regard to case for the same reason.
		 *
		 * Configuration rather than a constant because a module prefix describes a
		 * module rather than this codebase, and the pipeline is pointed at more
		 * than one: an unlisted prefix survives into the workspace folder name and
		 * the final PDF for every lecture of that module (technical-design.md §3.2).
		 */
		readonly modulePrefixes: readonly string[];
	};
	readonly stages: Readonly<Partial<Record<StageId, StageConfig>>>;
	readonly output: {
		/**
		 * The language every stage that produces prose is told to write in. A
		 * regional variant, because that is the part a lecturer notices: the
		 * transcriber cannot be asked for one (its own `languageCode` names a
		 * language and nothing more), so the first point in the pipeline at which
		 * the spelling can be chosen at all is the first LLM call.
		 */
		readonly language: OutputLanguage;
		readonly pandocEngine: string;
	};
};

/**
 * The checker's verdict for a single QA iteration (technical-design.md Stage 8).
 */
export type QaVerdict = "pass" | "fail";

/**
 * A single QA iteration's outcome, summarised for the manifest
 * (technical-design.md Stage 8).
 */
export type QaIterationSummary = {
	readonly iteration: number;
	readonly verdict: QaVerdict;
	readonly deficiencyCount: number;
	readonly criticalCount: number;
	readonly costUsd: number;
};

/**
 * The condition that terminated the QA loop (technical-design.md Stage 8).
 */
export type TerminationReason = "qa-passed" | "max-iterations-reached" | "stalled";

/**
 * What one run of a stage produced: what the work cost, and what it left on
 * disk.
 *
 * Declared once because these two travel together from the stage to the
 * manifest — the runner reads both off {@link StageResult} and writes both into
 * the stage's entry, unchanged. `configUsed` is not among them: the runner
 * supplies that from the configuration it resolved, so it belongs to the entry
 * rather than to what the stage handed back (technical-design.md §4.2).
 */
type StageRunRecord = {
	readonly cost: StageCost | null;
	readonly filesWritten: readonly string[];
};

/** Output-related fields common to every terminal stage entry. */
type StageOutputData = StageRunRecord & {
	readonly configUsed: StageRunConfig | null;
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
 * A stage entry whose output stands on disk: the stage either ran to completion,
 * or was skipped because a prior run had already completed it. Both carry the
 * same {@link CompletedStageData}, and both mean the same thing to a later run —
 * the work is done and does not need paying for again (technical-design.md §4.2).
 *
 * Exported so the predicate that tests for it can be a type guard: a caller that
 * has checked goes on to read `filesWritten`, which a plain boolean would leave
 * it unable to reach without a cast.
 *
 * `qa-loop`'s completed entry extends {@link StageEntryComplete}, so it is a
 * member of this union and narrowing preserves its extra fields.
 */
export type SettledStageEntry = StageEntryComplete | StageEntrySkipped;

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
 * summaries and the reason the loop terminated (technical-design.md Stage 8).
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
		/**
		 * Every stage's state, and with it the only record of what each stage cost.
		 * No roll-up sits beside them: stage costs are read one stage at a time and
		 * summed nowhere (NFR-2.2, technical-design.md §4.5).
		 */
		readonly stages: ManifestStages;
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
 * The lecture-identity fields a stage may settle, for the runner to write into
 * the manifest. Only Stage 3 ever settles any: it judges the lecturer's
 * provisional title and, when it replaces it, renames the lecture's files onto
 * a new base name (technical-design.md §4.2; §5, Stage 3).
 */
export type LectureIdentityChanges = Partial<
	Pick<RunManifest, "lectureTitle" | "aiDerivedTitle" | "workspaceFolderName">
>;

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
export type StageResult<TOutput> = StageRunRecord & {
	readonly output: TOutput;
	/**
	 * What the stage settled about the lecture's identity, written by the runner
	 * with the stage's `complete` entry — no stage writes the manifest itself
	 * (technical-design.md §4.2).
	 *
	 * Absent and `{}` both mean the stage settled nothing; the runner spreads it
	 * either way. Only Stage 3 settles anything, which is why the field is
	 * optional rather than required of every stage.
	 */
	readonly identityChanges?: LectureIdentityChanges;
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
	 * @returns `true` when the manifest marks the stage complete or skipped (see
	 * {@link SettledStageEntry}) and every recorded output file exists.
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
 * Every severity a QA deficiency may carry, worst first
 * (technical-design.md Stage 8).
 *
 * Ordered rather than merely listed, because the order is a fact two parties
 * rely on: a checker's reply is validated against this set, and a report shown
 * to a reader is ordered by it. Written as a list and again as an ordering, the
 * two could disagree about a severity that had been added to one of them.
 *
 * It is the source of truth for {@link QaSeverity}, as {@link STAGE_IDS} is for
 * {@link StageId}.
 */
export const QA_SEVERITIES = ["critical", "major", "minor"] as const;

/**
 * Severity of a single QA deficiency (technical-design.md Stage 8).
 * Derived from {@link QA_SEVERITIES}.
 */
export type QaSeverity = (typeof QA_SEVERITIES)[number];

/**
 * Category of a single quality finding.
 *
 * One union shared by every stage that checks an output against the source it
 * was made from, so two checkers cannot end up describing the same fault in
 * different words. Each stage's prompt offers only its own subset: a checker
 * asked for a category it has no way to judge will find one.
 *
 * The faithfulness categories below are asked for by transcript verification
 * and by the QA loop alike; the prose categories are faults in the notes
 * themselves, which only the QA loop looks for.
 *
 * `distortion` and `unsourced-addition` divide on what the reviser must do, and
 * that line is the whole reason they are separate categories: a distortion
 * contradicts the source and is corrected against it, an unsourced addition is
 * absent from the source and is deleted. Looking for a source that would
 * support one instead would violate NFR-1.3 (technical-design.md Stage 8).
 */
export type QaDeficiencyType =
	// Faithfulness to the source: transcript verification and the QA loop.
	| "omission" // source content is entirely absent from the output (FR-4.2)
	| "underexplained" // present, but stripped of the mechanism or reasoning that makes it usable (FR-4.2)
	| "distortion" // the output asserts something the source contradicts (FR-4.3)
	| "unsourced-addition" // present in the output, absent from the source (FR-4.3)
	| "other" // a real finding no category fits — a standing prompt to invent the one it needs
	// Prose faults in the notes: the QA loop only.
	| "clarity" // factually correct but ambiguous, muddled, or hard to follow (FR-4.3)
	| "british-english" // spelling, punctuation, or idiom deviating from en-GB
	| "formatting" // heading level, list structure, table structure, or LaTeX rendering
	| "figure-reference"; // wrong image, missing image, or broken relative path

/**
 * The passage in the source a finding is about: the words themselves, and where
 * to go and read them.
 *
 * Both together, because a quote with no locator sends a reader hunting through
 * a whole transcript for it, and a locator with no quote cannot be checked
 * without opening the source. Stated once and reused, so a finding and a
 * cleared consideration point at a source the same way.
 */
export type QaSourceAnchor = {
	readonly evidence: string; // direct quote from the source material
	readonly location: string; // where that quote sits: topic block, slide number, or timestamp
};

/**
 * A single issue found by a quality checker, with the evidence and the
 * suggested remedy the reviser will act on (technical-design.md Stage 8).
 *
 * A finding locates both ends. `outputLocation` is where in the output the
 * fault sits, or — for an omission, where nothing sits yet — the place the
 * missing content belongs. `source` is the passage it is about. A category with
 * no source end carries `null` there rather than an invented locator: an
 * unsourced addition is defined by its absence from the source, and a prose
 * fault is about the output alone. Nothing branches on that `null`; which
 * categories have a source end is settled by `type`.
 */
export type QaDeficiency = {
	readonly severity: QaSeverity;
	readonly type: QaDeficiencyType;
	readonly description: string;
	readonly source: QaSourceAnchor | null;
	readonly suggestedFix: string;
	readonly outputLocation: string; // section heading, "Glossary", or "throughout"
};

/**
 * Something a checker examined and decided was not a deficiency, and why.
 *
 * Recorded because a findings list alone cannot distinguish a checker that
 * missed something from one that looked at it and cleared it, and only the
 * first is a reason to distrust the checker. A lecturer's aside, an
 * administrative announcement, or a filler phrase dropped on purpose belongs
 * here rather than going unmentioned (technical-design.md Stage 8).
 */
export type QaConsideration = {
	readonly source: QaSourceAnchor;
	readonly whyNotRaised: string;
};

/**
 * What a quality checker returns when asked to judge one output against its
 * source: everything the model itself is in a position to say.
 *
 * Separate from {@link QaDeficienciesReport} because the iteration number is not
 * the model's to supply — it is a fact about the loop calling it, and a checker
 * asked for it would have to guess. Transcript verification runs once and has no
 * iteration at all (technical-design.md Stage 4, Stage 8).
 */
export type QaFindingsReport = {
	readonly overallVerdict: QaVerdict;
	readonly coverageScore: number; // 0–100, LLM self-assessed
	readonly deficiencies: readonly QaDeficiency[];
	readonly considered: readonly QaConsideration[];
};

/**
 * One iteration's findings as the QA loop records them: what the checker said,
 * stamped with which pass said it (technical-design.md Stage 8).
 */
export type QaDeficienciesReport = QaFindingsReport & {
	readonly iteration: number;
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

/**
 * Cost fields recorded per stage in a run log: what the stage spent and how many
 * calls it took, and deliberately no more (technical-design.md §4.6).
 *
 * Narrower than {@link StageCost}, which also carries token counts and, for a
 * cost that could not be established, the reason. Keeping the history slim is
 * the intent rather than an oversight: the cost report reads these two fields
 * and nothing else, and the manifest is where a stage's full cost detail lives.
 *
 * It is also the only one of the two shapes that can describe a stage making no
 * billable calls at all. `StageCost`'s `costUsd: null` arm requires a
 * `costResolutionError`, and a stage that never called anything had no lookup
 * fail — so unifying the two would mean inventing a reason where there is none.
 */
export type RunLogCost = {
	readonly costUsd: number | null;
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
 * When a piece of work began and finished, both ISO 8601.
 *
 * A run log, a lecture's summary and a batch's summary each span a period, and
 * each said so for itself — three declarations of the same pair, which is three
 * places to correct should the pair ever gain a third member or change its
 * format.
 */
type TimeSpan = {
	readonly startedAt: string;
	readonly endedAt: string;
};

/**
 * A single append-only run log written to `runs/<timestamp>.json`. Records the
 * complete financial audit trail for one pipeline invocation, including failed
 * attempts (technical-design.md §4.6).
 */
export type RunLog = TimeSpan & {
	readonly runId: string;
	readonly triggeredBy: RunTrigger;
	readonly runType: RunType;
	readonly fromStage: StageId | null;
	/** The `--to-stage` bound, or `null` for a run that was not bounded; the stages after it read `not-reached`. */
	readonly toStage: StageId | null;
	/** What each stage of this run did and cost. The run itself carries no figure (NFR-2.2). */
	readonly stages: Readonly<Partial<Record<StageId, RunLogStageEntry>>>;
};

/**
 * The overall outcome of a run or batch: every stage's output standing, whether
 * this run produced it or found it already there (`success`), or at least one
 * stage that failed (`failed`) (technical-design.md §4.7).
 *
 * Two values rather than three. The question a run answers is whether the work
 * is done, and there are only two answers to it — a third would have to describe
 * a lecture whose pipeline is incomplete without anything having failed, and
 * nothing the runner sees can be that: it runs every stage it was given, and a
 * stage it never reached was stopped by a failure that already decides the run.
 */
export type OverallStatus = "success" | "failed";

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
 * Options controlling a single lecture run (technical-design.md §4.7).
 */
export type RunOptions = {
	readonly fromStage?: StageId; // reset this stage + all downstream to pending before running
	/**
	 * The last stage the run performs. Stages after it are not run and are
	 * recorded `not-reached`, exactly as the stages after a halt are; nothing is
	 * reset and nothing is deleted, so a bounded run leaves the lecture resumable
	 * rather than finished (technical-design.md §4.7).
	 *
	 * A position in {@link STAGE_IDS} rather than a name matched against the
	 * stages the runner holds, so a stage the pipeline has not yet built still
	 * bounds the run.
	 */
	readonly toStage?: StageId;
	/**
	 * What the runner does once a stage has failed: `halt` stops the run, leaving
	 * the stages after it `not-reached`; `continue` logs the failure and moves on
	 * to the next stage (technical-design.md §8, Stage Failure Protocol). Always
	 * stated — the default is {@link DEFAULT_RUN_OPTIONS}, not the absence of a
	 * value.
	 */
	readonly onStageFailure: "halt" | "continue";
};

/**
 * Options controlling a batch run: everything a single lecture run takes, plus
 * the one thing only a batch can say (technical-design.md §4.7).
 */
export type BatchRunOptions = RunOptions & {
	/**
	 * How many lectures `runBatch` processes at once, drawn from one queue across
	 * every module in the batch. Absent from {@link RunOptions} because `run`
	 * addresses a single lecture and could do nothing with it. Distinct from
	 * `StageConfig.concurrency`, which bounds the parallel API calls made
	 * *within* one stage.
	 */
	readonly concurrency: number;
};

/** What a lecture run does when its caller expresses no preference. */
export const DEFAULT_RUN_OPTIONS: RunOptions = { onStageFailure: "halt" };

/** What a batch run does when its caller expresses no preference: one at a time. */
export const DEFAULT_BATCH_OPTIONS: BatchRunOptions = {
	...DEFAULT_RUN_OPTIONS,
	concurrency: 1,
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
export type RunSummary = TimeSpan & {
	readonly workspaceRoot: string;
	readonly runId: string; // matches the run log created for this run
	readonly stageOutcomes: readonly RunStageOutcome[]; // in execution order
	readonly overallStatus: OverallStatus;
};

/**
 * The outcome of running a batch of lectures across one or more modules
 * (technical-design.md §4.7).
 */
export type BatchSummary = TimeSpan & {
	readonly lectures: readonly RunSummary[]; // one entry per lecture attempted, in the order they ran
	readonly overallStatus: OverallStatus;
};

/**
 * Something worth telling the user about, at the moment it happens
 * (technical-design.md §10).
 *
 * A run summary describes a run that has finished. These describe one that is
 * still going, which is the only way a user learns what a long run is doing —
 * and, for a run that repeats nothing, the only way they learn it did anything
 * at all.
 *
 * They carry facts rather than sentences: the wording is the CLI's, which is
 * what keeps the runner out of the business of writing to a user (§8).
 */
export type RunEvent =
	| { readonly event: "lecture-started"; readonly manifest: RunManifest }
	| { readonly event: "stage-started"; readonly stageId: StageId }
	| { readonly event: "stage-skipped"; readonly stageId: StageId }
	| {
			readonly event: "stage-completed";
			readonly stageId: StageId;
			readonly cost: StageCost | null;
	  }
	| { readonly event: "stage-failed"; readonly stageId: StageId };

/**
 * Where a run's events are told to. The runner is given one the way it is given
 * a logger; the CLI supplies one that writes to the stream it owns
 * (technical-design.md §10).
 */
export type RunReporter = (event: RunEvent) => void;
