/**
 * One-off: add the `lecture` key to run files written before it existed.
 *
 * Every pass-one run has always recorded the transcript it cut, so the key can
 * be recovered rather than guessed. Runs that already carry one are left alone,
 * which makes this safe to run again.
 *
 * Usage: pnpm exec tsx backfill-lecture-key.mts
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { lectureKeyFor } from "./lecture-key.mts";
import { OUT_DIR } from "./trial-model.mts";

/** A run file, of which only the transcript path and the key matter here. */
type RunFile = { lecture?: string; transcriptPath?: string; sourceRun?: string };

/** Reads a run file, or null when it is absent or unreadable. */
async function readRun(name: string): Promise<RunFile | null> {
	try {
		return JSON.parse(await readFile(join(OUT_DIR, name), "utf8")) as RunFile;
	} catch {
		return null;
	}
}

/**
 * The transcript a run was made against: its own if it recorded one, otherwise
 * the one its blocks file or its pass-one source recorded.
 */
async function transcriptFor({
	stem,
	run,
}: {
	readonly stem: string;
	readonly run: RunFile;
}): Promise<string | undefined> {
	if (run.transcriptPath !== undefined) {
		return run.transcriptPath;
	}
	const blocks = await readRun(`${stem}.blocks.json`);
	if (blocks?.transcriptPath !== undefined) {
		return blocks.transcriptPath;
	}
	if (run.sourceRun === undefined) {
		return undefined;
	}
	const source = await readRun(`${run.sourceRun}.blocks.json`);
	return source?.transcriptPath;
}

const names = (await readdir(OUT_DIR)).filter((name) => name.endsWith(".outcome.json")).sort();
const tally = new Map<string, number>();
let written = 0;
for (const name of names) {
	const stem = name.replace(/\.outcome\.json$/u, "");
	const run = await readRun(name);
	if (run === null) {
		continue;
	}
	const transcriptPath = await transcriptFor({ stem, run });
	const lecture =
		run.lecture ?? (transcriptPath === undefined ? "unknown" : lectureKeyFor({ transcriptPath }));
	tally.set(lecture, (tally.get(lecture) ?? 0) + 1);
	if (run.lecture === undefined) {
		await writeFile(join(OUT_DIR, name), JSON.stringify({ ...run, lecture }, null, 2), "utf8");
		written += 1;
	}
}
console.log(`${String(names.length)} outcome files, ${String(written)} gained a lecture key`);
for (const [lecture, count] of [...tally].sort()) {
	console.log(`  ${lecture.padEnd(10)} ${String(count)}`);
}
