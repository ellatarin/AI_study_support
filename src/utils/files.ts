import { readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

/**
 * Thrown when a path derived from the run manifest or a stage's `filesWritten`
 * resolves outside the module tree. The manifest is untrusted input; this error
 * signals a corrupt or hand-edited manifest attempting to reach beyond
 * `moduleRoot` (technical-design.md §4.4).
 */
export class ManifestPathError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = "ManifestPathError";
	}
}

/**
 * Writes a file atomically: content is written to a `.tmp`-suffixed sibling and
 * renamed onto the target only after the write fully succeeds. A crash mid-write
 * therefore leaves a `.tmp` file, never a partial file at the real path
 * (technical-design.md §4.3).
 *
 * @param args - The destination path and the content to write.
 * @throws Rethrows any filesystem error after removing the partial `.tmp` file.
 * @example
 * await writeFileAtomic({ path: "notes.md", content: "# Notes" });
 */
export async function writeFileAtomic({
	path,
	content,
}: {
	readonly path: string;
	readonly content: string | Uint8Array;
}): Promise<void> {
	const tmpPath = `${path}.tmp`;
	try {
		await writeFile(tmpPath, content);
		await rename(tmpPath, path);
	} catch (error: unknown) {
		await rm(tmpPath, { force: true });
		throw error;
	}
}

/**
 * Deletes every `.tmp` file in a directory. Run at the start of a stage to clear
 * partial files left by a crashed previous run (technical-design.md §4.3).
 *
 * @param dir - The directory to scan; only its immediate `.tmp` entries are removed.
 */
export async function cleanTmpFiles(dir: string): Promise<void> {
	const entries = await readdir(dir);
	const tmpFiles = entries.filter((name) => name.endsWith(".tmp"));
	await Promise.all(tmpFiles.map((name) => rm(join(dir, name), { force: true })));
}

/** Whether a filesystem error carries the `ENOENT` (not found) code. */
function isNotFoundError(error: unknown): boolean {
	return error instanceof Error && (error as { readonly code?: unknown }).code === "ENOENT";
}

/**
 * Resolves an absolute, symlink-collapsed path for a candidate, whether or not
 * it exists yet. Existing paths resolve directly; a not-yet-created file
 * resolves its (existing) parent directory and re-appends the basename.
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

/** Whether `target` is `ancestor` itself or nested beneath it. */
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
 * Resolves a manifest-derived path to an absolute location and asserts it stays
 * within `moduleRoot`, collapsing symlinks first so a symlinked escape is caught
 * (technical-design.md §4.4).
 *
 * @param args - The workspace root the entry is relative to, the module root that
 * bounds all pipeline output, and the untrusted `filesWritten` entry.
 * @returns The absolute, symlink-collapsed path, guaranteed under `moduleRoot`.
 * @throws {@link ManifestPathError} when the entry resolves outside `moduleRoot`.
 */
export async function resolveManifestPath({
	workspaceRoot,
	moduleRoot,
	entry,
}: {
	readonly workspaceRoot: string;
	readonly moduleRoot: string;
	readonly entry: string;
}): Promise<string> {
	const candidate = resolve(workspaceRoot, entry);
	const resolved = await realpathResolved(candidate);
	const moduleRootReal = await realpath(moduleRoot);

	if (!isDescendant({ ancestor: moduleRootReal, target: resolved })) {
		throw new ManifestPathError(`Manifest path "${entry}" resolves outside the module root`);
	}
	return resolved;
}
