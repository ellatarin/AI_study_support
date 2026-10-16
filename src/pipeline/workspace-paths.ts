/**
 * This module resolves each path from a manifest, and refuses a path outside the
 * module tree (technical-design.md §4.4). A corrupt or hand-edited manifest can
 * contain such a path. The module is apart from `src/utils/files.ts`, because a
 * mistake here lets a path escape the module tree.
 */

import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { NamedError } from "../utils/errors.js";

/**
 * {@link resolveManifestPath} throws this error when the resolved path of a
 * manifest entry is outside the module tree. Then the manifest is corrupt, or a
 * person edited it by hand (technical-design.md §4.4).
 */
export class ManifestPathError extends NamedError {}

/**
 * Checks that a file system error has the `ENOENT` (not found) code.
 *
 * @param error - The caught error.
 * @returns `true` when the error is a Node `ENOENT` error.
 */
function isNotFoundError(error: unknown): boolean {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/**
 * Resolves an absolute path with its symbolic links followed, also when the path
 * does not exist yet. For a file that does not exist, the function resolves the
 * parent folder and adds the file name again.
 *
 * @param candidate - The absolute path to resolve.
 * @returns The absolute path, with symbolic links followed.
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
 * Checks that `target` is `ancestor` or is in it.
 *
 * @param args - The two absolute paths.
 * @param args.ancestor - The folder that must hold `target`.
 * @param args.target - The path to test.
 * @returns `true` when `target` is in `ancestor`.
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
 * {@link resolveManifestPath} takes one untrusted path from a manifest, and the
 * two roots that limit it (technical-design.md §4.4).
 */
export type ManifestPathQuery = {
	/** The manifest entry is relative to this workspace root. */
	readonly workspaceRoot: string;
	/** The resolved path must be in this module root. */
	readonly moduleRoot: string;
	/** This untrusted path is one entry of the manifest's `filesWritten`. */
	readonly entry: string;
};

/**
 * Resolves a path from a manifest to an absolute path, and makes sure that it is
 * in `moduleRoot`. The function follows symbolic links first, so it also catches
 * a link to a path outside the tree (technical-design.md §4.4).
 *
 * @param query - The path and the roots that limit it.
 * @returns The absolute path, with symbolic links followed. It is always in `moduleRoot`.
 * @throws {@link ManifestPathError} When the entry resolves outside `moduleRoot`.
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
