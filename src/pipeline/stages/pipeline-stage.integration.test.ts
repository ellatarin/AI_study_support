import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ManifestStageEntry, StageContext, StageStatus } from "../../types/pipeline.js";
import { ManifestPathError } from "../../utils/files.js";
import { makeManifest, makeStageContext, makeWorkspaceTree, stagesWith } from "../fixtures.js";
import { isStageComplete } from "./pipeline-stage.js";

const STAGE_ID = "audio-extraction";
const AUDIO_ENTRY = join("Audio", "audio.m4a");

/** A `complete` entry recording the given output files. */
function completeEntry(filesWritten: readonly string[]): ManifestStageEntry {
	return {
		status: "complete",
		completedAt: "2025-10-10T10:00:00.000Z",
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
		await mkdir(join(workspaceRoot, "Audio"), { recursive: true });
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

	async function writeAudioFile(): Promise<void> {
		await writeFile(join(workspaceRoot, AUDIO_ENTRY), "audio bytes");
	}

	it.each<{ readonly status: StageStatus }>([
		{ status: "pending" },
		{ status: "running" },
		{ status: "failed" },
		{ status: "skipped" },
	])("should report incomplete when the manifest status is $status", async ({ status }) => {
		await writeAudioFile();
		const context = contextWith({ status } as ManifestStageEntry);

		expect(await isStageComplete({ context, stageId: STAGE_ID })).toBe(false);
	});

	it("should report complete when the stage is complete and every recorded file exists", async () => {
		await writeAudioFile();
		const context = contextWith(completeEntry([AUDIO_ENTRY]));

		expect(await isStageComplete({ context, stageId: STAGE_ID })).toBe(true);
	});

	it("should report incomplete when a recorded output file has been deleted", async () => {
		const context = contextWith(completeEntry([AUDIO_ENTRY]));

		expect(await isStageComplete({ context, stageId: STAGE_ID })).toBe(false);
	});

	it("should report incomplete when only some of the recorded files exist", async () => {
		await writeAudioFile();
		const context = contextWith(completeEntry([AUDIO_ENTRY, join("Audio", "extra.m4a")]));

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
