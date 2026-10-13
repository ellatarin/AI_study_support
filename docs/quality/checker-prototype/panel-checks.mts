/**
 * Counts one panel of check runs against the answer key of the lecture. Each
 * run must have its Jev scores (`judge-faults.mts`). For each run and for the
 * panel, it prints the real faults and the false faults that are kept, each by
 * name, and each kept fault outside the key as not marked. `--json` prints the
 * same count as JSON.
 *
 * Usage, from the project root:
 *   pnpm exec tsx docs/quality/checker-prototype/panel-checks.mts \
 *     --lecture 2026-03-04 --rewrites "Rewrites (sonnet-5.5, w1)" \
 *     --runs "gemini-3.8-flash c20,gemini-3.8-flash c20 run 2" \
 *     --jev-bar 0.6 --votes 2
 */

import { join } from "node:path";
import { parseArgs } from "node:util";
import { readAnswerKey } from "./check-results.mts";
import { readScoredFaults } from "./jev-scores.mts";
import { type KeptFaults, keepPanelFaults } from "./panel-count.mts";
import { rewritesRunsFolder } from "./prototype-layout.mts";

/**
 * Describes the faults that a run or the panel keeps.
 *
 * @param args - The name and the kept faults.
 * @param args.name - The name of the run, or "Panel".
 * @param args.kept - The kept faults.
 * @returns The lines of the description.
 */
function describeKept({ name, kept }: { readonly name: string; readonly kept: KeptFaults }): string {
	const names = (ids: readonly string[]): string => (ids.length === 0 ? "none" : ids.join(", "));
	const notMarked = kept.notMarked.map(
		(fault) => `\n  - not marked, subtopic ${fault.subtopicId} (Jev ${fault.jevScore}): ${fault.description}`,
	);
	return `${name}: real ${kept.realFaults.length} (${names(kept.realFaults)}), false ${kept.falseFaults.length + kept.notMarked.length} (${names(kept.falseFaults)}${kept.notMarked.length === 0 ? "" : `, ${kept.notMarked.length} not marked`})${notMarked.join("")}`;
}

const { values } = parseArgs({
	options: {
		lecture: { type: "string" },
		rewrites: { type: "string" },
		runs: { type: "string" },
		"jev-bar": { type: "string" },
		votes: { type: "string" },
		json: { type: "boolean", default: false },
	},
});
const { lecture, rewrites, runs, "jev-bar": jevBar, votes } = values;
if (lecture === undefined || rewrites === undefined || runs === undefined || jevBar === undefined || votes === undefined) {
	throw new Error("Give --lecture, --rewrites, --runs, --jev-bar and --votes. See the usage at the top of this file.");
}
const runsFolder = rewritesRunsFolder({ lecture, rewrites });
const count = keepPanelFaults({
	runs: await Promise.all(
		runs.split(",").map(async (name) => ({ name, faults: await readScoredFaults(join(runsFolder, name)) })),
	),
	answerKey: await readAnswerKey(`${lecture}/${rewrites}`),
	jevBar: Number(jevBar),
	votesNeeded: Number(votes),
});
console.log(
	values.json
		? JSON.stringify(count)
		: [...count.runs.map((run) => describeKept({ name: run.name, kept: run })), describeKept({ name: "Panel", kept: count.panel })].join("\n"),
);
