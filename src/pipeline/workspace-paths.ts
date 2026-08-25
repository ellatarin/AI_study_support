/**
 * Turning a path into a place on disk it is safe to touch.
 *
 * Two doors, because a path arrives from one of two kinds of place and the
 * difference decides what has to be proved about it. Segments the code supplies
 * are trusted and are simply joined onto the workspace. An entry read back out
 * of a lecture's manifest, or named by a model, is not: a corrupt or hand-edited
 * manifest must never be able to delete, overwrite or observe a file outside the
 * module tree, so such an entry is resolved, its symlinks collapsed, and its
 * final location proved to be inside `moduleRoot` before anything acts on it
 * (technical-design.md §4.4).
 *
 * This lives apart from the filesystem conveniences in `src/utils/files.ts`
 * because it differs from them in kind rather than in subject. Listing a
 * directory or writing a file without leaving half of one are conveniences: the
 * cost of a mistake is an inconvenience. This is the one place in the pipeline
 * where the cost of a mistake is a path escaping the tree the user pointed us
 * at, so it is worth being able to read, review and change on its own.
 */

import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { NamedError } from "../utils/errors.js";

/**
 * Thrown when a path derived from the run manifest or a stage's `filesWritten`
 * resolves outside the module tree. The manifest is untrusted input; this error
 * signals a corrupt or hand-edited manifest attempting to reach beyond
 * `moduleRoot` (technical-design.md §4.4).
 */
export class ManifestPathError extends NamedError {}

/**
 * Resolves an absolute path inside a workspace from trusted path segments.
 *
 * The trusted door. Used for internal, code-supplied paths — a stage's own
 * output directories, say — and it performs no boundary check because the
 * segments never originate from the manifest or from a model's reply. Anything
 * that does must go through {@link resolveManifestPath} instead
 * (technical-design.md §4.3).
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
 * The untrusted door: resolves a manifest-derived path to an absolute location
 * and asserts it stays within `moduleRoot`, collapsing symlinks first so a
 * symlinked escape is caught (technical-design.md §4.4).
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
