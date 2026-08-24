import type { Dirent } from "node:fs";
import { access, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { NamedError } from "./errors.js";

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
 * Thrown when a path derived from the run manifest or a stage's `filesWritten`
 * resolves outside the module tree. The manifest is untrusted input; this error
 * signals a corrupt or hand-edited manifest attempting to reach beyond
 * `moduleRoot` (technical-design.md §4.4).
 */
export class ManifestPathError extends NamedError {}

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
	readonly produce: (tmpPath: string) => Promise<void>;
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
 * Resolves an absolute path inside a workspace from trusted path segments. Used
 * for internal, code-supplied paths (e.g. a stage's own output directories); it
 * performs no boundary validation because the segments never originate from the
 * manifest or LLM output — untrusted paths must go through
 * {@link resolveManifestPath} instead (technical-design.md §4.3).
 *
 * @param args - The workspace root and the path segments to append to it.
 * @param args.workspaceRoot - Absolute path to the workspace root.
 * @param args.segments - Trusted path segments to append, in order.
 * @returns The joined absolute path.
 * @example
 * workspacePath({ workspaceRoot, segments: ["Audio", "audio.m4a"] });
 */
export function workspacePath({
	workspaceRoot,
	segments,
}: {
	readonly workspaceRoot: string;
	readonly segments: readonly string[];
}): string {
	return join(workspaceRoot, ...segments);
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

/**
 * Whether a filesystem error carries the `ENOENT` (not found) code.
 *
 * @param error - The caught error to inspect.
 * @returns `true` when the error is a Node `ENOENT` error.
 */
function isNotFoundError(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/**
 * Resolves an absolute, symlink-collapsed path for a candidate, whether or not
 * it exists yet. Existing paths resolve directly; a not-yet-created file
 * resolves its (existing) parent directory and re-appends the basename.
 *
 * @param candidate - The absolute path to resolve.
 * @returns The symlink-collapsed absolute path.
 */
async function realpathResolved(candidate: string): Promise<string> {
	try {
		return await realpath(candidate);
	} catch (error: unknown) {
		if (!isNotFoundError(error)) {
			throw error;
		}
		const parent = await realpath(dirname(candidate));
		return join(parent, basename(candidate));
	}
}

/**
 * Whether `target` is `ancestor` itself or nested beneath it.
 *
 * @param args - The two absolute paths to compare.
 * @param args.ancestor - The directory expected to contain `target`.
 * @param args.target - The path being tested.
 * @returns `true` when `target` is within `ancestor`.
 */
function isDescendant({
	ancestor,
	target,
}: {
	readonly ancestor: string;
	readonly target: string;
}): boolean {
	const rel = relative(ancestor, target);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * One untrusted manifest path together with the roots that bound it. Named so
 * that callers forwarding a path to {@link resolveManifestPath} state the shape
 * once rather than restating all three fields.
 */
export type ManifestPathQuery = {
	/** The workspace root the entry is relative to. */
	readonly workspaceRoot: string;
	/** The module root that bounds all pipeline output. */
	readonly moduleRoot: string;
	/** The untrusted `filesWritten` entry to resolve. */
	readonly entry: string;
};

/**
 * Resolves a manifest-derived path to an absolute location and asserts it stays
 * within `moduleRoot`, collapsing symlinks first so a symlinked escape is caught
 * (technical-design.md §4.4).
 *
 * @param query - The path to resolve and the roots that bound it, as {@link ManifestPathQuery} describes them.
 * @returns The absolute, symlink-collapsed path, guaranteed under `moduleRoot`.
 * @throws {@link ManifestPathError} when the entry resolves outside `moduleRoot`.
 */
export async function resolveManifestPath(query: ManifestPathQuery): Promise<string> {
	const candidate = resolve(query.workspaceRoot, query.entry);
	const resolved = await realpathResolved(candidate);
	const moduleRootReal = await realpath(query.moduleRoot);

	if (!isDescendant({ ancestor: moduleRootReal, target: resolved })) {
		throw new ManifestPathError(`Manifest path "${query.entry}" resolves outside the module root`);
	}
	return resolved;
}
