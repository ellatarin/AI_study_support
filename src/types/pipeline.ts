/**
 * The types that the stages, the runner, the config loader and the cost report
 * share. Also, the constants that some of these types are derived from.
 *
 * This module imports nothing. So every layer can import from it without a cycle.
 *
 * See technical-design.md §4 (architecture), §6 (config) and §7 (cost).
 */

/**
 * The name of the configuration file in the project root.
 *
 * The name is declared here, and not in the config loader, because code that the
 * loader imports also names the file. The OpenRouter client and the message for
 * an unconfigured stage tell the user to edit it. `config.ts` imports from
 * `openrouter.ts`, so an import back from `config.ts` would make a cycle
 * (technical-design.md §6).
 */
export const CONFIG_FILENAME = "pipeline-config.json";

/**
 * Every stage, in pipeline order (technical-design.md §4.1).
 *
 * {@link StageId} is derived from this list, so a stage cannot be in one and not
 * in the other. Code that walks the stages in order iterates this list.
 */
export const STAGE_IDS = [
	"source-normalisation",
	"audio-extraction",
	"transcription",
	"initial-subtopic-splitting",
	"deepen-subtopic-splitting",
	"choose-division",
	"retitle-subtopics",
	"group-into-topics",
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
 * Every language that the notes can be written in. Each BCP-47 tag maps to the
 * name that a prompt uses for the language.
 *
 * A model does not reliably obey "Write in en-GB", so a prompt names the language
 * in words. The tag and its name are declared together, so the config cannot
 * offer a language that the prompts have no name for (technical-design.md §6).
 *
 * The language spoken in the lectures is a different setting:
 * {@link PipelineConfig.elevenLabs.languageCode}.
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
 * The runner writes `running` before the stage starts. If the invocation stops
 * while the stage runs, `running` stays in the manifest. The next pipeline run
 * does the stage again, because it is not a completed stage.
 */
export type StageStatus = "pending" | "running" | "complete" | "failed" | "skipped";

/**
 * The cost of a call, or the reason that the cost is unknown.
 *
 * An unknown cost has `costUsd: null` and a reason. It is never zero, because a
 * failed lookup and a call that cost nothing are different facts (NFR-2.2).
 *
 * This type is separate from {@link StageCost} because two parts of the code find
 * a cost before any token count is known. The OpenRouter client reads `usage.cost`
 * from a reply, and `transcription` prices the audio by its length.
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

/** A stage's tuning: its model settings other than the model itself. */
type StageTuning = {
	readonly temperature?: number;
	readonly maxTokens?: number;
	/**
	 * How many splitting or grouping runs a panel stage makes at once. Unset means
	 * one at a time (technical-design.md §6).
	 */
	readonly concurrency?: number;
	/**
	 * How many calls one splitting run makes at once in deepening. Only
	 * `deepen-subtopic-splitting` reads it. The config loader refuses it on any
	 * other stage (technical-design.md §6).
	 */
	readonly callConcurrency?: number;
	/**
	 * The send gate: the least time, in seconds, between the starts of two of the
	 * stage's sends. Resends count. Only `group-into-topics` reads it. The config
	 * loader refuses it on any other stage (technical-design.md §6).
	 */
	readonly sendGapSeconds?: number;
	/** The iteration limit of the QA loop. Only `qa-loop` uses it, and that stage is not built. */
	readonly maxIterations?: number;
};

/**
 * The configuration that a stage ran with, as its stage entry and the run log
 * record it. It lets each cost be matched to a model and its tuning (NFR-3.2,
 * technical-design.md §4.5).
 *
 * The type lets `modelId` be `null`, but the runner never writes that. For a stage
 * with no configuration, the runner writes `null` in place of the whole value.
 */
export type StageConfigUsed = {
	readonly modelId: string | null;
} & StageTuning;

/** One stage's configuration in the `stages` section of `pipeline-config.json` (technical-design.md §6). */
export type StageConfig = {
	readonly modelId: string;
} & StageTuning;

/** The size of a panel, and its bar. */
export type PanelSettings = {
	/** How many runs the panel makes. */
	readonly panelSize: number;
	/**
	 * The support that a position needs to be kept. The config loader refuses a bar
	 * above `panelSize`, because then the vote could keep nothing.
	 */
	readonly bar: number;
};

/** The contents of `pipeline-config.json`, after the config loader checks them (technical-design.md §6). */
export type PipelineConfig = {
	readonly version: string;
	readonly moduleRoots: readonly string[];
	readonly openRouter: {
		/**
		 * The address of the OpenRouter API. The OpenAI client, the model list and the
		 * models page that a failed model-ID check links to all come from it.
		 *
		 * It is configuration because it describes the service, not this code. A
		 * gateway or a regional endpoint needs only a config edit
		 * (technical-design.md §6).
		 */
		readonly baseUrl: string;
		/** How long the OpenAI client waits for one HTTP request, in milliseconds. */
		readonly completionTimeoutMs: number;
		/**
		 * How many times the OpenAI client itself retries a failed HTTP request. These
		 * retries happen inside one send. The pipeline's resends are separate.
		 */
		readonly completionMaxRetries: number;
	};
	readonly elevenLabs: {
		/**
		 * The address of the ElevenLabs API, given to the SDK's own `baseUrl` option.
		 * ElevenLabs serves one API from several regional hosts. The host that an
		 * account must use depends on the account, so the host is configuration
		 * (technical-design.md §6).
		 */
		readonly baseUrl: string;
		/**
		 * The language spoken in the lectures, as the ISO-639-3 code that Scribe
		 * expects, such as `eng`.
		 *
		 * It is separate from {@link PipelineConfig.finalOutput.language}, which is the
		 * language of the notes. A user can want notes in a language that the lecture
		 * was not given in. Also, the two settings take different forms
		 * (technical-design.md §6).
		 */
		readonly languageCode: string;
		/**
		 * The price of one hour of audio. `transcription` multiplies it by the audio's
		 * length, because the Scribe API returns no price.
		 *
		 * The rate is correct only for the request that this pipeline makes: batch
		 * Scribe v2 with no diarization, entity detection or keyterm prompting.
		 * ElevenLabs charges extra for each of those (technical-design.md §6).
		 */
		readonly costPerAudioHourUsd: number;
	};
	readonly currency: {
		/**
		 * The number of pounds for one US dollar, used when a cost is shown.
		 *
		 * Providers charge in US dollars, so costs are stored in dollars and
		 * converted only when shown. A corrected rate therefore changes every
		 * report, old ones too, and no stored figure mixes two rates (NFR-2.3).
		 */
		readonly gbpPerUsd: number;
	};
	readonly modelIdCheck: {
		/**
		 * The provider prefixes that the model-ID check skips. A provider prefix is the
		 * part of a model ID before the `/`.
		 *
		 * With its provider listed, a stage that does not call OpenRouter can name its
		 * model in the config. The IDs of a listed provider get no check for typing
		 * errors (technical-design.md §6).
		 */
		readonly exemptProviders: readonly string[];
	};
	/** The splitting panel and the size gate (technical-design.md §5, "Dividing the transcript"). */
	readonly subtopicSplitting: PanelSettings & {
		/** The size gate: deepening takes a subtopic with more words than this. */
		readonly sizeGateWords: number;
	};
	/**
	 * The grouping panel (technical-design.md §5, `group-into-topics`). Its bar
	 * applies to the vote, and the vote only breaks ties between groupings.
	 */
	readonly grouping: PanelSettings;
	/** How a batch runs (technical-design.md §4.7, §6). */
	readonly batch: {
		/** How many lectures a batch runs at once. `--concurrency` overrides it for one invocation. */
		readonly concurrency: number;
	};
	readonly naming: {
		/**
		 * The module prefixes that normalisation strips from a filename when it takes
		 * the provisional title. The match ignores case.
		 *
		 * A lecturer can write one module in two ways, such as `BOD_Cell injury` and
		 * `Biology of Disease - Cell injury`. So the list holds both. It is
		 * configuration because a module prefix describes a module, not this code. A
		 * module prefix that is not in the list stays in the base name. So it is in
		 * the workspace folder name and the notes PDF (technical-design.md §3.2).
		 */
		readonly modulePrefixes: readonly string[];
	};
	/** Each stage's configuration. The config loader refuses a key that names no stage. */
	readonly stages: Readonly<Partial<Record<StageId, StageConfig>>>;
	readonly finalOutput: {
		/**
		 * The language that every stage that writes prose is told to use
		 * (technical-design.md §6).
		 *
		 * The setting is a regional variant, because a reader notices the spelling.
		 * The transcriber cannot be told a variant: its `languageCode` names only a
		 * language. So the first model call is the first point where the spelling can
		 * be chosen.
		 */
		readonly language: OutputLanguage;
		readonly pandocEngine: string;
	};
};

/** A checker's verdict on one output (technical-design.md §5, `qa-loop`). */
export type QaVerdict = "pass" | "fail";

/** One iteration of the QA loop, as the `qa-loop` stage entry records it (technical-design.md §5, `qa-loop`). */
export type QaIterationSummary = {
	readonly iteration: number;
	readonly verdict: QaVerdict;
	readonly deficiencyCount: number;
	readonly criticalCount: number;
	readonly costUsd: number;
};

/**
 * The reason that the QA loop stopped (technical-design.md §5, `qa-loop`).
 * `stalled` means that the deficiencies stopped changing.
 */
export type TerminationReason = "qa-passed" | "max-iterations-reached" | "stalled";

/**
 * The part of a stage's result that the runner copies into the stage entry
 * unchanged: the cost and the files written (technical-design.md §4.2).
 *
 * `configUsed` is not here, because the runner takes it from the configuration
 * that it resolved, not from the stage.
 */
type StageCostAndFiles = {
	readonly cost: StageCost | null;
	readonly filesWritten: readonly string[];
};

/** The fields of a failed, completed or skipped stage entry. */
type StageOutputData = StageCostAndFiles & {
	readonly configUsed: StageConfigUsed | null;
};

type CompletedStageData = StageOutputData & {
	readonly completedAt: string;
};

/** A stage that has not run since the manifest was made or the stage was reset. */
type StageEntryPending = { readonly status: "pending" };

/** A stage that is running now, or that was running when the invocation stopped. */
type StageEntryRunning = { readonly status: "running" };

/** A stage whose `run` threw. `error` holds the message. */
type StageEntryFailed = {
	readonly status: "failed";
	readonly failedAt: string;
	readonly error: string;
} & StageOutputData;

/** A stage whose `run` returned a result. */
type StageEntryComplete = { readonly status: "complete" } & CompletedStageData;

/**
 * A stage that the runner did not run, because it was already a completed stage.
 * The entry keeps the time, configuration, cost and files of the earlier entry.
 */
type StageEntrySkipped = { readonly status: "skipped" } & CompletedStageData;

/** The completed entry of `qa-loop`, with each iteration and the reason that the loop stopped. */
type StageEntryQaComplete = StageEntryComplete & {
	readonly qaIterations: readonly QaIterationSummary[];
	readonly terminationReason: TerminationReason;
};

/** The stage entries that are the same for every stage. Only the completed entry of `qa-loop` is different. */
type SharedStageEntry =
	| StageEntryPending
	| StageEntryRunning
	| StageEntrySkipped
	| StageEntryFailed;

/**
 * The entry of a completed stage: `complete` or `skipped`. Both mean that the
 * stage's output was made and is not paid for again (technical-design.md §4.2).
 *
 * The type is exported so that `isCompletedEntry` can be a type guard. A caller
 * that checks can then read `filesWritten` without a cast.
 *
 * The completed entry of `qa-loop` extends {@link StageEntryComplete}. So it is in
 * this union, and narrowing keeps its extra fields.
 */
export type CompletedStageEntry = StageEntryComplete | StageEntrySkipped;

/**
 * The stage entry of every stage except `qa-loop`, which has a
 * {@link QaStageEntry} (technical-design.md §4.5). The `status` field decides
 * which other fields are present.
 */
export type StageEntry = SharedStageEntry | StageEntryComplete;

/**
 * The stage entry of `qa-loop`. Its completed entry also records each iteration
 * and the reason that the loop stopped (technical-design.md §5, `qa-loop`).
 */
export type QaStageEntry = SharedStageEntry | StageEntryQaComplete;

/**
 * The stage entries of a manifest, by stage id. An index with a stage id that is
 * not known at compile time gives either kind of entry.
 */
type ManifestStages = {
	readonly "qa-loop"?: QaStageEntry;
} & Readonly<Partial<Record<Exclude<StageId, "qa-loop">, StageEntry>>>;

/** The lecture identity fields that the manifest and the stage context share. */
type LectureIdentity = {
	readonly lectureNumber: number;
	/**
	 * The lecture date, as `YYYY-MM-DD`. Normalisation makes sure that it is unique
	 * in the module. The CLI takes it to name a lecture, as in `run <date>`
	 * (technical-design.md §4.7).
	 */
	readonly lectureDate: string;
	/** The title from the lecturer's filename. It can be empty (see `src/utils/naming.ts`). */
	readonly provisionalTitle: string;
	/**
	 * The lecture title: the user title if set, otherwise the AI-derived title,
	 * otherwise the provisional title. It is never `null`, so a later stage reads it
	 * without a check.
	 *
	 * Normalisation sets it to the provisional title for a new lecture.
	 * `transcript-structuring` changes it when it adopts an AI-derived title. The
	 * `rename` command changes it to the user title.
	 */
	readonly lectureTitle: string;
};

/**
 * The `manifest.json` of one lecture (technical-design.md §4.5). Its paths are
 * relative to the workspace, so the manifest stays correct when the workspace
 * folder is renamed.
 */
export type Manifest = {
	readonly version: string;
} & LectureIdentity & {
		/**
		 * The user title, set by the `rename` command. It is `null` until the user
		 * renames the lecture. While it is set, no stage changes `lectureTitle`
		 * (technical-design.md §5, `source-normalisation`).
		 */
		readonly userTitle: string | null;
		/**
		 * The AI-derived title. It is `null` until `transcript-structuring` judges the
		 * provisional title not meaningful and proposes a title.
		 *
		 * With no user title, the stage also makes it the lecture title and renames
		 * the lecture files to match. With a user title, only this field changes.
		 */
		readonly aiDerivedTitle: string | null;
		readonly baseName: string;
		readonly createdAt: string;
		readonly updatedAt: string;
		/**
		 * Each stage's entry. The stage entries are the only record of what each stage
		 * cost. Nothing adds the stage costs together (NFR-2.2,
		 * technical-design.md §4.5).
		 */
		readonly stages: ManifestStages;
	};

/**
 * The data that a stage receives about its lecture (technical-design.md §4.2). A
 * stage only reads it. The runner writes every change to the manifest, and builds
 * a new stage context after each stage.
 */
export type StageContext = LectureIdentity & {
	readonly workspaceRoot: string; // absolute path of the workspace
	readonly moduleRoot: string; // absolute path of the module folder, such as `Biology of Disease/`
	readonly config: PipelineConfig;
	/** The manifest as it was before the runner marked this stage `running`. */
	readonly manifest: Manifest;
};

/**
 * The lecture identity fields that a stage decided, for the runner to write into
 * the manifest (technical-design.md §4.2). Only `transcript-structuring` decides
 * any. When it adopts an AI-derived title, it renames the lecture files to a new
 * base name.
 */
export type LectureIdentityChanges = Partial<
	Pick<Manifest, "lectureTitle" | "aiDerivedTitle" | "baseName">
>;

/**
 * What a stage's `run` returns (technical-design.md §4.2).
 *
 * Each `filesWritten` entry is relative to the workspace. An entry can go up with
 * `..`, as a path into the module's `Final output/` does, but it must stay in the
 * module. `resolveManifestPath` checks this before the path is used
 * (technical-design.md §4.4).
 *
 * @typeParam TOutput - The stage's own output.
 */
export type StageResult<TOutput> = StageCostAndFiles & {
	readonly output: TOutput;
	/**
	 * The lecture identity that the stage decided. The runner writes it into the
	 * manifest with the stage's `complete` entry. No stage writes the manifest
	 * itself (technical-design.md §4.2).
	 *
	 * Absent and `{}` mean the same: the stage decided nothing. The field is
	 * optional because only `transcript-structuring` sets it.
	 */
	readonly identityChanges?: LectureIdentityChanges;
};

/**
 * The contract that every stage of one lecture meets (technical-design.md §4.2).
 *
 * @typeParam TInput - What `getInput` gives to `run`.
 * @typeParam TOutput - The output of `run`.
 */
export type PipelineStage<TInput, TOutput> = {
	readonly stageId: StageId;

	/**
	 * Checks whether the stage is a completed stage, so that the runner can skip it.
	 * @param context - The stage context.
	 * @returns `true` when the stage entry is `complete` or `skipped` (see
	 * {@link CompletedStageEntry}) and every file that it records is on disk.
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
 * The contract of `source-normalisation`, which works on a whole module and not on
 * one lecture (technical-design.md §5, `source-normalisation`).
 *
 * The stage runs again each time lectures are added. It finds the new source
 * pairs, and it does not change a lecture that is already normalised, apart from
 * its number and base name.
 *
 * Numbering runs across the module. When a new lecture has an earlier date than
 * other lectures, every later lecture gets a new number and a new base name. Each
 * rename goes through a temporary name first, so that no rename lands on a name
 * that another lecture still uses. This needs the whole module at once.
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

/**
 * Every severity that a deficiency can have, worst first
 * (technical-design.md §5, `qa-loop`).
 *
 * The order is part of the fact. A checker's reply is checked against this list,
 * and the verification report Markdown sorts the deficiencies by it. With one list
 * for both, the two cannot disagree about a severity.
 */
export const QA_SEVERITIES = ["critical", "major", "minor"] as const;

/** The severity of one deficiency (technical-design.md §5, `qa-loop`). */
export type QaSeverity = (typeof QA_SEVERITIES)[number];

/**
 * The deficiency type of a deficiency (technical-design.md §5, `qa-loop`).
 *
 * Every stage that checks an output against its source uses this one union. So
 * two checkers cannot name the same fault in different words. Each checker is
 * offered only the deficiency types that it can judge. A checker that is asked
 * for a fault that it cannot judge will find one.
 *
 * Distortion and unsourced addition are separate because their remedies are
 * opposite. The reviser fixes a distortion against the source. It deletes an
 * unsourced addition, and never looks for a source to support it (NFR-1.3).
 */
export type QaDeficiencyType =
	// Faithfulness: transcript verification and the QA loop.
	| "omission" // source content that is absent from the output (FR-4.2)
	| "underexplained" // present, but without the mechanism or reasoning that makes it usable (FR-4.2)
	| "distortion" // the output asserts something that the source contradicts (FR-4.3)
	| "unsourced-addition" // in the output, but not in the source (FR-4.3)
	| "other" // a real deficiency that fits no other type. The description names the type it needs
	// Prose faults: the QA loop only.
	| "clarity" // correct, but ambiguous or hard to follow (FR-4.3)
	| "british-english" // spelling, punctuation or idiom that is not British English
	| "formatting" // heading levels, lists, tables or LaTeX
	| "figure-reference"; // a wrong or missing image, or a broken relative path

/**
 * The passage of the source that a deficiency or a consideration is about: a
 * quote, and where the quote is.
 *
 * Both are kept. With no location, a reader must search the whole transcript for
 * the quote. With no quote, a reader cannot check the location without the source
 * open.
 */
export type QaSourcePassage = {
	readonly evidence: string; // a direct quote from the source
	readonly location: string; // where the quote is in the source, in the checker's own words
};

/**
 * One deficiency that a checker found, with the fix that it suggests to the
 * reviser (technical-design.md §5, `qa-loop`).
 *
 * A deficiency gives both ends. `outputLocation` is where the fault is in the
 * output. For an omission, it is where the missing content belongs. `source` is
 * the passage that the deficiency is about. It is `null` for an unsourced
 * addition, which has no source, and for a prose fault, which is about the
 * output only.
 *
 * The verification report Markdown writes a "no source passage" line for a `null`
 * source. The check of a checker's reply accepts `null` for every deficiency type.
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
 * Something that a checker examined and decided is not a deficiency, with its
 * reason (technical-design.md §5, `qa-loop`).
 *
 * A list of deficiencies alone cannot tell a checker that missed something from a
 * checker that looked and cleared it. Only the first is a reason to distrust the
 * checker. Examples are a lecturer's aside, an announcement, and filler that the
 * output left out on purpose.
 */
export type QaConsideration = {
	readonly source: QaSourcePassage;
	readonly whyNotRaised: string;
};

/**
 * Everything that a checker's reply holds about one output and its source.
 *
 * The iteration number is not here, because the model cannot know it. The QA loop
 * adds it in {@link QaDeficienciesReport}. Transcript verification checks once
 * and has no iteration (technical-design.md §5, `transcript-verification` and
 * `qa-loop`).
 */
export type QaCheckerReport = {
	readonly overallVerdict: QaVerdict;
	readonly coverageScore: number; // 0 to 100, as the model estimates it
	readonly deficiencies: readonly QaDeficiency[];
	readonly considered: readonly QaConsideration[];
};

/** The checker report of one QA loop iteration, with the iteration's number (technical-design.md §5, `qa-loop`). */
export type QaDeficienciesReport = QaCheckerReport & {
	readonly iteration: number;
};

/** How a pipeline run started: with `--from-stage` or without it (technical-design.md §4.6). */
export type PipelineRunTrigger = "manual" | "from-stage";

/**
 * The run type of a pipeline run. The runner decides it from the manifest when
 * the pipeline run starts. The cost report puts each run log's costs in the
 * section for its run type (technical-design.md §7).
 */
export type RunType = "normal" | "error-recovery" | "experiment";

/**
 * The cost of one stage in a run log: what it spent and how many calls it made
 * (technical-design.md §4.6).
 *
 * It is smaller than {@link StageCost}. It has no token counts, and no reason for
 * an unknown cost. The stage entry in the manifest holds the full cost.
 *
 * It is also the only cost type that can show a stage that made no calls. The
 * runner writes `costUsd: null` and `callCount: 0` for such a stage. In
 * {@link StageCost}, `costUsd: null` needs an `unknownCostReason`, and a stage
 * that made no call had no lookup to fail.
 */
export type RunLogCost = {
	readonly costUsd: number | null;
	readonly callCount: number;
};

/** The fields of every run log entry for a stage that ran. */
type RanStageBase = {
	readonly action: "ran";
	readonly configUsed: StageConfigUsed | null;
	readonly cost: RunLogCost;
};

/**
 * What happened to one stage in a pipeline run, as the run log records it
 * (technical-design.md §4.6).
 *
 * `skipped` means that the stage was already a completed stage. `not-reached`
 * means that the pipeline run stopped before the stage. It stopped because a
 * stage failed with `onStageFailure: "halt"`, or because of the `--to-stage`
 * bound. A `ran` entry has an `error` only when the stage failed.
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

/**
 * One run log, written to `Run logs/<timestamp>.json` in the workspace
 * (technical-design.md §4.6). It is the append-only record of one pipeline run,
 * failed attempts included.
 */
export type RunLog = TimePeriod & {
	readonly pipelineRunId: string;
	readonly triggeredBy: PipelineRunTrigger;
	readonly runType: RunType;
	readonly fromStage: StageId | null;
	/** The `--to-stage` bound, or `null` for a pipeline run with no bound. The stages after it are `not-reached`. */
	readonly toStage: StageId | null;
	/** What each stage did and cost in this pipeline run. The run log has no total (NFR-2.2). */
	readonly stages: Readonly<Partial<Record<StageId, RunLogStageEntry>>>;
};

/**
 * The outcome of a pipeline run or a batch: `failed` when any stage failed,
 * otherwise `success` (technical-design.md §4.7).
 *
 * A skipped stage and a stage that was not reached count as success. So a bounded
 * run succeeds while later stages are still pending. The manifest, not this
 * status, shows how far a lecture has got.
 */
export type OverallStatus = "success" | "failed";

/** A lecture that `resolveLecturesByDate` found, with its module and workspace (technical-design.md §4.7). */
export type LectureMatch = {
	readonly moduleRoot: string;
	readonly workspaceRoot: string;
	readonly lectureNumber: number;
	readonly lectureTitle: string;
};

/** The options of one pipeline run (technical-design.md §4.7). */
export type PipelineRunOptions = {
	readonly fromStage?: StageId; // reset this stage and every later stage, then run from it
	/**
	 * The last stage that the pipeline run does. The stages after it are recorded
	 * `not-reached`, as after a halt. Nothing is reset or deleted, so the lecture
	 * stays resumable (technical-design.md §4.7).
	 *
	 * The bound is a position in {@link STAGE_IDS}, not a name matched against the
	 * stages that the runner has. So a stage that is not built can still bound a
	 * pipeline run.
	 */
	readonly toStage?: StageId;
	/**
	 * What the runner does after a stage fails. `halt` stops the pipeline run, and
	 * the later stages are `not-reached`. `continue` records the failure and starts
	 * the next stage (technical-design.md §8, Stage Failure Protocol).
	 *
	 * The field is required. The default is {@link DEFAULT_PIPELINE_RUN_OPTIONS},
	 * not a missing value.
	 */
	readonly onStageFailure: "halt" | "continue";
};

/**
 * The options of a batch: the options of one pipeline run, and how many lectures
 * run at once (technical-design.md §4.7).
 */
export type BatchOptions = PipelineRunOptions & {
	/**
	 * How many lectures `runBatch` runs at once. The lectures come from one queue
	 * across every module in the batch. {@link PipelineRunOptions} has no such
	 * field, because the `run` command runs one lecture.
	 *
	 * This is not a stage's `concurrency`, which is how many splitting or grouping
	 * runs a panel stage makes at once.
	 */
	readonly concurrency: number;
};

/** The options of a pipeline run when the caller gives none: halt at the first failure. */
export const DEFAULT_PIPELINE_RUN_OPTIONS: PipelineRunOptions = { onStageFailure: "halt" };

/** The options of a batch when the caller gives none: one lecture at a time. */
export const DEFAULT_BATCH_OPTIONS: BatchOptions = {
	...DEFAULT_PIPELINE_RUN_OPTIONS,
	concurrency: 1,
};

/** The options that narrow a cost report (technical-design.md §4.7). */
export type ReportOptions = {
	readonly lectureDate?: string; // report only the lecture with this lecture date
};

/**
 * What one stage did in a pipeline run, with the stage's id
 * (technical-design.md §4.7, §7).
 *
 * The run log keys its entries by stage id. A summary is an ordered list, so each
 * entry carries the id. Without it, the run summary could not name the stage of a
 * row.
 */
export type PipelineStageOutcome = {
	readonly stageId: StageId;
	readonly entry: RunLogStageEntry;
};

/** The outcome of one pipeline run (technical-design.md §4.7). */
export type PipelineRunSummary = TimePeriod & {
	readonly workspaceRoot: string;
	readonly pipelineRunId: string; // the same as in the run log of this pipeline run
	readonly stageOutcomes: readonly PipelineStageOutcome[]; // in pipeline order
	readonly overallStatus: OverallStatus;
};

/** The outcome of a batch, across one or more modules (technical-design.md §4.7). */
export type BatchSummary = TimePeriod & {
	readonly lectures: readonly PipelineRunSummary[]; // one for each lecture, by module and then by date
	readonly overallStatus: OverallStatus;
};

/**
 * A fact that the runner reports while a pipeline run happens, for the CLI to
 * show (technical-design.md §10).
 *
 * The run summary describes a pipeline run that has ended. These events are the
 * only way that a user sees what a long pipeline run is doing. When every stage
 * is skipped, they are the only sign that the pipeline run did anything.
 *
 * An event holds facts, not sentences. The CLI writes the words, so the runner
 * never writes to the user (technical-design.md §8).
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

/**
 * The function that receives the runner's events. The runner gets one as it gets
 * a logger. The CLI gives one that writes to the output stream that the CLI owns
 * (technical-design.md §10).
 */
export type PipelineRunReporter = (event: PipelineRunEvent) => void;
