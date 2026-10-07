/**
 * The text that a reader sees about pipeline runs: the run summary, the cost
 * report and the batch summary. The module also holds the table code, the stage
 * labels and the money format that the three share. It is in `src/pipeline/`
 * and not in `src/utils/`, because it reads manifests and run logs
 * (technical-design.md §7, "Cost and Reporting Modules").
 */

import type {
	BatchSummary,
	Manifest,
	OverallStatus,
	PipelineRunSummary,
	PipelineStageOutcome,
	QaStageEntry,
	RunLog,
	RunLogStageEntry,
	StageCost,
	StageEntry,
	StageId,
} from "../types/pipeline.js";
import { STAGE_IDS } from "../types/pipeline.js";
import { moduleName, moduleRootOf } from "./layout.js";
import { isCompletedEntry, summariseLectures } from "./run-status.js";

/**
 * The name that a reader sees for each stage (technical-design.md §4.1). The
 * reports walk the stages in {@link STAGE_IDS} order, never in the key order of
 * this map (§4.7, "Pipeline order comes from `STAGE_IDS`").
 */
const STAGE_LABELS: Readonly<Record<StageId, string>> = {
	"source-normalisation": "Source normalisation",
	"audio-extraction": "Audio extraction",
	transcription: "Transcription",
	"initial-subtopic-splitting": "Initial subtopic splitting",
	"deepen-subtopic-splitting": "Deepen subtopic splitting",
	"choose-division": "Choose division",
	"retitle-subtopics": "Retitle subtopics",
	"group-into-topics": "Group into topics",
	"judge-lecture-title": "Judge lecture title",
	"transcript-structuring": "Transcript structuring",
	"transcript-verification": "Transcript verification",
	"slide-conversion": "Slide conversion",
	"image-extraction": "Image extraction",
	synthesis: "Synthesis",
	"qa-loop": "QA loop",
	"pdf-generation": "PDF generation",
};

/**
 * Gives the name that a reader sees for a stage. The run summary, the first
 * section of the cost report and the CLI's messages use it. The other two
 * sections of the cost report show the stage id, as technical-design.md §7 shows.
 *
 * @param args - The stage to name.
 * @param args.stageId - The stage's id.
 * @returns The stage's label.
 */
export function stageLabel({ stageId }: { readonly stageId: StageId }): string {
	return STAGE_LABELS[stageId];
}

const RULE = "─";

type Cell = readonly [text: string, width: number, align: "left" | "right"];

/** The width of the cost column in every table, and in the rows of the experiment section. */
const COST_WIDTH = 10;

/**
 * The width of the model column. It holds the longest model id in
 * technical-design.md §4.5 (27 characters) and one space after it.
 */
const MODEL_WIDTH = 28;

const COST_HEADER: Cell = ["Cost", COST_WIDTH, "right"];

/**
 * Gives the text for a stored dollar amount, in the currency that the reports
 * show. It gives `n/a` for an unknown cost. Every money amount in a report goes
 * through a money formatter, so every amount has the same format.
 */
export type MoneyFormatter = (amount: number | null) => string;

/**
 * Makes the money formatter for an exchange rate. Costs are stored in dollars
 * and converted only here, when they are shown (technical-design.md §7,
 * "Currency", NFR-2.3).
 *
 * @param args - The exchange rate.
 * @param args.gbpPerUsd - The number of pounds for one US dollar, from `currency.gbpPerUsd`.
 * @returns A formatter that shows a stored dollar amount in pounds.
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
 * Makes a cost cell.
 *
 * @param args - The amount and the formatter.
 * @param args.amount - The stored dollar amount, or `null` for an unknown cost.
 * @param args.formatMoney - The report's money formatter.
 * @returns The cell, aligned right.
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

/** The mark at the end of a value that is too wide for its column. */
const ELLIPSIS = "…";

/**
 * Shortens a cell's text to fit its column. The shortened text keeps one space
 * at the end, so the columns after it stay under their headings
 * (technical-design.md §7, "Cost and Reporting Modules").
 *
 * @param args - The text and the column.
 * @param args.text - The cell's full text.
 * @param args.width - The column's width.
 * @returns The text, shortened only if it is too wide.
 */
function fitToColumn({ text, width }: { readonly text: string; readonly width: number }): string {
	if (text.length < width) {
		return text;
	}
	return `${text.slice(0, width - 2)}${ELLIPSIS}`;
}

/**
 * Groups the members by a key. The keys keep the order in which they are first
 * found. So a report follows the order of the pipeline runs, and does not sort
 * them. The experiment section groups by stage, and the batch summary groups by
 * module.
 *
 * @param args - The members and their key.
 * @param args.members - The things to group.
 * @param args.keyOf - Gives the key of a member.
 * @returns The members by key, with the keys in the order first found.
 * @typeParam TMember - One thing to group.
 */
function groupBy<TMember>({
	members,
	keyOf,
}: {
	readonly members: readonly TMember[];
	readonly keyOf: (member: TMember) => string;
}): ReadonlyMap<string, readonly TMember[]> {
	const grouped = new Map<string, TMember[]>();
	for (const member of members) {
		const key = keyOf(member);
		grouped.set(key, [...(grouped.get(key) ?? []), member]);
	}
	return grouped;
}

/**
 * Joins cells into one row of a table.
 *
 * @param cells - The cells, in column order.
 * @returns The row.
 */
function formatCells(cells: readonly Cell[]): string {
	return cells
		.map(([text, width, align]) => {
			const fitted = fitToColumn({ text, width });
			return align === "right" ? fitted.padStart(width) : fitted.padEnd(width);
		})
		.join("");
}

/**
 * Makes a table with a title, a header and a rule above and below the rows. The
 * table ends at the lower rule, because no table adds its rows (NFR-2.2). The
 * batch summary adds its own last row below it.
 *
 * The width of the rules comes from the header. So a new column cannot leave the
 * rules too short.
 *
 * @param args - The parts of the table.
 * @param args.title - The title above the table.
 * @param args.columns - The header cells.
 * @param args.rows - The rows, each a list of cells.
 * @returns The lines of the table.
 */
function renderCostTable({
	title,
	columns,
	rows,
}: {
	readonly title: string;
	readonly columns: readonly Cell[];
	readonly rows: readonly (readonly Cell[])[];
}): readonly string[] {
	// eslint-disable-next-line max-params -- the language sets the parameters of a reduce callback
	const ruleWidth = columns.reduce((total, [, width]) => total + width, 0);
	const rule = RULE.repeat(ruleWidth);
	return [title, formatCells(columns), rule, ...rows.map(formatCells), rule];
}

type RanStageEntry = Extract<RunLogStageEntry, { readonly action: "ran" }>;

/** A run log entry of a stage that ran, which a section of the cost report chose, with its run log. */
type SelectedStageEntry = {
	readonly log: RunLog;
	readonly stageId: StageId;
	readonly entry: RanStageEntry;
};

/** The rule by which a section of the cost report chooses the run log entries that it shows. */
type StageEntrySelector = (args: {
	readonly log: RunLog;
	readonly entry: RanStageEntry;
}) => boolean;

/**
 * Gives the run log entries of stages that ran and that a section chooses. A
 * section can choose by the run type of the pipeline run, by the status of
 * the stage, or by both.
 *
 * @param args - The run logs and the rule.
 * @param args.runLogs - The lecture's run logs.
 * @param args.selects - The section's rule.
 * @returns Each chosen entry, with its run log and stage id, in pipeline order inside each run log.
 */
function ranStageEntries({
	runLogs,
	selects,
}: {
	readonly runLogs: readonly RunLog[];
	readonly selects: StageEntrySelector;
}): readonly SelectedStageEntry[] {
	return runLogs.flatMap((log) =>
		STAGE_IDS.flatMap((stageId): readonly SelectedStageEntry[] => {
			const entry = log.stages[stageId];
			return entry?.action === "ran" && selects({ log, entry }) ? [{ log, stageId, entry }] : [];
		}),
	);
}

/**
 * The rule of the error recovery section: a stage that failed in any pipeline
 * run, and every stage of an error-recovery run. The run that first meets a
 * failure has the run type `normal`. So the rule also chooses by the status
 * (technical-design.md §7).
 *
 * @param args - The entry to judge.
 * @param args.log - The run log of the entry.
 * @param args.entry - The entry of a stage that ran.
 * @returns `true` when the error recovery section shows the entry.
 */
const wasSpentOnFailure: StageEntrySelector = ({ log, entry }) =>
	entry.status === "failed" || log.runType === "error-recovery";

/**
 * The rule of the experiment section: every stage of an experiment run, whatever
 * its status.
 *
 * @param args - The entry to judge.
 * @param args.log - The run log of the entry.
 * @returns `true` when the experiment section shows the entry.
 */
const wasAnExperiment: StageEntrySelector = ({ log }) => log.runType === "experiment";

/** The model and the recorded cost that a table shows for one stage. */
type StageCostRow = {
	readonly model: string;
	readonly cost: StageCost | null;
};

/**
 * Gives the row of a stage in the run summary or the first section of the cost
 * report. A stage gets a row only when its stage entry names a model. A stage
 * that names no model makes no model call, so it has no model cost to compare
 * (technical-design.md §7, NFR-2.2).
 *
 * A row can hold no cost or an unknown cost. The table then shows `n/a`.
 *
 * @param entry - The stage entry, or `undefined` when the manifest has none.
 * @returns The stage's model and recorded cost, or `null` when the stage gets no
 *   row: it names no model, or it is `pending` or `running`.
 */
function stageCostRow(entry: StageEntry | QaStageEntry | undefined): StageCostRow | null {
	if (entry === undefined || entry.status === "pending" || entry.status === "running") {
		return null;
	}
	const model = entry.configUsed?.modelId;
	if (model === undefined || model === null) {
		return null;
	}
	return { model, cost: entry.cost };
}

/**
 * The input that the cost report and the run summary share. A report gets a
 * formatter and not a rate, so this module does not know the currency
 * (technical-design.md §7, "Cost and Reporting Modules").
 */
type ManifestWithMoney = {
	readonly manifest: Manifest;
	readonly formatMoney: MoneyFormatter;
};

type ManifestSectionArgs = {
	readonly manifest: Manifest;
	readonly formatMoney: MoneyFormatter;
};

type RunLogSectionArgs = {
	readonly runLogs: readonly RunLog[];
	readonly formatMoney: MoneyFormatter;
};

const CURRENT_PIPELINE_WIDTHS = { stage: 24, model: MODEL_WIDTH, calls: 7 } as const;

/**
 * Makes the first section of the cost report: the cost of the output that is on
 * disk now, from the manifest.
 *
 * @param args - The section's input.
 * @param args.manifest - The lecture's manifest.
 * @param args.formatMoney - The report's money formatter.
 * @returns The section's lines.
 */
function currentPipelineSection({ manifest, formatMoney }: ManifestSectionArgs): readonly string[] {
	const rows = STAGE_IDS.flatMap((stageId): readonly (readonly Cell[])[] => {
		const entry = manifest.stages[stageId];
		// Only a `complete` or `skipped` stage has its output on disk. The error
		// recovery section shows what a failed stage cost.
		if (!isCompletedEntry(entry)) {
			return [];
		}
		const row = stageCostRow(entry);
		if (row === null) {
			return [];
		}
		return [
			[
				[stageLabel({ stageId }), CURRENT_PIPELINE_WIDTHS.stage, "left"],
				[row.model, CURRENT_PIPELINE_WIDTHS.model, "left"],
				[String(row.cost?.callCount ?? 0), CURRENT_PIPELINE_WIDTHS.calls, "right"],
				costCell({ amount: row.cost?.costUsd ?? null, formatMoney }),
			],
		];
	});
	return renderCostTable({
		title: "Current pipeline cost",
		columns: [
			["Stage", CURRENT_PIPELINE_WIDTHS.stage, "left"],
			["Model", CURRENT_PIPELINE_WIDTHS.model, "left"],
			["Calls", CURRENT_PIPELINE_WIDTHS.calls, "right"],
			COST_HEADER,
		],
		rows,
	});
}

const ERROR_RECOVERY_WIDTHS = { run: 26, stage: 22, status: 8 } as const;

/**
 * Makes the error recovery section of the cost report from the run logs. It
 * shows each failed stage and each stage of an error-recovery run.
 *
 * @param args - The section's input.
 * @param args.runLogs - The lecture's run logs.
 * @param args.formatMoney - The report's money formatter.
 * @returns The section's lines.
 */
function errorRecoverySection({ runLogs, formatMoney }: RunLogSectionArgs): readonly string[] {
	const rows = ranStageEntries({ runLogs, selects: wasSpentOnFailure }).map(
		({ log, stageId, entry }): readonly Cell[] => [
			[log.startedAt, ERROR_RECOVERY_WIDTHS.run, "left"],
			[stageId, ERROR_RECOVERY_WIDTHS.stage, "left"],
			[entry.status === "failed" ? "failed" : "retry", ERROR_RECOVERY_WIDTHS.status, "right"],
			costCell({ amount: entry.cost.costUsd, formatMoney }),
		],
	);
	return renderCostTable({
		title: "Error recovery cost",
		columns: [
			["Run", ERROR_RECOVERY_WIDTHS.run, "left"],
			["Stage", ERROR_RECOVERY_WIDTHS.stage, "left"],
			["Status", ERROR_RECOVERY_WIDTHS.status, "right"],
			COST_HEADER,
		],
		rows,
	});
}

/**
 * Makes the experiment section of the cost report: the cost of each stage of an
 * experiment run, from the run logs, grouped by stage.
 *
 * This section does not use {@link renderCostTable}, and that is deliberate. The
 * section compares models for one stage, so each stage is a heading with its
 * pipeline runs under it. `renderCostTable` makes one flat table, which would
 * show the stage on every row and lose the groups.
 *
 * @param args - The section's input.
 * @param args.runLogs - The lecture's run logs.
 * @param args.formatMoney - The report's money formatter.
 * @returns The section's lines.
 */
function experimentSection({ runLogs, formatMoney }: RunLogSectionArgs): readonly string[] {
	const byStage = groupBy({
		members: ranStageEntries({ runLogs, selects: wasAnExperiment }),
		keyOf: ({ stageId }) => stageId,
	});
	return [
		"Experiment cost",
		...[...byStage].flatMap(([stageId, entries]) => [
			`Stage: ${stageId}`,
			...entries.map(({ log, entry }) => {
				const model = fitToColumn({
					text: entry.configUsed?.modelId ?? "—",
					width: MODEL_WIDTH,
				}).padEnd(MODEL_WIDTH);
				const cost = formatMoney(entry.cost.costUsd).padStart(COST_WIDTH);
				return `  Run ${log.startedAt}    ${model}${cost}`;
			}),
		]),
	];
}

/**
 * Makes the cost report of one lecture. It has a heading that names the lecture,
 * and three sections: the current output, error recovery and experiments
 * (technical-design.md §7).
 *
 * @param args - The report's input.
 * @param args.runLogs - The lecture's run logs.
 * @param args.manifest - The lecture's manifest.
 * @param args.formatMoney - The report's money formatter.
 * @returns The report.
 */
export function formatCostReport({
	runLogs,
	manifest,
	formatMoney,
}: ManifestWithMoney & { readonly runLogs: readonly RunLog[] }): string {
	return [
		// The command can print the reports of many lectures one after another.
		// The heading identifies the lecture of each report (technical-design.md §7,
		// "Cost Report Command").
		lectureHeading({ manifest }),
		"",
		...currentPipelineSection({ manifest, formatMoney }),
		"",
		...errorRecoverySection({ runLogs, formatMoney }),
		"",
		...experimentSection({ runLogs, formatMoney }),
	].join("\n");
}

/** The column widths of the run summary. `promptTokens` and `completionTokens` are parts of the `tokens` column. */
const RUN_SUMMARY_WIDTHS = {
	stage: 24,
	model: MODEL_WIDTH,
	calls: 7,
	tokens: 21,
	promptTokens: 9,
	completionTokens: 7,
} as const;

/**
 * Writes a token count with thousands separators, aligned right in its width.
 * So the `in / out` pairs stay aligned in the column.
 *
 * @param args - The count and its width.
 * @param args.count - The token count.
 * @param args.width - The width to align the count in.
 * @returns The count as text.
 */
function tokenCount({ count, width }: { readonly count: number; readonly width: number }): string {
	return count.toLocaleString("en-GB").padStart(width);
}

/**
 * Makes the `in / out` cell of the run summary from a stage's token counts.
 *
 * @param cost - The stage's recorded cost, or `null` when it recorded none.
 * @returns The token cell. A stage with no recorded cost shows zero tokens.
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
 * Gives the heading that names a lecture: its lecture number, lecture title and
 * lecture date. The run summary, the cost report and the CLI's notice at the
 * start of a pipeline run all use it. So a reader never sees one lecture named
 * two ways (technical-design.md §7, "Cost and Reporting Modules").
 *
 * @param args - The lecture to name.
 * @param args.manifest - The lecture's manifest.
 * @returns The heading.
 * @example
 * lectureHeading({ manifest }); // "Lecture 1: Cell Injury (2025-10-10)"
 */
export function lectureHeading({ manifest }: { readonly manifest: Manifest }): string {
	return `Lecture ${manifest.lectureNumber}: ${manifest.lectureTitle} (${manifest.lectureDate})`;
}

/**
 * Gives the rows of the run summary: each stage that ran in this pipeline run
 * and that names a model, with its model and cost from the manifest. A skipped
 * or not-reached stage did no work, so it gets no row (technical-design.md §7,
 * "End-of-Run Summary").
 *
 * @param args - The pipeline run's stage outcomes and the manifest.
 * @param args.outcomes - Each stage's outcome, in pipeline order.
 * @param args.manifest - The lecture's manifest, which holds each stage's model and cost.
 * @returns The rows, in the order of the outcomes.
 */
function executedStages({
	outcomes,
	manifest,
}: {
	readonly outcomes: readonly PipelineStageOutcome[];
	readonly manifest: Manifest;
}): readonly (StageCostRow & { readonly stageId: StageId })[] {
	const stages: (StageCostRow & { readonly stageId: StageId })[] = [];
	for (const outcome of outcomes) {
		if (outcome.entry.action !== "ran") {
			continue;
		}
		const row = stageCostRow(manifest.stages[outcome.stageId]);
		if (row !== null) {
			stages.push({ stageId: outcome.stageId, ...row });
		}
	}
	return stages;
}

/**
 * Makes the run summary of one pipeline run. Each stage that ran and that names
 * a model gets a row with its model, calls, tokens and cost. Nothing adds the
 * rows (technical-design.md §7, "End-of-Run Summary").
 *
 * @param args - The summary's input.
 * @param args.outcomes - Each stage's outcome in this pipeline run, in pipeline order.
 * @param args.manifest - The lecture's manifest, read after the pipeline run.
 * @param args.formatMoney - The report's money formatter.
 * @returns The summary table.
 */
export function formatRunSummary({
	outcomes,
	manifest,
	formatMoney,
}: ManifestWithMoney & { readonly outcomes: readonly PipelineStageOutcome[] }): string {
	const rows = executedStages({ outcomes, manifest }).map(
		({ stageId, model, cost }): readonly Cell[] => [
			[stageLabel({ stageId }), RUN_SUMMARY_WIDTHS.stage, "left"],
			[model, RUN_SUMMARY_WIDTHS.model, "left"],
			[String(cost?.callCount ?? 0), RUN_SUMMARY_WIDTHS.calls, "right"],
			tokensCell(cost),
			costCell({ amount: cost?.costUsd ?? null, formatMoney }),
		],
	);
	return renderCostTable({
		title: `Run summary — ${lectureHeading({ manifest })}`,
		columns: [
			["Stage", RUN_SUMMARY_WIDTHS.stage, "left"],
			["Model", RUN_SUMMARY_WIDTHS.model, "left"],
			["Calls", RUN_SUMMARY_WIDTHS.calls, "right"],
			["Tokens (in / out)", RUN_SUMMARY_WIDTHS.tokens, "right"],
			COST_HEADER,
		],
		rows,
	}).join("\n");
}

const BATCH_SUMMARY_WIDTHS = { module: 30, lectures: 10, status: 10 } as const;

/**
 * Groups a batch's pipeline runs by module, in the order the modules are first
 * found. The key is the module's path and not its name, because two module
 * folders can have the same name (technical-design.md §7, "End-of-Run Summary").
 *
 * @param lectures - The pipeline run of each lecture in the batch.
 * @returns The pipeline runs by module root.
 */
function lecturesByModule(
	lectures: readonly PipelineRunSummary[],
): ReadonlyMap<string, readonly PipelineRunSummary[]> {
	return groupBy({
		members: lectures,
		keyOf: (lecture) => moduleRootOf({ workspaceRoot: lecture.workspaceRoot }),
	});
}

/**
 * Makes the batch summary: one row for each module with its number of lectures
 * and its status, then one row for all modules (technical-design.md §4.7). It
 * shows no money, because the cost of a module or a batch is a sum across
 * lectures (NFR-2.2).
 *
 * @param args - The summary's input.
 * @param args.batch - The batch's summary.
 * @returns The batch summary table.
 */
export function formatBatchSummary({ batch }: { readonly batch: BatchSummary }): string {
	const rows: (readonly Cell[])[] = [];
	for (const [moduleRoot, lectures] of lecturesByModule(batch.lectures)) {
		const status: OverallStatus = summariseLectures({ lectures });
		rows.push([
			[moduleName({ moduleRoot }), BATCH_SUMMARY_WIDTHS.module, "left"],
			[String(lectures.length), BATCH_SUMMARY_WIDTHS.lectures, "right"],
			[status, BATCH_SUMMARY_WIDTHS.status, "right"],
		]);
	}
	const acrossModules: readonly Cell[] = [
		["All modules", BATCH_SUMMARY_WIDTHS.module, "left"],
		[String(batch.lectures.length), BATCH_SUMMARY_WIDTHS.lectures, "right"],
		[batch.overallStatus, BATCH_SUMMARY_WIDTHS.status, "right"],
	];
	return [
		...renderCostTable({
			title: "Batch summary",
			columns: [
				["Module", BATCH_SUMMARY_WIDTHS.module, "left"],
				["Lectures", BATCH_SUMMARY_WIDTHS.lectures, "right"],
				["Status", BATCH_SUMMARY_WIDTHS.status, "right"],
			],
			rows,
		}),
		formatCells(acrossModules),
	].join("\n");
}
