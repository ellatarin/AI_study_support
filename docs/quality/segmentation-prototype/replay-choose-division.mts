/**
 * Replays the pipeline's `choose-division` choice on the prototype's saved `d13`
 * runs, for `replay_choose_division.py` to compare with the prototype's own
 * choice (ticket 07). For each lecture it chooses from all 18 runs at a bar of
 * nine, and from every panel of nine drawn from them at a bar of five.
 *
 * Runs are taken in the order the prototype globbed them — sorted file names —
 * so "the earliest run" means the same run on both sides.
 *
 * Usage: npx tsx replay-choose-division.mts <out.json>
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chooseDivision } from "../../../src/pipeline/stages/choose-division/choose-division.ts";
import type { Subtopic } from "../../../src/pipeline/stages/division.ts";

const RUNS = join(import.meta.dirname, "runs");
const LECTURES = ["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8"];
const PANEL = 9;

/** A saved prototype run as the pipeline reads a division: spans from the blocks' lengths. */
async function readRun(file: string): Promise<{ readonly text: string; readonly run: readonly Subtopic[] }> {
	const { blocks } = JSON.parse(await readFile(join(RUNS, file), "utf8")) as {
		readonly blocks: readonly { readonly label: string; readonly content: string }[];
	};
	let start = 0;
	const run = blocks.map((block) => {
		const subtopic = { start, end: start + block.content.length, title: block.label, why: "" };
		start = subtopic.end;
		return subtopic;
	});
	return { text: blocks.map((block) => block.content).join(""), run };
}

/** Every way of choosing `size` of `count` indexes, in the order Python's `combinations` gives. */
function* combinations(count: number, size: number): Generator<readonly number[]> {
	const picked = [...Array(size).keys()];
	for (;;) {
		yield [...picked];
		let index = size - 1;
		while (index >= 0 && picked[index] === count - size + index) index--;
		if (index < 0) return;
		picked[index] = (picked[index] ?? 0) + 1;
		for (let later = index + 1; later < size; later++) picked[later] = (picked[later - 1] ?? 0) + 1;
	}
}

const out: Record<string, { files: readonly string[]; full: number; fullDistance: number; panels: number[] }> = {};
for (const lecture of LECTURES) {
	const prefix = `deepen-d13-600-split-s6-${lecture}-`;
	const files = (await readdir(RUNS)).filter((f) => f.startsWith(prefix) && f.endsWith(".blocks.json")).sort();
	const read = await Promise.all(files.map(readRun));
	const text = read[0]?.text ?? "";
	const runs = read.map((entry) => entry.run);
	const full = chooseDivision({ text, runs, bar: 9 }).choice;
	const panels: number[] = [];
	for (const panel of combinations(runs.length, PANEL)) {
		const { chosenRun } = chooseDivision({ text, runs: panel.map((index) => runs[index] ?? []), bar: 5 }).choice;
		panels.push(panel[chosenRun - 1] ?? -1);
	}
	out[lecture] = { files, full: full.chosenRun - 1, fullDistance: full.distanceFromVote, panels };
	console.log(lecture, files.length, "runs; full panel chose", files[full.chosenRun - 1], "at", full.distanceFromVote);
}
await writeFile(process.argv[2] ?? "replay-choose-division.json", JSON.stringify(out));
