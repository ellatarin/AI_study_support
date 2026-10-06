/**
 * The existing workspaces of a module, and the deletion of orphaned workspaces.
 * This is the only code that destroys a user's work for good
 * (technical-design.md §5, `source-normalisation`, 'Orphaned workspace handling').
 *
 * The code finds a workspace by the lecture date in its manifest, not by its
 * base name. So a renumbered lecture is still found.
 */

/* jscpd:ignore-start -- jscpd matches these imports with the first four imports of runner.ts, from `rm` on.
   Both modules delete files, join paths and log. An import is not logic, so nothing here can be extracted.
   The duplication floor stays where it is for code that can be extracted. */
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "pino";
import type { Manifest } from "../../../types/pipeline.js";
/* jscpd:ignore-end */
import { listSubdirectoryNames } from "../../../utils/files.js";
import { moduleDirs, workspaceRootFor } from "../../layout.js";
import { readManifestSafe } from "../../manifest.js";

/**
 * Asks the user to approve an action that cannot be undone, and returns the
 * answer. The CLI supplies it, so the stage never reads stdin itself
 * (technical-design.md §5, `source-normalisation`).
 */
export type ConfirmPrompt = (args: { readonly message: string }) => Promise<boolean>;

/** An existing workspace: its base name and its manifest. */
export type ExistingWorkspace = { readonly baseName: string; readonly manifest: Manifest };

/**
 * The result of the deletion confirmation: each orphaned workspace is deleted,
 * or the user declined a question. The result is returned, not thrown, so the
 * stage decides what a declined question means (technical-design.md §5,
 * `source-normalisation`).
 */
export type OrphanedWorkspaceOutcome =
	| { readonly state: "deleted" }
	| { readonly state: "declined"; readonly reason: string };

/**
 * Lists the workspaces of a module, keyed by the lecture date in each manifest.
 * A folder without a readable manifest is not a workspace, and the stage leaves
 * it alone.
 *
 * @param args - The module.
 * @param args.moduleRoot - The absolute path of the module.
 * @returns Each existing workspace, keyed by lecture date.
 */
export async function discoverWorkspaces({
	moduleRoot,
}: {
	readonly moduleRoot: string;
}): Promise<ReadonlyMap<string, ExistingWorkspace>> {
	const workspaces = new Map<string, ExistingWorkspace>();
	for (const baseName of await listSubdirectoryNames(moduleDirs({ moduleRoot }).processing)) {
		const manifest = await readManifestSafe({
			workspaceRoot: workspaceRootFor({ moduleRoot, baseName }),
		});
		if (manifest === null) {
			continue;
		}
		workspaces.set(manifest.lectureDate, { baseName, manifest });
	}
	return workspaces;
}

/**
 * Finds the orphaned workspaces: those whose lecture date has no source pair.
 * Their sources were deleted directly, not with the CLI (technical-design.md §5,
 * `source-normalisation`).
 *
 * @param args - The existing workspaces and the lecture dates that still have sources.
 * @param args.workspaces - The existing workspaces, keyed by lecture date.
 * @param args.presentLectureDates - The lecture dates that still have a video recording and a slide deck.
 * @returns The orphaned workspaces, in date order.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- a ReadonlyMap and a ReadonlySet are readonly, but the rule does not accept the built-in collection types as readonly. This function only reads them.
export function findOrphanedWorkspaces({
	workspaces,
	presentLectureDates,
}: {
	readonly workspaces: ReadonlyMap<string, ExistingWorkspace>;
	readonly presentLectureDates: ReadonlySet<string>;
}): readonly ExistingWorkspace[] {
	return [...workspaces.keys()]
		.filter((lectureDate) => !presentLectureDates.has(lectureDate))
		.sort()
		.map((lectureDate) => workspaces.get(lectureDate) as ExistingWorkspace);
}

/**
 * Builds the question for one orphaned workspace. The question names the lecture
 * by its number, title and date, so that the user can judge the deletion. The
 * question gives no cost (technical-design.md §5, `source-normalisation`).
 *
 * @param args - The lecture that the question is about.
 * @param args.manifest - The manifest of the orphaned workspace.
 * @returns The question to the user.
 */
function orphanedWorkspacePrompt({ manifest }: { readonly manifest: Manifest }): string {
	const title = manifest.lectureTitle === "" ? "(untitled)" : manifest.lectureTitle;
	return `Lecture ${manifest.lectureNumber} "${title}" (${manifest.lectureDate}) has no video recording or slide deck left. Delete its workspace and any final output?`;
}

/** The module, its PDFs and the logger, which each deletion uses. */
type OrphanedWorkspaceContext = {
	readonly moduleRoot: string;
	readonly existingPdfs: ReadonlyMap<string, string>;
	readonly logger: Logger;
};

/**
 * Deletes one approved orphaned workspace, with its manifest, and its PDF in the
 * final output folder. It logs the lecture number, title and date that the
 * deletion destroyed.
 *
 * @param args - The orphaned workspace and the locations of its files.
 * @param args.orphanedWorkspace - The orphaned workspace to delete.
 * @param args.moduleRoot - The absolute path of the module.
 * @param args.existingPdfs - The PDFs in the final output folder, keyed by lecture date.
 * @param args.logger - The logger of the stage.
 * @returns A promise that resolves when the workspace and the PDF are deleted.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- OrphanedWorkspaceContext holds pino's Logger and a ReadonlyMap. The Logger has mutable properties that the rule cannot ignore. The rule does not accept the ReadonlyMap as readonly. CLAUDE.md permits a mutable type that a library requires.
async function deleteOrphanedWorkspace({
	orphanedWorkspace,
	moduleRoot,
	existingPdfs,
	logger,
}: { readonly orphanedWorkspace: ExistingWorkspace } & OrphanedWorkspaceContext): Promise<void> {
	const { manifest } = orphanedWorkspace;
	await rm(workspaceRootFor({ moduleRoot, baseName: orphanedWorkspace.baseName }), {
		recursive: true,
		force: true,
	});
	const pdf = existingPdfs.get(manifest.lectureDate);
	if (pdf !== undefined) {
		await rm(join(moduleDirs({ moduleRoot }).finalOutput, pdf), { force: true });
	}
	logger.info(
		{
			baseName: orphanedWorkspace.baseName,
			lectureNumber: manifest.lectureNumber,
			lectureTitle: manifest.lectureTitle,
			lectureDate: manifest.lectureDate,
		},
		"Deleted orphaned workspace",
	);
}

/**
 * Runs the deletion confirmation. It asks once for each orphaned workspace, then
 * once for all of them. If the user declines any question, it deletes nothing.
 * So a source folder that was moved by mistake costs nothing
 * (technical-design.md §5, `source-normalisation`, 'Orphaned workspace handling').
 *
 * @param args - The orphaned workspaces, the locations of their files, and the dependencies.
 * @param args.orphanedWorkspaces - The orphaned workspaces. There is at least one.
 * @param args.moduleRoot - The absolute path of the module.
 * @param args.existingPdfs - The PDFs in the final output folder, keyed by lecture date.
 * @param args.logger - The logger of the stage.
 * @param args.confirm - The function that asks the user each question.
 * @returns `deleted`, or `declined` with the question that the user declined.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- OrphanedWorkspaceContext holds pino's Logger and a ReadonlyMap. The Logger has mutable properties that the rule cannot ignore. The rule does not accept the ReadonlyMap as readonly. CLAUDE.md permits a mutable type that a library requires.
export async function resolveOrphanedWorkspaces({
	orphanedWorkspaces,
	moduleRoot,
	existingPdfs,
	logger,
	confirm,
}: {
	readonly orphanedWorkspaces: readonly ExistingWorkspace[];
	readonly confirm: ConfirmPrompt;
} & OrphanedWorkspaceContext): Promise<OrphanedWorkspaceOutcome> {
	logger.info(
		{
			moduleRoot,
			orphanedWorkspaces: orphanedWorkspaces.map((orphanedWorkspace) => orphanedWorkspace.baseName),
		},
		"Lecture workspaces have no source files left",
	);

	for (const orphanedWorkspace of orphanedWorkspaces) {
		if (
			!(await confirm({
				message: orphanedWorkspacePrompt({ manifest: orphanedWorkspace.manifest }),
			}))
		) {
			return {
				state: "declined",
				reason: `deleting lecture ${orphanedWorkspace.manifest.lectureDate} was declined`,
			};
		}
	}

	const finalMessage = `Permanently delete ${orphanedWorkspaces.length} lecture workspace(s) and their final output? This cannot be undone.`;
	if (!(await confirm({ message: finalMessage }))) {
		return { state: "declined", reason: "the final confirmation was declined" };
	}

	for (const orphanedWorkspace of orphanedWorkspaces) {
		await deleteOrphanedWorkspace({ orphanedWorkspace, moduleRoot, existingPdfs, logger });
	}
	return { state: "deleted" };
}
