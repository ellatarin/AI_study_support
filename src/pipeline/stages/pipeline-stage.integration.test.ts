import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ManifestStageEntry, StageContext, StageStatus } from "../../types/pipeline.js";
import { ManifestPathError } from "../../utils/files.js";
import {
	makeManifest,
	makeStageContext,
	makeWorkspaceTree,
	stageCompletedAt,
	stagesWith,
} from "../fixtures.js";
import { stageOutputEntry, stageOutputPath } from "../layout.js";
import { isStageComplete } from "./pipeline-stage.js";

// Any stage with a single output file would do; Stage 1's is the simplest.
const STAGE_ID = "audio-extraction";

/** A `complete` entry recording the given output files. */
function completeEntry(filesWritten: readonly string[]): ManifestStageEntry {
	return {
		status: "complete",
		completedAt: stageCompletedAt,
		configUsed: null,
		cost: null,
		filesWritten,
	};
}

describe("isStageComplete", () => {
	let moduleRoot: string;
	let workspaceRoot: string;

	beforeEach(async () => {
		({ moduleRoot, workspaceRoot } = await makeWorkspaceTree({ prefix: "pipeline-stage-" }));
		await mkdir(dirname(outputPath()), { recursive: true });
	});

	afterEach(async () => {
		await rm(moduleRoot, { recursive: true, force: true });
	});

	function contextWith(entry: ManifestStageEntry): StageContext {
		return makeStageContext({
			workspaceRoot,
			manifest: makeManifest({ stages: stagesWith({ stageId: STAGE_ID, entry }) }),
		});
	}

	/** Where the chosen stage is required to leave its output. */
	function outputPath(): string {
		return stageOutputPath({ workspaceRoot, stageId: STAGE_ID });
	}

	async function writeOutputFile(): Promise<void> {
		await writeFile(outputPath(), "audio bytes");
	}

	it.each<{ readonly status: StageStatus }>([
		{ status: "pending" },
		{ status: "running" },
		{ status: "failed" },
		{ status: "skipped" },
	])("should report incomplete when the manifest status is $status", async ({ status }) => {
		await writeOutputFile();
		const context = contextWith({ status } as ManifestStageEntry);

		expect(await isStageComplete({ context, stageId: STAGE_ID })).toBe(false);
	});

	it("should report complete when the stage is complete and every recorded file exists", async () => {
		await writeOutputFile();
		const context = contextWith(completeEntry([stageOutputEntry(STAGE_ID)]));

		expect(await isStageComplete({ context, stageId: STAGE_ID })).toBe(true);
	});

	it("should report incomplete when a recorded output file has been deleted", async () => {
		const context = contextWith(completeEntry([stageOutputEntry(STAGE_ID)]));

		expect(await isStageComplete({ context, stageId: STAGE_ID })).toBe(false);
	});

	it("should report incomplete when only some of the recorded files exist", async () => {
		await writeOutputFile();
		const missingSibling = join(dirname(stageOutputEntry(STAGE_ID)), "extra.m4a");
		const context = contextWith(completeEntry([stageOutputEntry(STAGE_ID), missingSibling]));

		expect(await isStageComplete({ context, stageId: STAGE_ID })).toBe(false);
	});

	it("should report complete when the stage recorded no output files", async () => {
		const context = contextWith(completeEntry([]));

		expect(await isStageComplete({ context, stageId: STAGE_ID })).toBe(true);
	});

	it("should throw ManifestPathError when a recorded path escapes the module root", async () => {
		const context = contextWith(completeEntry([join("..", "..", "..", "escaped.m4a")]));

		await expect(isStageComplete({ context, stageId: STAGE_ID })).rejects.toThrow(
			ManifestPathError,
		);
	});
});
