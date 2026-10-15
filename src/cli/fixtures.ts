/**
 * Test fixtures that the CLI suites share. The builders make the commands that
 * `parseCliArgs` gives, so a new field of a command needs one edit and not one
 * edit in each suite.
 */

import { testLecture } from "../pipeline/fixtures.js";
import { DEFAULT_PIPELINE_RUN_OPTIONS, NO_CONFIG_OVERRIDES } from "../types/pipeline.js";
import type { CliCommand } from "./args.js";

type RunCommand = Extract<CliCommand, { readonly command: "run" }>;
type BatchCommand = Extract<CliCommand, { readonly command: "batch" }>;

/**
 * Gives the `run` command of the test lecture with no flags.
 *
 * @param fields - The fields that differ from a command with no flags.
 * @returns The command.
 */
export function runCommand(fields: Partial<RunCommand> = {}): RunCommand {
	return {
		command: "run",
		lectureDate: testLecture.date,
		options: DEFAULT_PIPELINE_RUN_OPTIONS,
		configOverrides: NO_CONFIG_OVERRIDES,
		...fields,
	};
}

/**
 * Gives the `batch` command of every configured module with no flags.
 *
 * @param fields - The fields that differ from a command with no flags.
 * @returns The command.
 */
export function batchCommand(fields: Partial<BatchCommand> = {}): BatchCommand {
	return {
		command: "batch",
		moduleRoot: null,
		options: DEFAULT_PIPELINE_RUN_OPTIONS,
		configOverrides: NO_CONFIG_OVERRIDES,
		concurrency: null,
		...fields,
	};
}
