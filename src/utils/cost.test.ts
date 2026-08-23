import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	GBP_PER_USD,
	makeManifest,
	otherLecture,
	otherModuleName,
	otherModuleRoot,
	testLecture,
	testModuleName,
	testModuleRoot,
	testRunId,
	transcriptionModelId,
} from "../pipeline/fixtures.js";
import { moduleDirs, stageOutputEntry } from "../pipeline/layout.js";
import type {
	BatchSummary,
	OverallStatus,
	RunLog,
	RunLogStageEntry,
	RunManifest,
	RunStageOutcome,
	RunSummary,
	StageCost,
	StageRunConfig,
} from "../types/pipeline.js";
import {
	accumulateCost,
	createMoneyFormatter,
	formatBatchSummary,
	formatCostReport,
	formatRunSummary,
} from "./cost.js";

// Slide conversion is the stage these tables are built around: it is the one
// with a per-call model, a concurrency, and enough calls for the totals to be
// worth checking. Every fixture below records the same run of it.
const SLIDE_CONVERSION_CONFIG: StageRunConfig = {
	modelId: "google/gemini-2.5-flash",
	concurrency: 3,
};
const SLIDE_CONVERSION_CALLS = 24;
const SLIDE_CONVERSION_COST_USD = 0.034;

describe("accumulateCost", () => {
	it.each([
		{
			name: "two resolved costs",
			current: { promptTokens: 100, completionTokens: 50, callCount: 1, totalCostUsd: 0.02 },
			incoming: { promptTokens: 200, completionTokens: 80, callCount: 2, totalCostUsd: 0.03 },
			expectedTokens: { promptTokens: 300, completionTokens: 130, callCount: 3 },
			expectedCost: 0.05,
		},
		{
			name: "a zero accumulator and a resolved cost",
			current: { promptTokens: 0, completionTokens: 0, callCount: 0, totalCostUsd: 0 },
			incoming: { promptTokens: 200, completionTokens: 80, callCount: 2, totalCostUsd: 0.03 },
			expectedTokens: { promptTokens: 200, completionTokens: 80, callCount: 2 },
			expectedCost: 0.03,
		},
	])("should sum tokens, calls, and cost when merging $name", ({
		current,
		incoming,
		expectedTokens,
		expectedCost,
	}) => {
		const result = accumulateCost({ current, incoming });

		expect(result.promptTokens).toBe(expectedTokens.promptTokens);
		expect(result.completionTokens).toBe(expectedTokens.completionTokens);
		expect(result.callCount).toBe(expectedTokens.callCount);
		expect(result.totalCostUsd).toBeCloseTo(expectedCost);
	});

	it("should carry the error and null the cost when the incoming cost is unresolved", () => {
		const result = accumulateCost({
			current: { promptTokens: 100, completionTokens: 50, callCount: 1, totalCostUsd: 0.02 },
			incoming: {
				promptTokens: 200,
				completionTokens: 80,
				callCount: 2,
				totalCostUsd: null,
				costResolutionError: "cost lookup timed out",
			},
		});

		expect(result).toEqual({
			promptTokens: 300,
			completionTokens: 130,
			callCount: 3,
			totalCostUsd: null,
			costResolutionError: "cost lookup timed out",
		});
	});

	it("should carry the error and null the cost when the current cost is unresolved", () => {
		const result = accumulateCost({
			current: {
				promptTokens: 100,
				completionTokens: 50,
				callCount: 1,
				totalCostUsd: null,
				costResolutionError: "generation lookup returned 503",
			},
			incoming: { promptTokens: 200, completionTokens: 80, callCount: 2, totalCostUsd: 0.03 },
		});

		expect(result).toEqual({
			promptTokens: 300,
			completionTokens: 130,
			callCount: 3,
			totalCostUsd: null,
			costResolutionError: "generation lookup returned 503",
		});
	});

	it("should join both errors when current and incoming are both unresolved", () => {
		const result = accumulateCost({
			current: {
				promptTokens: 100,
				completionTokens: 50,
				callCount: 1,
				totalCostUsd: null,
				costResolutionError: "prompt-cost lookup failed",
			},
			incoming: {
				promptTokens: 200,
				completionTokens: 80,
				callCount: 2,
				totalCostUsd: null,
				costResolutionError: "completion-cost lookup failed",
			},
		});

		expect(result).toEqual({
			promptTokens: 300,
			completionTokens: 130,
			callCount: 3,
			totalCostUsd: null,
			costResolutionError: "prompt-cost lookup failed; completion-cost lookup failed",
		});
	});
});

const resolved = ({
	callCount,
	totalCostUsd,
}: {
	readonly callCount: number;
	readonly totalCostUsd: number;
}): StageCost => ({
	promptTokens: 0,
	completionTokens: 0,
	callCount,
	totalCostUsd,
});

/**
 * A completed stage entry. What a report draws on is the model and the cost; the
 * timestamp is shared across entries because no report prints it.
 */
const completed = ({
	configUsed = null,
	cost = null,
	filesWritten = [],
}: {
	readonly configUsed?: StageRunConfig | null;
	readonly cost?: StageCost | null;
	readonly filesWritten?: readonly string[];
}) => ({
	status: "complete" as const,
	completedAt: "2025-10-10T09:05:00.000Z",
	configUsed,
	cost,
	filesWritten,
});

// A model id past any column's width, for the rows that have to survive one.
const OVERLONG_MODEL_ID = "openrouter/an-extravagantly-long-model-identifier";

// The longest model id technical-design.md §4.5 records, at 27 characters — the
// one the Model column has to hold without moving the columns after it.
const synthesisEntry = completed({
	configUsed: { modelId: "anthropic/claude-sonnet-4.6", maxTokens: 8192 },
	cost: resolved({ callCount: 1, totalCostUsd: 0.312 }),
	filesWritten: [stageOutputEntry("synthesis")],
});

const manifest: RunManifest = makeManifest({
	stages: {
		// Completed non-LLM stage: null config and null cost exercise the
		// manifestStageMeta "—"/0 fallbacks within the complete branch.
		"audio-extraction": completed({ filesWritten: [stageOutputEntry("audio-extraction")] }),
		transcription: completed({
			configUsed: { modelId: transcriptionModelId },
			cost: resolved({ callCount: 1, totalCostUsd: 0.042 }),
			filesWritten: [stageOutputEntry("transcription")],
		}),
		"slide-conversion": completed({
			configUsed: SLIDE_CONVERSION_CONFIG,
			cost: resolved({
				callCount: SLIDE_CONVERSION_CALLS,
				totalCostUsd: SLIDE_CONVERSION_COST_USD,
			}),
			filesWritten: [stageOutputEntry("slide-conversion")],
		}),
		synthesis: synthesisEntry,
	},
	currentPipelineCost: {
		totalCostUsd: 0.393,
		byStage: {
			"audio-extraction": 0,
			transcription: 0.042,
			"slide-conversion": SLIDE_CONVERSION_COST_USD,
			synthesis: 0.312,
			// In byStage but absent from `stages` — exercises the manifestStageMeta fallback.
			"pdf-generation": 0.005,
		},
	},
});

// The original failure, as technical-design.md §7's worked example has it: an
// ordinary run that no --from-stage preceded, so the classifier types it
// `normal`. Section 2 reaches it through the failure, not through the run's type.
const originalFailure: RunLog = {
	runId: "2025-10-10T09:00:00Z-1",
	startedAt: "2025-10-10T09:00:00.000Z",
	endedAt: "2025-10-10T09:02:00.000Z",
	triggeredBy: "manual",
	runType: "normal",
	fromStage: null,
	stages: {
		"slide-conversion": {
			action: "ran",
			status: "failed",
			configUsed: SLIDE_CONVERSION_CONFIG,
			cost: { totalCostUsd: 0.021, callCount: 5 },
			error: "Slide 17 conversion failed: 429 rate limit",
		},
	},
	totalCostThisRun: 0.021,
};

const runLogs: readonly RunLog[] = [
	originalFailure,
	{
		runId: "2025-10-10T10:30:00Z-1",
		startedAt: "2025-10-10T10:30:00.000Z",
		endedAt: "2025-10-10T10:33:00.000Z",
		triggeredBy: "from-stage",
		runType: "error-recovery",
		fromStage: "slide-conversion",
		stages: {
			"slide-conversion": {
				action: "ran",
				status: "complete",
				configUsed: SLIDE_CONVERSION_CONFIG,
				cost: {
					totalCostUsd: SLIDE_CONVERSION_COST_USD,
					callCount: SLIDE_CONVERSION_CALLS,
				},
			},
		},
		totalCostThisRun: SLIDE_CONVERSION_COST_USD,
	},
	{
		runId: "2025-10-11T14:00:00Z-1",
		startedAt: "2025-10-11T14:00:00.000Z",
		endedAt: "2025-10-11T14:05:00.000Z",
		triggeredBy: "from-stage",
		runType: "experiment",
		fromStage: "synthesis",
		stages: {
			synthesis: {
				action: "ran",
				status: "complete",
				configUsed: { modelId: "anthropic/claude-opus-4.1" },
				cost: { totalCostUsd: 0.89, callCount: 1 },
			},
		},
		totalCostThisRun: 0.89,
	},
	{
		runId: "2025-10-10T11:00:00Z-1",
		startedAt: "2025-10-10T11:00:00.000Z",
		endedAt: "2025-10-10T11:01:00.000Z",
		triggeredBy: "from-stage",
		runType: "error-recovery",
		fromStage: "image-extraction",
		stages: {
			// null cost → the section-2 "n/a" for the row, and the unresolved wasted total.
			"image-extraction": {
				action: "ran",
				status: "failed",
				configUsed: { modelId: "openai/gpt-4.1" },
				cost: { totalCostUsd: null, callCount: 2 },
				error: "cost lookup timed out",
			},
			// non-"ran" entry → the ranStageEntries skip branch.
			"audio-extraction": { action: "skipped" },
		},
		totalCostThisRun: null,
	},
	{
		runId: "2025-10-11T16:00:00Z-1",
		startedAt: "2025-10-11T16:00:00.000Z",
		endedAt: "2025-10-11T16:02:00.000Z",
		triggeredBy: "from-stage",
		runType: "experiment",
		fromStage: "synthesis",
		stages: {
			// null cost → the experiment-section "n/a" branch.
			synthesis: {
				action: "ran",
				status: "complete",
				configUsed: { modelId: "meta-llama/llama-3.1-405b" },
				cost: { totalCostUsd: null, callCount: 1 },
			},
		},
		totalCostThisRun: null,
	},
];

describe("createMoneyFormatter", () => {
	it.each([
		{
			scenario: "a whole dollar at the standard rate",
			gbpPerUsd: 0.74,
			usd: 1,
			expected: "£0.740",
		},
		{ scenario: "a fractional amount", gbpPerUsd: 0.74, usd: 0.042, expected: "£0.031" },
		{ scenario: "a corrected, higher rate", gbpPerUsd: 0.8, usd: 0.042, expected: "£0.034" },
		{ scenario: "a rate of parity", gbpPerUsd: 1, usd: 0.042, expected: "£0.042" },
	])("should convert at the configured rate when given $scenario", ({
		gbpPerUsd,
		usd,
		expected,
	}) => {
		const formatMoney = createMoneyFormatter({ gbpPerUsd });

		expect(formatMoney(usd)).toBe(expected);
	});

	it("should render n/a when the cost could not be resolved", () => {
		const formatMoney = createMoneyFormatter({ gbpPerUsd: GBP_PER_USD });

		expect(formatMoney(null)).toBe("n/a");
	});
});

describe("formatCostReport", () => {
	it("should render the three-section report when given a manifest and run logs", () => {
		expect(formatCostReport({ runLogs, manifest, gbpPerUsd: GBP_PER_USD })).toMatchSnapshot();
	});

	// The table is aligned by padding alone, so a row that has kept its columns is
	// exactly as wide as the rule above it, and one that has pushed them along is
	// wider.
	const widthOf = ({
		report,
		rowLabel,
	}: {
		readonly report: string;
		readonly rowLabel: string;
	}): { readonly row: number; readonly rule: number } => {
		const lines = report.split("\n");
		return {
			row: (lines.find((line) => line.startsWith(rowLabel)) ?? "").length,
			rule: (lines.find((line) => line.startsWith("─")) ?? "").length,
		};
	};

	it("should hold the columns in place when a model id is the longest the design records", () => {
		const { row, rule } = widthOf({
			report: formatCostReport({ runLogs, manifest, gbpPerUsd: GBP_PER_USD }),
			rowLabel: "Synthesis",
		});

		expect(row).toBe(rule);
	});

	it("should shorten a model id when it is wider than the column it is given", () => {
		const overlong = makeManifest({
			stages: {
				...manifest.stages,
				synthesis: { ...synthesisEntry, configUsed: { modelId: OVERLONG_MODEL_ID } },
			},
			currentPipelineCost: manifest.currentPipelineCost,
		});

		const report = formatCostReport({ runLogs, manifest: overlong, gbpPerUsd: GBP_PER_USD });
		const { row, rule } = widthOf({ report, rowLabel: "Synthesis" });

		expect(row).toBe(rule);
		expect(report).toContain("…");
	});

	it("should count a failed stage as wasted when the run that failed was an ordinary one", () => {
		const report = formatCostReport({
			runLogs: [originalFailure],
			manifest,
			gbpPerUsd: GBP_PER_USD,
		});

		// 0.021 USD at 0.74 = 0.01554.
		expect(report).toMatch(/slide-conversion\s+failed\s+£0\.016/);
		expect(report).toMatch(/Wasted on failures\s+£0\.016/);
	});

	it("should leave the wasted total unresolved when a failed run's cost could not be looked up", () => {
		const report = formatCostReport({ runLogs, manifest, gbpPerUsd: GBP_PER_USD });

		expect(report).toMatch(/Wasted on failures\s+n\/a/);
	});

	it("should render every total in pounds when the stored figures are in dollars", () => {
		const report = formatCostReport({ runLogs, manifest, gbpPerUsd: GBP_PER_USD });

		// 0.393 USD is the manifest's stored total; 0.393 * 0.74 = 0.29082.
		expect(report).toContain("£0.291");
		expect(report).not.toContain("$");
	});
});

const ran = (status: "complete" | "failed"): RunLogStageEntry =>
	status === "complete"
		? { action: "ran", status, configUsed: null, cost: { totalCostUsd: 0.1, callCount: 1 } }
		: {
				action: "ran",
				status,
				error: "synthesis failed",
				configUsed: null,
				cost: { totalCostUsd: null, callCount: 0 },
			};

// The stages this run touched: two that completed, one that failed, one skipped
// because its output already existed, and one never reached after the failure.
const runOutcomes: readonly RunStageOutcome[] = [
	{ stageId: "audio-extraction", entry: { action: "skipped" } },
	{ stageId: "transcription", entry: ran("complete") },
	{ stageId: "slide-conversion", entry: ran("complete") },
	{ stageId: "synthesis", entry: ran("failed") },
	{ stageId: "pdf-generation", entry: { action: "not-reached" } },
];

const runManifest: RunManifest = {
	...manifest,
	stages: {
		"audio-extraction": {
			...completed({ filesWritten: [stageOutputEntry("audio-extraction")] }),
			status: "skipped",
		},
		// The same transcription entry the report fixture uses: one call, no tokens.
		transcription: manifest.stages.transcription,
		"slide-conversion": completed({
			configUsed: SLIDE_CONVERSION_CONFIG,
			cost: {
				promptTokens: 41_000,
				completionTokens: 8100,
				callCount: SLIDE_CONVERSION_CALLS,
				totalCostUsd: SLIDE_CONVERSION_COST_USD,
			},
			filesWritten: [stageOutputEntry("slide-conversion")],
		}),
		// A failed stage records no cost at all, so its row has nothing to show.
		synthesis: {
			status: "failed",
			failedAt: "2025-10-10T09:40:00.000Z",
			error: "synthesis failed",
			configUsed: { modelId: "anthropic/claude-sonnet-4.6" },
			cost: null,
			filesWritten: [],
		},
	},
};

describe("formatRunSummary", () => {
	it("should list only the stages that ran when others were skipped or not reached", () => {
		const summary = formatRunSummary({
			outcomes: runOutcomes,
			manifest: runManifest,
			gbpPerUsd: GBP_PER_USD,
		});

		expect(summary).toContain("Transcription");
		expect(summary).toContain("Slide conversion");
		expect(summary).toContain("Synthesis");
		expect(summary).not.toContain("Audio extraction");
		expect(summary).not.toContain("PDF generation");
	});

	it("should show the model, calls, and token counts recorded for a stage when it ran", () => {
		const summary = formatRunSummary({
			outcomes: runOutcomes,
			manifest: runManifest,
			gbpPerUsd: GBP_PER_USD,
		});

		expect(summary).toContain(SLIDE_CONVERSION_CONFIG.modelId);
		expect(summary).toContain("41,000");
		expect(summary).toContain("8,100");
		// 0.034 USD at 0.74 = 0.02516.
		expect(summary).toContain("£0.025");
	});

	it("should identify the lecture in its heading when summarising a run", () => {
		const summary = formatRunSummary({
			outcomes: runOutcomes,
			manifest: runManifest,
			gbpPerUsd: GBP_PER_USD,
		});

		expect(summary).toContain(`Lecture ${String(testLecture.number)}`);
		expect(summary).toContain(testLecture.title);
		expect(summary).toContain(testLecture.date);
	});

	it("should render a stage's cost as n/a when the manifest recorded none", () => {
		const summary = formatRunSummary({
			outcomes: [{ stageId: "synthesis", entry: ran("failed") }],
			manifest: runManifest,
			gbpPerUsd: GBP_PER_USD,
		});

		expect(summary).toContain("n/a");
	});

	it("should total the calls, tokens, and cost of every stage that ran when the run ends", () => {
		const summary = formatRunSummary({
			outcomes: runOutcomes,
			manifest: runManifest,
			gbpPerUsd: GBP_PER_USD,
		});

		// 1 + 24 calls; 0.042 + 0.034 USD at 0.74 = 0.05624; the failed stage adds nothing.
		expect(summary).toContain("This run");
		expect(summary).toMatch(/This run\s+25\s+41,000 \/\s+8,100\s+£0\.056/);
	});

	it("should render the total as n/a when a stage's cost lookup did not resolve", () => {
		const unresolved: RunManifest = {
			...runManifest,
			stages: {
				...runManifest.stages,
				transcription: completed({
					configUsed: { modelId: transcriptionModelId },
					cost: {
						promptTokens: 0,
						completionTokens: 0,
						callCount: 1,
						totalCostUsd: null,
						costResolutionError: "duration lookup failed",
					},
				}),
			},
		};

		const summary = formatRunSummary({
			outcomes: [{ stageId: "transcription", entry: ran("complete") }],
			manifest: unresolved,
			gbpPerUsd: GBP_PER_USD,
		});

		expect(summary).toMatch(/This run\s+1\s+0 \/\s+0\s+n\/a/);
	});

	it("should render the whole summary table when given a run's outcomes", () => {
		expect(
			formatRunSummary({ outcomes: runOutcomes, manifest: runManifest, gbpPerUsd: GBP_PER_USD }),
		).toMatchSnapshot();
	});
});

const lecture = ({
	moduleRoot,
	folder,
	overallStatus,
	totalCostUsd,
}: {
	readonly moduleRoot: string;
	readonly folder: string;
	readonly overallStatus: OverallStatus;
	readonly totalCostUsd: number;
}): RunSummary => ({
	workspaceRoot: join(moduleDirs({ moduleRoot }).processing, folder),
	runId: testRunId,
	startedAt: "2025-10-10T09:00:00.000Z",
	endedAt: "2025-10-10T09:30:00.000Z",
	totalCostUsd,
	stageOutcomes: [],
	overallStatus,
});

const succeededLecture = lecture({
	moduleRoot: testModuleRoot,
	folder: testLecture.folderName,
	overallStatus: "success",
	totalCostUsd: 0.2,
});

const failedLecture = lecture({
	moduleRoot: testModuleRoot,
	folder: otherLecture.folderName,
	overallStatus: "failed",
	totalCostUsd: 0.1,
});

// A third lecture, in the second module, so the table has a module whose status
// differs from the first's. Its own identity is not shared.
const otherModuleLecture = lecture({
	moduleRoot: otherModuleRoot,
	folder: "Lecture 1 - Antigens - 2025-10-11",
	overallStatus: "partial",
	totalCostUsd: 0.3,
});

const batch: BatchSummary = {
	startedAt: "2025-10-10T09:00:00.000Z",
	endedAt: "2025-10-10T10:00:00.000Z",
	lectures: [succeededLecture, failedLecture, otherModuleLecture],
	totalCostUsd: 0.6,
	overallStatus: "failed",
};

describe("formatBatchSummary", () => {
	it("should render one row per module when the batch spanned several modules", () => {
		const summary = formatBatchSummary({ batch, gbpPerUsd: GBP_PER_USD });

		expect(summary).toMatch(new RegExp(`${testModuleName}\\s+2\\s`));
		expect(summary).toMatch(new RegExp(`${otherModuleName}\\s+1\\s`));
	});

	it("should report a module as failed when one of its lectures failed", () => {
		const summary = formatBatchSummary({ batch, gbpPerUsd: GBP_PER_USD });

		// 0.2 + 0.1 USD at 0.74 = 0.222.
		expect(summary).toMatch(new RegExp(`${testModuleName}\\s+2\\s+failed\\s+£0\\.222`));
	});

	it("should carry a module's own status when none of its lectures failed", () => {
		const summary = formatBatchSummary({ batch, gbpPerUsd: GBP_PER_USD });

		expect(summary).toMatch(new RegExp(`${otherModuleName}\\s+1\\s+partial\\s+£0\\.222`));
	});

	it("should total every lecture in an all-modules row when the batch ends", () => {
		const summary = formatBatchSummary({ batch, gbpPerUsd: GBP_PER_USD });

		// 0.6 USD at 0.74 = 0.444.
		expect(summary).toMatch(/All modules\s+3\s+failed\s+£0\.444/);
	});

	it("should keep two modules apart when their directories carry the same name", () => {
		// A second module of the same name, filed somewhere else — two rows, since
		// the two hold different lectures and cost different amounts.
		const namesake = lecture({
			moduleRoot: join(otherModuleRoot, testModuleName),
			folder: otherLecture.folderName,
			overallStatus: "success",
			totalCostUsd: 0.5,
		});

		const summary = formatBatchSummary({
			batch: { ...batch, lectures: [succeededLecture, namesake] },
			gbpPerUsd: GBP_PER_USD,
		});

		const rows = summary.split("\n").filter((line) => line.startsWith(testModuleName));
		expect(rows).toHaveLength(2);
		// 0.2 and 0.5 USD at 0.74, each still its own module's spend.
		expect(summary).toMatch(new RegExp(`${testModuleName}\\s+1\\s+success\\s+£0\\.148`));
		expect(summary).toMatch(new RegExp(`${testModuleName}\\s+1\\s+success\\s+£0\\.370`));
	});

	it("should render both the module's spend and the batch total as unknown when one lecture's cost is unresolved", () => {
		const summary = formatBatchSummary({
			batch: {
				...batch,
				lectures: [{ ...succeededLecture, totalCostUsd: null }, failedLecture, otherModuleLecture],
				totalCostUsd: null,
			},
			gbpPerUsd: GBP_PER_USD,
		});

		expect(summary).toMatch(new RegExp(`${testModuleName}\\s+2\\s+failed\\s+n/a`));
		expect(summary).toMatch(/All modules\s+3\s+failed\s+n\/a/);
	});

	it("should render the whole batch table when given a batch summary", () => {
		expect(formatBatchSummary({ batch, gbpPerUsd: GBP_PER_USD })).toMatchSnapshot();
	});
});
