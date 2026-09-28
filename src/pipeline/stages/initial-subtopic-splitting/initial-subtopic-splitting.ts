/**
 * `initial-subtopic-splitting`: the first of the three division stages. Makes a
 * panel of splitting runs, each sending the whole transcript with the `s6`
 * prompt and cutting it where the model says each subtopic begins
 * (technical-design.md §5, "Dividing the transcript").
 */

import { relative } from "node:path";
import type {
	PipelineStage,
	StageContext,
	StageCost,
	StageResult,
} from "../../../types/pipeline.js";
import { NamedError } from "../../../utils/errors.js";
import { isRecord } from "../../../utils/record.js";
import { configuredStage } from "../../../utils/stage-config.js";
import { stageDirectoryPaths } from "../../layout.js";
import { assertLossless, placeCuts, type Subtopic, sliceSubtopics } from "../division.js";
import {
	type JsonReplyOutcome,
	type ModelStageDependencies,
	type ModelStageRunArgs,
	tryJsonReply,
} from "../model-stage.js";
import { runPanel, sendWithResends } from "../panel-runs.js";
import { createPipelineStage } from "../pipeline-stage.js";
import { readStageText } from "../stage-input.js";
import { buildSplittingMessages } from "./initial-subtopic-splitting.prompt.js";

/**
 * Thrown when the transcript cannot be divided: it is missing or empty. A run
 * whose replies stay unusable fails the stage with the panel's own error.
 */
export class InitialSubtopicSplittingError extends NamedError {}

const STAGE_ID = "initial-subtopic-splitting";

/** The transcript this stage divides, with the whitespace at its ends removed. */
export type InitialSubtopicSplittingInput = { readonly transcript: string };

/** Every splitting run of the panel, in run order. */
export type InitialSubtopicSplittingOutput = { readonly runs: readonly (readonly Subtopic[])[] };

/** One subtopic as the `s6` reply gives it. */
type ReplySubtopic = {
	readonly label: string;
	readonly groupedBecause: string;
	readonly startsWith: string;
};

/** The object the `s6` prompt asks for. */
type SplitReply = { readonly subtopics: readonly ReplySubtopic[] };

/** The reply's shape in words, for the failure a user reads when a reply is not one. */
const DOCUMENTED_REPLY_SHAPE = "{ subtopics: [{ label, groupedBecause, startsWith }] } object";

/**
 * Whether a parsed reply is the documented list of at least one subtopic.
 *
 * @param value - The parsed reply.
 * @returns `true` when every subtopic carries its three strings.
 */
function isSplitReply(value: unknown): value is SplitReply {
	if (!isRecord(value) || !Array.isArray(value.subtopics) || value.subtopics.length === 0) {
		return false;
	}
	return value.subtopics.every(
		(subtopic: unknown) =>
			isRecord(subtopic) &&
			typeof subtopic.label === "string" &&
			typeof subtopic.groupedBecause === "string" &&
			typeof subtopic.startsWith === "string",
	);
}

/**
 * Whether a value read back from a run file is a run: a list of subtopics.
 *
 * @param value - The parsed run file.
 * @returns `true` when every entry carries a span, a label and a reason.
 */
function isSplittingRun(value: unknown): value is readonly Subtopic[] {
	return (
		Array.isArray(value) &&
		value.every(
			(subtopic: unknown) =>
				isRecord(subtopic) &&
				typeof subtopic.start === "number" &&
				typeof subtopic.end === "number" &&
				typeof subtopic.label === "string" &&
				typeof subtopic.why === "string",
		)
	);
}

/**
 * Sends the transcript once and turns a usable reply into a division. A reply
 * naming an opening the transcript does not contain is as unusable as one that
 * is not JSON, so it is returned as a failure for the panel to resend.
 *
 * @param args - The transcript, the run context, and the model dependencies.
 * @param args.transcript - The transcript to divide.
 * @param args.context - The current lecture run context.
 * @param args.logger - The stage's logger.
 * @param args.client - The OpenAI client the call goes through.
 * @returns The division, or why the reply could not be used, with the call's cost.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino Logger and OpenAI client are library types that are not deeply readonly
async function divideOnce({
	transcript,
	context,
	logger,
	client,
}: {
	readonly transcript: string;
	readonly context: StageContext;
} & ModelStageDependencies): Promise<JsonReplyOutcome<readonly Subtopic[]>> {
	const outcome = await tryJsonReply({
		messages: buildSplittingMessages({ transcript }),
		stageId: STAGE_ID,
		context,
		isReply: isSplitReply,
		documentedShape: DOCUMENTED_REPLY_SHAPE,
		logger,
		client,
	});
	if ("failure" in outcome) {
		return outcome;
	}
	const { subtopics } = outcome.reply;
	const placed = placeCuts({
		text: transcript,
		quotes: subtopics.map((subtopic) => subtopic.startsWith),
	});
	if ("unplaced" in placed) {
		return {
			failure: `The model's opening words "${placed.unplaced}" are not in the transcript after the previous cut`,
			cost: outcome.cost,
		};
	}
	const division = sliceSubtopics({
		text: transcript,
		cuts: placed.cuts,
		named: subtopics.map((subtopic) => ({ label: subtopic.label, why: subtopic.groupedBecause })),
	});
	assertLossless({ text: transcript, subtopics: division });
	return { reply: division, cost: outcome.cost };
}

/**
 * Makes the panel of splitting runs, resuming from any an earlier launch saved.
 *
 * @param args - The stage's input, context and dependencies.
 * @param args.input - The transcript to divide.
 * @param args.context - The current lecture run context.
 * @param args.logger - The run's logger, on which each model call is recorded.
 * @param args.client - The OpenAI client the calls go through.
 * @returns Every run, what this launch's calls cost, and the run files.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger and the OpenAI client carry mutable properties the rule cannot see past; both are only read from here (CLAUDE.md permits dropping readonly where a library requires a mutable type)
async function splitTranscript({
	input,
	context,
	logger,
	client,
}: ModelStageRunArgs<InitialSubtopicSplittingInput>): Promise<
	StageResult<InitialSubtopicSplittingOutput>
> {
	const [directory = context.workspaceRoot] = stageDirectoryPaths({
		workspaceRoot: context.workspaceRoot,
		stageId: STAGE_ID,
	});
	const { runs, cost, runFiles } = await runPanel({
		panelSize: context.config.division.panelSize,
		concurrency: configuredStage({ config: context.config, stageId: STAGE_ID })?.concurrency,
		directory,
		isRun: isSplittingRun,
		makeRun: async ({
			runNumber,
		}): Promise<{ readonly run: readonly Subtopic[]; readonly cost: StageCost }> => {
			const sent = await sendWithResends({
				what: `Splitting run ${runNumber}`,
				logger,
				send: () => divideOnce({ transcript: input.transcript, context, logger, client }),
			});
			return { run: sent.reply, cost: sent.cost };
		},
	});
	return {
		output: { runs },
		cost,
		filesWritten: runFiles.map((file) => relative(context.workspaceRoot, file)),
	};
}

/**
 * Reads the transcript this stage divides.
 *
 * @param context - The current lecture run context.
 * @returns The transcript, with the whitespace at its ends removed.
 * @throws {InitialSubtopicSplittingError} If the transcript is missing or holds no text.
 */
async function readTranscript(context: StageContext): Promise<InitialSubtopicSplittingInput> {
	const text = await readStageText({
		context,
		stageId: "transcription",
		purpose: "divide",
		fail: (message) => new InitialSubtopicSplittingError(message),
	});
	return { transcript: text.trim() };
}

/**
 * Builds the `initial-subtopic-splitting` stage.
 *
 * @param dependencies - The logger and OpenAI client provider the stage runs with.
 * @param dependencies.logger - The run's logger; the factory binds it to this stage.
 * @param dependencies.client - The invocation's OpenAI client, handed to the stage as the logger is (§4.7).
 * @returns The stage.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger and the OpenAI client carry mutable properties the rule cannot see past; both are only read from here (CLAUDE.md permits dropping readonly where a library requires a mutable type)
export function createInitialSubtopicSplittingStage({
	logger,
	client,
}: ModelStageDependencies): PipelineStage<
	InitialSubtopicSplittingInput,
	InitialSubtopicSplittingOutput
> {
	return createPipelineStage({
		stageId: STAGE_ID,
		logger,
		getInput: readTranscript,
		run: (args) => splitTranscript({ ...args, client }),
	});
}
