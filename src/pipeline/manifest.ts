/**
 * The reader and writer of a lecture's `manifest.json`. `source-normalisation`, the runner
 * and the CLI's identity-change commands all write the manifest. So its path and
 * its format are declared here once (technical-design.md §4.5).
 */

/* jscpd:ignore-start -- this file and `src/cli/args.ts` are the two places where
   a date enters the pipeline from outside. Both import the pipeline types, the
   date check and the error helpers.
   jscpd finds these imports as a copy of the same imports in `src/cli/args.ts`.
   Imports cannot be shared, and CLAUDE.md forbids barrel files (File
   Organisation). Only the imports are exempt. jscpd checks the code below as
   usual. */
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type Manifest, STAGE_IDS } from "../types/pipeline.js";
import { isCalendarDate } from "../utils/date.js";
import { errorMessage, NamedError } from "../utils/errors.js";
import { readJsonSafe, writeJsonAtomic } from "../utils/files.js";
import { isRecord } from "../utils/record.js";
import { MANIFEST_FILE } from "./layout.js";
/* jscpd:ignore-end */

/**
 * {@link readManifest} could not read the manifest file. The file is missing, or
 * the file system refused the read (technical-design.md §4.5).
 */
export class ManifestUnreadableError extends NamedError {}

/** {@link readManifest} read the manifest file, but the text is not JSON (technical-design.md §4.5). */
export class ManifestNotJsonError extends NamedError {}

/**
 * The manifest file is JSON, but it does not describe a lecture. Examples are
 * `{}`, `[]` and `null` (technical-design.md §4.5).
 */
export class ManifestShapeError extends NamedError {}

/**
 * The schema version in each manifest that the pipeline writes. It is here, beside
 * the format, so `source-normalisation` and the test fixtures write the same
 * version (technical-design.md §4.5).
 */
export const MANIFEST_VERSION = "1";

/**
 * A stage map with each stage `pending`, as `source-normalisation` writes it for a
 * new workspace. It is here so `source-normalisation` and the test fixtures make
 * the same map (technical-design.md §4.5).
 *
 * The cast is necessary because `Object.fromEntries` gives `string` keys. The keys
 * come from `STAGE_IDS`, so each key is a stage id.
 *
 * @returns A new stage map on each call.
 */
export function pendingStages(): Manifest["stages"] {
	const entries = STAGE_IDS.map((stageId) => [stageId, { status: "pending" }] as const);
	return Object.fromEntries(entries) as Manifest["stages"];
}

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
 * Reads a workspace's manifest, and throws when it cannot. Callers use it when the
 * path must be a lecture workspace.
 *
 * It checks the parsed value with the same {@link isManifest} as
 * {@link readManifestSafe}. Each failure has its own error type, so a caller can
 * tell which failure occurred (technical-design.md §4.5).
 *
 * @param args - The workspace to read.
 * @param args.workspaceRoot - Absolute path to the lecture workspace folder.
 * @returns The manifest.
 * @throws {ManifestUnreadableError} When the file is missing or the file system refuses the read.
 * @throws {ManifestNotJsonError} When the text is not JSON.
 * @throws {ManifestShapeError} When the JSON does not describe a lecture.
 */
export async function readManifest({
	workspaceRoot,
}: {
	readonly workspaceRoot: string;
}): Promise<Manifest> {
	const path = manifestPath({ workspaceRoot });
	const parsed = parseManifest({ path, contents: await readManifestFile(path) });
	if (!isManifest(parsed)) {
		throw new ManifestShapeError(`${path} is not a lecture manifest`);
	}
	return parsed;
}

/**
 * Reads the text of the manifest file.
 *
 * @param path - Absolute path to the manifest file.
 * @returns The file's contents.
 * @throws {ManifestUnreadableError} When the file cannot be read.
 */
async function readManifestFile(path: string): Promise<string> {
	try {
		return await readFile(path, "utf8");
	} catch (error: unknown) {
		throw new ManifestUnreadableError(`${path} could not be read: ${errorMessage(error)}`);
	}
}

/**
 * Parses the text of the manifest file.
 *
 * @param args - The file and its text.
 * @param args.path - Absolute path to the manifest file, for the error message.
 * @param args.contents - The text of the file.
 * @returns The parsed value, which is not yet checked as a manifest.
 * @throws {ManifestNotJsonError} When the text does not parse as JSON.
 */
function parseManifest({
	path,
	contents,
}: {
	readonly path: string;
	readonly contents: string;
}): unknown {
	try {
		return JSON.parse(contents);
	} catch (error: unknown) {
		throw new ManifestNotJsonError(`${path} is not valid JSON: ${errorMessage(error)}`);
	}
}

/**
 * Tells if a parsed `manifest.json` describes a lecture. The check is shallow. It
 * reads only `lectureNumber`, `lectureDate` and `stages`, which each caller that
 * lists the workspaces reads next. A manifest with imperfect stage entries still
 * describes a lecture (technical-design.md §4.5).
 *
 * The lecture date must also be a calendar date. Each lookup finds a lecture by
 * its date, so a date in another form would match nothing and cause no error. The
 * command line is the other place where a date enters the pipeline, and it uses
 * the same {@link isCalendarDate}.
 *
 * @param value - The parsed file contents.
 * @returns `true` when the value describes a lecture.
 */
function isManifest(value: unknown): value is Manifest {
	if (!isRecord(value)) {
		return false;
	}
	return (
		typeof value.lectureNumber === "number" &&
		typeof value.lectureDate === "string" &&
		isCalendarDate(value.lectureDate) &&
		isRecord(value.stages)
	);
}

/**
 * Reads a workspace's manifest. It gives `null` when the file is missing, is not
 * JSON or does not describe a lecture. Callers use it when they list folders that
 * may not be lectures (technical-design.md §4.5).
 *
 * @param args - The workspace to read.
 * @param args.workspaceRoot - Absolute path to the folder that may be a workspace.
 * @returns The manifest, or `null` when the folder is not a lecture.
 */
export async function readManifestSafe({
	workspaceRoot,
}: {
	readonly workspaceRoot: string;
}): Promise<Manifest | null> {
	const parsed = await readJsonSafe(manifestPath({ workspaceRoot }));
	return isManifest(parsed) ? parsed : null;
}

/**
 * Writes a workspace's manifest atomically, and makes the workspace folder if it
 * does not exist. If the invocation stops during the write, the earlier manifest
 * stays complete (technical-design.md §4.3).
 *
 * @param args - The workspace and the manifest.
 * @param args.workspaceRoot - Absolute path to the lecture workspace folder.
 * @param args.manifest - The manifest to write.
 * @returns A promise that resolves when the manifest is written.
 */
export async function writeManifest({
	workspaceRoot,
	manifest,
}: {
	readonly workspaceRoot: string;
	readonly manifest: Manifest;
}): Promise<void> {
	const path = manifestPath({ workspaceRoot });
	await mkdir(dirname(path), { recursive: true });
	await writeJsonAtomic({ path, value: manifest });
}

/**
 * Puts changes on a lecture's manifest, sets `updatedAt` and writes the changed manifest.
 * The runner uses it after each stage, and the CLI's `rename` and `change-date`
 * use it. So each of these edits sets `updatedAt` (technical-design.md §4.5).
 *
 * The caller gives the instant. The runner gives the instant of the stage entry,
 * so the manifest and its stage entry record the same moment.
 *
 * @param args - The manifest, the changes and the instant.
 * @param args.workspaceRoot - Absolute path to the lecture workspace folder.
 * @param args.manifest - The manifest before the changes.
 * @param args.changes - The fields to put on the manifest.
 * @param args.updatedAt - The instant of the change, as ISO 8601.
 * @returns The manifest as written.
 */
export async function patchManifest({
	workspaceRoot,
	manifest,
	changes,
	updatedAt,
}: {
	readonly workspaceRoot: string;
	readonly manifest: Manifest;
	readonly changes: Partial<Manifest>;
	readonly updatedAt: string;
}): Promise<Manifest> {
	const updated: Manifest = { ...manifest, ...changes, updatedAt };
	await writeManifest({ workspaceRoot, manifest: updated });
	return updated;
}
