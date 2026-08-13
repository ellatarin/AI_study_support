/**
 * The `lecture-notes` entry point, run by `bin/lecture-notes` (and directly as
 * `pnpm exec tsx src/index.ts <command>` during development).
 *
 * It does only what cannot be done anywhere else: load the environment, hand the
 * command line to {@link runCli}, and set the exit code. Everything else —
 * parsing, assembly, and the commands themselves — lives under `src/cli/` where
 * it can be tested (technical-design.md §4.7).
 */

import "dotenv/config";
import { runCli } from "./cli/run-cli.js";

process.exitCode = await runCli({ argv: process.argv.slice(2) });
