/**
 * The command that runs the migration in `add-rounds-and-correct-terms.ts` on
 * each module of `pipeline-config.json` in the working directory. The user runs
 * it with `pnpm tsx src/migrations/run-add-rounds-and-correct-terms.ts`.
 */

import { loadConfig } from "../pipeline/config.js";
import { migrateModules } from "./add-rounds-and-correct-terms.js";

const config = await loadConfig({ projectRoot: process.cwd() });
await migrateModules({
	moduleRoots: config.moduleRoots,
	write: (line) => process.stdout.write(`${line}\n`),
});
