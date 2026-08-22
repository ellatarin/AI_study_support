/**
 * Building the {@link StageContext} a stage runs against.
 *
 * This is the only way one is made. The runner assembles a fresh context at
 * every stage transition, and the test fixtures assemble one for each stage
 * suite; both go through here, so a stage under test is handed a context put
 * together exactly as a real run puts it together (technical-design.md §4.7).
 */

import type { PipelineConfig, RunManifest, StageContext } from "../types/pipeline.js";
import { moduleRootOf } from "./layout.js";

/**
 * Builds the immutable {@link StageContext} for a lecture run from its manifest,
 * deriving `moduleRoot` two levels up from the workspace
 * (`moduleRoot/Pipeline processing/<folder>`) and freezing the result so no stage
 * can mutate shared run state (technical-design.md §4.7).
 *
 * @param args - The context inputs.
 * @param args.workspaceRoot - Absolute path to the lecture workspace folder.
 * @param args.manifest - The lecture's run manifest, the source of lecture identity.
 * @param args.config - The validated pipeline configuration.
 * @returns The frozen stage context shared by every stage in the run.
 */
export function assembleContext({
	workspaceRoot,
	manifest,
	config,
}: {
	readonly workspaceRoot: string;
	readonly manifest: RunManifest;
	readonly config: PipelineConfig;
}): StageContext {
	return Object.freeze({
		workspaceRoot,
		moduleRoot: moduleRootOf({ workspaceRoot }),
		config,
		manifest,
		lectureNumber: manifest.lectureNumber,
		lectureDate: manifest.lectureDate,
		provisionalTitle: manifest.provisionalTitle,
		lectureTitle: manifest.lectureTitle,
	});
}
