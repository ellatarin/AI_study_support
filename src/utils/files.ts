/**
 * Conveniences for the filesystem. They list a directory that may not exist,
 * test a path, and write a file that is never left half written
 * (technical-design.md §4.3). The check of a path from untrusted input is in
 * `src/pipeline/workspace-paths.ts` (§4.4).
 */

import type { Dirent } from "node:fs";
import { access, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Reads the entries of a directory, with the kind of each. A missing directory
 * gives `[]`, so a caller can read a directory that may not exist yet, such as
 * `Run logs/`, without a try/catch (technical-design.md §4.3).
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
 * Tells if a path exists, whatever kind of entry it is. It gives a value, not an
 * error, because each caller expects both answers.
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
 * Lists the names of the entries in a directory that pass a test, or `[]` when
 * the directory is missing.
 *
 * @param args - The directory to look in, and the test for the entries to keep.
 * @param args.dir - Absolute path to the directory to list.
 * @param args.matches - The test that tells if a directory entry belongs in the listing.
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
 * Lists the names of the files in a directory, or `[]` when the directory is
 * missing. The list does not include subdirectories or dotfiles.
 *
 * @param dir - Absolute path to the directory to list.
 * @returns The file names.
 */
export function listFileNames(dir: string): Promise<readonly string[]> {
	return readEntryNames({ dir, matches: (entry) => entry.isFile() && !entry.name.startsWith(".") });
}

/**
 * Lists the names of the subdirectories in a directory, or `[]` when the
 * directory is missing.
 *
 * @param dir - Absolute path to the directory to list.
 * @returns The subdirectory names.
 */
export function listSubdirectoryNames(dir: string): Promise<readonly string[]> {
	return readEntryNames({ dir, matches: (entry) => entry.isDirectory() });
}

/**
 * Writes a file atomically. The content goes to a `.tmp` file beside the target,
 * which is renamed to the target only after the write succeeds. So a crash
 * leaves a `.tmp` file, never a part of a file at the target
 * (technical-design.md §4.3).
 *
 * @param args - The destination path and the content to write.
 * @param args.path - The path to write to. The `.tmp` path is this path with the suffix.
 * @param args.content - The text or bytes to write.
 * @returns A promise that resolves once the file is in place.
 * @throws Rethrows any filesystem error after removing the partial `.tmp` file.
 * @example
 * await writeFileAtomic({ path: "notes.md", content: "# Notes" });
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- A Uint8Array is mutable through its index signature, and no wrapper type removes it. node:fs asks for this type for bytes. CLAUDE.md permits a mutable type that a library requires.
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
 * The suffix of a file while it is written. The atomic writes add it, and
 * {@link cleanTmpFiles} deletes the files that carry it. The two must agree, so
 * both read this one constant. `source-normalisation` uses a different suffix for
 * its renames (technical-design.md §4.3, and §5, `source-normalisation`).
 */
const TMP_SUFFIX = ".tmp";

/** The indentation of a JSON file, so that a diff of it stays easy to read. */
const JSON_INDENT = 2;

/**
 * Gives the text of a JSON file that the pipeline writes: indented, with a newline
 * at the end. A person reads these files, so they are indented.
 *
 * @param value - The value to serialise.
 * @returns The file's text.
 */
export function jsonFileContent(value: unknown): string {
	return `${JSON.stringify(value, null, JSON_INDENT)}\n`;
}

/**
 * Writes a value as JSON, atomically, in the format of {@link jsonFileContent}.
 * The manifest, the run logs and the saved runs are written with it
 * (technical-design.md §4.3).
 *
 * @param args - The destination and the value.
 * @param args.path - The path to write to. The `.tmp` path is this path with the suffix.
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
	return writeFileAtomic({ path, content: jsonFileContent(value) });
}

/**
 * A function that writes a file at the `.tmp` path that it gets. The file is
 * renamed to its target when the function resolves. The type has a name because
 * {@link produceFileAtomic} and the stage writer both use it (technical-design.md §4.3).
 */
export type ProduceFile = (tmpPath: string) => Promise<void>;

/**
 * Writes a file atomically when the caller does not hold the content, such as
 * when ffmpeg writes the audio in `audio-extraction`. `produce` writes the `.tmp`
 * file, which is renamed to the target only when `produce` resolves. A failure
 * removes the `.tmp` file (technical-design.md §4.3).
 *
 * @param args - The destination and the producer.
 * @param args.path - The target path. The `.tmp` path is this path with the suffix.
 * @param args.produce - Writes the file at the `.tmp` path that it gets.
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
 * Reads and parses a JSON file. A file that is missing, unreadable or not JSON
 * gives `null`, so the caller decides what such a file means. The value is
 * `unknown`, because the caller must check its shape (technical-design.md §4.3).
 *
 * @param path - Absolute path to the file to read.
 * @returns The parsed value, or `null` when the file is missing, unreadable or not JSON.
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
 * Deletes every `.tmp` file in a directory. Each stage run does this at its
 * start, to remove the files that a crash left (technical-design.md §4.3).
 *
 * @param dir - The directory to clean. Its subdirectories are not cleaned.
 * @returns A promise that resolves once the `.tmp` files are removed.
 */
export async function cleanTmpFiles(dir: string): Promise<void> {
	const entries = await readdir(dir);
	const tmpFiles = entries.filter((name) => name.endsWith(TMP_SUFFIX));
	await Promise.all(tmpFiles.map((name) => rm(join(dir, name), { force: true })));
}
