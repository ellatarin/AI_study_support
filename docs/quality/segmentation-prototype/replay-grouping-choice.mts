/**
 * Replays the prototype's saved `g23` grouping runs through `define-topics`'
 * choice and compares it, lecture by lecture, with what
 * `analysis-2026-09-30/choose_panel.py` chooses from the same runs.
 *
 * Each lecture's panel is runs 1–4 of `g23` with `openai/gpt-6.1-sol-pro` on
 * its `r9`-retitled division, the panel `choose_panel.py` and
 * `score_groupings.py` read by default. The stage's choice runs at bar 3,
 * which on four runs is the same vote as the prototype's strict majority.
 *
 * Run from the project root:
 *   pnpm exec tsx docs/quality/segmentation-prototype/replay-grouping-choice.mts
 *
 * Writes REPLAY-GROUPING-CHOICE.md beside this script.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chooseGrouping, type GroupingRun } from "../../../src/pipeline/stages/define-topics/choose-grouping.ts";

const PROTOTYPE_DIR = "docs/quality/segmentation-prototype";
const RUNS_DIR = join(PROTOTYPE_DIR, "runs");
const LECTURES = ["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8"];
const PANEL_RUNS = 4;
const BAR = 3;
const MODEL_TAG = "@gpt-6.1-sol-pro";

/** One topic as the prototype saved the model's reply: the prompt's word for a title is `label`. */
type SavedTopic = { label: string; groupedBecause: string; firstSubtopicId: number };

/** What `choose_panel.py` prints for one lecture. */
type PrototypeChoice = { lecture: string; runs: number; chosen: number[]; from: number[]; by: string; groupings: number };

/** A run that was saved, with its number in the prototype's run files. */
type NumberedRun = { runNumber: number; run: GroupingRun };

async function savedRuns(lecture: string): Promise<NumberedRun[]> {
	const runs: NumberedRun[] = [];
	for (let runNumber = 1; runNumber <= PANEL_RUNS; runNumber++) {
		const path = join(RUNS_DIR, `group-g23${MODEL_TAG}-chosen-live18-rt9-${lecture}-${runNumber}.raw.json`);
		if (!existsSync(path)) continue;
		const { topics } = JSON.parse(await readFile(path, "utf8")) as { topics: SavedTopic[] };
		runs.push({
			runNumber,
			run: { topics: topics.map(({ label, groupedBecause, firstSubtopicId }) => ({ title: label, groupedBecause, firstSubtopicId })) },
		});
	}
	return runs;
}

function prototypeChoices(): Map<string, PrototypeChoice> {
	const output = execFileSync("python3", ["choose_panel.py", MODEL_TAG, String(PANEL_RUNS), ...LECTURES], {
		cwd: join(PROTOTYPE_DIR, "analysis-2026-09-30"),
		encoding: "utf8",
	});
	const choices = output.trim().split("\n").map((line) => JSON.parse(line) as PrototypeChoice);
	return new Map(choices.map((choice) => [choice.lecture, choice]));
}

const prototype = prototypeChoices();
const rows: string[] = [];
let differences = 0;
for (const lecture of LECTURES) {
	const runs = await savedRuns(lecture);
	const { topics, choice } = chooseGrouping({ runs: runs.map(({ run }) => run), bar: BAR });
	const stageRun = runs[choice.chosenRun - 1]?.runNumber;
	const stageStarts = topics.map((topic) => topic.firstSubtopicId).join(",");
	const theirs = prototype.get(lecture);
	const theirStarts = theirs?.chosen.join(",");
	const same = stageStarts === theirStarts && stageRun === theirs?.from[0];
	if (!same) differences++;
	rows.push(
		`| ${lecture} | ${runs.length} | ${theirs?.groupings} | ${stageStarts} | ${stageRun} | ${choice.support} | ${choice.decidedBy} | ${theirStarts} | ${theirs?.from.join(",")} | ${theirs?.by} | ${same ? "same" : "**differs**"} |`,
	);
}

const report = [
	"# Replay: the stage's grouping choice against `choose_panel.py`",
	"",
	`Runs 1–${PANEL_RUNS} of \`g23\` with \`openai/gpt-6.1-sol-pro\` on each lecture's \`r9\`-retitled division; the stage chooses at bar ${BAR}.`,
	"Topic starts count from subtopic 1. \"Same\" means the same topic starts handed on from the same run.",
	"",
	"| Lecture | Runs | Groupings | Stage starts | Stage run | Support | Decided by | Prototype starts | Prototype runs | Prototype rule | Result |",
	"|---|---|---|---|---|---|---|---|---|---|---|",
	...rows,
	"",
	`${differences} of ${LECTURES.length} lectures differ.`,
	"",
].join("\n");
await writeFile(join(PROTOTYPE_DIR, "REPLAY-GROUPING-CHOICE.md"), report);
console.log(report);
