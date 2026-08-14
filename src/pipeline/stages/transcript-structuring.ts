/* jscpd:ignore-start -- every stage pulls in the same pipeline types, error, and
   file helpers, so sibling stages' import blocks match line for line. There is
   nothing to extract: imports cannot be shared, and barrel files are forbidden
   (CLAUDE.md, File Organisation). Only the imports are exempt; the code below is
   checked as normal. */
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
	PipelineStage,
	RunManifest,
	StageContext,
	StageResult,
} from "../../types/pipeline.js";
import { errorMessage, NamedError } from "../../utils/errors.js";
import { cleanTmpFiles, workspacePath, writeFileAtomic } from "../../utils/files.js";
import { baseNameForLecture, renameLectureFiles } from "../lecture-files.js";
import { writeManifest } from "../manifest.js";
import { makeCompletionCall } from "../openrouter.js";
import { createPipelineStage } from "./pipeline-stage.js";
import { moduleDirs } from "./source-normalisation.js";
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
const TRANSCRIPT_SEGMENTS = ["Transcript", "transcript.txt"] as const;
const STRUCTURED_DIR = "Structured transcript";
const STRUCTURED_FILE = "structured-transcript.md";
const STRUCTURED_ENTRY = join(STRUCTURED_DIR, STRUCTURED_FILE);

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
	const transcriptPath = workspacePath({
		workspaceRoot: context.workspaceRoot,
		segments: [...TRANSCRIPT_SEGMENTS],
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
 * Writes the structured transcript atomically, clearing any partial file a
 * killed run left behind (technical-design.md §4.3).
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
	const directory = workspacePath({ workspaceRoot, segments: [STRUCTURED_DIR] });
	await mkdir(directory, { recursive: true });
	await cleanTmpFiles(directory);
	await writeFileAtomic({ path: join(directory, STRUCTURED_FILE), content: markdown });
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

/** Where the lecture stands once Stage 3 has settled its title. */
type TitleResolution = {
	readonly lectureTitle: string;
	readonly workspaceRoot: string;
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
 * Writes changed lecture identity back to the manifest, stamped with now.
 *
 * Written where the workspace currently stands, which is what makes the order of
 * operations matter: the folder moves only after this (technical-design.md §5,
 * Stage 3).
 *
 * @param args - The lecture and what changed about it.
 * @param args.context - The current lecture run context.
 * @param args.changes - The identity fields to overwrite.
 * @returns A promise that resolves once the manifest is written.
 */
async function recordIdentity({
	context,
	changes,
}: {
	readonly context: StageContext;
	readonly changes: Partial<RunManifest>;
}): Promise<void> {
	await writeManifest({
		workspaceRoot: context.workspaceRoot,
		manifest: { ...context.manifest, ...changes, updatedAt: new Date().toISOString() },
	});
}

/**
 * Adopts the model's title: records it in the manifest, then moves the lecture's
 * files onto the matching base name.
 *
 * The manifest is written while the workspace still stands where it is, and the
 * folder moves last, so every write lands at a path that exists — and the runner
 * finds the workspace again by date afterwards (technical-design.md §5, Stage 3;
 * §4.7).
 *
 * @param args - The lecture and the title to adopt.
 * @param args.context - The current lecture run context.
 * @param args.aiDerivedTitle - The title the model proposed.
 * @returns The adopted title and the workspace's new path.
 */
async function adoptDerivedTitle({
	context,
	aiDerivedTitle,
}: {
	readonly context: StageContext;
	readonly aiDerivedTitle: string;
}): Promise<TitleResolution> {
	const baseName = deriveBaseName({ context, title: aiDerivedTitle });
	await recordIdentity({
		context,
		changes: {
			aiDerivedTitle,
			lectureTitle: aiDerivedTitle,
			workspaceFolderName: baseName,
		},
	});
	const workspaceRoot = await renameLectureFiles({
		dirs: moduleDirs({ moduleRoot: context.moduleRoot }),
		workspaceRoot: context.workspaceRoot,
		lectureDate: context.lectureDate,
		baseName,
	});
	return { lectureTitle: aiDerivedTitle, workspaceRoot };
}

/**
 * Settles the lecture's title on the model's judgement.
 *
 * Three outcomes: the lecturer's title stands and nothing is recorded; the user
 * has named the lecture themselves, so their title outranks the model's and only
 * `aiDerivedTitle` is recorded; or the model's title is adopted and the
 * lecture's files move with it (technical-design.md §5, Stage 3).
 *
 * @param args - The reply and the lecture it concerns.
 * @param args.reply - The model's parsed reply.
 * @param args.context - The current lecture run context.
 * @returns The effective title and the workspace's path afterwards.
 * @throws {TranscriptStructuringError} If a replacement is called for but none was proposed.
 */
async function settleTitle({
	reply,
	context,
}: {
	readonly reply: StructuringReply;
	readonly context: StageContext;
}): Promise<TitleResolution> {
	const unchanged = {
		lectureTitle: context.lectureTitle,
		workspaceRoot: context.workspaceRoot,
	};
	if (reply.provisionalTitleMeaningful) {
		return unchanged;
	}
	const aiDerivedTitle = requireSuggestedTitle(reply.suggestedTitle);
	if (context.manifest.userTitle === null) {
		return adoptDerivedTitle({ context, aiDerivedTitle });
	}
	// The user named this lecture, which outranks anything the model derives. What
	// it derived is still recorded — it is a true fact about the transcript, and
	// what the title falls back to were the user's ever cleared.
	await recordIdentity({ context, changes: { aiDerivedTitle } });
	return unchanged;
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
 * @returns The structured transcript's path, the settled title, the call's cost, and the file written.
 * @throws {TranscriptStructuringError} If the reply is unusable or a needed title is missing.
 */
async function structureTranscript({
	input,
	context,
}: {
	readonly input: TranscriptStructuringInput;
	readonly context: StageContext;
}): Promise<StageResult<TranscriptStructuringOutput>> {
	const { content, cost } = await makeCompletionCall({
		messages: buildStructuringMessages({
			transcriptText: input.transcriptText,
			provisionalTitle: context.provisionalTitle,
		}),
		stageId: STAGE_ID,
		config: context.config,
		responseFormat: "json",
	});
	const reply = parseReply(content);

	await writeStructuredTranscript({
		workspaceRoot: context.workspaceRoot,
		markdown: reply.structuredMarkdown,
	});
	const settled = await settleTitle({ reply, context });

	return {
		output: {
			// Resolved against where the workspace ended up: settling the title may have
			// moved it, taking the file just written along with it.
			structuredTranscriptPath: join(settled.workspaceRoot, STRUCTURED_ENTRY),
			lectureTitle: settled.lectureTitle,
		},
		cost,
		filesWritten: [STRUCTURED_ENTRY],
	};
}

/**
 * Builds Stage 3, which structures `Transcript/transcript.txt` into
 * `Structured transcript/structured-transcript.md` and settles the lecture's
 * title, renaming the lecture's files when it replaces one
 * (technical-design.md §5, Stage 3).
 *
 * @returns The transcript-structuring stage.
 */
export function createTranscriptStructuringStage(): PipelineStage<
	TranscriptStructuringInput,
	TranscriptStructuringOutput
> {
	return createPipelineStage({
		stageId: STAGE_ID,
		getInput: readTranscript,
		run: structureTranscript,
	});
}
