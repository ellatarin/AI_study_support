import { basename, resolve } from "node:path";
import { summariseOverallStatus } from "../pipeline/run-status.js";
import type {
	BatchSummary,
	ManifestStageEntry,
	OverallStatus,
	QaManifestStageEntry,
	RunLog,
	RunLogStageEntry,
	RunManifest,
	RunStageOutcome,
	RunSummary,
	RunType,
	StageCost,
	StageId,
} from "../types/pipeline.js";
import { STAGE_IDS } from "../types/pipeline.js";

/**
 * Merges two `StageCost` accumulators, summing tokens, call counts, and cost.
 * Cost is kept at full precision (rounding is a display concern) — the result is
 * a resolved cost only when both inputs resolved; if either is `null` the merged
 * cost is `null` and the unresolved errors are joined (technical-design.md §7).
 *
 * @param args - The two costs to combine.
 * @param args.current - The running accumulator.
 * @param args.incoming - The cost to fold in.
 * @returns A new `StageCost` with the combined totals.
 */
export function accumulateCost({
	current,
	incoming,
}: {
	readonly current: StageCost;
	readonly incoming: StageCost;
}): StageCost {
	const base = {
		promptTokens: current.promptTokens + incoming.promptTokens,
		completionTokens: current.completionTokens + incoming.completionTokens,
		callCount: current.callCount + incoming.callCount,
	};

	if (current.totalCostUsd === null || incoming.totalCostUsd === null) {
		const errors = [
			current.totalCostUsd === null ? current.costResolutionError : null,
			incoming.totalCostUsd === null ? incoming.costResolutionError : null,
		].filter((message): message is string => message !== null);
		return { ...base, totalCostUsd: null, costResolutionError: errors.join("; ") };
	}
	return { ...base, totalCostUsd: current.totalCostUsd + incoming.totalCostUsd };
}

/** Human-readable label for each stage, in pipeline order (technical-design.md §4.1). */
const STAGE_LABELS: Readonly<Record<StageId, string>> = {
	"source-normalisation": "Source normalisation",
	"audio-extraction": "Audio extraction",
	transcription: "Transcription",
	"transcript-structuring": "Transcript structuring",
	"slide-conversion": "Slide conversion",
	"image-extraction": "Image extraction",
	synthesis: "Synthesis",
	"qa-loop": "QA loop",
	"pdf-generation": "PDF generation",
};

// Reports walk the stages in STAGE_IDS order, the declared source of truth,
// rather than in the key order of the label map above — that map is keyed *by*
// stage, and reading its keys as the pipeline sequence would let a stage added
// to one map and not another silently reorder or vanish from a report
// (technical-design.md §4.7).

/**
 * The human-readable name of a stage, as every report and message shows it.
 * Exported so the CLI names a stage the same way its summary table does.
 *
 * @param args - The stage to name.
 * @param args.stageId - The stage's canonical id.
 * @returns The stage's display label.
 */
export function stageLabel({ stageId }: { readonly stageId: StageId }): string {
	return STAGE_LABELS[stageId];
}

const RULE = "─";

/** A single table cell: its text, column width, and alignment. */
type Cell = readonly [text: string, width: number, align: "left" | "right"];

/** Width of the cost column, shared by the header, the cells, and the free-form rows. */
const COST_WIDTH = 10;

/** The shared cost-column header, reused by every table so it is declared once. */
const COST_HEADER: Cell = ["Cost", COST_WIDTH, "right"];

/**
 * Renders a stored USD amount as display text in the presentation currency, or
 * `n/a` when cost resolution failed. The single place a money amount becomes a
 * string, so every table and free-form row shows the same format.
 */
export type MoneyFormatter = (amount: number | null) => string;

/**
 * Builds the report's money formatter for a given exchange rate.
 *
 * Costs are stored in USD because that is what providers bill, and converted
 * only here, at the point of display (technical-design.md §7, NFR-2.3). Binding
 * the rate once and passing the resulting function down means no section knows
 * about rates or currency at all, and a corrected rate re-renders the whole
 * history consistently rather than leaving figures frozen at the rate in force
 * when each was written.
 *
 * @param args - The conversion inputs.
 * @param args.gbpPerUsd - Pounds per US dollar, from `currency.gbpPerUsd`.
 * @returns A formatter that renders a stored USD amount in pounds.
 */
export function createMoneyFormatter({
	gbpPerUsd,
}: {
	readonly gbpPerUsd: number;
}): MoneyFormatter {
	return (amount) => {
		if (amount === null) {
			return "n/a";
		}
		return `£${(amount * gbpPerUsd).toFixed(3)}`;
	};
}

/**
 * Builds a right-aligned cost cell of the standard width.
 *
 * @param args - The cell inputs.
 * @param args.amount - The stored USD amount, or `null` if cost resolution failed.
 * @param args.formatMoney - The report's money formatter.
 * @returns The formatted cost cell.
 */
function costCell({
	amount,
	formatMoney,
}: {
	readonly amount: number | null;
	readonly formatMoney: MoneyFormatter;
}): Cell {
	return [formatMoney(amount), COST_WIDTH, "right"];
}

/**
 * Joins fixed-width cells into a single aligned row.
 *
 * @param cells - The cells to render, in column order.
 * @returns The aligned row string.
 */
function formatCells(cells: readonly Cell[]): string {
	return cells
		.map(([text, width, align]) => (align === "right" ? text.padStart(width) : text.padEnd(width)))
		.join("");
}

/**
 * Assembles a titled, ruled table from its parts, shared by the report sections.
 *
 * @param args - The table parts.
 * @param args.title - The section title printed above the table.
 * @param args.columns - The header cells.
 * @param args.rows - The body rows, each a list of cells.
 * @param args.footer - The total/summary cells printed below the rule.
 * @param args.width - The width of the horizontal rules, in characters.
 * @returns The table as an array of lines.
 */
function renderCostTable({
	title,
	columns,
	rows,
	footer,
	width,
}: {
	readonly title: string;
	readonly columns: readonly Cell[];
	readonly rows: readonly (readonly Cell[])[];
	readonly footer: readonly Cell[];
	readonly width: number;
}): readonly string[] {
	return [
		title,
		formatCells(columns),
		RULE.repeat(width),
		...rows.map(formatCells),
		RULE.repeat(width),
		formatCells(footer),
	];
}

type RanStageEntry = Extract<RunLogStageEntry, { readonly action: "ran" }>;

/**
 * Flattens the run logs of a given classification into their executed stage
 * entries, so the report sections iterate results rather than re-walking logs.
 *
 * @param args - The selection inputs.
 * @param args.runLogs - The lecture's run logs.
 * @param args.runType - The run classification to select.
 * @returns Each executed stage entry with the log and stage id it came from.
 */
function ranStageEntries({
	runLogs,
	runType,
}: {
	readonly runLogs: readonly RunLog[];
	readonly runType: RunType;
}): readonly { readonly log: RunLog; readonly stageId: string; readonly entry: RanStageEntry }[] {
	const result: {
		readonly log: RunLog;
		readonly stageId: string;
		readonly entry: RanStageEntry;
	}[] = [];
	for (const log of runLogs) {
		if (log.runType !== runType) {
			continue;
		}
		// Object.entries widens the Partial<Record> value to `| undefined`, but never
		// yields undefined at runtime; cast it away so there is no dead guard branch.
		for (const [stageId, entry] of Object.entries(log.stages) as [string, RunLogStageEntry][]) {
			if (entry.action === "ran") {
				result.push({ log, stageId, entry });
			}
		}
	}
	return result;
}

/**
 * Extracts the model and cost a manifest stage entry recorded. A stage that has
 * not reached a terminal state carries neither, and a stage that made no billable
 * call carries no cost, so both are reported as absent.
 *
 * @param entry - The manifest stage entry, or `undefined` if the stage never ran.
 * @returns The model id (a placeholder when unavailable) and the recorded cost.
 */
function manifestStageOutput(entry: ManifestStageEntry | QaManifestStageEntry | undefined): {
	readonly model: string;
	readonly cost: StageCost | null;
} {
	if (entry === undefined || entry.status === "pending" || entry.status === "running") {
		return { model: "—", cost: null };
	}
	return { model: entry.configUsed?.modelId ?? "—", cost: entry.cost };
}

/**
 * Extracts the model and call count recorded for a manifest stage entry.
 *
 * @param entry - The manifest stage entry, or `undefined` if the stage never ran.
 * @returns The model id and call count, with placeholders when unavailable.
 */
function manifestStageMeta(entry: ManifestStageEntry | QaManifestStageEntry | undefined): {
	readonly model: string;
	readonly calls: number;
} {
	const { model, cost } = manifestStageOutput(entry);
	return { model, calls: cost?.callCount ?? 0 };
}

/**
 * The arguments of anything rendered for the user: what is being rendered, plus
 * the rate it is rendered at. Every exported formatter takes this shape, since
 * costs are stored in USD and converted only at the point of display
 * (technical-design.md §7).
 *
 * @typeParam TSubject - The data the formatter renders.
 */
type PresentedAt<TSubject> = TSubject & { readonly gbpPerUsd: number };

/**
 * The arguments of a report rendered from one lecture's manifest — the manifest
 * itself, whatever else the report draws on, and the rate it is rendered at.
 *
 * @typeParam TSubject - What the report draws on besides the manifest.
 */
type ManifestReport<TSubject> = PresentedAt<TSubject & { readonly manifest: RunManifest }>;

/** Inputs for the section driven by the manifest, plus the shared formatter. */
type ManifestSectionArgs = {
	readonly manifest: RunManifest;
	readonly formatMoney: MoneyFormatter;
};

/** Inputs for the sections driven by run logs, plus the shared formatter. */
type RunLogSectionArgs = {
	readonly runLogs: readonly RunLog[];
	readonly formatMoney: MoneyFormatter;
};

/**
 * Section 1: what the outputs currently on disk cost to produce.
 *
 * @param args - The section inputs.
 * @param args.manifest - The lecture's run manifest.
 * @param args.formatMoney - The report's money formatter.
 * @returns The section's lines.
 */
function currentPipelineSection({ manifest, formatMoney }: ManifestSectionArgs): readonly string[] {
	const rows: Cell[][] = [];
	for (const stageId of STAGE_IDS) {
		const cost = manifest.currentPipelineCost.byStage[stageId];
		if (cost === undefined) {
			continue;
		}
		const { model, calls } = manifestStageMeta(manifest.stages[stageId]);
		rows.push([
			[STAGE_LABELS[stageId], 24, "left"],
			[model, 26, "left"],
			[String(calls), 7, "right"],
			costCell({ amount: cost, formatMoney }),
		]);
	}
	return renderCostTable({
		title: "Current pipeline cost",
		columns: [["Stage", 24, "left"], ["Model", 26, "left"], ["Calls", 7, "right"], COST_HEADER],
		rows,
		footer: [
			["", 57, "left"],
			costCell({ amount: manifest.currentPipelineCost.totalCostUsd, formatMoney }),
		],
		width: 67,
	});
}

/**
 * Section 2: spend from failed runs and their retries.
 *
 * @param args - The section inputs.
 * @param args.runLogs - The lecture's run logs.
 * @param args.formatMoney - The report's money formatter.
 * @returns The section's lines.
 */
function errorRecoverySection({ runLogs, formatMoney }: RunLogSectionArgs): readonly string[] {
	const rows: Cell[][] = [];
	let wasted = 0;
	for (const { log, stageId, entry } of ranStageEntries({ runLogs, runType: "error-recovery" })) {
		if (entry.status === "failed" && entry.cost.totalCostUsd !== null) {
			wasted += entry.cost.totalCostUsd;
		}
		const status = entry.status === "failed" ? "failed" : "retry";
		rows.push([
			[log.startedAt, 26, "left"],
			[stageId, 22, "left"],
			[status, 8, "right"],
			costCell({ amount: entry.cost.totalCostUsd, formatMoney }),
		]);
	}
	return renderCostTable({
		title: "Error recovery cost",
		columns: [["Run", 26, "left"], ["Stage", 22, "left"], ["Status", 8, "right"], COST_HEADER],
		rows,
		footer: [["Wasted on failures", 56, "left"], costCell({ amount: wasted, formatMoney })],
		width: 66,
	});
}

/**
 * Section 3: deliberate model re-runs, grouped by stage for comparison.
 *
 * @param args - The section inputs.
 * @param args.runLogs - The lecture's run logs.
 * @param args.formatMoney - The report's money formatter.
 * @returns The section's lines.
 */
function experimentSection({ runLogs, formatMoney }: RunLogSectionArgs): readonly string[] {
	const byStage = new Map<string, string[]>();
	for (const { log, stageId, entry } of ranStageEntries({ runLogs, runType: "experiment" })) {
		const model = (entry.configUsed?.modelId ?? "—").padEnd(26);
		const cost = formatMoney(entry.cost.totalCostUsd).padStart(COST_WIDTH);
		byStage.set(stageId, [
			...(byStage.get(stageId) ?? []),
			`  Run ${log.startedAt}    ${model}${cost}`,
		]);
	}
	const lines: string[] = ["Experiment cost"];
	for (const [stageId, runLines] of byStage) {
		lines.push(`Stage: ${stageId}`, ...runLines);
	}
	return lines;
}

/**
 * Renders the three-section cost report for a single lecture: current pipeline
 * cost (from the manifest), error-recovery spend, and experiment comparisons
 * (both from the run logs, selected by `runType`). Stored figures are in USD and
 * every total is presented in pounds (technical-design.md §7).
 *
 * @param args - The report inputs.
 * @param args.runLogs - The lecture's run logs.
 * @param args.manifest - The lecture's run manifest.
 * @param args.gbpPerUsd - Pounds per US dollar, from `currency.gbpPerUsd`.
 * @returns The formatted multi-section report string.
 */
export function formatCostReport({
	runLogs,
	manifest,
	gbpPerUsd,
}: ManifestReport<{ readonly runLogs: readonly RunLog[] }>): string {
	const formatMoney = createMoneyFormatter({ gbpPerUsd });
	return [
		...currentPipelineSection({ manifest, formatMoney }),
		"",
		...errorRecoverySection({ runLogs, formatMoney }),
		"",
		...experimentSection({ runLogs, formatMoney }),
	].join("\n");
}

/** A zero accumulator, so a run with no billable stage still totals cleanly. */
const NO_COST: StageCost = {
	promptTokens: 0,
	completionTokens: 0,
	callCount: 0,
	totalCostUsd: 0,
};

/** Column widths of the end-of-run summary, shared by its header, rows, and total. */
const RUN_SUMMARY_WIDTHS = {
	stage: 24,
	model: 28,
	calls: 7,
	tokens: 21,
	promptTokens: 9,
	completionTokens: 7,
} as const;

const RUN_SUMMARY_RULE_WIDTH =
	RUN_SUMMARY_WIDTHS.stage +
	RUN_SUMMARY_WIDTHS.model +
	RUN_SUMMARY_WIDTHS.calls +
	RUN_SUMMARY_WIDTHS.tokens +
	COST_WIDTH;

/**
 * Formats a token count with thousands separators, padded so the `in / out` pair
 * stays aligned down the column.
 *
 * @param args - The count and the width to pad it to.
 * @param args.count - The token count.
 * @param args.width - The column width to right-align within.
 * @returns The padded, separated count.
 */
function tokenCount({ count, width }: { readonly count: number; readonly width: number }): string {
	return count.toLocaleString("en-GB").padStart(width);
}

/**
 * Renders a stage's prompt and completion tokens as the summary's `in / out` cell.
 *
 * @param cost - The stage's recorded cost, or `null` when it recorded none.
 * @returns The token cell.
 */
function tokensCell(cost: StageCost | null): Cell {
	const promptTokens = tokenCount({
		count: cost?.promptTokens ?? 0,
		width: RUN_SUMMARY_WIDTHS.promptTokens,
	});
	const completionTokens = tokenCount({
		count: cost?.completionTokens ?? 0,
		width: RUN_SUMMARY_WIDTHS.completionTokens,
	});
	return [`${promptTokens} / ${completionTokens}`, RUN_SUMMARY_WIDTHS.tokens, "right"];
}

/**
 * The stages this invocation actually executed, paired with what the manifest
 * recorded for each. Skipped and not-reached stages are left out: the summary
 * reports the work the run did, not the work it declined to repeat.
 *
 * @param args - The run's outcomes and the manifest they were recorded in.
 * @param args.outcomes - Every stage's outcome, in execution order.
 * @param args.manifest - The lecture's manifest, holding each stage's model and cost.
 * @returns The executed stages with their recorded model and cost.
 */
function executedStages({
	outcomes,
	manifest,
}: {
	readonly outcomes: readonly RunStageOutcome[];
	readonly manifest: RunManifest;
}): readonly {
	readonly stageId: StageId;
	readonly model: string;
	readonly cost: StageCost | null;
}[] {
	return outcomes
		.filter((outcome) => outcome.entry.action === "ran")
		.map((outcome) => ({
			stageId: outcome.stageId,
			...manifestStageOutput(manifest.stages[outcome.stageId]),
		}));
}

/**
 * Renders the end-of-run summary: one row per stage this invocation executed,
 * showing the model it used, its call and token counts, and its cost, closed by a
 * `This run` total. Costs are stored in USD and presented in pounds
 * (technical-design.md §7).
 *
 * A stage that recorded no cost — one that makes no billable call, or one that
 * failed before it made one — shows `n/a` and contributes nothing to the total;
 * a stage whose cost lookup failed outright leaves the total itself unresolved,
 * since the run's real spend is then unknown.
 *
 * @param args - The summary inputs.
 * @param args.outcomes - Every stage's outcome for this run, in execution order.
 * @param args.manifest - The lecture's manifest, read after the run.
 * @param args.gbpPerUsd - Pounds per US dollar, from `currency.gbpPerUsd`.
 * @returns The formatted summary table.
 */
export function formatRunSummary({
	outcomes,
	manifest,
	gbpPerUsd,
}: ManifestReport<{ readonly outcomes: readonly RunStageOutcome[] }>): string {
	const formatMoney = createMoneyFormatter({ gbpPerUsd });
	const stages = executedStages({ outcomes, manifest });
	let total: StageCost = NO_COST;
	const rows = stages.map(({ stageId, model, cost }) => {
		if (cost !== null) {
			total = accumulateCost({ current: total, incoming: cost });
		}
		return [
			[STAGE_LABELS[stageId], RUN_SUMMARY_WIDTHS.stage, "left"],
			[model, RUN_SUMMARY_WIDTHS.model, "left"],
			[String(cost?.callCount ?? 0), RUN_SUMMARY_WIDTHS.calls, "right"],
			tokensCell(cost),
			costCell({ amount: cost?.totalCostUsd ?? null, formatMoney }),
		] as readonly Cell[];
	});
	return renderCostTable({
		title: `Run summary — Lecture ${manifest.lectureNumber}: ${manifest.lectureTitle} (${manifest.lectureDate})`,
		columns: [
			["Stage", RUN_SUMMARY_WIDTHS.stage, "left"],
			["Model", RUN_SUMMARY_WIDTHS.model, "left"],
			["Calls", RUN_SUMMARY_WIDTHS.calls, "right"],
			["Tokens (in / out)", RUN_SUMMARY_WIDTHS.tokens, "right"],
			COST_HEADER,
		],
		rows,
		footer: [
			["This run", RUN_SUMMARY_WIDTHS.stage + RUN_SUMMARY_WIDTHS.model, "left"],
			[String(total.callCount), RUN_SUMMARY_WIDTHS.calls, "right"],
			tokensCell(total),
			costCell({ amount: total.totalCostUsd, formatMoney }),
		],
		width: RUN_SUMMARY_RULE_WIDTH,
	}).join("\n");
}

/** Column widths of the batch summary, shared by its header, rows, and total. */
const BATCH_SUMMARY_WIDTHS = { module: 30, lectures: 10, status: 10 } as const;

const BATCH_SUMMARY_RULE_WIDTH =
	BATCH_SUMMARY_WIDTHS.module +
	BATCH_SUMMARY_WIDTHS.lectures +
	BATCH_SUMMARY_WIDTHS.status +
	COST_WIDTH;

/**
 * The module a lecture belongs to, derived from its workspace two levels up
 * (`moduleRoot/Pipeline processing/<folder>`) exactly as the runner derives it.
 *
 * @param workspaceRoot - Absolute path to the lecture workspace.
 * @returns The module directory's name.
 */
function moduleNameOf(workspaceRoot: string): string {
	return basename(resolve(workspaceRoot, "..", ".."));
}

/**
 * Groups a batch's lectures by the module they belong to, preserving the order
 * the modules were first encountered so the report follows the run.
 *
 * @param lectures - Every lecture the batch attempted.
 * @returns The lectures grouped by module name.
 */
function lecturesByModule(
	lectures: readonly RunSummary[],
): ReadonlyMap<string, readonly RunSummary[]> {
	const grouped = new Map<string, RunSummary[]>();
	for (const lecture of lectures) {
		const moduleName = moduleNameOf(lecture.workspaceRoot);
		grouped.set(moduleName, [...(grouped.get(moduleName) ?? []), lecture]);
	}
	return grouped;
}

/**
 * Renders the batch summary: one row per module giving its lecture count, its
 * combined status, and what it spent, closed by a cross-module total
 * (technical-design.md §4.7).
 *
 * @param args - The summary inputs.
 * @param args.batch - The completed batch's summary.
 * @param args.gbpPerUsd - Pounds per US dollar, from `currency.gbpPerUsd`.
 * @returns The formatted batch table.
 */
export function formatBatchSummary({
	batch,
	gbpPerUsd,
}: PresentedAt<{ readonly batch: BatchSummary }>): string {
	const formatMoney = createMoneyFormatter({ gbpPerUsd });
	const rows: (readonly Cell[])[] = [];
	for (const [moduleName, lectures] of lecturesByModule(batch.lectures)) {
		const status: OverallStatus = summariseOverallStatus({
			statuses: lectures.map((lecture) => lecture.overallStatus),
		});
		let spent = 0;
		for (const lecture of lectures) {
			spent += lecture.totalCostUsd;
		}
		rows.push([
			[moduleName, BATCH_SUMMARY_WIDTHS.module, "left"],
			[String(lectures.length), BATCH_SUMMARY_WIDTHS.lectures, "right"],
			[status, BATCH_SUMMARY_WIDTHS.status, "right"],
			costCell({ amount: spent, formatMoney }),
		]);
	}
	return renderCostTable({
		title: "Batch summary",
		columns: [
			["Module", BATCH_SUMMARY_WIDTHS.module, "left"],
			["Lectures", BATCH_SUMMARY_WIDTHS.lectures, "right"],
			["Status", BATCH_SUMMARY_WIDTHS.status, "right"],
			COST_HEADER,
		],
		rows,
		footer: [
			["All modules", BATCH_SUMMARY_WIDTHS.module, "left"],
			[String(batch.lectures.length), BATCH_SUMMARY_WIDTHS.lectures, "right"],
			[batch.overallStatus, BATCH_SUMMARY_WIDTHS.status, "right"],
			costCell({ amount: batch.totalCostUsd, formatMoney }),
		],
		width: BATCH_SUMMARY_RULE_WIDTH,
	}).join("\n");
}
