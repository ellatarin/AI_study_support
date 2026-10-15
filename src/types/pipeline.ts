/**
 * The types that the stages, the runner, the config loader and the cost report
 * share. This module imports nothing, so every layer can import from it.
 *
 * See technical-design.md §4 (architecture), §6 (config) and §7 (cost).
 */

/**
 * The name of the configuration file in the project root. It is here, not in the
 * config loader, to prevent an import cycle (technical-design.md §6).
 */
export const CONFIG_FILENAME = "pipeline-config.json";

/** Every stage, in pipeline order. {@link StageId} is derived from it (technical-design.md §4.1). */
export const STAGE_IDS = [
	"source-normalisation",
	"audio-extraction",
	"transcription",
	"initial-subtopic-splitting",
	"deepen-subtopic-splitting",
	"choose-division",
	"retitle-subtopics",
	"group-into-topics",
	"judge-lecture-title",
	"structure-transcript",
	"render-slides",
	"read-slides",
	"place-slides",
	"correct-terms",
	"rewrite-subtopics",
	"check-facts",
	"correct-factual-errors",
	"relocate-slides",
	"build-notes-page",
] as const;

/** The id of one stage (technical-design.md §4.1). */
export type StageId = (typeof STAGE_IDS)[number];

/**
 * Every language that the notes can be written in. Each tag maps to the name that
 * a prompt uses, because a model does not reliably obey a tag (technical-design.md §6).
 */
export const OUTPUT_LANGUAGES = {
	"en-GB": "British English",
	"en-US": "American English",
} as const;

/** The tag of a language that the notes can be written in (technical-design.md §6). */
export type OutputLanguage = keyof typeof OUTPUT_LANGUAGES;

/** The page views of the notes page, in the order of the page's switch (CONTEXT.md, "Page view"). */
export const PAGE_VIEW_IDS = ["notes", "rewrite", "corrections", "transcript"] as const;

/** The id of one page view of the notes page. */
export type PageViewId = (typeof PAGE_VIEW_IDS)[number];

/** The page view that the notes page opens on. `finalOutput.pageViews` must hold it. */
export const FIRST_PAGE_VIEW: PageViewId = "notes";

/**
 * The status of a stage entry in the manifest (technical-design.md §4.2).
 *
 * If the invocation stops while a stage runs, `running` stays in the manifest.
 * The next pipeline run does the stage again, because it is not a completed stage.
 */
export type StageStatus = "pending" | "running" | "complete" | "failed" | "skipped";

/**
 * The cost of a call, or the reason that the cost is unknown. An unknown cost is
 * never zero (NFR-2.2).
 */
export type CostResolution =
	| { readonly costUsd: number }
	| { readonly costUsd: null; readonly unknownCostReason: string };

/** The token counts, the number of calls and the cost of a stage's calls (technical-design.md §7). */
export type StageCost = {
	readonly promptTokens: number;
	readonly completionTokens: number;
	readonly callCount: number;
} & CostResolution;

/**
 * The tally of what one stage run spends. Each model call adds the cost of its
 * reply. The runner reads the total when the stage fails (technical-design.md §7,
 * "A stage that fails").
 */
export type CostTally = {
	readonly add: (cost: StageCost) => void;
	/** Gives the sum of each cost added, or `null` when nothing was added. */
	readonly total: () => StageCost | null;
};

/** The cost of one model of a stage with a list of models (technical-design.md §4.5). */
export type ModelCost = { readonly modelId: string; readonly cost: StageCost };

/**
 * The cost tally of each model of one stage run, for a stage with a list of
 * models. The runner owns it, so each model's cost is still there when the stage
 * fails, as the stage's own {@link CostTally} is (technical-design.md §4.5, §7).
 */
export type CostTallyByModel = {
	/** Gives the tally of one model. The first call for a model makes it. */
	readonly tallyOf: (modelId: string) => CostTally;
	/** Gives the total of each model that has a cost, in the order of the first `tallyOf` call for each model. */
	readonly costByModel: () => readonly ModelCost[];
};

/** A stage's tuning: its model settings other than the model itself (technical-design.md §6). */
type StageTuning = {
	readonly temperature?: number;
	readonly maxTokens?: number;
	/** The number of splitting or grouping runs that a panel stage makes at once. Unset means one at a time. */
	readonly concurrency?: number;
	/** The number of calls that one splitting run makes at once in deepening. Only `deepen-subtopic-splitting` reads it. */
	readonly callConcurrency?: number;
	/** The send gate, in seconds. Only `group-into-topics` reads it. */
	readonly sendGapSeconds?: number;
};

/**
 * The configuration that a stage ran with, as its stage entry and the run log
 * record it (technical-design.md §4.5).
 *
 * The runner never writes `modelId: null`. For a stage with no configuration, it
 * writes `null` in place of the whole value.
 */
export type StageConfigUsed =
	| ({ readonly modelId: string | null } & StageTuning)
	/** The config of each model of the list that the stage used: called, or read the saved reply of. */
	| FactCheckStageConfig
	/** The page views and the highlight switch that built the notes page. */
	| Pick<PipelineConfig["finalOutput"], "pageViews" | "highlightSlideSentences">;

/** One stage's configuration in `pipeline-config.json` (technical-design.md §6). */
export type StageConfig = {
	readonly modelId: string;
} & StageTuning;

/** The configuration of `correct-factual-errors`: one model, and the switch that turns the correction off. */
export type FactCorrectionStageConfig = StageConfig & {
	/** `true` makes the stage copy each rewrite unchanged, with no model call. */
	readonly bypass: boolean;
};

/** The roles of a model in the `models` list of `check-facts` (technical-design.md §5, `check-facts`, and §6). */
export const MODEL_ROLES = ["primary", "secondary", "disabled"] as const;

/** The role of a model in the `models` list of `check-facts`. */
export type ModelRole = (typeof MODEL_ROLES)[number];

/** One entry of the `models` list of `check-facts`: a model, its settings and its role (technical-design.md §6). */
export type FactCheckModel = {
	readonly modelId: string;
	readonly role: ModelRole;
} & Pick<StageTuning, "temperature" | "maxTokens">;

/** The configuration of `check-facts`: a list of models in place of one `modelId` (technical-design.md §6). */
export type FactCheckStageConfig = { readonly models: readonly FactCheckModel[] };

/** The stages whose configuration has one `modelId`. Only `check-facts` has a list of models. */
export type SingleModelStageId = Exclude<StageId, "check-facts">;

/** The size of a panel, and its bar. */
export type PanelSettings = {
	readonly panelSize: number;
	/** The support that a position needs to be kept. It is at most `panelSize`. */
	readonly bar: number;
};

/** The page settings of the Notes PDF, from `finalOutput.pdf` (CONTEXT.md, "Notes PDF"). */
export type NotesPdfSettings = {
	/** The text size, in points. */
	readonly fontSizePt: number;
	/** The margin on each of the four sides of the page, in millimetres. */
	readonly marginMm: number;
	/** The slide width, as a percent of the width of the text column. */
	readonly slideWidthPercent: number;
	/** The space above each slide, in millimetres. */
	readonly slideSpaceBeforeMm: number;
	/** The space below each slide, under its caption, in millimetres. */
	readonly slideSpaceAfterMm: number;
};

/** The contents of `pipeline-config.json`, after the config loader checks them (technical-design.md §6). */
export type PipelineConfig = {
	readonly version: string;
	readonly moduleRoots: readonly string[];
	readonly openRouter: {
		readonly baseUrl: string;
		/** The time in milliseconds that the OpenAI client waits for one HTTP request. */
		readonly completionTimeoutMs: number;
		/** The number of times that the OpenAI client retries an HTTP request inside one send. */
		readonly completionMaxRetries: number;
	};
	readonly elevenLabs: {
		readonly baseUrl: string;
		/** The language spoken in the lectures, as an ISO-639-3 code such as `eng`. It is not the language of the notes. */
		readonly languageCode: string;
		/** The price of one hour of audio, because the Scribe API returns no price. */
		readonly costPerAudioHourUsd: number;
	};
	readonly currency: {
		/** The number of pounds for one US dollar. Costs are stored in dollars and converted only when shown. */
		readonly gbpPerUsd: number;
	};
	readonly modelIdCheck: {
		/** The providers whose model IDs the model-ID check skips. A provider is the part of a model ID before the `/`. */
		readonly exemptProviders: readonly string[];
	};
	/** The splitting panel and the size gate (technical-design.md §5, "Dividing the transcript"). */
	readonly subtopicSplitting: PanelSettings & {
		/** The size gate: deepening takes a subtopic with more words than this. */
		readonly sizeGateWords: number;
	};
	/** The grouping panel. Its vote only breaks ties between groupings (technical-design.md §5, `group-into-topics`). */
	readonly grouping: PanelSettings;
	readonly batch: {
		/** The number of lectures that a batch runs at once. `--concurrency` overrides it. */
		readonly concurrency: number;
	};
	readonly naming: {
		/** The module prefixes that normalisation strips from a filename. The match ignores case. */
		readonly modulePrefixes: readonly string[];
	};
	readonly stages: Readonly<Partial<Record<SingleModelStageId, StageConfig>>> & {
		readonly "check-facts"?: FactCheckStageConfig;
		readonly "correct-factual-errors"?: FactCorrectionStageConfig;
	};
	readonly finalOutput: {
		/** The language that every stage that writes prose is told to use. */
		readonly language: OutputLanguage;
		/** The page views that the notes page shows. The page keeps its own order of the views. */
		readonly pageViews: readonly PageViewId[];
		/** `true` colours the sentence of each slide in the Notes view. */
		readonly highlightSlideSentences: boolean;
		readonly pdf: NotesPdfSettings;
	};
};

/** The cost and the files of a stage entry. The files come from the stage's result, and the cost from its cost tally. */
type StageCostAndFiles = {
	readonly cost: StageCost | null;
	/**
	 * The cost of each model that the stage called, since the last reset. Only a
	 * stage with a list of models has it (technical-design.md §4.5).
	 */
	readonly costByModel?: readonly ModelCost[];
	readonly filesWritten: readonly string[];
};

type StageOutputData = StageCostAndFiles & {
	readonly configUsed: StageConfigUsed | null;
};

type CompletedStageData = StageOutputData & {
	readonly completedAt: string;
};

type StageEntryPending = { readonly status: "pending" };

/** A stage that is running now, or that was running when the invocation stopped. */
type StageEntryRunning = { readonly status: "running" };

type StageEntryFailed = {
	readonly status: "failed";
	readonly failedAt: string;
	readonly error: string;
} & StageOutputData;

type StageEntryComplete = { readonly status: "complete" } & CompletedStageData;

/** A completed stage that the runner did not run again. It keeps the data of the earlier entry. */
type StageEntrySkipped = { readonly status: "skipped" } & CompletedStageData;

/** The entry of a completed stage: `complete` or `skipped` (technical-design.md §4.2, §4.7). */
export type CompletedStageEntry = StageEntryComplete | StageEntrySkipped;

/** The stage entry of a stage (technical-design.md §4.5). */
export type StageEntry =
	| StageEntryPending
	| StageEntryRunning
	| StageEntrySkipped
	| StageEntryFailed
	| StageEntryComplete;

/** The lecture identity fields that the manifest and the stage context share. */
type LectureIdentity = {
	readonly lectureNumber: number;
	/** `YYYY-MM-DD`. It is unique in the module. */
	readonly lectureDate: string;
	/** The title from the lecturer's filename. It can be empty. */
	readonly provisionalTitle: string;
	/** The user title if set, otherwise the AI-derived title, otherwise the provisional title. */
	readonly lectureTitle: string;
};

/** The `manifest.json` of one lecture. Its paths are relative to the workspace (technical-design.md §4.5). */
export type Manifest = {
	readonly version: string;
} & LectureIdentity & {
		/** The title that the `rename` command sets. While it is set, no stage changes `lectureTitle`. */
		readonly userTitle: string | null;
		/**
		 * The title that `judge-lecture-title` proposes when the provisional title is
		 * not meaningful (technical-design.md §5, `judge-lecture-title`).
		 */
		readonly aiDerivedTitle: string | null;
		readonly baseName: string;
		readonly createdAt: string;
		readonly updatedAt: string;
		/** Each stage's entry. Nothing adds the stage costs together (NFR-2.2). */
		readonly stages: Readonly<Partial<Record<StageId, StageEntry>>>;
	};

/**
 * The data that a stage receives about its lecture. A stage only reads it. The
 * runner builds a new one after each stage (technical-design.md §4.2).
 */
export type StageContext = LectureIdentity & {
	readonly workspaceRoot: string; // absolute path
	readonly moduleRoot: string; // absolute path
	readonly config: PipelineConfig;
	/** The manifest as it was before the runner marked this stage `running`. */
	readonly manifest: Manifest;
};

/** The lecture identity fields that a stage decided, for the runner to write (technical-design.md §4.2). */
export type LectureIdentityChanges = Partial<
	Pick<Manifest, "lectureTitle" | "aiDerivedTitle" | "baseName">
>;

/**
 * The value that a stage's `run` returns (technical-design.md §4.2). Each `filesWritten`
 * entry is relative to the workspace and must stay in the module (§4.4). The cost
 * is not part of it: the runner reads the cost tally of the stage run (§7).
 *
 * @typeParam TOutput - The stage's own output.
 */
export type StageResult<TOutput> = Pick<StageCostAndFiles, "filesWritten"> & {
	readonly output: TOutput;
	/** The facts that the stage found and that the user must see. Absent means none (technical-design.md §10, "Stage Notices"). */
	readonly notices?: readonly string[];
	/** The lecture identity that the stage decided. Absent and `{}` both mean nothing. */
	readonly identityChanges?: LectureIdentityChanges;
};

/**
 * The contract that every stage of one lecture meets (technical-design.md §4.2).
 *
 * @typeParam TInput - The value that `getInput` gives to `run`.
 * @typeParam TOutput - The output of `run`.
 */
export type PipelineStage<TInput, TOutput> = {
	readonly stageId: StageId;

	/**
	 * Checks that the stage is a completed stage, so that the runner can skip it.
	 * @param context - The stage context.
	 * @returns `true` when the stage entry is `complete` or `skipped` and every file that it records is on disk.
	 */
	isComplete(context: StageContext): Promise<boolean>;

	/**
	 * Reads the stage's input from the output of earlier stages, and checks it.
	 * @param context - The stage context.
	 * @returns The input.
	 */
	getInput(context: StageContext): Promise<TInput>;

	/**
	 * Does the stage's work.
	 * @param args - The input, the stage context, and the cost tally of this stage run.
	 * @returns The output, the cost and the files written.
	 */
	run(args: {
		readonly input: TInput;
		readonly context: StageContext;
		readonly costTally: CostTally;
		/** The cost tally of each model, for a stage with a list of models. */
		readonly costTallyByModel: CostTallyByModel;
	}): Promise<StageResult<TOutput>>;
};

/**
 * The contract of `source-normalisation`. It works on a whole module, because a
 * new lecture can change the number of every later lecture (technical-design.md §5,
 * `source-normalisation`).
 */
export type SourceNormalisationStage = {
	readonly stageId: "source-normalisation";
	/**
	 * Normalises every source pair in a module into workspaces.
	 * @param args - The module.
	 * @param args.moduleRoot - The absolute path of the module folder.
	 * @returns A promise that resolves when every workspace of the module exists.
	 */
	normaliseModule(args: { readonly moduleRoot: string }): Promise<void>;
};

/** The way that a pipeline run started: with `--from-stage` or without it. */
export type PipelineRunTrigger = "manual" | "from-stage";

/** The run type of a pipeline run, decided from the manifest when it starts (technical-design.md §7). */
export type RunType = "normal" | "error-recovery" | "experiment";

/**
 * The cost of one stage in a run log (technical-design.md §4.6). A stage that
 * made no calls has `costUsd: null` and `callCount: 0`.
 */
export type RunLogCost = {
	readonly costUsd: number | null;
	readonly callCount: number;
};

type RanStageBase = {
	readonly action: "ran";
	readonly configUsed: StageConfigUsed | null;
	readonly cost: RunLogCost;
	/** The cost of each model that the stage called in this run. Only a stage with a list of models has it (technical-design.md §4.5). */
	readonly costByModel?: readonly { readonly modelId: string; readonly cost: RunLogCost }[];
};

/**
 * The record of one stage in a pipeline run (technical-design.md §4.6).
 * `not-reached` follows a failure that stopped the run, or the `--to-stage` bound.
 */
export type RunLogStageEntry =
	| { readonly action: "skipped" }
	| { readonly action: "not-reached" }
	| (RanStageBase & { readonly status: "complete" })
	| (RanStageBase & { readonly status: "failed"; readonly error: string });

/** The start and the end of a piece of work, both as ISO 8601 times. */
type TimePeriod = {
	readonly startedAt: string;
	readonly endedAt: string;
};

/** The append-only record of one pipeline run, in `Run logs/` in the workspace. */
export type RunLog = TimePeriod & {
	readonly pipelineRunId: string;
	readonly triggeredBy: PipelineRunTrigger;
	readonly runType: RunType;
	readonly fromStage: StageId | null;
	readonly toStage: StageId | null;
	/** The record of each stage, with its cost. The run log has no total (NFR-2.2). */
	readonly stages: Readonly<Partial<Record<StageId, RunLogStageEntry>>>;
};

/**
 * `failed` when any stage failed, otherwise `success`. So a bounded run succeeds
 * while later stages are still pending (technical-design.md §4.7).
 */
export type OverallStatus = "success" | "failed";

/** A lecture that `resolveLecturesByDate` found (technical-design.md §4.7). */
export type LectureMatch = {
	readonly moduleRoot: string;
	readonly workspaceRoot: string;
	readonly lectureNumber: number;
	readonly lectureTitle: string;
};

/** The options of one pipeline run (technical-design.md §4.7). */
export type PipelineRunOptions = {
	readonly fromStage?: StageId; // reset this stage and every later stage, then run from it
	/** The last stage that the pipeline run does. Nothing is reset or deleted. */
	readonly toStage?: StageId;
	/** The action of the runner after a stage fails (technical-design.md §8). */
	readonly onStageFailure: "halt" | "continue";
};

/** The options of a batch (technical-design.md §4.7). */
export type BatchOptions = PipelineRunOptions & {
	/** The number of lectures that `runBatch` runs at once. This is not a stage's `concurrency`. */
	readonly concurrency: number;
};

/** The words that `--fact-correction` accepts. */
export const FACT_CORRECTION_CHOICES = ["run", "bypass"] as const;

/** The words that `--highlight-slide-sentences` accepts. */
export const HIGHLIGHT_CHOICES = ["on", "off"] as const;

/**
 * The config values that the flags of `run` and `batch` override for one
 * invocation. Each value holds the flag's word. `null` means that the config value applies.
 */
export type ConfigOverrides = {
	/** The override of `stages.correct-factual-errors.bypass`, from `--fact-correction`. */
	readonly factCorrection: (typeof FACT_CORRECTION_CHOICES)[number] | null;
	/** The override of `finalOutput.pageViews`, from `--page-views`. */
	readonly pageViews: readonly PageViewId[] | null;
	/** The override of `finalOutput.highlightSlideSentences`, from `--highlight-slide-sentences`. */
	readonly highlightSlideSentences: (typeof HIGHLIGHT_CHOICES)[number] | null;
};

/** The overrides of an invocation with none of the override flags. */
export const NO_CONFIG_OVERRIDES: ConfigOverrides = {
	factCorrection: null,
	pageViews: null,
	highlightSlideSentences: null,
};

/** The options of a pipeline run when the caller gives none. */
export const DEFAULT_PIPELINE_RUN_OPTIONS: PipelineRunOptions = { onStageFailure: "halt" };

/** The options of a batch when the caller gives none. */
export const DEFAULT_BATCH_OPTIONS: BatchOptions = {
	...DEFAULT_PIPELINE_RUN_OPTIONS,
	concurrency: 1,
};

/** The options that narrow a cost report (technical-design.md §4.7). */
export type ReportOptions = {
	readonly lectureDate?: string;
};

/** The outcome of one stage in a pipeline run, with the stage's id (technical-design.md §4.7). */
export type PipelineStageOutcome = {
	readonly stageId: StageId;
	readonly entry: RunLogStageEntry;
};

/** The outcome of one pipeline run (technical-design.md §4.7). */
export type PipelineRunSummary = TimePeriod & {
	readonly workspaceRoot: string;
	readonly pipelineRunId: string; // the same as in the run log
	readonly stageOutcomes: readonly PipelineStageOutcome[]; // in pipeline order
	readonly overallStatus: OverallStatus;
};

/** The outcome of a batch (technical-design.md §4.7). */
export type BatchSummary = TimePeriod & {
	readonly lectures: readonly PipelineRunSummary[]; // by module, then by date
	readonly overallStatus: OverallStatus;
};

/**
 * A fact that the runner reports while a pipeline run happens. The CLI writes the
 * words (technical-design.md §10).
 */
export type PipelineRunEvent =
	| { readonly event: "lecture-started"; readonly manifest: Manifest }
	| { readonly event: "stage-started"; readonly stageId: StageId }
	| { readonly event: "stage-skipped"; readonly stageId: StageId }
	| {
			readonly event: "stage-completed";
			readonly stageId: StageId;
			readonly cost: StageCost | null;
	  }
	| { readonly event: "stage-failed"; readonly stageId: StageId }
	| { readonly event: "stage-notice"; readonly stageId: StageId; readonly notice: string };

/** Receives the runner's events (technical-design.md §10). */
export type PipelineRunReporter = (event: PipelineRunEvent) => void;
