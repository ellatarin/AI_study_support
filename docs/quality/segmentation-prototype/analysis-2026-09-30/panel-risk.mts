/**
 * How often would `define-topics`' panel choose a bad grouping, judged from the
 * runs already saved? Uses the stage's own `chooseGrouping` at bar 3.
 *
 * Part 1, lecture 4: random panels of 5 and of 10 drawn (without replacement
 * inside a panel) from each pool of saved runs, counting what the panel chose
 * for subtopics 18–21. The user's ruling (2026-10-03): 18–21 together or a
 * break at 20 are fine, a break at 19 is bad.
 *
 * Part 2, every lecture: the five 30 September `g23` Sol Pro runs. The user
 * judged runs 1–4's groupings acceptable (ticket 08, 2026-09-30); run 5 was
 * not judged. For the full panel and for each panel of 4 (one run left out),
 * which grouping is chosen and whether it is one the user judged.
 *
 * Run from the project root:
 *   pnpm exec tsx docs/quality/segmentation-prototype/analysis-2026-09-30/panel-risk.mts
 * Writes PANEL-RISK.md beside the other analysis results in the prototype folder.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chooseGrouping, type GroupingRun } from "../../../../src/pipeline/stages/define-topics/choose-grouping.ts";

const PROTOTYPE_DIR = "docs/quality/segmentation-prototype";
const RUNS_DIR = join(PROTOTYPE_DIR, "runs");
const LIVE_DIR = join(PROTOTYPE_DIR, "live-runs");
const BAR = 3;
const DRAWS = 100_000;
const PANEL_SIZES = [5, 10];
const LECTURES = ["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8"];
const SEPTEMBER_RUNS = [1, 2, 3, 4, 5];
const JUDGED_RUNS = [1, 2, 3, 4];

type SavedTopic = { label?: string; title?: string; groupedBecause: string; firstSubtopicId: number };

async function readRun(path: string): Promise<GroupingRun> {
	const { topics } = JSON.parse(await readFile(path, "utf8")) as { topics: SavedTopic[] };
	return {
		topics: topics.map((t) => ({ title: t.title ?? t.label ?? "", groupedBecause: t.groupedBecause, firstSubtopicId: t.firstSubtopicId })),
	};
}

const protoPath = (tag: string, source: string, lecture: string, n: number): string =>
	join(RUNS_DIR, `group-g23@gpt-6.1-sol-pro${tag}-${source}-${lecture}-${n}.raw.json`);
const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const startsOf = (run: GroupingRun): string => run.topics.map((t) => t.firstSubtopicId).join(",");

/** The grouping the stage would hand on from this panel. */
const chosenRun = (runs: readonly GroupingRun[]): GroupingRun => ({ topics: chooseGrouping({ runs, bar: BAR }).topics });

/** What a lecture 4 grouping does with subtopics 18–21. */
function stretchOutcome(run: GroupingRun): string {
	const starts = run.topics.map((t) => t.firstSubtopicId);
	if (starts.includes(19)) return "split at 19";
	if (starts.includes(20)) return "split at 20";
	return starts.includes(21) ? "split at 21" : "18–21 together";
}

/** A small seeded generator, so the draws are the same each time the script runs. */
function seededRandom(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state * 1664525 + 1013904223) % 4294967296;
		return state / 4294967296;
	};
}

function drawPanel(pool: readonly GroupingRun[], size: number, random: () => number): GroupingRun[] {
	const left = [...pool];
	const panel: GroupingRun[] = [];
	for (let i = 0; i < size; i++) panel.push(left.splice(Math.floor(random() * left.length), 1)[0] as GroupingRun);
	return panel;
}

const OUTCOMES = ["split at 19", "split at 20", "split at 21", "18–21 together"];

async function lectureFourPools(): Promise<{ name: string; runs: GroupingRun[] }[]> {
	const live = [
		...(await Promise.all(range(1, 5).map((n) => readRun(join(LIVE_DIR, "l4-2026-10-03-panel5", "Grouping runs", `run-0${n}.json`))))),
		...(await Promise.all(range(1, 10).map((n) => readRun(join(LIVE_DIR, "l4-2026-10-03-panel10", "Grouping runs", `run-${String(n).padStart(2, "0")}.json`))))),
	];
	const protoTitlesOn = await Promise.all(range(1, 20).map((n) => readRun(protoPath("", "chosen-live18-rt9", "l4", n))));
	const protoTitlesOff = await Promise.all(range(1, 10).map((n) => readRun(protoPath("~nocache", "chosen-live18-rt9", "l4", n))));
	const liveTitlesOn = await Promise.all(range(1, 10).map((n) => readRun(protoPath("", "chosen-live18-rtlive", "l4", n))));
	const liveTitlesOff = await Promise.all(range(1, 10).map((n) => readRun(protoPath("~nocache", "chosen-live18-rtlive", "l4", n))));
	return [
		{ name: "Prototype's titles, caching on", runs: protoTitlesOn },
		{ name: "Prototype's titles, caching off", runs: protoTitlesOff },
		{ name: "Prototype's titles, all", runs: [...protoTitlesOn, ...protoTitlesOff] },
		{ name: "Live titles, prototype, caching on", runs: liveTitlesOn },
		{ name: "Live titles, prototype, caching off", runs: liveTitlesOff },
		{ name: "Live titles, live stage", runs: live },
		{ name: "Live titles, all", runs: [...liveTitlesOn, ...liveTitlesOff, ...live] },
	];
}

function partOne(pools: { name: string; runs: GroupingRun[] }[]): string[] {
	const random = seededRandom(20261003);
	const lines = [
		"## 1. Lecture 4: how often a panel chooses each outcome for 18–21",
		"",
		`${DRAWS.toLocaleString("en-GB")} random panels per row, drawn from the pool's saved runs; each panel chosen by \`chooseGrouping\` at bar ${BAR}. "Single runs" is the share of the pool's own runs, for comparison. A panel of 10 is drawn only from pools of more than 10 runs.`,
		"",
		"| Pool | Runs | Panel | Split at 19 (bad) | Split at 20 | 18–21 together |",
		"|---|---|---|---|---|---|",
	];
	const share = (count: number, of: number): string => `${((100 * count) / of).toFixed(1)}%`;
	for (const pool of pools) {
		const single = new Map<string, number>();
		for (const run of pool.runs) single.set(stretchOutcome(run), (single.get(stretchOutcome(run)) ?? 0) + 1);
		const otherOutcome = OUTCOMES.filter((o) => !["split at 19", "split at 20", "18–21 together"].includes(o)).some((o) => single.has(o));
		if (otherOutcome) throw new Error(`${pool.name}: an outcome this table has no column for`);
		lines.push(
			`| ${pool.name} | ${pool.runs.length} | single runs | ${share(single.get("split at 19") ?? 0, pool.runs.length)} | ${share(single.get("split at 20") ?? 0, pool.runs.length)} | ${share(single.get("18–21 together") ?? 0, pool.runs.length)} |`,
		);
		for (const size of PANEL_SIZES.filter((s) => s < pool.runs.length)) {
			const chosen = new Map<string, number>();
			for (let d = 0; d < DRAWS; d++) {
				const outcome = stretchOutcome(chosenRun(drawPanel(pool.runs, size, random)));
				chosen.set(outcome, (chosen.get(outcome) ?? 0) + 1);
			}
			lines.push(
				`| | | panel of ${size} | ${share(chosen.get("split at 19") ?? 0, DRAWS)} | ${share(chosen.get("split at 20") ?? 0, DRAWS)} | ${share(chosen.get("18–21 together") ?? 0, DRAWS)} |`,
			);
		}
	}
	return lines;
}

async function partTwo(): Promise<string[]> {
	const lines = [
		"",
		"## 2. Every lecture: the 30 September panels",
		"",
		"Runs 1–5 of `g23` on Sol Pro, 30 September. \"Judged\" means a grouping the user judged acceptable (made by one of runs 1–4); run 5 was never judged. Panels of 4 leave out one run each.",
		"",
		"| Lecture | Groupings (runs that made each) | Panel of 5 chooses | Panels of 4 choose | Any panel picks an unjudged grouping |",
		"|---|---|---|---|---|",
	];
	for (const lecture of LECTURES) {
		const runs = await Promise.all(SEPTEMBER_RUNS.map((n) => readRun(protoPath("", "chosen-live18-rt9", lecture, n))));
		const byGrouping = new Map<string, number[]>();
		for (const [i, run] of runs.entries()) byGrouping.set(startsOf(run), [...(byGrouping.get(startsOf(run)) ?? []), SEPTEMBER_RUNS[i] as number]);
		const names = new Map([...byGrouping.keys()].map((key, i) => [key, String.fromCharCode(65 + i)]));
		const judged = (key: string): boolean => (byGrouping.get(key) ?? []).some((n) => JUDGED_RUNS.includes(n));
		const label = (key: string): string => `${names.get(key)}${judged(key) ? "" : " (unjudged)"}`;
		const groupings = [...byGrouping].map(([key, ns]) => `${names.get(key)}: ${ns.join(",")}`).join("; ");
		const full = startsOf(chosenRun(runs));
		const leaveOneOut = SEPTEMBER_RUNS.map((_, out) => startsOf(chosenRun(runs.filter((__, i) => i !== out))));
		const counts = new Map<string, number>();
		for (const key of leaveOneOut) counts.set(key, (counts.get(key) ?? 0) + 1);
		const anyUnjudged = [full, ...leaveOneOut].some((key) => !judged(key));
		lines.push(
			`| ${lecture} | ${groupings} | ${label(full)} | ${[...counts].map(([key, n]) => `${label(key)} ×${n}`).join(", ")} | ${anyUnjudged ? "**yes**" : "no"} |`,
		);
	}
	lines.push("", "Each grouping's topic starts:", "");
	for (const lecture of LECTURES) {
		const runs = await Promise.all(SEPTEMBER_RUNS.map((n) => readRun(protoPath("", "chosen-live18-rt9", lecture, n))));
		const keys = [...new Set(runs.map(startsOf))];
		if (keys.length > 1) lines.push(`- ${lecture}: ${keys.map((key, i) => `${String.fromCharCode(65 + i)} = ${key}`).join("; ")}`);
	}
	return lines;
}

const report = [
	"# Panel risk, from the saved runs",
	"",
	...partOne(await lectureFourPools()),
	...(await partTwo()),
	"",
].join("\n");
await writeFile(join(PROTOTYPE_DIR, "PANEL-RISK.md"), report);
console.log(report);
