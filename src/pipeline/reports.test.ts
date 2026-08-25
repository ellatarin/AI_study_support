import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
	BatchSummary,
	ManifestStageEntry,
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
	finishedEntry,
	formatTestMoney,
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
} from "./fixtures.js";
import { stageOutputEntry, workspaceRootFor } from "./layout.js";
import {
	createMoneyFormatter,
	formatBatchSummary,
	formatCostReport,
	formatRunSummary,
} from "./reports.js";

// Three tests below capture a whole rendered report as a snapshot, and they are
// the sanctioned exception to CLAUDE.md's rule, not a lapse from it. The rule
// forbids snapshots for behaviour and permits them for serialisation-format
// regression, and what these three functions produce IS a format: column
// alignment, padding, section order and headings, all of which exist to be read
// by a person and none of which any single assertion is watching. Every figure
// and every word inside them is asserted explicitly by the tests around each
// snapshot, so the snapshot adds the one thing those cannot — that the layout
// as a whole did not move. Settled with the owner during the 2026-08-24 review;
// do not replace them with assertions on the strength of the rule alone.

// Slide conversion is the stage these tables are built around: it is the one
// with a per-call model, a concurrency, and enough calls for its own figure to
// be worth checking. Every fixture below records the same run of it.
const SLIDE_CONVERSION_CONFIG: StageRunConfig = {
	modelId: "google/gemini-2.5-flash",
	concurrency: 3,
};
const SLIDE_CONVERSION_CALLS = 24;
const SLIDE_CONVERSION_COST_USD = 0.034;

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

// A model id past any column's width, for the rows that have to survive one.
const OVERLONG_MODEL_ID = "openrouter/an-extravagantly-long-model-identifier";

/**
 * The longest model id technical-design.md §4.5 records, at 27 characters — the
 * one the Model column has to hold without moving the columns after it.
 */
const SYNTHESIS_MODEL_ID = "anthropic/claude-sonnet-4.6";

/** How synthesis failed, wherever this suite has it fail. */
const SYNTHESIS_FAILURE = "synthesis failed";

/**
 * The synthesis row, taking whichever model it is asked about: at its default it
 * carries {@link SYNTHESIS_MODEL_ID}, and the width cases ask for one past any
 * column's width.
 */
function synthesisEntryFor(modelId = SYNTHESIS_MODEL_ID): ManifestStageEntry {
	return finishedEntry({
		configUsed: { modelId, maxTokens: 8192 },
		cost: resolved({ callCount: 1, costUsd: 0.312 }),
		filesWritten: [stageOutputEntry("synthesis")],
	});
}

const synthesisEntry = synthesisEntryFor();

/**
 * Synthesis as a stage that failed: it names a model, so it keeps a row, and it
 * left no output and recorded no cost, so there is nothing for that row to price.
 */
const failedSynthesisEntry: ManifestStageEntry = {
	status: "failed",
	failedAt: "2025-10-10T09:40:00.000Z",
	error: SYNTHESIS_FAILURE,
	configUsed: { modelId: SYNTHESIS_MODEL_ID },
	cost: null,
	filesWritten: [],
};

const IMAGE_EXTRACTION_MODEL_ID = "openai/gpt-4.1";

const manifest: RunManifest = makeManifest({
	stages: {
		// Completed, and names no model: it makes no model call, so no table gives
		// it a row however it finished.
		"audio-extraction": finishedEntry({ filesWritten: [stageOutputEntry("audio-extraction")] }),
		// Names a model, and its cost lookup failed: a row, reading n/a.
		"image-extraction": finishedEntry({
			configUsed: { modelId: IMAGE_EXTRACTION_MODEL_ID },
			cost: {
				promptTokens: 0,
				completionTokens: 2400,
				callCount: 12,
				costUsd: null,
				costResolutionError: "the generation endpoint timed out",
			},
		}),
		transcription: finishedEntry({
			configUsed: { modelId: transcriptionModelId },
			cost: resolved({ callCount: 1, costUsd: 0.042 }),
			filesWritten: [stageOutputEntry("transcription")],
		}),
		"slide-conversion": finishedEntry({
			configUsed: SLIDE_CONVERSION_CONFIG,
			cost: resolved({
				callCount: SLIDE_CONVERSION_CALLS,
				costUsd: SLIDE_CONVERSION_COST_USD,
			}),
			filesWritten: [stageOutputEntry("slide-conversion")],
		}),
		synthesis: synthesisEntry,
	},
});

/**
 * A run's identity and span, from the two instants that bound it.
 *
 * The id is derived rather than invented per run. Nothing reads it — no
 * assertion, and section 2 shows a run by its start instant — so five ids
 * written by hand were five values claiming to matter, and none of them was even
 * in the form `deriveRunId` produces.
 *
 * @param span - When the run began and ended.
 * @param span.startedAt - The instant the run began; the one section 2 prints.
 * @param span.endedAt - The instant it finished.
 * @returns The three fields every run log opens with.
 */
function ranFrom({
	startedAt,
	endedAt,
}: {
	readonly startedAt: string;
	readonly endedAt: string;
}): Pick<RunLog, "runId" | "startedAt" | "endedAt"> {
	return { runId: `run-at-${startedAt}`, startedAt, endedAt };
}

// The original failure, as technical-design.md §7's worked example has it: an
// ordinary run that no --from-stage preceded, so the classifier types it
// `normal`. Section 2 reaches it through the failure, not through the run's type.
const originalFailure: RunLog = {
	...ranFrom({ startedAt: "2025-10-10T09:00:00.000Z", endedAt: "2025-10-10T09:02:00.000Z" }),
	triggeredBy: "manual",
	runType: "normal",
	fromStage: null,
	stages: {
		"slide-conversion": {
			action: "ran",
			status: "failed",
			configUsed: SLIDE_CONVERSION_CONFIG,
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
		fromStage: "slide-conversion",
		stages: {
			"slide-conversion": {
				action: "ran",
				status: "complete",
				configUsed: SLIDE_CONVERSION_CONFIG,
				cost: {
					costUsd: SLIDE_CONVERSION_COST_USD,
					callCount: SLIDE_CONVERSION_CALLS,
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
		fromStage: "image-extraction",
		stages: {
			// null cost → the section-2 "n/a" for the row, and the unresolved wasted total.
			"image-extraction": {
				action: "ran",
				status: "failed",
				configUsed: { modelId: "openai/gpt-4.1" },
				cost: { costUsd: null, callCount: 2 },
				error: "cost lookup timed out",
			},
			// non-"ran" entry → the ranStageEntries skip branch.
			"audio-extraction": { action: "skipped" },
		},
	},
	{
		...ranFrom({ startedAt: "2025-10-11T16:00:00.000Z", endedAt: "2025-10-11T16:02:00.000Z" }),
		triggeredBy: "from-stage",
		runType: "experiment",
		fromStage: "synthesis",
		stages: {
			// null cost → the experiment-section "n/a" branch.
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
		// The last two rates are deliberately not the standard one: what they prove
		// is that the formatter converts at whatever rate it was built with.
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
 * The report this suite's fixtures produce, with any of them replaced.
 *
 * Most tests here vary nothing at all and read one line out of the report, so
 * the shared run logs, manifest and rate are stated here rather than at each of
 * them.
 *
 * @param overrides - Whichever inputs this test needs different.
 * @returns The formatted report.
 */
function costReport(overrides: Partial<Parameters<typeof formatCostReport>[0]> = {}): string {
	return formatCostReport({ runLogs, manifest, formatMoney: formatTestMoney, ...overrides });
}

describe("formatCostReport", () => {
	// The format snapshot; see the note at the top of this file.
	it("should render the three-section report when given a manifest and run logs", () => {
		expect(costReport()).toMatchSnapshot();
	});

	// A report with no flags covers every configured module, so several of these
	// print one after another with nothing else to tell them apart.
	it("should open by naming the lecture when the report is rendered", () => {
		expect(costReport().startsWith("Lecture 1: Cell Injury (2025-10-10)")).toBe(true);
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
		expect(report).toMatch(/slide-conversion\s+failed\s+£0\.016/);
	});

	it("should render a stage's cost as n/a when its lookup failed", () => {
		const report = costReport();

		expect(report).toMatch(/Image extraction\s+openai\/gpt-4\.1\s+12\s+n\/a/);
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

		// Section 1 prices the outputs that stand on disk, and a failed stage left
		// none. Its spend is section 2's to report.
		expect(report).not.toMatch(/^Synthesis/m);
	});

	it("should sum nothing beneath its sections when the report is rendered", () => {
		const report = costReport();

		expect(report).not.toContain("Wasted on failures");
		// 0.042 + 0.034 + 0.312 USD at 0.74, the total the first section used to
		// close with.
		expect(report).not.toContain("£0.287");
	});

	it("should render every figure in pounds when the stored figures are in dollars", () => {
		const report = costReport();

		// 0.312 USD is what synthesis cost; 0.312 * 0.74 = 0.23088.
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
		"audio-extraction": finishedEntry({
			status: "skipped",
			filesWritten: [stageOutputEntry("audio-extraction")],
		}),
		// The same transcription entry the report fixture uses: one call, no tokens.
		transcription: manifest.stages.transcription,
		"slide-conversion": finishedEntry({
			configUsed: SLIDE_CONVERSION_CONFIG,
			cost: {
				promptTokens: 41_000,
				completionTokens: 8100,
				callCount: SLIDE_CONVERSION_CALLS,
				costUsd: SLIDE_CONVERSION_COST_USD,
			},
			filesWritten: [stageOutputEntry("slide-conversion")],
		}),
		synthesis: failedSynthesisEntry,
	},
};

/**
 * The summary this suite's run produces, with any of its inputs replaced.
 *
 * @param overrides - Whichever inputs this test needs different.
 * @returns The formatted summary table.
 */
function runSummary(overrides: Partial<Parameters<typeof formatRunSummary>[0]> = {}): string {
	return formatRunSummary({
		outcomes: runOutcomes,
		manifest: runManifest,
		formatMoney: formatTestMoney,
		...overrides,
	});
}

describe("formatRunSummary", () => {
	it("should list only the stages that ran when others were skipped or not reached", () => {
		const summary = runSummary();

		expect(summary).toContain("Transcription");
		expect(summary).toContain("Slide conversion");
		expect(summary).toContain("Synthesis");
		expect(summary).not.toContain("Audio extraction");
		expect(summary).not.toContain("PDF generation");
	});

	it("should show the model, calls, and token counts recorded for a stage when it ran", () => {
		const summary = runSummary();

		expect(summary).toContain(SLIDE_CONVERSION_CONFIG.modelId);
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

		// Synthesis names a model and failed before it charged anything, so it keeps
		// its row and its cost is unknown rather than nothing. The `.` in the model
		// id goes into the pattern unescaped: it sits between two runs of padding,
		// where nothing else in the row could stand in for it.
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
		// 1 + 24 calls, and 0.042 + 0.034 USD at 0.74 — what the closing line read.
		expect(summary).not.toContain("£0.056");
	});

	// The format snapshot; see the note at the top of this file.
	it("should render the whole summary table when given a run's outcomes", () => {
		expect(runSummary()).toMatchSnapshot();
	});
});

const lecture = ({
	moduleRoot,
	folder,
	overallStatus,
}: {
	readonly moduleRoot: string;
	readonly folder: string;
	readonly overallStatus: OverallStatus;
}): RunSummary => ({
	workspaceRoot: workspaceRootFor({ moduleRoot, folderName: folder }),
	runId: testRunId,
	startedAt: "2025-10-10T09:00:00.000Z",
	endedAt: "2025-10-10T09:30:00.000Z",
	stageOutcomes: [],
	overallStatus,
});

const succeededLecture = lecture({
	moduleRoot: testModuleRoot,
	folder: testLecture.folderName,
	overallStatus: "success",
});

const failedLecture = lecture({
	moduleRoot: testModuleRoot,
	folder: otherLecture.folderName,
	overallStatus: "failed",
});

// A third lecture, in the second module, so the table has a module whose status
// differs from the first's. Its own identity is not shared.
const otherModuleLecture = lecture({
	moduleRoot: otherModuleRoot,
	folder: "Lecture 1 - Antigens - 2025-10-11",
	overallStatus: "success",
});

const batch: BatchSummary = {
	startedAt: "2025-10-10T09:00:00.000Z",
	endedAt: "2025-10-10T10:00:00.000Z",
	lectures: [succeededLecture, failedLecture, otherModuleLecture],
	overallStatus: "failed",
};

/**
 * The table this suite's batch produces, with any of its fields replaced.
 *
 * @param overrides - Whichever fields of the batch this test needs different.
 * @returns The formatted batch table.
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

	// The row is the module's own verdict, not the batch's: this batch failed
	// overall, and this module still reads success because nothing in it failed.
	it("should carry a module's own status when none of its lectures failed", () => {
		const summary = batchSummary();

		expect(summary).toMatch(new RegExp(`${otherModuleName}\\s+1\\s+success`));
	});

	it("should count every lecture in an all-modules row when the batch ends", () => {
		const summary = batchSummary();

		expect(summary).toMatch(/All modules\s+3\s+failed/);
	});

	it("should show no money at all when the batch table is rendered", () => {
		// What a module or a batch spent is a sum across lectures, and the figures
		// are kept per stage (NFR-2.2). Each lecture's own summary carries them.
		const summary = batchSummary();

		expect(summary).not.toContain("£");
		expect(summary).not.toContain("Cost");
	});

	it("should keep two modules apart when their directories carry the same name", () => {
		// A second module of the same name, filed somewhere else — two rows, since
		// the two hold different lectures.
		const namesake = lecture({
			moduleRoot: join(otherModuleRoot, testModuleName),
			folder: otherLecture.folderName,
			overallStatus: "failed",
		});

		const summary = batchSummary({ lectures: [succeededLecture, namesake] });

		const rows = summary.split("\n").filter((line) => line.startsWith(testModuleName));
		expect(rows).toHaveLength(2);
		expect(summary).toMatch(new RegExp(`${testModuleName}\\s+1\\s+success`));
		expect(summary).toMatch(new RegExp(`${testModuleName}\\s+1\\s+failed`));
	});

	// The format snapshot; see the note at the top of this file.
	it("should render the whole batch table when given a batch summary", () => {
		expect(batchSummary()).toMatchSnapshot();
	});
});
