/**
 * The CLI's composition root: it assembles the runner, the stages, the logger,
 * and the prompts, hands them to the command layer, and turns whatever comes
 * back — an exit code or a typed error — into how the process should exit.
 *
 * Assembly lives here rather than in `src/index.ts` so that everything except
 * the process itself can be exercised: `runCli` takes the arguments, the project
 * root, and both output streams (technical-design.md §4.7, §8).
 */

import { loadConfig } from "../pipeline/config.js";
import { RUNS_DIR } from "../pipeline/layout.js";
import { deriveRunId, PipelineRunner } from "../pipeline/runner.js";
import { createAudioExtractionStage } from "../pipeline/stages/audio-extraction.js";
import { createSourceNormalisationStage } from "../pipeline/stages/source-normalisation.js";
import { createTranscriptStructuringStage } from "../pipeline/stages/transcript-structuring.js";
import { createTranscriptionStage } from "../pipeline/stages/transcription.js";
import { errorMessage } from "../utils/errors.js";
import { createRootLogger } from "../utils/logger.js";
import { CliUsageError, parseCliArgs, USAGE } from "./args.js";
import {
	type CliDeps,
	EXIT_FAILURE,
	EXIT_SUCCESS,
	executeCommand,
	type RunnableCliCommand,
} from "./commands.js";
import { confirmPrompt, selectLectureMatch, selectLectureMatches } from "./prompts.js";

/** Where the CLI's two streams of output go; replaced wholesale under test. */
type CliOutput = {
	/** Receives everything the user asked to see. */
	readonly write: (text: string) => void;
	/** Receives anything that went wrong. */
	readonly writeError: (text: string) => void;
};

/**
 * Builds the dependencies a command runs against: the configured runner, the
 * stages in pipeline order, and the prompts.
 *
 * @param args - The assembly inputs.
 * @param args.projectRoot - The directory holding `pipeline-config.json`.
 * @param args.write - Where user-facing output goes.
 * @returns The assembled command dependencies.
 * @throws {import("../pipeline/config.js").ConfigError} When the configuration cannot be read or is invalid.
 */
async function assembleDeps({
	projectRoot,
	write,
}: {
	readonly projectRoot: string;
	readonly write: (text: string) => void;
}): Promise<CliDeps> {
	const config = await loadConfig({ projectRoot });
	const logger = createRootLogger({
		runTimestamp: deriveRunId({ instant: new Date() }),
		runsDir: RUNS_DIR,
	});
	const runner = new PipelineRunner({
		config,
		sourceNormalisation: createSourceNormalisationStage({ logger, confirm: confirmPrompt }),
		// Pipeline order; each further stage joins this list as it is built.
		lectureStages: [
			createAudioExtractionStage({ logger }),
			createTranscriptionStage({ logger }),
			createTranscriptStructuringStage({ logger }),
		],
		logger,
	});
	return {
		runner,
		moduleRoots: config.moduleRoots,
		gbpPerUsd: config.currency.gbpPerUsd,
		selectMatches: selectLectureMatches,
		selectMatch: selectLectureMatch,
		confirm: confirmPrompt,
		write,
	};
}

/**
 * Reports a failure as a sentence rather than a stack trace, adding the usage
 * text when the command line itself was the problem.
 *
 * @param args - What went wrong and where to say so.
 * @param args.error - The caught failure.
 * @param args.output - The CLI's output streams.
 * @returns The failure exit code.
 */
function reportFailure({
	error,
	output,
}: {
	readonly error: unknown;
	readonly output: CliOutput;
}): number {
	output.writeError(`${errorMessage(error)}\n`);
	if (error instanceof CliUsageError) {
		output.write(`\n${USAGE}\n`);
	}
	return EXIT_FAILURE;
}

/**
 * Runs the CLI end to end: parses the command line, assembles the pipeline, and
 * carries the command out.
 *
 * `--help` is answered before the configuration is read, so the commands can be
 * discovered in a project that is not yet configured. Every typed failure —
 * a misused command line, an unreadable config, a stage error, a corrupt
 * manifest — is reported as a message and a non-zero exit code rather than an
 * unhandled rejection (technical-design.md §8).
 *
 * @param args - The invocation inputs.
 * @param args.argv - The arguments following the program name.
 * @param args.projectRoot - The directory holding `pipeline-config.json`; defaults to the working directory.
 * @param args.write - Where user-facing output goes; defaults to stdout.
 * @param args.writeError - Where failures are reported; defaults to stderr.
 * @returns The process exit code.
 * @example
 * process.exitCode = await runCli({ argv: process.argv.slice(2) });
 */
export async function runCli({
	argv,
	projectRoot = process.cwd(),
	write = (text: string) => {
		process.stdout.write(text);
	},
	writeError = (text: string) => {
		process.stderr.write(text);
	},
}: {
	readonly argv: readonly string[];
	readonly projectRoot?: string;
	readonly write?: (text: string) => void;
	readonly writeError?: (text: string) => void;
}): Promise<number> {
	const output: CliOutput = { write, writeError };
	try {
		const command = parseCliArgs({ argv });
		if (command.command === "help") {
			write(`${USAGE}\n`);
			return EXIT_SUCCESS;
		}
		const deps = await assembleDeps({ projectRoot, write });
		return await executeCommand({ command: command satisfies RunnableCliCommand, deps });
	} catch (error: unknown) {
		return reportFailure({ error, output });
	}
}
