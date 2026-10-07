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
	"transcript-structuring",
	"transcript-verification",
	"slide-conversion",
	"image-extraction",
	"synthesis",
	"qa-loop",
	"pdf-generation",
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
	/** The iteration limit of the QA loop. */
	readonly maxIterations?: number;
};

/**
 * The configuration that a stage ran with, as its stage entry and the run log
 * record it (technical-design.md §4.5).
 *
 * The runner never writes `modelId: null`. For a stage with no configuration, it
 * writes `null` in place of the whole value.
 */
export type StageConfigUsed = {
	readonly modelId: string | null;
} & StageTuning;

/** One stage's configuration in `pipeline-config.json` (technical-design.md §6). */
export type StageConfig = {
	readonly modelId: string;
} & StageTuning;

/** The size of a panel, and its bar. */
export type PanelSettings = {
	readonly panelSize: number;
	/** The support that a position needs to be kept. It is at most `panelSize`. */
	readonly bar: number;
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
	readonly stages: Readonly<Partial<Record<StageId, StageConfig>>>;
	readonly finalOutput: {
		/** The language that every stage that writes prose is told to use. */
		readonly language: OutputLanguage;
		readonly pandocEngine: string;
	};
};

/** A checker's verdict on one output. */
export type QaVerdict = "pass" | "fail";

/** One iteration of the QA loop, as the `qa-loop` stage entry records it (technical-design.md §5, `qa-loop`). */
export type QaIterationSummary = {
	readonly iteration: number;
	readonly verdict: QaVerdict;
	readonly deficiencyCount: number;
	readonly criticalCount: number;
	readonly costUsd: number;
};

/** The reason that the QA loop stopped. `stalled` means that the deficiencies stopped changing. */
export type TerminationReason = "qa-passed" | "max-iterations-reached" | "stalled";

/** The part of a stage's result that the runner copies into the stage entry unchanged. */
type StageCostAndFiles = {
	readonly cost: StageCost | null;
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

type StageEntryQaComplete = StageEntryComplete & {
	readonly qaIterations: readonly QaIterationSummary[];
	readonly terminationReason: TerminationReason;
};

type SharedStageEntry =
	| StageEntryPending
	| StageEntryRunning
	| StageEntrySkipped
	| StageEntryFailed;

/** The entry of a completed stage: `complete` or `skipped` (technical-design.md §4.2, §4.7). */
export type CompletedStageEntry = StageEntryComplete | StageEntrySkipped;

/** The stage entry of every stage except `qa-loop` (technical-design.md §4.5). */
export type StageEntry = SharedStageEntry | StageEntryComplete;

/** The stage entry of `qa-loop`, which also records each iteration (technical-design.md §5, `qa-loop`). */
export type QaStageEntry = SharedStageEntry | StageEntryQaComplete;

type ManifestStages = {
	readonly "qa-loop"?: QaStageEntry;
} & Readonly<Partial<Record<Exclude<StageId, "qa-loop">, StageEntry>>>;

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
		 * The title that `transcript-structuring` proposes when the provisional title is
		 * not meaningful (technical-design.md §5, `transcript-structuring`).
		 */
		readonly aiDerivedTitle: string | null;
		readonly baseName: string;
		readonly createdAt: string;
		readonly updatedAt: string;
		/** Each stage's entry. Nothing adds the stage costs together (NFR-2.2). */
		readonly stages: ManifestStages;
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
 * entry is relative to the workspace and must stay in the module (§4.4).
 *
 * @typeParam TOutput - The stage's own output.
 */
export type StageResult<TOutput> = StageCostAndFiles & {
	readonly output: TOutput;
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
	 * Checks whether the stage is a completed stage, so that the runner can skip it.
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
	 * @param args - The input and the stage context.
	 * @returns The output, the cost and the files written.
	 */
	run(args: {
		readonly input: TInput;
		readonly context: StageContext;
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

/** Every severity that a deficiency can have, worst first. Reports sort by this order. */
export const QA_SEVERITIES = ["critical", "major", "minor"] as const;

/** The severity of one deficiency. */
export type QaSeverity = (typeof QA_SEVERITIES)[number];

/**
 * The deficiency type of a deficiency. Every checker uses this one list, and is
 * offered only the types that it can judge (technical-design.md §5, `qa-loop`).
 */
export type QaDeficiencyType =
	// Faithfulness: transcript verification and the QA loop.
	| "omission" // source content that is absent from the output (FR-4.2)
	| "underexplained" // present, but without the mechanism or reasoning that makes it usable (FR-4.2)
	| "distortion" // the output asserts something that the source contradicts (FR-4.3)
	| "unsourced-addition" // in the output, but not in the source (FR-4.3)
	| "other" // a real deficiency that fits no other type
	// Prose faults: the QA loop only.
	| "clarity" // correct, but ambiguous or hard to follow (FR-4.3)
	| "british-english" // spelling, punctuation or idiom that is not British English
	| "formatting" // heading levels, lists, tables or LaTeX
	| "figure-reference"; // a wrong or missing image, or a broken relative path

/** The passage of the source that a deficiency or a consideration is about. */
export type QaSourcePassage = {
	readonly evidence: string; // a direct quote from the source
	readonly location: string; // where the quote is, in the checker's own words
};

/**
 * One deficiency that a checker found (technical-design.md §5, `qa-loop`).
 *
 * `source` is `null` for an unsourced addition and for a prose fault. The reply
 * check accepts `null` for every deficiency type.
 */
export type QaDeficiency = {
	readonly severity: QaSeverity;
	readonly type: QaDeficiencyType;
	readonly description: string;
	readonly source: QaSourcePassage | null;
	readonly suggestedFix: string;
	readonly outputLocation: string;
};

/**
 * Something that a checker examined and decided is not a deficiency. It shows that
 * the checker looked at a passage, and did not miss it.
 */
export type QaConsideration = {
	readonly source: QaSourcePassage;
	readonly whyNotRaised: string;
};

/** Everything that a checker's reply holds. The QA loop adds the iteration number, which the model cannot know. */
export type QaCheckerReport = {
	readonly overallVerdict: QaVerdict;
	readonly coverageScore: number; // 0 to 100, as the model estimates it
	readonly deficiencies: readonly QaDeficiency[];
	readonly considered: readonly QaConsideration[];
};

/** The checker report of one QA loop iteration, with the iteration's number. */
export type QaDeficienciesReport = QaCheckerReport & {
	readonly iteration: number;
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

/** When a piece of work started and ended, both as ISO 8601 times. */
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
	| { readonly event: "stage-failed"; readonly stageId: StageId };

/** The function that receives the runner's events (technical-design.md §10). */
export type PipelineRunReporter = (event: PipelineRunEvent) => void;
