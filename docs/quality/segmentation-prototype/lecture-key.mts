/**
 * Which lecture a run was made against, as a short key.
 *
 * Every trial writes its runs into one `runs/` directory, and the numbers in the
 * ledger are only meaningful within a single lecture — a prompt version's topic
 * counts on one transcript say nothing about another. So each run records the
 * lecture it came from, the ledger groups by it, and the key goes into the run's
 * filename as well, which is what stops two lectures' runs overwriting each
 * other at the same instance number.
 */

import { basename, dirname, sep } from "node:path";

/** How a normalised workspace folder names its lecture: `Lecture 5 - Title - 2026-03-09`. */
const WORKSPACE_FOLDER = /^Lecture (\d+)\b/u;

/**
 * The lecture key for a transcript path.
 *
 * Reads the lecture number out of the nearest enclosing workspace folder, which
 * Stage 0 names `Lecture N - Title - YYYY-MM-DD`. A transcript kept outside a
 * workspace — the loose lecture-3 copy under `docs/quality/`, say — has no
 * lecture number to find, so it falls back to its own filename, which at least
 * distinguishes it from every other source.
 *
 * @param options - Options object.
 * @param options.transcriptPath - Path to the transcript the run was made against.
 * @returns A short key such as `l5`, safe to put in a filename.
 * @example
 * lectureKeyFor({ transcriptPath: ".../Lecture 5 - Cancer Genetics - 2026-03-09/Transcript/transcript.txt" });
 * // → "l5"
 */
export function lectureKeyFor({
	transcriptPath,
}: {
	readonly transcriptPath: string;
}): string {
	let directory = dirname(transcriptPath);
	while (directory !== "" && directory !== sep && directory !== dirname(directory)) {
		const matched = WORKSPACE_FOLDER.exec(basename(directory));
		if (matched !== null) {
			return `l${matched[1] ?? ""}`;
		}
		directory = dirname(directory);
	}
	return basename(transcriptPath)
		.replace(/\.[^.]+$/u, "")
		.replace(/[^a-z0-9]+/giu, "-")
		.toLowerCase();
}
