#!/usr/bin/env node
/*
 * The one-shot escape hatch shared by every blocking hook.
 *
 * Write `.claude/tool-override` with a one-line reason before the tool call and
 * the next block is waived, once. The reason stays in the transcript.
 *
 * One implementation, in one place, because there used to be three: one
 * resolving the path relative to the working directory (so it did nothing
 * whenever the cwd was not the repo root), one resolving it against the repo,
 * and one hook with no escape hatch at all.
 *
 * Runnable as well as importable, so the shell hooks share this exact
 * behaviour rather than reimplementing it: exit 0 when an override was
 * consumed, 1 when there was none.
 */

import fs from "node:fs";
import path from "node:path";
import { isEntryPoint } from "../../lib/entry-point.mjs";
import { repoRoot } from "./repo-root.mjs";

const overrideFile = path.join(repoRoot, ".claude", "tool-override");

/**
 * Consumes an override if one is waiting, reporting it on stderr so the waiver
 * and its reason are visible in the transcript.
 *
 * @returns {boolean} True when a block should be waived.
 */
export function acceptOverride() {
	if (!fs.existsSync(overrideFile)) return false;
	let reason = "";
	try {
		reason = fs.readFileSync(overrideFile, "utf8").trim();
		fs.unlinkSync(overrideFile);
	} catch {
		return false;
	}
	process.stderr.write(`Override accepted: ${reason}\n`);
	return true;
}

if (isEntryPoint(import.meta.url)) {
	process.exit(acceptOverride() ? 0 : 1);
}
