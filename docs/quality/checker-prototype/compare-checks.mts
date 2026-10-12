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
import { pathExists } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/utils/files.js";
import { isRecord } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/utils/record.js";
import { matchesKeyFault, type QuotedFault } from "./fault-matching.mts";
import { PROJECT_ROOT, rewritesRunsFolder, workspaceOf } from "./prototype-layout.mts";

/** The answer key of each lecture and rewrites folder: the review with the user's marks. */
const ANSWER_KEYS: Readonly<Record<string, string>> = {
	"2026-03-04/Rewrites (sonnet-5.5, w1)": join(
		PROJECT_ROOT,
		"docs/quality/2026-10-11-lecture-3-checker-c2-review.json",
	),
};

/** The user's mark for a fault that matters. */
const MATTERS = "matters";

/** A fault that a checker reported. */
type CheckerFault = QuotedFault & { readonly deficiencyType: string; readonly description: string };

/** A fault of the answer key, with the user's mark. */
type KeyFault = QuotedFault & {
	readonly fault: string;
	readonly description: string;
	readonly userVerdict: string;
};

/** One checker's results on the rewrites: its faults and what it cost. */
type CheckerResults = {
	readonly name: string;
	readonly faults: readonly CheckerFault[];
	readonly subtopicsChecked: number;
	readonly costUsd: number | null;
};

/**
 * Gives a passage of a parsed fault, or null.
 *
 * @param value - The passage as parsed.
 * @returns The passage when it is a string, or null.
 */
function passage(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

/**
 * Reads the faults of one result file of a subtopic.
 *
 * @param path - The absolute path of the file.
 * @returns The faults, with the subtopic of the file.
 */
async function readFaults(path: string): Promise<readonly CheckerFault[]> {
	const check: unknown = JSON.parse(await readFile(path, "utf8"));
	if (!isRecord(check) || typeof check.subtopicId !== "number" || !Array.isArray(check.deficiencies)) {
		throw new Error(`${path} is not a check of a subtopic`);
	}
	const { subtopicId } = check;
	return check.deficiencies.filter(isRecord).map((fault) => ({
		subtopicId,
		deficiencyType: String(fault.deficiencyType),
		description: String(fault.description),
		sourcePassage: passage(fault.sourcePassage),
		rewritePassage: passage(fault.rewritePassage),
	}));
}

/**
 * Reads the results of one checker from a folder of subtopic files.
 *
 * @param args - The folder and the name of the checker.
 * @param args.folder - The absolute path of the folder.
 * @param args.name - The name of the checker in the tables.
 * @returns The checker's results. The cost is read from `run.json` when the folder has one.
 */
async function readChecker({
	folder,
	name,
}: {
	readonly folder: string;
	readonly name: string;
}): Promise<CheckerResults> {
	const files = (await readdir(folder)).filter((file) => /^subtopic-\d+/.test(file));
	const faults = (await Promise.all(files.map((file) => readFaults(join(folder, file))))).flat();
	const runFile = join(folder, "run.json");
	const run: unknown = (await pathExists(runFile)) ? JSON.parse(await readFile(runFile, "utf8")) : null;
	const commands = isRecord(run) && Array.isArray(run.commands) ? run.commands.filter(isRecord) : [];
	const costs = commands.map((command) =>
		isRecord(command.cost) && typeof command.cost.costUsd === "number" ? command.cost.costUsd : 0,
	);
	return {
		name,
		faults,
		subtopicsChecked: files.length,
		costUsd: commands.length === 0 ? null : costs.reduce((sum, cost) => sum + cost, 0),
	};
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
		...runs.map((entry) => readChecker({ folder: join(runsFolder, entry.name), name: entry.name })),
		...saved.map((name) =>
			readChecker({
				folder: join(workspaceRoot, name),
				name: `${name.slice(savedPrefix.length, -1)} (pipeline)`,
			}),
		),
	]);
}

/**
 * Reads the answer key of a lecture and rewrites folder.
 *
 * @param key - The lecture and the rewrites folder, joined by "/".
 * @returns The faults of the key.
 * @throws Error when the lecture and rewrites folder have no key.
 */
async function readAnswerKey(key: string): Promise<readonly KeyFault[]> {
	const path = ANSWER_KEYS[key];
	if (path === undefined) {
		throw new Error(`No answer key for ${key}. The keys are ${Object.keys(ANSWER_KEYS).join(", ")}.`);
	}
	const review: unknown = JSON.parse(await readFile(path, "utf8"));
	if (!isRecord(review) || !Array.isArray(review.faults)) {
		throw new Error(`${path} has no list of faults`);
	}
	return review.faults as readonly KeyFault[];
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
