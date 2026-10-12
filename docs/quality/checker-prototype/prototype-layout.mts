/**
 * The paths of the checker prototype: where the project and the lectures are,
 * and where each run of a model and a prompt version writes its results.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { moduleDirs } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/pipeline/layout.js";

/** The project. The path is in the form that the symlink from /Users/ellatarin keeps valid on both machines. */
export const PROJECT_ROOT = "/Users/ellatarin/my_repositories/Ella_AI_project";

/** The pipeline stage whose checker the prototype runs. */
export const CHECK_STAGE_ID = "check-rewrite-attempts";

/** The module whose lectures the trials read. */
const MODULE_ROOT = "/Users/ellatarin/Lecture Notes/Biology of Disease";

/**
 * Finds the workspace of a lecture from its date.
 *
 * @param lecture - The date of the lecture, such as "2026-03-04".
 * @returns The absolute path of the workspace.
 * @throws Error when no single workspace ends with the date.
 */
export async function workspaceOf(lecture: string): Promise<string> {
	const { processing } = moduleDirs({ moduleRoot: MODULE_ROOT });
	const found = (await readdir(processing)).filter((name) => name.endsWith(` - ${lecture}`));
	if (found.length !== 1 || found[0] === undefined) {
		throw new Error(`Expected one workspace for ${lecture} in ${processing}, found ${found.length}`);
	}
	return join(processing, found[0]);
}

/** The folder that holds every run, beside the scripts. */
const RUNS_DIR = join(import.meta.dirname, "runs");

/**
 * Gives the folder of the runs on one rewrites folder of one lecture.
 *
 * @param args - The lecture and the rewrites folder.
 * @param args.lecture - The date of the lecture, such as "2026-03-04".
 * @param args.rewrites - The name of the rewrites folder, such as "Rewrites (sonnet-5.5, w1)".
 * @returns The absolute path.
 */
export function rewritesRunsFolder({
	lecture,
	rewrites,
}: {
	readonly lecture: string;
	readonly rewrites: string;
}): string {
	return join(RUNS_DIR, lecture, rewrites);
}

/**
 * Gives the folder of one run: one model with one prompt version, named by the
 * model's short name and the version, such as "gemini-3.8-flash c3". A check by
 * paragraph adds "by paragraph", a set reasoning effort adds "effort" and the
 * effort, and a repeat run adds its number, such as
 * "gemini-3.8-flash c3 by paragraph effort high run 2".
 *
 * @param args - The lecture, the rewrites folder, the model, the version, the run number, the unit of the check and the reasoning effort.
 * @param args.lecture - The date of the lecture.
 * @param args.rewrites - The name of the rewrites folder.
 * @param args.modelId - The OpenRouter model id, such as "google/gemini-3.8-flash".
 * @param args.version - The prompt version, such as "c3".
 * @param args.runNumber - The number of the run of this model and version, from 1.
 * @param args.byParagraph - Whether the checker gets one part of a subtopic at a time.
 * @param args.effort - The reasoning effort that each call asks for, or null for the model's default.
 * @returns The absolute path.
 */
export function checkRunFolder({
	modelId,
	version,
	runNumber,
	byParagraph,
	effort,
	...rewritesFolder
}: {
	readonly lecture: string;
	readonly rewrites: string;
	readonly modelId: string;
	readonly version: string;
	readonly runNumber: number;
	readonly byParagraph: boolean;
	readonly effort: string | null;
}): string {
	const unit = byParagraph ? " by paragraph" : "";
	const setEffort = effort === null ? "" : ` effort ${effort}`;
	const repeat = runNumber === 1 ? "" : ` run ${runNumber}`;
	return join(
		rewritesRunsFolder(rewritesFolder),
		`${modelId.split("/").pop() ?? modelId} ${version}${unit}${setEffort}${repeat}`,
	);
}

/**
 * Gives the cuts file of one rewrites folder of one lecture: the parts of each
 * subtopic's text, one for each rewrite paragraph.
 *
 * @param args - The lecture and the rewrites folder.
 * @param args.lecture - The date of the lecture, such as "2026-03-04".
 * @param args.rewrites - The name of the rewrites folder, such as "Rewrites (sonnet-5.5, w1)".
 * @returns The absolute path.
 */
export function splitsFile({ lecture, rewrites }: { readonly lecture: string; readonly rewrites: string }): string {
	return join(import.meta.dirname, "splits", lecture, `${rewrites}.json`);
}

/**
 * Gives the name of the result file of one subtopic in a run folder.
 *
 * @param subtopicId - The subtopic.
 * @returns The file name.
 */
export function subtopicResultFile(subtopicId: number): string {
	return `subtopic-${subtopicId}.json`;
}
