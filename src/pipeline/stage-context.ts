/**
 * The builder of the {@link StageContext} that a stage runs against. The runner
 * builds one at the start of a pipeline run and after each write to the manifest.
 * The test fixtures build one for each stage suite. Both use this module, so a
 * stage under test gets a context made as in a real pipeline run
 * (technical-design.md §4.7).
 */

import type { Manifest, PipelineConfig, StageContext } from "../types/pipeline.js";
import { moduleRootOf } from "./layout.js";

/**
 * Builds a frozen {@link StageContext} from a lecture's manifest, so no stage can
 * change it. `moduleRoot` is two folders above the workspace
 * (`moduleRoot/Pipeline processing/<folder>`, technical-design.md §4.7).
 *
 * @param args - The workspace, the manifest and the configuration.
 * @param args.workspaceRoot - Absolute path to the lecture workspace folder.
 * @param args.manifest - The lecture's manifest, which gives the lecture identity.
 * @param args.config - The pipeline configuration, after the config loader checks it.
 * @returns The frozen stage context.
 */
export function assembleContext({
	workspaceRoot,
	manifest,
	config,
}: {
	readonly workspaceRoot: string;
	readonly manifest: Manifest;
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
