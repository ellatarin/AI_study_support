/**
 * Replays every saved `s6` splitting reply through the pipeline's own cutting
 * code, and reports any run whose subtopics differ from the prototype's.
 *
 * The pipeline's `initial-subtopic-splitting` stage cuts with `placeCuts` and
 * `sliceSubtopics` (src/pipeline/stages/division.ts), ported from `applyCuts`
 * here. Given the same reply and the same transcript, the two should cut in the
 * same places; this is the check that they do. No model is called.
 *
 * Run from the project root:
 *   pnpm exec tsx docs/quality/segmentation-prototype/replay-initial-splitting.mts
 *
 * Writes REPLAY-INITIAL-SPLITTING.md beside this script.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	assertLossless,
	placeCuts,
	type ReplySubtopic,
	replyNaming,
	sliceSubtopics,
} from "../../../src/pipeline/stages/division.ts";
import { applyCuts } from "./cut-blocks.mts";

const PROTOTYPE_DIR = "docs/quality/segmentation-prototype";
const RUNS_DIR = join(PROTOTYPE_DIR, "runs");
const RESULTS_PATH = join(PROTOTYPE_DIR, "REPLAY-INITIAL-SPLITTING.md");
const RUN_STEM = /^split-s6-(l\d+)-(\d+)\.outcome\.json$/u;

type PrototypeBlock = { readonly label: string; readonly content: string };

/** What replaying one run found. */
type Replayed = {
	readonly stem: string;
	readonly lecture: string;
	readonly instance: number;
	readonly result: "match" | "matches today's prototype" | "unplaced" | "different";
	readonly detail: string;
};

async function readJson(path: string): Promise<unknown> {
	return JSON.parse(await readFile(path, "utf8"));
}

/** Where each prototype block starts: its blocks were sliced from the transcript in order. */
function blockStarts(blocks: readonly PrototypeBlock[]): number[] {
	const starts: number[] = [];
	let at = 0;
	for (const block of blocks) {
		starts.push(at);
		at += block.content.length;
	}
	return starts;
}

async function replay(stem: string, lecture: string, instance: number): Promise<Replayed> {
	const outcome = (await readJson(join(RUNS_DIR, `${stem}.outcome.json`))) as { transcriptPath: string };
	const { subtopics } = (await readJson(join(RUNS_DIR, `${stem}.raw.json`))) as {
		subtopics: readonly ReplySubtopic[];
	};
	const { blocks } = (await readJson(join(RUNS_DIR, `${stem}.blocks.json`))) as {
		blocks: readonly PrototypeBlock[];
	};
	// Trimmed once on reading, as both the prototype and the stage do.
	const transcript = (await readFile(outcome.transcriptPath, "utf8")).trim();
	const base = { stem, lecture, instance };

	const placed = placeCuts({ text: transcript, quotes: subtopics.map((subtopic) => subtopic.startsWith) });
	if ("unplaced" in placed) {
		return { ...base, result: "unplaced", detail: `quote not found: "${placed.unplaced}"` };
	}
	const division = sliceSubtopics({
		text: transcript,
		cuts: placed.cuts,
		named: subtopics.map(replyNaming),
	});
	assertLossless({ text: transcript, subtopics: division });

	const prototypeStarts = blockStarts(blocks);
	const pipelineStarts = division.map((subtopic) => subtopic.start);
	if (JSON.stringify(prototypeStarts) !== JSON.stringify(pipelineStarts)) {
		// The saved blocks were cut by applyCuts as it stood on the day of the run.
		// Cutting the same reply with applyCuts as it stands now tells a pipeline
		// defect apart from a change the prototype made after the run was saved.
		const today = applyCuts(transcript, subtopics.map((subtopic, index) => ({ id: index + 1, ...subtopic })));
		const agreesWithToday = JSON.stringify(blockStarts(today.blocks)) === JSON.stringify(pipelineStarts);
		const moved = pipelineStarts
			.map((start, index) => ({ start, was: prototypeStarts[index] ?? -1 }))
			.filter(({ start, was }) => start !== was)
			.map(({ start, was }) => `${was} → ${start} (${JSON.stringify(transcript.slice(start, Math.max(start, was)))})`);
		return {
			...base,
			result: agreesWithToday ? "matches today's prototype" : "different",
			detail: `cuts moved: ${moved.join("; ")}`,
		};
	}
	const titleMismatch = division.findIndex((subtopic, index) => subtopic.title !== blocks[index]?.label);
	if (titleMismatch !== -1) {
		return { ...base, result: "different", detail: `title of subtopic ${titleMismatch + 1} differs` };
	}
	return { ...base, result: "match", detail: `${division.length} subtopics` };
}

function report(replayed: readonly Replayed[]): string {
	const lectures = [...new Set(replayed.map((run) => run.lecture))];
	const rows = lectures.map((lecture) => {
		const runs = replayed.filter((run) => run.lecture === lecture);
		const count = (result: Replayed["result"]): number => runs.filter((run) => run.result === result).length;
		return `| ${lecture} | ${runs.length} | ${count("match")} | ${count("matches today's prototype")} | ${count("unplaced")} | ${count("different")} |`;
	});
	const exceptions = replayed
		.filter((run) => run.result !== "match")
		.map((run) => `- \`${run.stem}\` — ${run.result}: ${run.detail}`);
	return [
		"# Replay of the `s6` splitting runs through the pipeline's cutting code",
		"",
		"Generated by `replay-initial-splitting.mts`; do not edit by hand.",
		"",
		"Each saved `s6` reply is cut by `placeCuts` and `sliceSubtopics` from",
		"`src/pipeline/stages/division.ts` and compared with the prototype's own blocks:",
		"the same starts and the same labels is a match. Where the starts differ, the",
		"reply is cut again with `applyCuts` as it stands today; a run the pipeline cuts",
		"exactly as today's `applyCuts` does differs only because the prototype changed",
		"after the run was saved.",
		"",
		"| lecture | runs | match | matches today's prototype | quote not found | different |",
		"|---|---|---|---|---|---|",
		...rows,
		"",
		"## Runs that did not match",
		"",
		...(exceptions.length === 0 ? ["None."] : exceptions),
		"",
	].join("\n");
}

async function main(): Promise<void> {
	const stems = (await readdir(RUNS_DIR))
		.map((name) => RUN_STEM.exec(name))
		.filter((match) => match !== null)
		.map((match) => ({ stem: match[0].replace(".outcome.json", ""), lecture: match[1] ?? "", instance: Number(match[2]) }))
		.sort((left, right) => left.lecture.localeCompare(right.lecture, "en", { numeric: true }) || left.instance - right.instance);
	const replayed: Replayed[] = [];
	for (const { stem, lecture, instance } of stems) {
		replayed.push(await replay(stem, lecture, instance));
	}
	const markdown = report(replayed);
	await writeFile(RESULTS_PATH, markdown, "utf8");
	console.log(markdown);
}

await main();
