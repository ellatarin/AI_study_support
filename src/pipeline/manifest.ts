/**
 * Reading and writing a lecture's `manifest.json`.
 *
 * The manifest is the pipeline's single record of a lecture's identity, stage
 * states, and accumulated cost, and three separate callers touch it: Stage 0
 * creates and renumbers it, the runner patches a stage entry after every stage,
 * and the CLI's identity commands rewrite the lecture's title or date. Its
 * location and on-disk format live here so those callers share one definition
 * rather than each rebuilding the path and the JSON formatting
 * (technical-design.md §4.5).
 */

import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RunManifest } from "../types/pipeline.js";
import { writeFileAtomic } from "../utils/files.js";

/** The manifest's filename within a lecture workspace. */
const MANIFEST_FILE = "manifest.json";

/** Indentation applied to the persisted manifest, so it stays diff-friendly. */
const JSON_INDENT = 2;

/**
 * The absolute path of a workspace's manifest.
 *
 * @param args - The workspace to locate.
 * @param args.workspaceRoot - Absolute path to the lecture workspace folder.
 * @returns The absolute path to that workspace's `manifest.json`.
 */
export function manifestPath({ workspaceRoot }: { readonly workspaceRoot: string }): string {
	return join(workspaceRoot, MANIFEST_FILE);
}

/**
 * Reads a workspace's manifest, failing loudly when it cannot be read. Used
 * where the manifest's absence means the caller was handed a path that is not a
 * lecture workspace at all.
 *
 * @param args - The workspace to read.
 * @param args.workspaceRoot - Absolute path to the lecture workspace folder.
 * @returns The parsed manifest.
 * @throws Rethrows the filesystem error when the manifest is missing or unreadable, and the parse error when it is malformed.
 */
export async function readManifest({
	workspaceRoot,
}: {
	readonly workspaceRoot: string;
}): Promise<RunManifest> {
	return JSON.parse(await readFile(manifestPath({ workspaceRoot }), "utf8")) as RunManifest;
}

/**
 * Reads a workspace's manifest, returning `null` when it is missing or
 * malformed. Used where directories are scanned speculatively — a folder under
 * `Pipeline processing/` that holds no readable manifest is simply not a lecture,
 * which is a fact to skip over rather than an error to raise.
 *
 * @param args - The workspace to read.
 * @param args.workspaceRoot - Absolute path to the candidate workspace folder.
 * @returns The parsed manifest, or `null` when it cannot be read.
 */
export async function readManifestSafe({
	workspaceRoot,
}: {
	readonly workspaceRoot: string;
}): Promise<RunManifest | null> {
	try {
		return await readManifest({ workspaceRoot });
	} catch {
		return null;
	}
}

/**
 * Writes a workspace's manifest atomically, creating the workspace directory if
 * it does not yet exist. The atomic write means a crash mid-write leaves the
 * previous manifest intact rather than a truncated one (technical-design.md §4.3).
 *
 * @param args - The write inputs.
 * @param args.workspaceRoot - Absolute path to the lecture workspace folder.
 * @param args.manifest - The manifest to persist.
 * @returns A promise that resolves once the manifest is in place.
 */
export async function writeManifest({
	workspaceRoot,
	manifest,
}: {
	readonly workspaceRoot: string;
	readonly manifest: RunManifest;
}): Promise<void> {
	const path = manifestPath({ workspaceRoot });
	await mkdir(dirname(path), { recursive: true });
	await writeFileAtomic({ path, content: JSON.stringify(manifest, null, JSON_INDENT) });
}
