import type {
	ManifestStageEntry,
	QaManifestStageEntry,
	RunLog,
	RunLogStageEntry,
	RunManifest,
	RunType,
	StageCost,
	StageId,
} from "../types/pipeline.js";

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

const STAGE_ORDER = Object.keys(STAGE_LABELS) as readonly StageId[];

const RULE = "─";

/** A single table cell: its text, column width, and alignment. */
type Cell = readonly [text: string, width: number, align: "left" | "right"];

/** The shared cost-column header, reused by every table so it is declared once. */
const COST_HEADER: Cell = ["Cost", 10, "right"];

/**
 * Builds a right-aligned cost cell of the standard width.
 *
 * @param amount - The dollar amount, or `null` if cost resolution failed.
 * @returns The formatted cost cell.
 */
function costCell(amount: number | null): Cell {
	return [amount === null ? "n/a" : `$${amount.toFixed(3)}`, 10, "right"];
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
		for (const [stageId, entry] of Object.entries(log.stages)) {
			if (entry?.action === "ran") {
				result.push({ log, stageId, entry });
			}
		}
	}
	return result;
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
	if (entry?.status === "complete") {
		return { model: entry.configUsed?.modelId ?? "—", calls: entry.cost?.callCount ?? 0 };
	}
	return { model: "—", calls: 0 };
}

/**
 * Section 1: what the outputs currently on disk cost to produce.
 *
 * @param manifest - The lecture's run manifest.
 * @returns The section's lines.
 */
function currentPipelineSection(manifest: RunManifest): readonly string[] {
	const rows: Cell[][] = [];
	for (const stageId of STAGE_ORDER) {
		const cost = manifest.currentPipelineCost.byStage[stageId];
		if (cost === undefined) {
			continue;
		}
		const { model, calls } = manifestStageMeta(manifest.stages[stageId]);
		rows.push([
			[STAGE_LABELS[stageId], 24, "left"],
			[model, 26, "left"],
			[String(calls), 7, "right"],
			costCell(cost),
		]);
	}
	return renderCostTable({
		title: "Current pipeline cost",
		columns: [["Stage", 24, "left"], ["Model", 26, "left"], ["Calls", 7, "right"], COST_HEADER],
		rows,
		footer: [["", 57, "left"], costCell(manifest.currentPipelineCost.totalCostUsd)],
		width: 67,
	});
}

/**
 * Section 2: spend from failed runs and their retries.
 *
 * @param runLogs - The lecture's run logs.
 * @returns The section's lines.
 */
function errorRecoverySection(runLogs: readonly RunLog[]): readonly string[] {
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
			costCell(entry.cost.totalCostUsd),
		]);
	}
	return renderCostTable({
		title: "Error recovery cost",
		columns: [["Run", 26, "left"], ["Stage", 22, "left"], ["Status", 8, "right"], COST_HEADER],
		rows,
		footer: [["Wasted on failures", 56, "left"], costCell(wasted)],
		width: 66,
	});
}

/**
 * Section 3: deliberate model re-runs, grouped by stage for comparison.
 *
 * @param runLogs - The lecture's run logs.
 * @returns The section's lines.
 */
function experimentSection(runLogs: readonly RunLog[]): readonly string[] {
	const byStage = new Map<string, string[]>();
	for (const { log, stageId, entry } of ranStageEntries({ runLogs, runType: "experiment" })) {
		const model = (entry.configUsed?.modelId ?? "—").padEnd(26);
		const cost = (
			entry.cost.totalCostUsd === null ? "n/a" : `$${entry.cost.totalCostUsd.toFixed(3)}`
		).padStart(10);
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
 * (both from the run logs, selected by `runType`) (technical-design.md §7).
 *
 * @param args - The report inputs.
 * @param args.runLogs - The lecture's run logs.
 * @param args.manifest - The lecture's run manifest.
 * @returns The formatted multi-section report string.
 */
export function formatCostReport({
	runLogs,
	manifest,
}: {
	readonly runLogs: readonly RunLog[];
	readonly manifest: RunManifest;
}): string {
	return [
		...currentPipelineSection(manifest),
		"",
		...errorRecoverySection(runLogs),
		"",
		...experimentSection(runLogs),
	].join("\n");
}
