/**
 * Compares every check of one rewrites folder with the answer key: the runs of
 * this prototype, and the saved checks in the lecture's own "Checks (…)"
 * folders. It prints the summary and the table of the faults that matter, and
 * writes the full comparison, with each fault outside the key, to
 * `comparison.md` in the runs folder.
 *
 * Usage, from the project root:
 *   pnpm exec tsx docs/quality/checker-prototype/compare-checks.mts \
 *     --lecture 2026-03-04 --rewrites "Rewrites (sonnet-5.5, w1)"
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { runLogsDirPath } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/pipeline/layout.js";
import { pathExists } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/utils/files.js";
import { isRecord } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/utils/record.js";
import {
	type CheckerFault,
	type KeyFault,
	listSubtopicResultFiles,
	MATTERS,
	readAnswerKey,
	readFaults,
} from "./check-results.mts";
import { matchesKeyFault } from "./fault-matching.mts";
import { CHECK_STAGE_ID, rewritesRunsFolder, workspaceOf } from "./prototype-layout.mts";

/**
 * The run logs of each saved "Checks (…)" folder of a lecture, keyed by the
 * lecture and the folder, joined by "/". A run log does not name the folder
 * that its checks were copied to, so this list connects them. A folder that is
 * not in the list shows its cost as not recorded.
 */
const PIPELINE_CHECK_RUN_LOGS: Readonly<Record<string, readonly string[]>> = {
	"2026-03-04/Checks (sonnet-5.5, w1, sol-pro, c2)": ["2026-10-11T21-10-20Z"],
	"2026-03-04/Checks (sonnet-5.5, w1, terra-pro, c2)": ["2026-10-12T09-09-49Z"],
	"2026-03-04/Checks (sonnet-5.5, w1, sonnet-5.5, c2)": [
		"2026-10-12T09-19-39Z",
		"2026-10-12T09-30-54Z",
		"2026-10-12T09-41-18Z",
	],
	"2026-03-04/Checks (sonnet-5.5, w1, gemini-3.1-pro, c2)": ["2026-10-12T09-45-48Z"],
	"2026-03-04/Checks (sonnet-5.5, w1, gemini-3.8-flash, c2)": ["2026-10-12T09-53-06Z", "2026-10-12T10-00-51Z"],
	"2026-03-04/Checks (sonnet-5.5, w1, gemini-3.8-flash, c3)": ["2026-10-12T10-22-37Z"],
};

/** One checker's results on the rewrites: its faults and what it cost. */
type CheckerResults = {
	readonly name: string;
	readonly faults: readonly CheckerFault[];
	readonly subtopicsChecked: number;
	readonly costUsd: number | null;
};

/**
 * Adds the dollar costs of several records. A record with no dollar cost adds nothing.
 *
 * @param costs - The parsed `cost` field of each record.
 * @returns The sum, or null when there is no record.
 */
function totalCost(costs: readonly unknown[]): number | null {
	if (costs.length === 0) {
		return null;
	}
	return costs.reduce<number>(
		(sum, cost) => sum + (isRecord(cost) && typeof cost.costUsd === "number" ? cost.costUsd : 0),
		0,
	);
}

/**
 * Reads the cost of a prototype run from its `run.json`.
 *
 * @param folder - The absolute path of the run folder.
 * @returns The cost of every command of the run, or null when the folder has no `run.json`.
 */
async function prototypeRunCost(folder: string): Promise<number | null> {
	const runFile = join(folder, "run.json");
	const run: unknown = (await pathExists(runFile)) ? JSON.parse(await readFile(runFile, "utf8")) : null;
	const commands = isRecord(run) && Array.isArray(run.commands) ? run.commands.filter(isRecord) : [];
	return totalCost(commands.map((command) => command.cost));
}

/**
 * Reads the cost of a saved "Checks (…)" folder from the run logs that
 * {@link PIPELINE_CHECK_RUN_LOGS} gives for it.
 *
 * @param args - The workspace, the lecture and the folder.
 * @param args.workspaceRoot - The absolute path of the workspace.
 * @param args.lecture - The date of the lecture.
 * @param args.folder - The name of the saved folder.
 * @returns The cost of the check stage in each run log, or null when the folder has no run logs in the list.
 */
async function pipelineChecksCost({
	workspaceRoot,
	lecture,
	folder,
}: {
	readonly workspaceRoot: string;
	readonly lecture: string;
	readonly folder: string;
}): Promise<number | null> {
	const runLogs = PIPELINE_CHECK_RUN_LOGS[`${lecture}/${folder}`] ?? [];
	const costs = await Promise.all(
		runLogs.map(async (runLog) => {
			const log: unknown = JSON.parse(
				await readFile(join(runLogsDirPath({ workspaceRoot }), `${runLog}.json`), "utf8"),
			);
			const stage = isRecord(log) && isRecord(log.stages) ? log.stages[CHECK_STAGE_ID] : undefined;
			return isRecord(stage) ? stage.cost : undefined;
		}),
	);
	return totalCost(costs);
}

/**
 * Reads the results of one checker from a folder of subtopic files.
 *
 * @param args - The folder, the name of the checker and its cost.
 * @param args.folder - The absolute path of the folder.
 * @param args.name - The name of the checker in the tables.
 * @param args.costUsd - The cost of the checks, or null when it is not recorded.
 * @returns The checker's results.
 */
async function readChecker({
	folder,
	name,
	costUsd,
}: {
	readonly folder: string;
	readonly name: string;
	readonly costUsd: number | null;
}): Promise<CheckerResults> {
	const files = await listSubtopicResultFiles(folder);
	const faults = (await Promise.all(files.map((file) => readFaults(join(folder, file))))).flat();
	return { name, faults, subtopicsChecked: files.length, costUsd };
}

/**
 * Reads every checker of the rewrites folder: the prototype's runs, then the
 * lecture's saved "Checks (…)" folders of the same rewrites.
 *
 * @param args - The lecture and the rewrites folder.
 * @param args.lecture - The date of the lecture.
 * @param args.rewrites - The name of the rewrites folder, such as "Rewrites (sonnet-5.5, w1)".
 * @returns The results of each checker.
 */
async function readCheckers({
	lecture,
	rewrites,
}: {
	readonly lecture: string;
	readonly rewrites: string;
}): Promise<readonly CheckerResults[]> {
	const runsFolder = rewritesRunsFolder({ lecture, rewrites });
	const runs = (await pathExists(runsFolder))
		? (await readdir(runsFolder, { withFileTypes: true })).filter((entry) => entry.isDirectory())
		: [];
	const workspaceRoot = await workspaceOf(lecture);
	const label = /^Rewrites \((.+)\)$/.exec(rewrites)?.[1];
	const savedPrefix = `Checks (${label ?? ""}, `;
	const saved =
		label === undefined
			? []
			: (await readdir(workspaceRoot)).filter((name) => name.startsWith(savedPrefix));
	return Promise.all([
		...runs.map(async (entry) => {
			const folder = join(runsFolder, entry.name);
			return readChecker({ folder, name: entry.name, costUsd: await prototypeRunCost(folder) });
		}),
		...saved.map(async (name) =>
			readChecker({
				folder: join(workspaceRoot, name),
				name: `${name.slice(savedPrefix.length, -1)} (pipeline)`,
				costUsd: await pipelineChecksCost({ workspaceRoot, lecture, folder: name }),
			}),
		),
	]);
}

/**
 * Builds a markdown table.
 *
 * @param args - The header and the rows.
 * @param args.header - The column headings.
 * @param args.rows - The cells of each row.
 * @returns The table.
 */
function table({
	header,
	rows,
}: {
	readonly header: readonly string[];
	readonly rows: readonly (readonly string[])[];
}): string {
	return [header, header.map(() => "---"), ...rows].map((cells) => `| ${cells.join(" | ")} |`).join("\n");
}

const { values } = parseArgs({ options: { lecture: { type: "string" }, rewrites: { type: "string" } } });
if (values.lecture === undefined || values.rewrites === undefined) {
	throw new Error("Give --lecture and --rewrites. See the usage at the top of this file.");
}
const { lecture, rewrites } = values;
const keyFaults = await readAnswerKey(`${lecture}/${rewrites}`);
const mattering = keyFaults.filter((keyFault) => keyFault.userVerdict === MATTERS);
const checkers = await readCheckers({ lecture, rewrites });

/**
 * Checks that a checker's faults hold a fault of the key.
 *
 * @param checker - The checker.
 * @param keyFault - The fault of the key.
 * @returns `true` when one of the checker's faults matches it.
 */
function found(checker: CheckerResults, keyFault: KeyFault): boolean {
	return checker.faults.some((fault) => matchesKeyFault({ fault, keyFault }));
}

const summary = table({
	header: ["Checker", "Faults", "Subtopics failed", "Subtopics checked", "Faults that matter found", "Cost"],
	rows: checkers.map((checker) => [
		checker.name,
		String(checker.faults.length),
		String(new Set(checker.faults.map((fault) => fault.subtopicId)).size),
		String(checker.subtopicsChecked),
		`${mattering.filter((keyFault) => found(checker, keyFault)).length} of ${mattering.length}`,
		checker.costUsd === null ? "not recorded" : `$${checker.costUsd.toFixed(2)}`,
	]),
});
const matters = table({
	header: ["Fault", ...checkers.map((checker) => checker.name)],
	rows: mattering.map((keyFault) => [
		keyFault.fault,
		...checkers.map((checker) => (found(checker, keyFault) ? "yes" : "no")),
	]),
});
const outsideKey = checkers.map((checker) => {
	const unmatched = checker.faults.filter(
		(fault) => !keyFaults.some((keyFault) => matchesKeyFault({ fault, keyFault })),
	);
	const lines = unmatched.map(
		(fault) =>
			`- **${fault.subtopicId}**, ${fault.deficiencyType}: ${fault.description}\n  - Source: ${fault.sourcePassage ?? "none"}\n  - Rewrite: ${fault.rewritePassage ?? "none"}`,
	);
	const count = `${unmatched.length} ${unmatched.length === 1 ? "fault" : "faults"}`;
	return `### ${checker.name}: ${count} outside the key\n\n${lines.join("\n")}`;
});
const report = `# Checks of ${rewrites}, lecture ${lecture}\n\n${summary}\n\n## Faults that matter\n\n${matters}\n\n## Faults outside the key\n\n${outsideKey.join("\n\n")}\n`;
await mkdir(rewritesRunsFolder({ lecture, rewrites }), { recursive: true });
await writeFile(join(rewritesRunsFolder({ lecture, rewrites }), "comparison.md"), report);
console.log(`${summary}\n\n${matters}`);
