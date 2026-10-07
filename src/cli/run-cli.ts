/**
 * The CLI's composition root. It makes the runner, the stages, the debug logger
 * and the prompts, and gives them to the commands. It turns the result, an exit
 * code or an error, into the process's exit code.
 *
 * This code is here and not in `src/index.ts`, so a test can run all of it. A
 * test gives `runCli` the arguments, the project root and both output streams
 * (technical-design.md §4.7, "CLI Structure", and §8, "The CLI Boundary").
 */

import { loadConfig } from "../pipeline/config.js";
import { debugLogPath } from "../pipeline/layout.js";
import { createOpenRouterClientProvider } from "../pipeline/openrouter.js";
import { createMoneyFormatter } from "../pipeline/reports.js";
import { deriveTimestampId, PipelineRunner } from "../pipeline/runner.js";
import { audioExtractionParts } from "../pipeline/stages/audio-extraction/audio-extraction.js";
import { createChooseDivisionStage } from "../pipeline/stages/choose-division/choose-division.js";
import { createDeepenSubtopicSplittingStage } from "../pipeline/stages/deepen-subtopic-splitting/deepen-subtopic-splitting.js";
import { createGroupIntoTopicsStage } from "../pipeline/stages/group-into-topics/group-into-topics.js";
import { createInitialSubtopicSplittingStage } from "../pipeline/stages/initial-subtopic-splitting/initial-subtopic-splitting.js";
import { createJudgeLectureTitleStage } from "../pipeline/stages/judge-lecture-title/judge-lecture-title.js";
import { createSourceFileStage } from "../pipeline/stages/pipeline-stage.js";
import { createReadSlidesStage } from "../pipeline/stages/read-slides/read-slides.js";
import { renderSlidesParts } from "../pipeline/stages/render-slides/render-slides.js";
import { createRetitleSubtopicsStage } from "../pipeline/stages/retitle-subtopics/retitle-subtopics.js";
import { createSourceNormalisationStage } from "../pipeline/stages/source-normalisation/source-normalisation.js";
import { createTranscriptStructuringStage } from "../pipeline/stages/transcript-structuring/transcript-structuring.js";
import { createTranscriptVerificationStage } from "../pipeline/stages/transcript-verification/transcript-verification.js";
import { createTranscriptionStage } from "../pipeline/stages/transcription/transcription.js";
import { errorMessage } from "../utils/errors.js";
import { createDebugLogger } from "../utils/logger.js";
import { CliUsageError, parseCliArgs, USAGE } from "./args.js";
import {
	type CliDeps,
	EXIT_FAILURE,
	EXIT_SUCCESS,
	executeCommand,
	type WriteText,
} from "./commands.js";
import { createPipelineRunReporter } from "./pipeline-run-reporter.js";
import { confirmPrompt, selectLectureMatch, selectLectureMatches } from "./prompts.js";

/** The CLI's two output streams. A test gives its own. */
type CliOutput = {
	/** Writes the output that the user asked for. */
	readonly write: WriteText;
	/** Writes the message of an error that stops the invocation. */
	readonly writeError: WriteText;
};

type AssembledDeps = { readonly deps: CliDeps; readonly closeDebugLog: () => Promise<void> };

/**
 * Makes the {@link CliDeps} from the configuration: the runner with its stages,
 * the prompts and the output stream.
 *
 * @param args - The project root and the output stream.
 * @param args.projectRoot - The folder that holds `pipeline-config.json`.
 * @param args.write - Writes the output that the user reads.
 * @returns The command dependencies, and the function that closes the debug log.
 * @throws {import("../pipeline/config.js").ConfigError} When the configuration cannot be read or is not valid.
 */
async function assembleDeps({
	projectRoot,
	write,
}: {
	readonly projectRoot: string;
	readonly write: WriteText;
}): Promise<AssembledDeps> {
	const config = await loadConfig({ projectRoot });
	const debugLogFile = debugLogPath({
		projectRoot,
		invocationId: deriveTimestampId({ instant: new Date() }),
	});
	const { logger, close: closeDebugLog } = createDebugLogger({ debugLogFile });
	// The invocation has one client. Each stage gets it from here, as it gets the
	// logger, so no module of the pipeline holds a client. It is a provider, not a
	// client, because a client needs the API key. A command that makes no model
	// call must work without the key.
	const client = createOpenRouterClientProvider({ openRouter: config.openRouter });
	// One formatter shows the money in all the CLI's output, the stage notices and
	// the summaries.
	// So the exchange rate is read once, and not given to each place that shows money.
	const formatMoney = createMoneyFormatter({ gbpPerUsd: config.currency.gbpPerUsd });
	const runner = new PipelineRunner({
		config,
		sourceNormalisation: createSourceNormalisationStage({
			logger,
			confirm: confirmPrompt,
			modulePrefixes: config.naming.modulePrefixes,
		}),
		// The runner runs these stages in this order, so the list is in pipeline order.
		// A stage that is not built yet is not in the list.
		lectureStages: [
			createSourceFileStage({ logger, ...audioExtractionParts }),
			createTranscriptionStage({ logger }),
			createInitialSubtopicSplittingStage({ logger, client }),
			createDeepenSubtopicSplittingStage({ logger, client }),
			createChooseDivisionStage({ logger }),
			createRetitleSubtopicsStage({ logger, client }),
			createGroupIntoTopicsStage({ logger, client }),
			createJudgeLectureTitleStage({ logger, client }),
			createSourceFileStage({ logger, ...renderSlidesParts }),
			createReadSlidesStage({ logger, client }),
			createTranscriptStructuringStage({ logger, client }),
			createTranscriptVerificationStage({ logger, client }),
		],
		logger,
		reporter: createPipelineRunReporter({ write, formatMoney }),
	});
	return {
		deps: {
			runner,
			moduleRoots: config.moduleRoots,
			batchConcurrency: config.batch.concurrency,
			formatMoney,
			selectMatches: selectLectureMatches,
			selectMatch: selectLectureMatch,
			confirm: confirmPrompt,
			debugLogPath: debugLogFile,
			write,
		},
		closeDebugLog,
	};
}

/**
 * Writes the message of an error, with no stack. After a {@link CliUsageError},
 * it also writes the usage text.
 *
 * @param args - The error and the output streams.
 * @param args.error - The caught error.
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
 * Does one invocation: parses the command line, makes the pipeline and does the
 * command.
 *
 * It answers `--help` before it reads the configuration, so `--help` works in a
 * project with no configuration. One catch takes every error. The error becomes
 * a message and the exit code `1` (technical-design.md §8, "The CLI Boundary").
 * Before it returns, it closes the debug log. So the debug log is complete on
 * disk when the exit code is known, also when the command failed.
 *
 * @param args - The invocation.
 * @param args.argv - The arguments after the program name.
 * @param args.projectRoot - The folder that holds `pipeline-config.json`. The default is the working directory.
 * @param args.write - Writes the output that the user reads. The default is stdout.
 * @param args.writeError - Writes error messages. The default is stderr.
 * @returns The exit code.
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
	readonly write?: WriteText;
	readonly writeError?: WriteText;
}): Promise<number> {
	const output: CliOutput = { write, writeError };
	try {
		const command = parseCliArgs({ argv });
		if (command.command === "help") {
			write(`${USAGE}\n`);
			return EXIT_SUCCESS;
		}
		const { deps, closeDebugLog } = await assembleDeps({ projectRoot, write });
		try {
			return await executeCommand({ command, deps });
		} finally {
			await closeDebugLog();
		}
	} catch (error: unknown) {
		return reportFailure({ error, output });
	}
}
