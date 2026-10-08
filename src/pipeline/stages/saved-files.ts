/**
 * This module makes a list of files, each saved as soon as it is made. A file
 * that an earlier invocation saved is read back and not made again. So a crash
 * loses only the work in flight. The panel stages save their runs with it, and
 * `read-slides` saves its slide readings with it (technical-design.md §5,
 * "Dividing the transcript", Panel runs, and `read-slides`).
 */

import type { StageCost } from "../../types/pipeline.js";
import { mapWithConcurrency } from "../../utils/concurrency.js";
import { totalCost } from "../../utils/cost.js";
import { pathExists, readJsonSafe, writeJsonAtomic } from "../../utils/files.js";
import { createParallelWorkBar } from "../../utils/progress.js";

/**
 * The reader of one saved file, and the error for a file that holds nothing
 * readable. A saved file is written whole or not at all, so an unreadable one
 * was changed outside the pipeline.
 *
 * @typeParam TContent - The contents of one file.
 */
export type SavedFileReader<TContent> = {
	/** Reads a parsed saved file, or gives `null` when it holds nothing readable. */
	readonly readSaved: (value: unknown) => TContent | null;
	/** Builds the error for the file at `path` that holds nothing readable. */
	readonly unreadable: (path: string) => Error;
};

/**
 * Reads the saved file at `path`.
 *
 * @param args - The file, and its reader.
 * @param args.path - The path of the saved file.
 * @param args.readSaved - Reads a parsed value as the contents of the file.
 * @param args.unreadable - Builds the error for a file that holds nothing readable.
 * @returns The contents, or `null` when no file is there.
 * @throws The error that `unreadable` builds, when a file is there but holds nothing readable.
 * @typeParam TContent - The contents of one file.
 */
export async function readSavedFile<TContent>({
	path,
	readSaved,
	unreadable,
}: { readonly path: string } & SavedFileReader<TContent>): Promise<TContent | null> {
	if (!(await pathExists(path))) {
		return null;
	}
	const saved = readSaved(await readJsonSafe(path));
	if (saved === null) {
		throw unreadable(path);
	}
	return saved;
}

/**
 * Reads each file in `files` that exists, and makes each file that is missing, a
 * few at a time. Each made file is saved as JSON as soon as it is made. A
 * progress bar shows each file by its number in `files`, from 1. A saved file
 * counts as done at once.
 *
 * When one file fails, no further file starts. The files in flight finish and
 * are saved, and then the failure is thrown.
 *
 * @param args - The files, how many to make at once, and how to read and make one.
 * @param args.files - Each file, in order. Each has the absolute path to save it at.
 *   Its folder must already exist.
 * @param args.label - The word in front of the progress bar, such as `Slides`.
 * @param args.concurrency - The most files made at the same time. Unset means one at a time.
 * @param args.readSaved - Reads a parsed saved file.
 * @param args.unreadable - Builds the error for a saved file that holds nothing readable.
 * @param args.make - Makes one missing file. It also gives the cost of its calls,
 *   or `null` when it made no call.
 * @returns The contents of each file in the order of `files`, and the cost of the
 *   files that this invocation made. The cost is `null` when none made a call.
 * @throws The error that `unreadable` builds, when a saved file holds nothing readable.
 * @typeParam TFile - One file to read or make, with its path.
 * @typeParam TContent - The contents of one file.
 */
export async function readOrMakeSavedFiles<TFile extends { readonly path: string }, TContent>({
	files,
	label,
	concurrency,
	readSaved,
	unreadable,
	make,
}: SavedFileReader<TContent> & {
	readonly files: readonly TFile[];
	readonly label: string;
	readonly concurrency: number | undefined;
	readonly make: (
		file: TFile,
	) => Promise<{ readonly content: TContent; readonly cost: StageCost | null }>;
}): Promise<{ readonly contents: readonly TContent[]; readonly cost: StageCost | null }> {
	const progressBar = createParallelWorkBar({ label, total: files.length });
	progressBar.start();
	let outcomes: readonly { readonly content: TContent; readonly cost: StageCost | null }[];
	try {
		outcomes = await mapWithConcurrency({
			items: files,
			limit: concurrency,
			work: async ({ item: file, index }) => {
				const itemNumber = index + 1;
				const saved = await readSavedFile({ path: file.path, readSaved, unreadable });
				if (saved !== null) {
					progressBar.complete(itemNumber);
					return { content: saved, cost: null };
				}
				progressBar.pick(itemNumber);
				try {
					const made = await make(file);
					await writeJsonAtomic({ path: file.path, value: made.content });
					progressBar.complete(itemNumber);
					return made;
				} catch (error: unknown) {
					progressBar.fail(itemNumber);
					throw error;
				}
			},
		});
	} finally {
		progressBar.stop();
	}
	return {
		contents: outcomes.map((outcome) => outcome.content),
		cost: totalCost(outcomes.map((outcome) => outcome.cost)),
	};
}
