/* jscpd:ignore-start -- every stage imports the same pipeline types, error and
   file helpers. So the import blocks of sibling stages are the same line for
   line. Imports cannot be shared, and CLAUDE.md (File Organisation) forbids
   barrel files. Only the imports are exempt. jscpd checks the code below. */
import { readFile } from "node:fs/promises";
import type { StageContext, StageResult } from "../../../types/pipeline.js";
import { errorMessage, NamedError } from "../../../utils/errors.js";
import { isRecord } from "../../../utils/record.js";
import { stageOutputPath } from "../../layout.js";
import {
	defineModelStage,
	type ModelStageFactory,
	type ModelStageRunArgs,
	requestJsonReply,
} from "../model-stage.js";
import { writeStageOutput } from "../pipeline-stage.js";
import { buildStructuringMessages } from "./transcript-structuring.prompt.js";
/* jscpd:ignore-end */

/**
 * The error when the transcript is missing or holds no text, or when the reply
 * is unusable. An unknown cost does not cause it (technical-design.md §5,
 * `transcript-structuring`, and §7).
 */
export class TranscriptStructuringError extends NamedError {}

/** The transcript that `transcript-structuring` structures. */
export type TranscriptStructuringInput = {
	/** The full text of `Transcript/transcript.txt`. */
	readonly transcriptText: string;
};

/** The structured transcript that `transcript-structuring` writes. */
export type TranscriptStructuringOutput = {
	/** The absolute path of `Structured transcript/structured-transcript.md`. */
	readonly structuredTranscriptPath: string;
};

const STAGE_ID = "transcript-structuring";

/** The reply that the prompt asks for. */
type StructuringReply = { readonly structuredMarkdown: string };

/**
 * Reads the transcript that `transcription` wrote.
 *
 * @param context - The stage context.
 * @returns The transcript text.
 * @throws {TranscriptStructuringError} If the transcript is missing or holds no text.
 */
async function readTranscript(context: StageContext): Promise<TranscriptStructuringInput> {
	const transcriptPath = stageOutputPath({
		workspaceRoot: context.workspaceRoot,
		stageId: "transcription",
	});
	let transcriptText: string;
	try {
		transcriptText = await readFile(transcriptPath, "utf8");
	} catch (error: unknown) {
		throw new TranscriptStructuringError(
			`No transcript at ${transcriptPath}; run transcription first (${errorMessage(error)})`,
		);
	}
	if (transcriptText.trim() === "") {
		throw new TranscriptStructuringError(
			`The transcript at ${transcriptPath} holds no text; there is nothing to structure`,
		);
	}
	return { transcriptText };
}

/**
 * Checks that a parsed reply holds the structured Markdown.
 *
 * @param value - The parsed reply.
 * @returns `true` when the value is a {@link StructuringReply}.
 */
function isStructuringReply(value: unknown): value is StructuringReply {
	return isRecord(value) && typeof value.structuredMarkdown === "string";
}

/** The text that ends the failure "The model's reply is not the documented …". */
const DOCUMENTED_REPLY_SHAPE = "{ structuredMarkdown } object";

/**
 * Structures the transcript in one model call, and writes
 * `Structured transcript/structured-transcript.md` (technical-design.md §5,
 * `transcript-structuring`).
 *
 * @param args - The input, the stage context and the dependencies of the stage.
 * @param args.input - The transcript to structure.
 * @param args.context - The stage context.
 * @param args.logger - The logger that records the model call.
 * @param args.client - The OpenRouter client that sends the call.
 * @param args.sendGate - The send gate of this stage run. The model call waits on it.
 * @returns The structured transcript path, the cost of the call and the file written.
 * @throws {TranscriptStructuringError} If the reply is unusable.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger has mutable properties that the rule cannot ignore. This function only writes log lines to it. CLAUDE.md permits a mutable type that a library requires.
async function structureTranscript({
	input,
	context,
	logger,
	client,
	sendGate,
}: ModelStageRunArgs<TranscriptStructuringInput>): Promise<
	StageResult<TranscriptStructuringOutput>
> {
	const { reply, cost } = await requestJsonReply({
		messages: buildStructuringMessages({
			transcriptText: input.transcriptText,
			language: context.config.finalOutput.language,
		}),
		stageId: STAGE_ID,
		context,
		isReply: isStructuringReply,
		documentedShape: DOCUMENTED_REPLY_SHAPE,
		fail: (message) => new TranscriptStructuringError(message),
		logger,
		client,
		sendGate,
	});
	const { path, filesWritten } = await writeStageOutput({
		stageId: STAGE_ID,
		context,
		content: reply.structuredMarkdown,
	});
	return { output: { structuredTranscriptPath: path }, cost, filesWritten };
}

/**
 * Builds the `transcript-structuring` stage from the logger and the OpenRouter client
 * of the invocation (technical-design.md §5, `transcript-structuring`).
 */
export const createTranscriptStructuringStage: ModelStageFactory<
	TranscriptStructuringInput,
	TranscriptStructuringOutput
> = defineModelStage({ stageId: STAGE_ID, getInput: readTranscript, run: structureTranscript });
