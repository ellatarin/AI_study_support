import { mkdir } from "node:fs/promises";
import type { Logger } from "pino";
import type { PipelineStage, StageContext, StageId, StageResult } from "../../types/pipeline.js";
import type { ManifestPathQuery } from "../../utils/files.js";
import {
	cleanTmpFiles,
	ManifestPathError,
	pathExists,
	resolveManifestPath,
	writeFileAtomic,
} from "../../utils/files.js";
import { createStageLogger } from "../../utils/logger.js";
import { stageDirectoryPaths, stageOutputEntry, stageOutputPath } from "../layout.js";
import { hasSettledOutput } from "../run-status.js";

/**
 * Whether one recorded `filesWritten` entry still exists, resolved through the
 * module-boundary check first.
 *
 * A path that cannot be resolved at all counts as absent rather than as an
 * error: deleting a stage's output usually takes its containing directory too,
 * which leaves `resolveManifestPath` with no parent to resolve. That is exactly
 * the "output was manually deleted" case, which must re-run the stage rather
 * than abort the run. A boundary violation is a different matter — a corrupt
 * manifest reaching outside the module tree is always raised.
 *
 * @param query - The recorded entry and the roots that bound it.
 * @returns `true` when the entry resolves and exists on disk.
 * @throws {ManifestPathError} If the entry resolves outside `moduleRoot`.
 */
async function recordedFileExists(query: ManifestPathQuery): Promise<boolean> {
	try {
		return await pathExists(await resolveManifestPath(query));
	} catch (error: unknown) {
		if (error instanceof ManifestPathError) {
			throw error;
		}
		return false;
	}
}

/**
 * The shared idempotency check every per-lecture stage uses for
 * `PipelineStage.isComplete`: the stage is complete only when its manifest entry
 * has settled output — `complete` or `skipped` — AND every file it recorded in
 * `filesWritten` is still on disk. A completed stage whose output was deleted
 * therefore re-runs automatically (technical-design.md §4.2).
 *
 * Both statuses count because the runner writes `skipped` over `complete` the
 * moment it honours this check, so accepting only `complete` would make every
 * third run repeat the billable work (§4.2, stage status semantics).
 *
 * The manifest is untrusted input, so each recorded entry is resolved through
 * {@link resolveManifestPath} before it is touched — an entry that points outside
 * the module tree is rejected rather than silently probed (technical-design.md
 * §4.4).
 *
 * @param args - The check inputs.
 * @param args.context - The current lecture run context.
 * @param args.stageId - The stage whose manifest entry and outputs to verify.
 * @returns `true` when the stage is complete and all its outputs exist.
 * @throws {ManifestPathError} If a recorded path resolves outside `moduleRoot`.
 */
export async function isStageComplete({
	context,
	stageId,
}: {
	readonly context: StageContext;
	readonly stageId: StageId;
}): Promise<boolean> {
	const entry = context.manifest.stages[stageId];
	if (!hasSettledOutput(entry)) {
		return false;
	}
	for (const written of entry.filesWritten) {
		const exists = await recordedFileExists({
			workspaceRoot: context.workspaceRoot,
			moduleRoot: context.moduleRoot,
			entry: written,
		});
		if (!exists) {
			return false;
		}
	}
	return true;
}

/**
 * Creates every directory the stage owns and clears any `.tmp` files a previous
 * crashed run left in them, so a stage begins against directories that exist and
 * hold nothing partial (technical-design.md §4.3).
 *
 * Asked of {@link stageDirectoryPaths} rather than derived from the stage's
 * output file, so a stage owning several directories — or one outside the
 * workspace, as `pdf-generation` does — is prepared as completely as a stage
 * owning a single one.
 *
 * @param args - The workspace and the stage.
 * @param args.workspaceRoot - Absolute path to the lecture workspace.
 * @param args.stageId - The stage whose directories to prepare.
 * @returns A promise that resolves once every directory exists and is clear.
 */
async function prepareStageDirectories({
	workspaceRoot,
	stageId,
}: {
	readonly workspaceRoot: string;
	readonly stageId: StageId;
}): Promise<void> {
	for (const directory of stageDirectoryPaths({ workspaceRoot, stageId })) {
		await mkdir(directory, { recursive: true });
		await cleanTmpFiles(directory);
	}
}

/**
 * Writes the single file a stage owns, and names it as `filesWritten` records
 * it.
 *
 * Writing the output and recording that it was written are one act with two
 * halves, and a stage that did both for itself could do the second about a file
 * it had not written to the path named in the first. Here the path and the entry
 * are derived from the same stage id, so a `filesWritten` entry always names the
 * file that was just put in place (technical-design.md §4.3, §4.5).
 *
 * Stages whose bytes come from a subprocess write through `produceFileAtomic`
 * instead and record their entry themselves; there is no content to hand over.
 *
 * @param args - The stage, the workspace, and the content.
 * @param args.stageId - The stage whose output this is.
 * @param args.workspaceRoot - Absolute path to the lecture workspace.
 * @param args.content - The text to write.
 * @returns The absolute path written, and the `filesWritten` naming it.
 */
export async function writeStageOutput({
	stageId,
	workspaceRoot,
	content,
}: {
	readonly stageId: StageId;
	readonly workspaceRoot: string;
	readonly content: string;
}): Promise<{ readonly path: string; readonly filesWritten: readonly string[] }> {
	const path = stageOutputPath({ workspaceRoot, stageId });
	await writeFileAtomic({ path, content });
	return { path, filesWritten: [stageOutputEntry(stageId)] };
}

/**
 * Assembles a per-lecture {@link PipelineStage} from the two parts that actually
 * differ between stages — how it gathers its input and what it does — and wires
 * the shared `isComplete` for the given stage id.
 *
 * Three things every stage would otherwise repeat are done here instead. The
 * idempotency check is the same check against the stage's own manifest entry
 * (technical-design.md §4.2). The stage's output directories are created and
 * cleared of `.tmp` leftovers before `run` begins (§4.3), which every stage
 * writing output needs and none of them should state for itself. And the run's
 * logger is bound to the stage **once, here**, so `run` receives a logger already
 * stamping `{ stage }` and no stage writes `.child()` for itself (§10).
 *
 * Binding at construction rather than per invocation is why `logger` appears on
 * this factory's `run` and not on {@link PipelineStage.run}: the runner calls a
 * stage with the input and the context, exactly as before, and never carries a
 * logger through the contract to do it.
 *
 * Building stages through here is what guarantees they cannot drift apart,
 * quietly skip a step, or log against the wrong stage.
 *
 * @param args - The stage's identity, dependencies, and behaviour.
 * @param args.stageId - The stage this implements.
 * @param args.logger - The run's logger, bound to this stage before `run` sees it.
 * @param args.getInput - Gathers and validates the stage's input.
 * @param args.run - Executes the stage, against prepared directories and a bound logger.
 * @returns The assembled pipeline stage.
 * @typeParam TInput - The input `getInput` produces and `run` consumes.
 * @typeParam TOutput - The output `run` produces.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger carries mutable properties the rule cannot see past; it is only read from here (CLAUDE.md permits dropping readonly where a library requires a mutable type)
export function createPipelineStage<TInput, TOutput>({
	stageId,
	logger,
	getInput,
	run,
}: {
	readonly stageId: StageId;
	readonly logger: Logger;
	readonly getInput: (context: StageContext) => Promise<TInput>;
	// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- reported again for the callback's own parameter; same pino Logger, same reason as above
	readonly run: (args: {
		readonly input: TInput;
		readonly context: StageContext;
		readonly logger: Logger;
	}) => Promise<StageResult<TOutput>>;
}): PipelineStage<TInput, TOutput> {
	const stageLogger = createStageLogger({ logger, stageId });
	return {
		stageId,
		isComplete: (context) => isStageComplete({ context, stageId }),
		getInput,
		run: async ({ input, context }) => {
			await prepareStageDirectories({ workspaceRoot: context.workspaceRoot, stageId });
			return run({ input, context, logger: stageLogger });
		},
	};
}
