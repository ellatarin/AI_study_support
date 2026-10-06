/* jscpd:ignore-start -- every stage imports the same pipeline types, error and
   file helpers. So the import blocks of sibling stages are the same line for
   line. Imports cannot be shared, and CLAUDE.md (File Organisation) forbids
   barrel files. Only the imports are exempt. jscpd checks the code below. */
import { readFile } from "node:fs/promises";
import type { Logger } from "pino";
import type { LectureIdentityChanges, StageContext, StageResult } from "../../../types/pipeline.js";
import { errorMessage, NamedError } from "../../../utils/errors.js";
import { isRecord } from "../../../utils/record.js";
import { moduleDirs, stageOutputPath } from "../../layout.js";
import { baseNameForLecture, renameLectureFiles } from "../../lecture-files.js";
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
 * is unusable. It is also the error when the model judges the provisional title
 * not meaningful and proposes no usable title. An unknown cost does not cause it
 * (technical-design.md §5, `transcript-structuring`, and §7).
 */
export class TranscriptStructuringError extends NamedError {}

/** The transcript that `transcript-structuring` structures. */
export type TranscriptStructuringInput = {
	/** The full text of `Transcript/transcript.txt`. */
	readonly transcriptText: string;
};

/** The structured transcript that `transcript-structuring` writes, and the lecture title after it. */
export type TranscriptStructuringOutput = {
	/** The absolute path of `Structured transcript/structured-transcript.md`. */
	readonly structuredTranscriptPath: string;
	readonly lectureTitle: string;
};

const STAGE_ID = "transcript-structuring";

/** The reply that the prompt asks for. */
type StructuringReply = {
	readonly provisionalTitleMeaningful: boolean;
	readonly suggestedTitle: string | null;
	readonly structuredMarkdown: string;
};

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
 * Checks that a parsed reply has the three fields of the prompt, with the right
 * types. An absent `suggestedTitle` is accepted, because a model that omits a
 * null field means the same as one that sends it.
 *
 * @param value - The parsed reply.
 * @returns `true` when the value is a {@link StructuringReply}.
 */
function isStructuringReply(value: unknown): value is StructuringReply {
	if (!isRecord(value)) {
		return false;
	}
	const { suggestedTitle } = value;
	return (
		typeof value.provisionalTitleMeaningful === "boolean" &&
		typeof value.structuredMarkdown === "string" &&
		(suggestedTitle === null || suggestedTitle === undefined || typeof suggestedTitle === "string")
	);
}

/** The text that ends the failure "The model's reply is not the documented …". */
const DOCUMENTED_REPLY_SHAPE =
	"{ provisionalTitleMeaningful, suggestedTitle, structuredMarkdown } object";

/**
 * Gives the AI-derived title from the reply.
 *
 * @param suggestedTitle - The title from the reply.
 * @returns The title, with the whitespace at its ends removed.
 * @throws {TranscriptStructuringError} If the reply has no title, or a title of only whitespace.
 */
function requireSuggestedTitle(suggestedTitle: string | null): string {
	if (suggestedTitle === null || suggestedTitle.trim() === "") {
		throw new TranscriptStructuringError(
			"The model judged the lecturer's title not meaningful but proposed nothing to replace it with",
		);
	}
	return suggestedTitle.trim();
}

/**
 * The lecture after the title is decided: the lecture title, the workspace path,
 * and the identity changes for the runner to write (technical-design.md §4.2).
 * The workspace path changes when the stage renames the lecture files.
 */
type TitleResolution = {
	readonly lectureTitle: string;
	readonly workspaceRoot: string;
	readonly identityChanges: LectureIdentityChanges;
};

/**
 * Builds the base name of a lecture from its AI-derived title.
 *
 * @param args - The lecture and its new title.
 * @param args.context - The stage context.
 * @param args.title - The AI-derived title.
 * @returns The base name that the lecture files move to.
 * @throws {TranscriptStructuringError} If the title has no characters that a filename can use.
 */
function deriveBaseName({
	context,
	title,
}: {
	readonly context: StageContext;
	readonly title: string;
}): string {
	try {
		return baseNameForLecture({
			lectureNumber: context.lectureNumber,
			title,
			lectureDate: context.lectureDate,
		});
	} catch (error: unknown) {
		throw new TranscriptStructuringError(
			`The model proposed "${title}", which cannot be used in a filename: ${errorMessage(error)}`,
		);
	}
}

/**
 * Makes the AI-derived title the lecture title. It moves the lecture files to the
 * new base name, and gives the identity changes for the runner to write. The
 * caller must write the structured transcript first, because the move changes the
 * workspace path (technical-design.md §5, `transcript-structuring`, "Order of
 * Operations"). The runner writes the manifest after the stage returns. The runner
 * finds the workspace again by the lecture date (technical-design.md §4.2, §4.7).
 *
 * @param args - The lecture and its AI-derived title.
 * @param args.context - The stage context.
 * @param args.aiDerivedTitle - The AI-derived title.
 * @returns The new lecture title, the new workspace path and the identity changes.
 */
async function adoptDerivedTitle({
	context,
	aiDerivedTitle,
}: {
	readonly context: StageContext;
	readonly aiDerivedTitle: string;
}): Promise<TitleResolution> {
	const baseName = deriveBaseName({ context, title: aiDerivedTitle });
	const workspaceRoot = await renameLectureFiles({
		dirs: moduleDirs({ moduleRoot: context.moduleRoot }),
		workspaceRoot: context.workspaceRoot,
		lectureDate: context.lectureDate,
		baseName,
	});
	return {
		lectureTitle: aiDerivedTitle,
		workspaceRoot,
		identityChanges: {
			aiDerivedTitle,
			lectureTitle: aiDerivedTitle,
			baseName,
		},
	};
}

/**
 * Decides the lecture title from the title judgement of the model. There are
 * three outcomes (technical-design.md §5, `transcript-structuring`):
 *
 * - The provisional title is meaningful. Nothing changes.
 * - The lecture has a user title. Only the AI-derived title is recorded.
 * - Otherwise the AI-derived title becomes the lecture title, and the lecture files move.
 *
 * The debug log records the outcome, because every later stage names its output
 * from this title (technical-design.md §10).
 *
 * @param args - The reply and its lecture.
 * @param args.reply - The parsed reply.
 * @param args.context - The stage context.
 * @param args.logger - The logger that records the outcome.
 * @returns The lecture title, the workspace path after the outcome, and the identity changes.
 * @throws {TranscriptStructuringError} If the provisional title is not meaningful and the reply has no usable title.
 */
// Only the outcome that adopts the AI-derived title waits on the disk. The outcomes
// that keep the provisional title or the user title give a resolved promise at once.
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger has mutable properties that the rule cannot ignore. This function only writes log lines to it. CLAUDE.md permits a mutable type that a library requires.
function decideTitle({
	reply,
	context,
	logger,
}: {
	readonly reply: StructuringReply;
	readonly context: StageContext;
	readonly logger: Logger;
}): Promise<TitleResolution> {
	/**
	 * Gives the lecture with its current title and workspace path.
	 *
	 * @param identityChanges - The identity changes for the runner to write.
	 * @returns The resolution of an outcome that moves no lecture file.
	 */
	const whereItStands = (identityChanges: LectureIdentityChanges): Promise<TitleResolution> =>
		Promise.resolve({
			lectureTitle: context.lectureTitle,
			workspaceRoot: context.workspaceRoot,
			identityChanges,
		});

	if (reply.provisionalTitleMeaningful) {
		logger.debug(
			{ lectureTitle: context.lectureTitle, outcome: "kept-provisional" },
			"Decided lecture title",
		);
		return whereItStands({});
	}
	const aiDerivedTitle = requireSuggestedTitle(reply.suggestedTitle);
	if (context.manifest.userTitle === null) {
		logger.debug({ aiDerivedTitle, outcome: "adopted-derived" }, "Decided lecture title");
		return adoptDerivedTitle({ context, aiDerivedTitle });
	}
	// A user title outranks the AI-derived title. The AI-derived title is still
	// recorded (technical-design.md §5, `transcript-structuring`).
	logger.debug(
		{ aiDerivedTitle, lectureTitle: context.lectureTitle, outcome: "kept-user-title" },
		"Decided lecture title",
	);
	return whereItStands({ aiDerivedTitle });
}

/**
 * Structures the transcript and decides the lecture title in one model call. It
 * writes `Structured transcript/structured-transcript.md`. It moves the lecture
 * files when the AI-derived title becomes the lecture title
 * (technical-design.md §5, `transcript-structuring`).
 *
 * @param args - The input, the stage context and the dependencies of the stage.
 * @param args.input - The transcript to structure.
 * @param args.context - The stage context.
 * @param args.logger - The logger that records the model call.
 * @param args.client - The OpenRouter client that sends the call.
 * @param args.sendGate - The send gate of this stage run. The model call waits on it.
 * @returns The structured transcript path, the lecture title, the identity changes, the cost of the call and the file written.
 * @throws {TranscriptStructuringError} If the reply is unusable, or if the stage needs an AI-derived title and the reply has no usable one.
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
	const { reply: replied, cost } = await requestJsonReply({
		messages: buildStructuringMessages({
			transcriptText: input.transcriptText,
			provisionalTitle: context.provisionalTitle,
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
	// An absent title and a null title mean the same. The stage makes them one
	// value, `null`, here, so that no code after this line has to check for both.
	const reply: StructuringReply = { ...replied, suggestedTitle: replied.suggestedTitle ?? null };

	const { filesWritten } = await writeStageOutput({
		stageId: STAGE_ID,
		workspaceRoot: context.workspaceRoot,
		content: reply.structuredMarkdown,
	});
	const decided = await decideTitle({ reply, context, logger });

	return {
		output: {
			// The path uses the workspace path after the title is decided. A move of the
			// workspace also moves the file that the stage wrote.
			structuredTranscriptPath: stageOutputPath({
				workspaceRoot: decided.workspaceRoot,
				stageId: STAGE_ID,
			}),
			lectureTitle: decided.lectureTitle,
		},
		cost,
		filesWritten,
		identityChanges: decided.identityChanges,
	};
}

/**
 * Builds the `transcript-structuring` stage from the logger and the OpenRouter client
 * of the invocation (technical-design.md §5, `transcript-structuring`).
 */
export const createTranscriptStructuringStage: ModelStageFactory<
	TranscriptStructuringInput,
	TranscriptStructuringOutput
> = defineModelStage({ stageId: STAGE_ID, getInput: readTranscript, run: structureTranscript });
