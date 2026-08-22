/* jscpd:ignore-start -- every stage pulls in the same pipeline types, error, and
   file helpers, so sibling stages' import blocks match line for line. There is
   nothing to extract: imports cannot be shared, and barrel files are forbidden
   (CLAUDE.md, File Organisation). Only the imports are exempt; the code below is
   checked as normal. */
import { readFile } from "node:fs/promises";
import type { Logger } from "pino";
import type {
	LectureIdentityChanges,
	PipelineStage,
	StageContext,
	StageResult,
} from "../../types/pipeline.js";
import { errorMessage, NamedError } from "../../utils/errors.js";
import { writeFileAtomic } from "../../utils/files.js";
import { moduleDirs, stageOutputEntry, stageOutputPath } from "../layout.js";
import { baseNameForLecture, renameLectureFiles } from "../lecture-files.js";
import { makeCompletionCall } from "../openrouter.js";
import { createPipelineStage } from "./pipeline-stage.js";
import { buildStructuringMessages } from "./transcript-structuring.prompt.js";
/* jscpd:ignore-end */

/**
 * Thrown when the transcript cannot be structured: it is missing or empty, the
 * model's reply is not the documented JSON object, or the model judged the
 * lecturer's title unusable yet proposed nothing that can stand in its place. A
 * failed cost lookup is NOT one of these — cost telemetry never gates pipeline
 * progress (technical-design.md §5, Stage 3; §7).
 */
export class TranscriptStructuringError extends NamedError {}

/** The transcript Stage 3 structures. */
export type TranscriptStructuringInput = {
	/** The full text of `Transcript/transcript.txt`. */
	readonly transcriptText: string;
};

/** The structured transcript Stage 3 produces, and the title it settled on. */
export type TranscriptStructuringOutput = {
	/** Absolute path to the written `Structured transcript/structured-transcript.md`. */
	readonly structuredTranscriptPath: string;
	/** The lecture's title after Stage 3, which downstream stages name output from. */
	readonly lectureTitle: string;
};

const STAGE_ID = "transcript-structuring";

/** The object Stage 3's single call is contracted to return. */
type StructuringReply = {
	readonly provisionalTitleMeaningful: boolean;
	readonly suggestedTitle: string | null;
	readonly structuredMarkdown: string;
};

/**
 * Reads and validates the transcript Stage 2 wrote.
 *
 * @param context - The current lecture run context.
 * @returns The transcript text.
 * @throws {TranscriptStructuringError} If the transcript is missing or holds no text.
 */
async function readTranscript(context: StageContext): Promise<TranscriptStructuringInput> {
	// Asked of the layout rather than restated here, so this stage and the stage
	// that wrote the transcript cannot disagree about where it is (§3.3).
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
 * Whether a parsed reply carries the three documented fields with the right
 * types. `suggestedTitle` is accepted as absent as well as `null`, since a model
 * omitting a null field means the same thing as sending one.
 *
 * @param value - The parsed reply to check.
 * @returns `true` when the value is a usable {@link StructuringReply}.
 */
function isStructuringReply(value: unknown): value is StructuringReply {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const candidate = value as Partial<Record<keyof StructuringReply, unknown>>;
	const { suggestedTitle } = candidate;
	return (
		typeof candidate.provisionalTitleMeaningful === "boolean" &&
		typeof candidate.structuredMarkdown === "string" &&
		(suggestedTitle === null || suggestedTitle === undefined || typeof suggestedTitle === "string")
	);
}

/**
 * Parses the model's reply into the documented object.
 *
 * Worth validating rather than trusting: JSON mode is a routing preference, not
 * a guarantee, so a model whose providers cannot honour it answers in prose and
 * the request still succeeds (technical-design.md §6).
 *
 * @param content - The raw reply text.
 * @returns The parsed reply.
 * @throws {TranscriptStructuringError} If the reply is not JSON, or not the documented object.
 */
function parseReply(content: string): StructuringReply {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch (error: unknown) {
		throw new TranscriptStructuringError(
			`The model answered with something other than JSON (${errorMessage(error)})`,
		);
	}
	if (!isStructuringReply(parsed)) {
		throw new TranscriptStructuringError(
			"The model's reply is not the documented { provisionalTitleMeaningful, suggestedTitle, structuredMarkdown } object",
		);
	}
	return { ...parsed, suggestedTitle: parsed.suggestedTitle ?? null };
}

/**
 * Writes the structured transcript atomically (technical-design.md §4.3); the
 * directory it lands in is prepared by the stage factory before `run` begins.
 *
 * @param args - The write inputs.
 * @param args.workspaceRoot - Absolute path to the lecture workspace.
 * @param args.markdown - The structured markdown to write.
 * @returns A promise that resolves once the file is in place.
 */
async function writeStructuredTranscript({
	workspaceRoot,
	markdown,
}: {
	readonly workspaceRoot: string;
	readonly markdown: string;
}): Promise<void> {
	await writeFileAtomic({
		path: stageOutputPath({ workspaceRoot, stageId: STAGE_ID }),
		content: markdown,
	});
}

/**
 * The title the model proposed, insisting it actually proposed one.
 *
 * @param suggestedTitle - The title from the reply.
 * @returns The trimmed title.
 * @throws {TranscriptStructuringError} If nothing usable was proposed.
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
 * Where the lecture stands once Stage 3 has settled its title: the title itself,
 * the workspace's path (which the stage may just have moved), and the identity
 * the runner is to write into the manifest (technical-design.md §4.2).
 */
type TitleResolution = {
	readonly lectureTitle: string;
	readonly workspaceRoot: string;
	readonly identityChanges: LectureIdentityChanges;
};

/**
 * The canonical base name for a lecture retitled by the model.
 *
 * @param args - The lecture and its new title.
 * @param args.context - The current lecture run context.
 * @param args.title - The model's proposed title.
 * @returns The base name the lecture's files are renamed onto.
 * @throws {TranscriptStructuringError} If the title has no characters usable in a filename.
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
 * Adopts the model's title: moves the lecture's files onto the matching base
 * name, and settles the identity the runner will record.
 *
 * The rename comes after the structured transcript has been written, so that
 * write lands at a path that still exists; the manifest is the runner's to write
 * afterwards, and it re-locates the workspace by date to do it
 * (technical-design.md §5, Stage 3; §4.2, §4.7).
 *
 * @param args - The lecture and the title to adopt.
 * @param args.context - The current lecture run context.
 * @param args.aiDerivedTitle - The title the model proposed.
 * @returns The adopted title, the workspace's new path, and the identity settled.
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
			workspaceFolderName: baseName,
		},
	};
}

/**
 * Settles the lecture's title on the model's judgement.
 *
 * Three outcomes: the lecturer's title stands and nothing is settled; the user
 * has named the lecture themselves, so their title outranks the model's and only
 * `aiDerivedTitle` is settled; or the model's title is adopted and the lecture's
 * files move with it (technical-design.md §5, Stage 3).
 *
 * Each outcome is logged, because which one happened is what explains the
 * lecture's name from here on: every later stage names its output from the title
 * settled here (technical-design.md §10).
 *
 * @param args - The reply and the lecture it concerns.
 * @param args.reply - The model's parsed reply.
 * @param args.context - The current lecture run context.
 * @param args.logger - The stage's logger, which records which outcome was taken.
 * @returns The effective title, the workspace's path afterwards, and the identity for the runner to record.
 * @throws {TranscriptStructuringError} If a replacement is called for but none was proposed.
 */
// Only one of the three outcomes touches the disk; the other two resolve
// immediately.
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger carries mutable properties the rule cannot see past; it is only logged to here (CLAUDE.md permits dropping readonly where a library requires a mutable type)
function settleTitle({
	reply,
	context,
	logger,
}: {
	readonly reply: StructuringReply;
	readonly context: StageContext;
	readonly logger: Logger;
}): Promise<TitleResolution> {
	/**
	 * The lecture as it stands, with nothing on disk moved.
	 *
	 * @param identityChanges - The identity the runner is to record, if any.
	 * @returns The resolution for an outcome that renames nothing.
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
			"Settled lecture title",
		);
		return whereItStands({});
	}
	const aiDerivedTitle = requireSuggestedTitle(reply.suggestedTitle);
	if (context.manifest.userTitle === null) {
		logger.debug({ aiDerivedTitle, outcome: "adopted-derived" }, "Settled lecture title");
		return adoptDerivedTitle({ context, aiDerivedTitle });
	}
	// The user named this lecture, which outranks anything the model derives. What
	// it derived is still recorded — it is a true fact about the transcript, and
	// what the title falls back to were the user's ever cleared.
	logger.debug(
		{ aiDerivedTitle, lectureTitle: context.lectureTitle, outcome: "kept-user-title" },
		"Settled lecture title",
	);
	return whereItStands({ aiDerivedTitle });
}

/**
 * Structures the transcript and settles the lecture's title in a single call,
 * writing `Structured transcript/structured-transcript.md` and renaming the
 * lecture's files when the model replaces the title (technical-design.md §5,
 * Stage 3).
 *
 * @param args - The run inputs.
 * @param args.input - The transcript to structure.
 * @param args.context - The current lecture run context.
 * @param args.logger - The run's logger, on which the model call is recorded.
 * @returns The structured transcript's path, the settled title, the identity for the runner to record, the call's cost, and the file written.
 * @throws {TranscriptStructuringError} If the reply is unusable or a needed title is missing.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger carries mutable properties the rule cannot see past; it is only logged to here (CLAUDE.md permits dropping readonly where a library requires a mutable type)
async function structureTranscript({
	input,
	context,
	logger,
}: {
	readonly input: TranscriptStructuringInput;
	readonly context: StageContext;
	readonly logger: Logger;
}): Promise<StageResult<TranscriptStructuringOutput>> {
	const { content, cost } = await makeCompletionCall({
		messages: buildStructuringMessages({
			transcriptText: input.transcriptText,
			provisionalTitle: context.provisionalTitle,
		}),
		stageId: STAGE_ID,
		config: context.config,
		responseFormat: "json",
		logger,
	});
	const reply = parseReply(content);

	await writeStructuredTranscript({
		workspaceRoot: context.workspaceRoot,
		markdown: reply.structuredMarkdown,
	});
	const settled = await settleTitle({ reply, context, logger });

	return {
		output: {
			// Resolved against where the workspace ended up: settling the title may have
			// moved it, taking the file just written along with it.
			structuredTranscriptPath: stageOutputPath({
				workspaceRoot: settled.workspaceRoot,
				stageId: STAGE_ID,
			}),
			lectureTitle: settled.lectureTitle,
		},
		cost,
		filesWritten: [stageOutputEntry(STAGE_ID)],
		identityChanges: settled.identityChanges,
	};
}

/**
 * Builds Stage 3, which structures `Transcript/transcript.txt` into
 * `Structured transcript/structured-transcript.md` and settles the lecture's
 * title, renaming the lecture's files when it replaces one
 * (technical-design.md §5, Stage 3).
 *
 * @param args - The stage's dependencies.
 * @param args.logger - The run's logger; the factory binds it to this stage.
 * @returns The transcript-structuring stage.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger carries mutable properties the rule cannot see past; it is only read from here (CLAUDE.md permits dropping readonly where a library requires a mutable type)
export function createTranscriptStructuringStage({
	logger,
}: {
	readonly logger: Logger;
}): PipelineStage<TranscriptStructuringInput, TranscriptStructuringOutput> {
	return createPipelineStage({
		stageId: STAGE_ID,
		logger,
		getInput: readTranscript,
		run: structureTranscript,
	});
}
