import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * This repo's root, resolved from this file's own location so it holds however
 * a hook was invoked and whatever the working directory is. Every hook needs
 * it, and a hook that resolved it relative to the cwd instead was dead whenever
 * the cwd was not the repo root.
 */
export const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
);
