/**
 * The entry point of `lecture-notes`. `bin/lecture-notes` runs it with
 * `pnpm exec tsx src/index.ts`.
 *
 * It loads the environment variables from `.env`, gives the command line to {@link runCli} and sets
 * the exit code. All other CLI code is in `src/cli/`, where a test can run it
 * (technical-design.md §4.7, "CLI Structure").
 */

import "dotenv/config";
import { runCli } from "./cli/run-cli.js";

process.exitCode = await runCli({ argv: process.argv.slice(2) });
