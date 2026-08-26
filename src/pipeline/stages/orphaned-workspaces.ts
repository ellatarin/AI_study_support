/**
 * The lecture workspaces already on disk, and discarding the ones whose sources
 * have gone.
 *
 * A workspace records which lecture it belongs to, so a lecture that has been
 * renumbered is still found by the date its manifest carries rather than by the
 * folder name it happens to have. When a run finds a workspace whose date has no
 * source video and slide left, the user deleted those sources by hand, and the
 * work already paid for is about to become unreachable.
 *
 * This is the only code in the project that permanently destroys a user's work,
 * so it asks first: once per lecture, then once more for the batch, and it is
 * all or nothing. Declining any one question leaves every workspace where it is.
 * A whole source folder moved by mistake therefore costs nothing, which a
 * "delete the ones you approved" reading would not give.
 *
 * See technical-design.md §5, Stage 0.
 */

/* jscpd:ignore-start -- these first lines are character-for-character runner.ts's, because both modules
   delete files, join paths and log. Nothing here can be extracted: an import is not logic. The duplication
   floor stays where it is for code that could be. */
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "pino";
import type { RunManifest } from "../../types/pipeline.js";
/* jscpd:ignore-end */
import { listSubdirectoryNames } from "../../utils/files.js";
import { moduleDirs, workspaceRootFor } from "../layout.js";
import { readManifestSafe } from "../manifest.js";

/**
 * Asks the user to approve an irreversible action, returning their answer. The
 * CLI backs this with `@inquirer/prompts`; tests stub it. Injected rather than
 * imported so Stage 0 never reaches for stdin itself (technical-design.md §5,
 * Stage 0).
 */
export type ConfirmPrompt = (args: { readonly message: string }) => Promise<boolean>;

/** An existing lecture workspace, discovered by its manifest's date. */
export type ExistingWorkspace = { readonly folder: string; readonly manifest: RunManifest };

/**
 * What the deletion protocol concluded: every orphan gone, or the question the
 * user said no to.
 *
 * The refusal is returned rather than thrown so this module owes nothing to the
 * stage that drives it — the stage owns what aborting a run means and says so in
 * its own error.
 */
export type OrphanOutcome =
	| { readonly state: "deleted" }
	| { readonly state: "declined"; readonly reason: string };

/**
 * Maps each existing lecture workspace to its folder name by reading its
 * manifest's `lectureDate`, so a renumbered lecture can be found by date.
 *
 * A folder with no readable manifest is not a lecture workspace this run knows
 * about, and is left alone.
 *
 * @param args - The module to look in.
 * @param args.moduleRoot - Absolute path to the module directory.
 * @returns A map of `lectureDate` → existing workspace (folder name and manifest).
 */
export async function discoverWorkspaces({
	moduleRoot,
}: {
	readonly moduleRoot: string;
}): Promise<ReadonlyMap<string, ExistingWorkspace>> {
	const workspaces = new Map<string, ExistingWorkspace>();
	for (const folder of await listSubdirectoryNames(moduleDirs({ moduleRoot }).processing)) {
		const manifest = await readManifestSafe({
			workspaceRoot: workspaceRootFor({ moduleRoot, folderName: folder }),
		});
		if (manifest === null) {
			continue;
		}
		workspaces.set(manifest.lectureDate, { folder, manifest });
	}
	return workspaces;
}

/**
 * The workspaces whose lecture date no longer has a source pair present. Their
 * sources were deleted directly rather than through the CLI, so Stage 0 must ask
 * before discarding the work (technical-design.md §5, Stage 0).
 *
 * @param args - The discovered workspaces and the dates still backed by sources.
 * @param args.workspaces - Existing workspaces keyed by lecture date.
 * @param args.presentIsos - The ISO dates that still have a video and slide.
 * @returns The orphaned workspaces, in date order.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- a ReadonlyMap and a ReadonlySet are already the readonly form; the rule does not recognise the built-in collection interfaces as deeply readonly, and both are only read here
export function findOrphans({
	workspaces,
	presentIsos,
}: {
	readonly workspaces: ReadonlyMap<string, ExistingWorkspace>;
	readonly presentIsos: ReadonlySet<string>;
}): readonly ExistingWorkspace[] {
	return [...workspaces.keys()]
		.filter((iso) => !presentIsos.has(iso))
		.sort()
		.map((iso) => workspaces.get(iso) as ExistingWorkspace);
}

/**
 * The per-orphan prompt: which lecture it is, so the user can judge the deletion
 * rather than answer blind.
 *
 * It quotes no figure. What a lecture has cost is the sum of its stages, and
 * stage costs are summed nowhere (NFR-2.2); `cost-report` still has the
 * per-stage figures for as long as the workspace stands.
 *
 * @param args - The lecture being asked about.
 * @param args.manifest - The orphaned lecture's manifest.
 * @returns The question put to the user.
 */
function orphanPrompt({ manifest }: { readonly manifest: RunManifest }): string {
	const title = manifest.lectureTitle === "" ? "(untitled)" : manifest.lectureTitle;
	return `Lecture ${manifest.lectureNumber} "${title}" (${manifest.lectureDate}) has no source video or slide left. Delete its workspace and any final output?`;
}

/** Where an orphan's files live and where its removal is recorded. */
type OrphanContext = {
	readonly moduleRoot: string;
	readonly existingPdfs: ReadonlyMap<string, string>;
	readonly logger: Logger;
};

/**
 * Deletes one approved orphan — its workspace folder (manifest included) and its
 * `Final output/` PDF — and records the prior state the deletion destroyed.
 *
 * @param args - The orphan and where its files live.
 * @param args.orphan - The orphaned workspace to delete.
 * @param args.moduleRoot - Absolute path to the module directory.
 * @param args.existingPdfs - Existing `Final output/` PDFs keyed by date.
 * @param args.logger - The run logger.
 * @returns A promise that resolves once the workspace and PDF are gone.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- OrphanContext carries pino's Logger and a ReadonlyMap: the first has mutable properties the rule cannot see past, the second is already the readonly form it declines to recognise (CLAUDE.md permits dropping readonly where a library requires a mutable type)
async function deleteOrphan({
	orphan,
	moduleRoot,
	existingPdfs,
	logger,
}: { readonly orphan: ExistingWorkspace } & OrphanContext): Promise<void> {
	const { manifest } = orphan;
	await rm(workspaceRootFor({ moduleRoot, folderName: orphan.folder }), {
		recursive: true,
		force: true,
	});
	const pdf = existingPdfs.get(manifest.lectureDate);
	if (pdf !== undefined) {
		await rm(join(moduleDirs({ moduleRoot }).finalOutput, pdf), { force: true });
	}
	logger.info(
		{
			folder: orphan.folder,
			lectureNumber: manifest.lectureNumber,
			lectureTitle: manifest.lectureTitle,
			lectureDate: manifest.lectureDate,
		},
		"Deleted orphaned lecture workspace",
	);
}

/**
 * Runs the direct-deletion guard: asks about each orphan in turn, then asks once
 * more before acting. Every orphan must be approved and the final confirmation
 * given, or nothing is deleted at all — a partial "delete some, keep others"
 * outcome is never produced, since a missing batch of sources usually means one
 * mistake rather than several deliberate deletions.
 *
 * @param args - The orphans, their locations, and the injected dependencies.
 * @param args.orphans - The orphaned workspaces (non-empty).
 * @param args.moduleRoot - Absolute path to the module being normalised.
 * @param args.existingPdfs - Existing `Final output/` PDFs keyed by date.
 * @param args.logger - The run logger.
 * @param args.confirm - The user prompt.
 * @returns Whether every orphan was deleted, or which question was declined.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- OrphanContext carries pino's Logger and a ReadonlyMap: the first has mutable properties the rule cannot see past, the second is already the readonly form it declines to recognise (CLAUDE.md permits dropping readonly where a library requires a mutable type)
export async function resolveOrphans({
	orphans,
	moduleRoot,
	existingPdfs,
	logger,
	confirm,
}: {
	readonly orphans: readonly ExistingWorkspace[];
	readonly confirm: ConfirmPrompt;
} & OrphanContext): Promise<OrphanOutcome> {
	logger.info(
		{ moduleRoot, orphans: orphans.map((orphan) => orphan.folder) },
		"Lecture workspaces have no source files left",
	);

	for (const orphan of orphans) {
		if (!(await confirm({ message: orphanPrompt({ manifest: orphan.manifest }) }))) {
			return {
				state: "declined",
				reason: `deleting lecture ${orphan.manifest.lectureDate} was declined`,
			};
		}
	}

	const finalMessage = `Permanently delete ${orphans.length} lecture workspace(s) and their final output? This cannot be undone.`;
	if (!(await confirm({ message: finalMessage }))) {
		return { state: "declined", reason: "the final confirmation was declined" };
	}

	for (const orphan of orphans) {
		await deleteOrphan({ orphan, moduleRoot, existingPdfs, logger });
	}
	return { state: "deleted" };
}
