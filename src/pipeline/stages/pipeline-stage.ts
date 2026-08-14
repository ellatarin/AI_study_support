import type { PipelineStage, StageContext, StageId, StageResult } from "../../types/pipeline.js";
import type { ManifestPathQuery } from "../../utils/files.js";
import { ManifestPathError, pathExists, resolveManifestPath } from "../../utils/files.js";

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
 * says `complete` AND every file it recorded in `filesWritten` is still on disk.
 * A completed stage whose output was deleted therefore re-runs automatically
 * (technical-design.md §4.2).
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
	if (entry?.status !== "complete") {
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
 * Assembles a per-lecture {@link PipelineStage} from the two parts that actually
 * differ between stages — how it gathers its input and what it does — and wires
 * the shared `isComplete` for the given stage id.
 *
 * Every stage's idempotency check is the same check against its own manifest
 * entry (technical-design.md §4.2), so building stages through here is what
 * guarantees they cannot drift apart or quietly skip the boundary validation.
 *
 * @param args - The stage's identity and behaviour.
 * @param args.stageId - The stage this implements.
 * @param args.getInput - Gathers and validates the stage's input.
 * @param args.run - Executes the stage.
 * @returns The assembled pipeline stage.
 * @typeParam TInput - The input `getInput` produces and `run` consumes.
 * @typeParam TOutput - The output `run` produces.
 */
export function createPipelineStage<TInput, TOutput>({
	stageId,
	getInput,
	run,
}: {
	readonly stageId: StageId;
	readonly getInput: (context: StageContext) => Promise<TInput>;
	readonly run: (args: {
		readonly input: TInput;
		readonly context: StageContext;
	}) => Promise<StageResult<TOutput>>;
}): PipelineStage<TInput, TOutput> {
	return {
		stageId,
		isComplete: (context) => isStageComplete({ context, stageId }),
		getInput,
		run,
	};
}
