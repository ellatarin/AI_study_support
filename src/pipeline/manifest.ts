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
import { readJsonSafe, writeJsonAtomic } from "../utils/files.js";
import { isRecord } from "../utils/record.js";
import { MANIFEST_FILE } from "./layout.js";

/**
 * The schema version stamped into every manifest this pipeline writes.
 *
 * It belongs beside the read and write it describes, because the two parties that
 * put a version into a manifest — Stage 0, which creates one, and the fixtures,
 * which seed one for every suite — would otherwise each hold their own copy, and
 * nothing reads `version` back to notice they had diverged. Bumping it here bumps
 * what the suites seed, which is the only way a future migration gets tested
 * against the version it is migrating from (technical-design.md §4.5).
 */
export const MANIFEST_VERSION = "1";

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
 * Whether a parsed `manifest.json` is a lecture's manifest.
 *
 * Deliberately shallow: it answers the question a speculative scan is asking —
 * *is this folder a lecture?* — from the three fields every scanning caller then
 * reads. A file that parses as JSON but carries none of them (`{}`, `[]`, a bare
 * number) is not a manifest, whereas one whose stage entries are imperfect still
 * describes a lecture and is left to the caller reading them.
 *
 * @param value - The parsed file contents.
 * @returns `true` when the value identifies a lecture.
 */
function isRunManifest(value: unknown): value is RunManifest {
	if (!isRecord(value)) {
		return false;
	}
	return (
		typeof value.lectureNumber === "number" &&
		typeof value.lectureDate === "string" &&
		isRecord(value.stages)
	);
}

/**
 * Reads a workspace's manifest, returning `null` when it is missing, malformed,
 * or not a manifest at all. Used where directories are scanned speculatively — a
 * folder under `Pipeline processing/` that holds no readable manifest is simply
 * not a lecture, which is a fact to skip over rather than an error to raise.
 *
 * Malformed covers more than a parse failure: a `manifest.json` holding `{}` or
 * `[]` parses perfectly and is still not a lecture, so the parsed value is put
 * through {@link isRunManifest} before it is handed back as one.
 *
 * @param args - The workspace to read.
 * @param args.workspaceRoot - Absolute path to the candidate workspace folder.
 * @returns The parsed manifest, or `null` when the folder is not a lecture.
 */
export async function readManifestSafe({
	workspaceRoot,
}: {
	readonly workspaceRoot: string;
}): Promise<RunManifest | null> {
	const parsed = await readJsonSafe(manifestPath({ workspaceRoot }));
	return isRunManifest(parsed) ? parsed : null;
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
	await writeJsonAtomic({ path, value: manifest });
}

/**
 * Lays changes over a lecture's manifest, records when they were made, and
 * writes the result.
 *
 * Every party that edits a manifest does the same three things — spread what is
 * there, lay the changes over it, stamp `updatedAt` — and the runner after each
 * stage, the CLI's `rename` and its `change-date` each did all three for
 * themselves. An editor that forgot the third would leave a manifest claiming
 * nothing had happened to it (technical-design.md §4.5).
 *
 * The instant is the caller's to give rather than read here, because the runner's
 * is not simply "now": it stamps the same instant it writes into the stage entry,
 * so the manifest and the entry inside it name one moment.
 *
 * @param args - The manifest, what to change about it, and when.
 * @param args.workspaceRoot - Absolute path to the lecture workspace folder.
 * @param args.manifest - The manifest as it currently stands.
 * @param args.changes - The fields to lay over it.
 * @param args.updatedAt - The instant the change was made, ISO 8601.
 * @returns The manifest as written.
 */
export async function patchManifest({
	workspaceRoot,
	manifest,
	changes,
	updatedAt,
}: {
	readonly workspaceRoot: string;
	readonly manifest: RunManifest;
	readonly changes: Partial<RunManifest>;
	readonly updatedAt: string;
}): Promise<RunManifest> {
	const updated: RunManifest = { ...manifest, ...changes, updatedAt };
	await writeManifest({ workspaceRoot, manifest: updated });
	return updated;
}
