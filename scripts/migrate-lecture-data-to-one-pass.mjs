/**
 * Changes the data of a lecture workspace to the pipeline in which each stage
 * runs once (ADR 0003). It prints each change, and it changes no file without `--apply`.
 *
 *     pnpm exec tsx scripts/migrate-lecture-data-to-one-pass.mjs <workspace>… [--apply]
 *
 * It renames only the files that the manifest lists. So it does not touch a
 * `Checks` folder, a copied folder or a run log.
 */
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { MANIFEST_FILE } from "../src/pipeline/layout.ts";
import { writeJsonAtomic } from "../src/utils/files.ts";
import { isEntryPoint } from "./lib/entry-point.mjs";

/** The id of the transcript check, which ADR 0003 removes. */
const REMOVED_STAGE_ID = "check-rewrite-attempts";

/** The old name of a subtopic file. The first group is the path up to the attempt number. */
const ATTEMPT_FILE_PATH = /^(.*\/subtopic-\d+)-attempt-\d+\.json$/;

/**
 * Gives the new name of a subtopic file path. Any other path comes back unchanged.
 *
 * @param {string} path - A path from `filesWritten`.
 * @returns {string} The path with no attempt number.
 */
function newSubtopicFilePath(path) {
	return path.replace(ATTEMPT_FILE_PATH, "$1.json");
}

/**
 * Reads a JSON file.
 *
 * @param {string} path - The absolute path.
 * @returns {Promise<Record<string, unknown>>} The parsed file.
 */
async function readJson(path) {
	return JSON.parse(await readFile(path, "utf8"));
}

/**
 * Gives a copy of a record with no field of the given name.
 *
 * @param {object} options - The record, and the field to leave out.
 * @param {Record<string, unknown>} options.record - The record.
 * @param {string} options.field - The name of the field to leave out.
 * @returns {Record<string, unknown>} The copy.
 */
function withoutField({ record, field }) {
	return Object.fromEntries(Object.entries(record).filter(([key]) => key !== field));
}

/**
 * Gives a stage entry with no `round`, and each old subtopic file path renamed.
 *
 * @param {Record<string, unknown>} entry - The stage entry.
 * @returns {Record<string, unknown>} The new stage entry.
 */
function migrateStageEntry(entry) {
	const kept = withoutField({ record: entry, field: "round" });
	if (!Array.isArray(kept.filesWritten)) {
		return kept;
	}
	return { ...kept, filesWritten: kept.filesWritten.map(newSubtopicFilePath) };
}

/**
 * Lists the changes that one workspace needs, and makes them when `apply` is true.
 *
 * @param {object} options - The workspace, and whether to change it.
 * @param {string} options.workspaceRoot - The absolute path to the lecture workspace.
 * @param {boolean} options.apply - True to change the files. False to only list the changes.
 * @returns {Promise<string[]>} One line for each change, empty when the workspace needs none.
 */
export async function migrateWorkspace({ workspaceRoot, apply }) {
	const manifestPath = join(workspaceRoot, MANIFEST_FILE);
	const manifest = await readJson(manifestPath);
	const { [REMOVED_STAGE_ID]: removedEntry, ...keptStages } = manifest.stages;
	const changes =
		removedEntry === undefined
			? []
			: [`${MANIFEST_FILE}: remove the stage entry "${REMOVED_STAGE_ID}"`];
	const renames = [];
	for (const [stageId, entry] of Object.entries(keptStages)) {
		if (Object.hasOwn(entry, "round")) {
			changes.push(`${MANIFEST_FILE}: remove "round" from the stage entry "${stageId}"`);
		}
		for (const path of entry.filesWritten ?? []) {
			if (ATTEMPT_FILE_PATH.test(path)) {
				renames.push({ oldPath: path, newPath: newSubtopicFilePath(path) });
			}
		}
	}
	changes.push(
		...renames.map(({ oldPath, newPath }) => `${oldPath} → ${newPath}, without "attemptNumber"`),
	);
	if (apply && changes.length > 0) {
		for (const { oldPath, newPath } of renames) {
			const content = withoutField({
				record: await readJson(join(workspaceRoot, oldPath)),
				field: "attemptNumber",
			});
			await writeJsonAtomic({ path: join(workspaceRoot, newPath), value: content });
			await rm(join(workspaceRoot, oldPath));
		}
		const stages = Object.fromEntries(
			Object.entries(keptStages).map(([stageId, entry]) => [stageId, migrateStageEntry(entry)]),
		);
		await writeJsonAtomic({ path: manifestPath, value: { ...manifest, stages } });
	}
	return changes;
}

/** Reads the workspaces and `--apply` from the command line, and prints each change. */
async function main() {
	const args = process.argv.slice(2);
	const apply = args.includes("--apply");
	for (const workspaceRoot of args.filter((arg) => arg !== "--apply")) {
		const changes = await migrateWorkspace({ workspaceRoot, apply });
		console.log(
			`${workspaceRoot}\n${changes.map((change) => `    ${change}`).join("\n") || "    no change"}`,
		);
	}
	if (!apply) {
		console.log("Nothing changed. Run again with --apply to make these changes.");
	}
}

// A test suite imports this module, so the import must not run the migration.
if (isEntryPoint(import.meta.url)) {
	await main();
}
