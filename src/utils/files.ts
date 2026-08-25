/**
 * Conveniences over the filesystem: listing a directory that may not exist,
 * asking whether a path is there, and writing a file without ever leaving half
 * of one behind (technical-design.md §4.3).
 *
 * Every one of these is a convenience in the strict sense — the cost of getting
 * one wrong is an inconvenience. Deciding whether a path derived from untrusted
 * input may be touched at all is a different kind of question and lives apart,
 * in `src/pipeline/workspace-paths.ts` (§4.4).
 */

import type { Dirent } from "node:fs";
import { access, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Reads a directory's entries with file-type info, returning `[]` when the
 * directory does not exist. Wraps `readdir` so callers can scan optional
 * directories (a workspace's `runs/`, a module's `Final output/`) without a
 * try/catch at every call site.
 *
 * @param dir - Absolute path to the directory to read.
 * @returns The directory entries, or `[]` when the directory is missing.
 */
export async function readDirSafe(dir: string): Promise<readonly Dirent[]> {
	try {
		return await readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}
}

/**
 * Whether a path exists on disk, whatever kind of entry it is.
 *
 * Phrased as a question rather than as a thrown error because every caller is
 * choosing between two ordinary outcomes — a stage output that still exists or
 * has been deleted, a lecture PDF that has been produced or has not yet.
 *
 * @param path - The absolute path to test.
 * @returns `true` when the path is reachable.
 */
export async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * The names of a directory's entries that a listing wants, or `[]` when the
 * directory is missing. The two public listings below differ only in which
 * entries they keep, so the read and the mapping to names are stated once here.
 *
 * @param args - Where to look, and which entries to keep.
 * @param args.dir - Absolute path to the directory to list.
 * @param args.matches - Whether a directory entry belongs in the listing.
 * @returns The matching entries' names.
 */
async function readEntryNames({
	dir,
	matches,
}: {
	readonly dir: string;
	readonly matches: (entry: Readonly<Dirent>) => boolean;
}): Promise<readonly string[]> {
	return (await readDirSafe(dir)).filter(matches).map((entry) => entry.name);
}

/**
 * Lists the real file names in a directory (excluding subdirectories and
 * dotfiles), or `[]` when the directory is missing.
 *
 * @param dir - Absolute path to the directory to list.
 * @returns The non-dotfile file names.
 */
export function listFileNames(dir: string): Promise<readonly string[]> {
	return readEntryNames({ dir, matches: (entry) => entry.isFile() && !entry.name.startsWith(".") });
}

/**
 * Lists the immediate subdirectory names of a directory, or `[]` when it is
 * missing.
 *
 * @param dir - Absolute path to the directory to list.
 * @returns The subdirectory names.
 */
export function listSubdirectoryNames(dir: string): Promise<readonly string[]> {
	return readEntryNames({ dir, matches: (entry) => entry.isDirectory() });
}

/**
 * Writes a file atomically: content is written to a `.tmp`-suffixed sibling and
 * renamed onto the target only after the write fully succeeds. A crash mid-write
 * therefore leaves a `.tmp` file, never a partial file at the real path
 * (technical-design.md §4.3).
 *
 * @param args - The destination path and the content to write.
 * @param args.path - The final path to write to; the `.tmp` sibling is derived from it.
 * @param args.content - The text or bytes to write.
 * @returns A promise that resolves once the file is in place.
 * @throws Rethrows any filesystem error after removing the partial `.tmp` file.
 * @example
 * await writeFileAtomic({ path: "notes.md", content: "# Notes" });
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- Uint8Array is mutable through its index signature, which no wrapper type removes, and it is the byte payload node:fs itself asks for (CLAUDE.md permits dropping readonly where a library requires a mutable type)
export function writeFileAtomic({
	path,
	content,
}: {
	readonly path: string;
	readonly content: string | Uint8Array;
}): Promise<void> {
	return produceFileAtomic({ path, produce: (tmpPath) => writeFile(tmpPath, content) });
}

/**
 * The suffix an in-progress write carries until it is renamed into place.
 *
 * The atomic write and the sweep that clears what a crash left behind are the
 * two halves of one convention, and only agreement between them makes it work: a
 * writer using a suffix the sweep does not recognise leaves its debris for ever,
 * and a sweep recognising one the writer does not use deletes nothing. Stage 0's
 * rename uses a suffix of its own deliberately, and says why — a `.tmp` there
 * would name a complete file mid-move rather than a partial one, and this sweep
 * would delete it (technical-design.md §4.3, §5 Stage 0).
 */
const TMP_SUFFIX = ".tmp";

/** Indentation applied to every JSON file the pipeline writes, so they stay diff-friendly. */
const JSON_INDENT = 2;

/**
 * Writes a value as indented JSON, atomically.
 *
 * Every JSON file the pipeline persists — the lecture manifest and the run logs —
 * is read by a human before it is read by anything else, so they are all
 * formatted the same way. Both writers went through {@link writeFileAtomic} and
 * each stated the indentation for itself, which is the one thing about the format
 * neither of them owns; it is settled here instead (technical-design.md §4.3).
 *
 * @param args - The destination and the value.
 * @param args.path - The final path to write to; the `.tmp` sibling is derived from it.
 * @param args.value - The value to serialise.
 * @returns A promise that resolves once the file is in place.
 * @throws Rethrows any filesystem error after removing the partial `.tmp` file.
 * @example
 * await writeJsonAtomic({ path: manifestPath, value: manifest });
 */
export function writeJsonAtomic({
	path,
	value,
}: {
	readonly path: string;
	readonly value: unknown;
}): Promise<void> {
	return writeFileAtomic({ path, content: JSON.stringify(value, null, JSON_INDENT) });
}

/**
 * Fills the `.tmp` path it is given. The file is renamed onto its real target
 * once this resolves, so a producer that rejects leaves nothing behind.
 *
 * Named because both parties to the convention state it — {@link
 * produceFileAtomic} here, and the stage-level writer that reaches it — and a
 * signature written at each end can change at one.
 */
export type ProduceFile = (tmpPath: string) => Promise<void>;

/**
 * The general form of {@link writeFileAtomic}, for output a caller produces
 * rather than supplies: `produce` is handed the `.tmp` path to create, and the
 * result is renamed onto the target only once it resolves. A failure removes the
 * partial `.tmp` and rethrows, so the real path never holds partial output
 * (technical-design.md §4.3).
 *
 * Used where the bytes come from a subprocess rather than from memory — Stage 1
 * has ffmpeg write the audio track directly to the `.tmp` sibling.
 *
 * @param args - The destination and the producer.
 * @param args.path - The final path; the `.tmp` sibling is derived from it.
 * @param args.produce - Creates the file at the `.tmp` path it is given.
 * @returns A promise that resolves once the file is in place.
 * @throws Rethrows any error from `produce` after removing the partial `.tmp` file.
 * @example
 * await produceFileAtomic({ path: audioPath, produce: (tmpPath) => extract(tmpPath) });
 */
export async function produceFileAtomic({
	path,
	produce,
}: {
	readonly path: string;
	readonly produce: ProduceFile;
}): Promise<void> {
	const tmpPath = `${path}${TMP_SUFFIX}`;
	try {
		await produce(tmpPath);
		await rename(tmpPath, path);
	} catch (error: unknown) {
		await rm(tmpPath, { force: true });
		throw error;
	}
}

/**
 * Reads and parses a JSON file, answering `null` when it is missing, unreadable,
 * or not JSON at all.
 *
 * The read half of {@link writeJsonAtomic}, and it answers with a value rather
 * than a throw for the same reason the directory reads below do: both callers
 * are scanning speculatively — the runner over whatever `runs/` happens to hold,
 * the manifest reader over a folder that may not be a lecture — and neither has
 * anything to say about a file it cannot read beyond skipping it.
 *
 * The parsed value is `unknown`: what the file was supposed to hold is the
 * caller's claim to make, and it is one a parse cannot check.
 *
 * @param path - Absolute path to the file to read.
 * @returns The parsed value, or `null` when there is none to be had.
 * @example
 * const parsed = await readJsonSafe(runLogPath);
 */
export async function readJsonSafe(path: string): Promise<unknown> {
	try {
		const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
		return parsed;
	} catch {
		return null;
	}
}

/**
 * Deletes every `.tmp` file in a directory. Run at the start of a stage to clear
 * partial files left by a crashed previous run (technical-design.md §4.3).
 *
 * @param dir - The directory to scan; only its immediate `.tmp` entries are removed.
 * @returns A promise that resolves once the `.tmp` files are removed.
 */
export async function cleanTmpFiles(dir: string): Promise<void> {
	const entries = await readdir(dir);
	const tmpFiles = entries.filter((name) => name.endsWith(TMP_SUFFIX));
	await Promise.all(tmpFiles.map((name) => rm(join(dir, name), { force: true })));
}
