import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
	BatchSummary,
	Manifest,
	OverallStatus,
	PipelineRunSummary,
	PipelineStageOutcome,
	RunLog,
	RunLogStageEntry,
	StageConfigUsed,
	StageCost,
	StageEntry,
} from "../types/pipeline.js";
import {
	completedEntry,
	formatTestMoney,
	GBP_PER_USD,
	makeManifest,
	otherLecture,
	otherModuleName,
	otherModuleRoot,
	testLecture,
	testModuleName,
	testModuleRoot,
	testTimestampId,
	transcriptionModelId,
} from "./fixtures.js";
import { stageOutputEntry, workspaceRootFor } from "./layout.js";
import {
	createMoneyFormatter,
	formatBatchSummary,
	formatCostReport,
	formatRunSummary,
} from "./reports.js";

// Three tests below keep a whole report as a snapshot. CLAUDE.md allows a
// snapshot for a format, and these reports are a format: column alignment,
// padding, section order and headings. The other tests check each figure and
// each word. The snapshot checks the one thing that they cannot: the layout as a
// whole. The user agreed to this in the review of 2026-08-24. Do not replace the
// snapshots with assertions because of the CLAUDE.md snapshot rule alone.

// Every fixture below records the same pipeline run of read-slides. It is the
// stage with a model for each call, a concurrency, and enough calls to make its
// figures worth a check.
const READ_SLIDES_CONFIG: StageConfigUsed = {
	modelId: "google/gemini-2.5-flash",
	concurrency: 3,
};
const READ_SLIDES_CALLS = 24;
const READ_SLIDES_COST_USD = 0.034;

const resolved = ({
	callCount,
	costUsd,
}: {
	readonly callCount: number;
	readonly costUsd: number;
}): StageCost => ({
	promptTokens: 0,
	completionTokens: 0,
	callCount,
	costUsd,
});

// A model id that is wider than every column.
const OVERLONG_MODEL_ID = "openrouter/an-extravagantly-long-model-identifier";

/**
 * The longest model id in technical-design.md §4.5 (27 characters). The Model
 * column must hold it and keep the columns after it in place.
 */
const SYNTHESIS_MODEL_ID = "anthropic/claude-sonnet-4.6";

/** The error of every failed synthesis in this suite. */
const SYNTHESIS_FAILURE = "synthesis failed";

/**
 * The stage entry of a completed synthesis, with {@link SYNTHESIS_MODEL_ID}
 * unless a test gives a different model.
 */
function synthesisEntryFor(modelId = SYNTHESIS_MODEL_ID): StageEntry {
	return completedEntry({
		configUsed: { modelId, maxTokens: 8192 },
		cost: resolved({ callCount: 1, costUsd: 0.312 }),
		filesWritten: [stageOutputEntry("synthesis")],
	});
}

const synthesisEntry = synthesisEntryFor();

/**
 * The stage entry of a failed synthesis. It names a model, so the run summary
 * gives it a row. It recorded no cost, so the row shows `n/a`.
 */
const failedSynthesisEntry: StageEntry = {
	status: "failed",
	failedAt: "2025-10-10T09:40:00.000Z",
	error: SYNTHESIS_FAILURE,
	configUsed: { modelId: SYNTHESIS_MODEL_ID },
	cost: null,
	filesWritten: [],
};

const PLACE_SLIDES_MODEL_ID = "openai/gpt-4.1";

const manifest: Manifest = makeManifest({
	stages: {
		// Audio extraction completed and names no model. It makes no model call, so
		// no table gives it a row.
		"audio-extraction": completedEntry({ filesWritten: [stageOutputEntry("audio-extraction")] }),
		// place-slides names a model and has an unknown cost. Its row shows n/a.
		"place-slides": completedEntry({
			configUsed: { modelId: PLACE_SLIDES_MODEL_ID },
			cost: {
				promptTokens: 0,
				completionTokens: 2400,
				callCount: 12,
				costUsd: null,
				unknownCostReason: "the generation endpoint timed out",
			},
		}),
		transcription: completedEntry({
			configUsed: { modelId: transcriptionModelId },
			cost: resolved({ callCount: 1, costUsd: 0.042 }),
			filesWritten: [stageOutputEntry("transcription")],
		}),
		"read-slides": completedEntry({
			configUsed: READ_SLIDES_CONFIG,
			cost: resolved({
				callCount: READ_SLIDES_CALLS,
				costUsd: READ_SLIDES_COST_USD,
			}),
		}),
		synthesis: synthesisEntry,
	},
});

/**
 * Gives the fields that every run log in this suite starts with. The id is made
 * from the start time, because nothing reads it: the error recovery section
 * shows a pipeline run by its start time. `toStage` is always `null`. No
 * pipeline run here is a bounded run, because a bound does not change what the
 * cost report shows.
 *
 * @param span - When the pipeline run started and ended.
 * @param span.startedAt - The start time, which the error recovery section shows.
 * @param span.endedAt - The end time.
 * @returns The id, the two times and `toStage`.
 */
function ranFrom({
	startedAt,
	endedAt,
}: {
	readonly startedAt: string;
	readonly endedAt: string;
}): Pick<RunLog, "pipelineRunId" | "startedAt" | "endedAt" | "toStage"> {
	return { pipelineRunId: `run-at-${startedAt}`, startedAt, endedAt, toStage: null };
}

// The first failure, as in the example of technical-design.md §7. The pipeline
// run had no --from-stage, so its run type is `normal`. The error recovery
// section shows it because the stage failed.
const originalFailure: RunLog = {
	...ranFrom({ startedAt: "2025-10-10T09:00:00.000Z", endedAt: "2025-10-10T09:02:00.000Z" }),
	triggeredBy: "manual",
	runType: "normal",
	fromStage: null,
	stages: {
		"read-slides": {
			action: "ran",
			status: "failed",
			configUsed: READ_SLIDES_CONFIG,
			cost: { costUsd: 0.021, callCount: 5 },
			error: "Slide 17 conversion failed: 429 rate limit",
		},
	},
};

const runLogs: readonly RunLog[] = [
	originalFailure,
	{
		...ranFrom({ startedAt: "2025-10-10T10:30:00.000Z", endedAt: "2025-10-10T10:33:00.000Z" }),
		triggeredBy: "from-stage",
		runType: "error-recovery",
		fromStage: "read-slides",
		stages: {
			"read-slides": {
				action: "ran",
				status: "complete",
				configUsed: READ_SLIDES_CONFIG,
				cost: {
					costUsd: READ_SLIDES_COST_USD,
					callCount: READ_SLIDES_CALLS,
				},
			},
		},
	},
	{
		...ranFrom({ startedAt: "2025-10-11T14:00:00.000Z", endedAt: "2025-10-11T14:05:00.000Z" }),
		triggeredBy: "from-stage",
		runType: "experiment",
		fromStage: "synthesis",
		stages: {
			synthesis: {
				action: "ran",
				status: "complete",
				configUsed: { modelId: "anthropic/claude-opus-4.1" },
				cost: { costUsd: 0.89, callCount: 1 },
			},
		},
	},
	{
		...ranFrom({ startedAt: "2025-10-10T11:00:00.000Z", endedAt: "2025-10-10T11:01:00.000Z" }),
		triggeredBy: "from-stage",
		runType: "error-recovery",
		fromStage: "place-slides",
		stages: {
			// An unknown cost, which the error recovery section shows as n/a.
			"place-slides": {
				action: "ran",
				status: "failed",
				configUsed: { modelId: "openai/gpt-4.1" },
				cost: { costUsd: null, callCount: 2 },
				error: "cost lookup timed out",
			},
			// A stage that did not run, which no section of the cost report shows.
			"audio-extraction": { action: "skipped" },
		},
	},
	{
		...ranFrom({ startedAt: "2025-10-11T16:00:00.000Z", endedAt: "2025-10-11T16:02:00.000Z" }),
		triggeredBy: "from-stage",
		runType: "experiment",
		fromStage: "synthesis",
		stages: {
			// An unknown cost, which the experiment section shows as n/a.
			synthesis: {
				action: "ran",
				status: "complete",
				configUsed: { modelId: "meta-llama/llama-3.1-405b" },
				cost: { costUsd: null, callCount: 1 },
			},
		},
	},
];

describe("createMoneyFormatter", () => {
	it.each([
		{
			scenario: "a whole dollar at the standard rate",
			gbpPerUsd: GBP_PER_USD,
			usd: 1,
			expected: "£0.740",
		},
		{ scenario: "a fractional amount", gbpPerUsd: GBP_PER_USD, usd: 0.042, expected: "£0.031" },
		// The last two rates are not the standard rate. They show that the formatter
		// converts at the rate that it was made with.
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

/**
 * Makes the cost report from this suite's fixtures. Most tests change no input
 * and read one line of the report.
 *
 * @param overrides - The inputs that a test changes.
 * @returns The report.
 */
function costReport(overrides: Partial<Parameters<typeof formatCostReport>[0]> = {}): string {
	return formatCostReport({ runLogs, manifest, formatMoney: formatTestMoney, ...overrides });
}

describe("formatCostReport", () => {
	// The format snapshot. See the note at the top of this file.
	it("should render the three-section report when given a manifest and run logs", () => {
		expect(costReport()).toMatchSnapshot();
	});

	// The command can print the reports of many lectures one after another. Only
	// the heading shows which lecture each report is about.
	it("should open by naming the lecture when the report is rendered", () => {
		expect(costReport().startsWith("Lecture 1: Cell Injury (2025-10-10)")).toBe(true);
	});

	// Only padding aligns the table. So a row whose columns stay in place is as
	// wide as the rule, and a row that moves its columns is wider.
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
		const { row, rule } = widthOf({ report: costReport(), rowLabel: "Synthesis" });

		expect(row).toBe(rule);
	});

	it("should shorten a model id when it is wider than the column it is given", () => {
		const overlong = makeManifest({
			stages: {
				...manifest.stages,
				synthesis: synthesisEntryFor(OVERLONG_MODEL_ID),
			},
		});

		const report = costReport({ manifest: overlong });
		const { row, rule } = widthOf({ report, rowLabel: "Synthesis" });

		expect(row).toBe(rule);
		expect(report).toContain("…");
	});

	it("should give a failed stage a row when the run that failed was an ordinary one", () => {
		const report = costReport({ runLogs: [originalFailure] });

		// 0.021 USD at 0.74 = 0.01554.
		expect(report).toMatch(/read-slides\s+failed\s+£0\.016/);
	});

	it("should render a stage's cost as n/a when its lookup failed", () => {
		const report = costReport();

		expect(report).toMatch(/Place slides\s+openai\/gpt-4\.1\s+12\s+n\/a/);
	});

	it("should leave a stage out when it names no model", () => {
		const report = costReport();

		expect(report).not.toContain("Audio extraction");
	});

	it("should leave a stage out when its output is not on disk", () => {
		const failedSynthesis = makeManifest({
			stages: { ...manifest.stages, synthesis: failedSynthesisEntry },
		});

		const report = costReport({ manifest: failedSynthesis });

		// The first section shows the cost of the output on disk, and a failed stage
		// has none. The error recovery section shows its cost.
		expect(report).not.toMatch(/^Synthesis/m);
	});

	it("should sum nothing beneath its sections when the report is rendered", () => {
		const report = costReport();

		expect(report).not.toContain("Wasted on failures");
		// The sum of the first section: 0.042 + 0.034 + 0.312 USD at 0.74.
		expect(report).not.toContain("£0.287");
	});

	it("should render every figure in pounds when the stored figures are in dollars", () => {
		const report = costReport();

		// Synthesis cost 0.312 USD. 0.312 * 0.74 = 0.23088.
		expect(report).toContain("£0.231");
		expect(report).not.toContain("$");
	});
});

const ran = (status: "complete" | "failed"): RunLogStageEntry =>
	status === "complete"
		? { action: "ran", status, configUsed: null, cost: { costUsd: 0.1, callCount: 1 } }
		: {
				action: "ran",
				status,
				error: SYNTHESIS_FAILURE,
				configUsed: null,
				cost: { costUsd: null, callCount: 0 },
			};

// The stage outcomes of one pipeline run. Two stages completed and one failed.
// One was skipped because its output was on disk. One was not reached after
// the failure.
const runOutcomes: readonly PipelineStageOutcome[] = [
	{ stageId: "audio-extraction", entry: { action: "skipped" } },
	{ stageId: "transcription", entry: ran("complete") },
	{ stageId: "read-slides", entry: ran("complete") },
	{ stageId: "synthesis", entry: ran("failed") },
	{ stageId: "pdf-generation", entry: { action: "not-reached" } },
];

const runSummaryManifest: Manifest = {
	...manifest,
	stages: {
		"audio-extraction": completedEntry({
			status: "skipped",
			filesWritten: [stageOutputEntry("audio-extraction")],
		}),
		// The same transcription entry the report fixture uses: one call, no tokens.
		transcription: manifest.stages.transcription,
		"read-slides": completedEntry({
			configUsed: READ_SLIDES_CONFIG,
			cost: {
				promptTokens: 41_000,
				completionTokens: 8100,
				callCount: READ_SLIDES_CALLS,
				costUsd: READ_SLIDES_COST_USD,
			},
		}),
		synthesis: failedSynthesisEntry,
	},
};

/**
 * Makes the run summary from this suite's fixtures.
 *
 * @param overrides - The inputs that a test changes.
 * @returns The summary table.
 */
function runSummary(overrides: Partial<Parameters<typeof formatRunSummary>[0]> = {}): string {
	return formatRunSummary({
		outcomes: runOutcomes,
		manifest: runSummaryManifest,
		formatMoney: formatTestMoney,
		...overrides,
	});
}

describe("formatRunSummary", () => {
	it("should list only the stages that ran when others were skipped or not reached", () => {
		const summary = runSummary();

		expect(summary).toContain("Transcription");
		expect(summary).toContain("Read slides");
		expect(summary).toContain("Synthesis");
		expect(summary).not.toContain("Audio extraction");
		expect(summary).not.toContain("PDF generation");
	});

	it("should show the model, calls, and token counts recorded for a stage when it ran", () => {
		const summary = runSummary();

		expect(summary).toContain(READ_SLIDES_CONFIG.modelId);
		expect(summary).toContain("41,000");
		expect(summary).toContain("8,100");
		// 0.034 USD at 0.74 = 0.02516.
		expect(summary).toContain("£0.025");
	});

	it("should identify the lecture in its heading when summarising a run", () => {
		const summary = runSummary();

		expect(summary).toContain(`Lecture ${String(testLecture.number)}`);
		expect(summary).toContain(testLecture.title);
		expect(summary).toContain(testLecture.date);
	});

	it("should render a stage's cost as n/a when the manifest recorded none", () => {
		const summary = runSummary({ outcomes: [{ stageId: "synthesis", entry: ran("failed") }] });

		// Synthesis names a model and recorded no cost, so it has a row that shows
		// n/a and not zero. The `.` in the model id is not escaped in the pattern.
		// It is between two runs of padding, so no other character in the row can
		// match it.
		expect(summary).toMatch(
			new RegExp(`Synthesis\\s+${SYNTHESIS_MODEL_ID}\\s+0\\s+0 /\\s+0\\s+n/a`),
		);
	});

	it("should leave a stage out when it names no model", () => {
		const summary = runSummary({
			outcomes: [
				{ stageId: "audio-extraction", entry: ran("complete") },
				{ stageId: "transcription", entry: ran("complete") },
			],
		});

		expect(summary).not.toContain("Audio extraction");
		expect(summary).toContain("Transcription");
	});

	it("should sum nothing beneath the table when the run ends", () => {
		const summary = runSummary();

		expect(summary).not.toContain("This run");
		// The sum of the costs: 0.042 + 0.034 USD at 0.74.
		expect(summary).not.toContain("£0.056");
	});

	// The format snapshot. See the note at the top of this file.
	it("should render the whole summary table when given a run's outcomes", () => {
		expect(runSummary()).toMatchSnapshot();
	});
});

const lecture = ({
	moduleRoot,
	baseName,
	overallStatus,
}: {
	readonly moduleRoot: string;
	readonly baseName: string;
	readonly overallStatus: OverallStatus;
}): PipelineRunSummary => ({
	workspaceRoot: workspaceRootFor({ moduleRoot, baseName }),
	pipelineRunId: testTimestampId,
	startedAt: "2025-10-10T09:00:00.000Z",
	endedAt: "2025-10-10T09:30:00.000Z",
	stageOutcomes: [],
	overallStatus,
});

const succeededLecture = lecture({
	moduleRoot: testModuleRoot,
	baseName: testLecture.baseName,
	overallStatus: "success",
});

const failedLecture = lecture({
	moduleRoot: testModuleRoot,
	baseName: otherLecture.baseName,
	overallStatus: "failed",
});

// A third lecture, in the second module, so that the two modules have different
// statuses. Its base name is written here, not taken from a shared fixture.
const otherModuleLecture = lecture({
	moduleRoot: otherModuleRoot,
	baseName: "Lecture 1 - Antigens - 2025-10-11",
	overallStatus: "success",
});

const batch: BatchSummary = {
	startedAt: "2025-10-10T09:00:00.000Z",
	endedAt: "2025-10-10T10:00:00.000Z",
	lectures: [succeededLecture, failedLecture, otherModuleLecture],
	overallStatus: "failed",
};

/**
 * Makes the batch summary from this suite's batch.
 *
 * @param overrides - The fields of the batch that a test changes.
 * @returns The batch summary table.
 */
function batchSummary(overrides: Partial<BatchSummary> = {}): string {
	return formatBatchSummary({ batch: { ...batch, ...overrides } });
}

describe("formatBatchSummary", () => {
	it("should render one row per module when the batch spanned several modules", () => {
		const summary = batchSummary();

		expect(summary).toMatch(new RegExp(`${testModuleName}\\s+2\\s`));
		expect(summary).toMatch(new RegExp(`${otherModuleName}\\s+1\\s`));
	});

	it("should report a module as failed when one of its lectures failed", () => {
		const summary = batchSummary();

		expect(summary).toMatch(new RegExp(`${testModuleName}\\s+2\\s+failed`));
	});

	// The row shows the module's own status, not the batch's. The batch failed,
	// but this module shows success because none of its lectures failed.
	it("should carry a module's own status when none of its lectures failed", () => {
		const summary = batchSummary();

		expect(summary).toMatch(new RegExp(`${otherModuleName}\\s+1\\s+success`));
	});

	it("should count every lecture in an all-modules row when the batch ends", () => {
		const summary = batchSummary();

		expect(summary).toMatch(/All modules\s+3\s+failed/);
	});

	it("should show no money at all when the batch table is rendered", () => {
		// The cost of a module or a batch is a sum across lectures, and costs are
		// kept for each stage (NFR-2.2). Each lecture's run summary shows them.
		const summary = batchSummary();

		expect(summary).not.toContain("£");
		expect(summary).not.toContain("Cost");
	});

	it("should keep two modules apart when their directories carry the same name", () => {
		// A second module with the same name, in a different folder. It gets its own
		// row, because it holds different lectures.
		const namesake = lecture({
			moduleRoot: join(otherModuleRoot, testModuleName),
			baseName: otherLecture.baseName,
			overallStatus: "failed",
		});

		const summary = batchSummary({ lectures: [succeededLecture, namesake] });

		const rows = summary.split("\n").filter((line) => line.startsWith(testModuleName));
		expect(rows).toHaveLength(2);
		expect(summary).toMatch(new RegExp(`${testModuleName}\\s+1\\s+success`));
		expect(summary).toMatch(new RegExp(`${testModuleName}\\s+1\\s+failed`));
	});

	// The format snapshot. See the note at the top of this file.
	it("should render the whole batch table when given a batch summary", () => {
		expect(batchSummary()).toMatchSnapshot();
	});
});
