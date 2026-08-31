/* jscpd:ignore-start -- every stage pulls in the same pipeline types, error, and
   file helpers, so sibling stages' import blocks match line for line. There is
   nothing to extract: imports cannot be shared, and barrel files are forbidden
   (CLAUDE.md, File Organisation). Only the imports are exempt; the code below is
   checked as normal. */
import { readFile } from "node:fs/promises";
import type {
	PipelineStage,
	QaConsideration,
	QaDeficiency,
	QaFindingsReport,
	QaSourceAnchor,
	StageContext,
	StageResult,
} from "../../types/pipeline.js";
import { errorMessage, NamedError } from "../../utils/errors.js";
import { isRecord } from "../../utils/record.js";
import { type StageWithOutputFile, stageOutputPath } from "../layout.js";
import {
	type ModelStageDependencies,
	type ModelStageRunArgs,
	requestJsonReply,
} from "./model-stage.js";
import { createPipelineStage, writeStageOutput } from "./pipeline-stage.js";
import { buildVerificationMessages } from "./transcript-verification.prompt.js";
/* jscpd:ignore-end */

/**
 * Thrown when the structured transcript cannot be verified: either version is
 * missing or empty, or the checker's reply is not the documented report.
 *
 * A report full of findings is emphatically NOT one of these — that is the stage
 * working. Nothing about a verdict fails this stage (technical-design.md §5,
 * Stage 4).
 */
export class TranscriptVerificationError extends NamedError {}

/** The two versions Stage 4 compares. */
export type TranscriptVerificationInput = {
	/** The full text of `Transcript/transcript.txt`, as Stage 2 wrote it. */
	readonly transcriptText: string;
	/** The full text of `Structured transcript/structured-transcript.md`, as Stage 3 wrote it. */
	readonly structuredTranscriptText: string;
};

/** Where Stage 4's report landed, and how much it found. */
export type TranscriptVerificationOutput = {
	/** Absolute path to the written `Transcript verification/verification-report.json`. */
	readonly verificationReportPath: string;
	/**
	 * How many findings the report carries. Surfaced so the runner can say what
	 * the stage did without reading the file — and never acted on: no count
	 * fails a stage or a run (technical-design.md §5, Stage 4).
	 */
	readonly findingCount: number;
};

const STAGE_ID = "transcript-verification";

/** How the report is indented on disk: written for a person to read, not only a parser. */
const REPORT_INDENT = 2;

/**
 * The categories this stage's checker may report.
 *
 * The faithfulness half of `QaDeficiencyType`. The prose categories are absent
 * because this call compares two transcripts and has no notes to judge the
 * writing of, and a checker offered a category it cannot judge will find one
 * (technical-design.md Stage 8).
 */
const VERIFICATION_TYPES = new Set([
	"omission",
	"underexplained",
	"distortion",
	"unsourced-addition",
	"other",
]);

/** The severities a finding may carry, as `QaSeverity` declares them. */
const SEVERITIES = new Set(["critical", "major", "minor"]);

/**
 * Reads one of the two versions being compared, insisting it holds text.
 *
 * Both reads are the same act against a different stage's output, so they are
 * one function: written twice, the two could drift into reporting a missing
 * file differently, and which file is missing is the whole content of the
 * message.
 *
 * @param args - Which stage's output to read, and for whom.
 * @param args.context - The current lecture run context.
 * @param args.stageId - The stage whose output file to read; only a stage that writes one.
 * @param args.producedBy - How to name the stage in a failure the user reads.
 * @returns The file's text.
 * @throws {TranscriptVerificationError} If the file is missing or holds no text.
 */
async function readStageText({
	context,
	stageId,
	producedBy,
}: {
	readonly context: StageContext;
	readonly stageId: StageWithOutputFile;
	readonly producedBy: string;
}): Promise<string> {
	const path = stageOutputPath({ workspaceRoot: context.workspaceRoot, stageId });
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (error: unknown) {
		throw new TranscriptVerificationError(
			`No file at ${path}; run ${producedBy} first (${errorMessage(error)})`,
		);
	}
	if (text.trim() === "") {
		throw new TranscriptVerificationError(
			`The file at ${path} holds no text; there is nothing to verify`,
		);
	}
	return text;
}

/**
 * Reads both versions the checker compares.
 *
 * @param context - The current lecture run context.
 * @returns The raw transcript and the structured one.
 * @throws {TranscriptVerificationError} If either is missing or holds no text.
 */
async function readBothVersions(context: StageContext): Promise<TranscriptVerificationInput> {
	return {
		transcriptText: await readStageText({
			context,
			stageId: "transcription",
			producedBy: "transcription",
		}),
		structuredTranscriptText: await readStageText({
			context,
			stageId: "transcript-structuring",
			producedBy: "transcript structuring",
		}),
	};
}

/**
 * Whether a value is the `{ evidence, location }` pair a finding points at its
 * source with.
 *
 * @param value - The parsed value to check.
 * @returns `true` when both fields are present as strings.
 */
function isSourceAnchor(value: unknown): value is QaSourceAnchor {
	return (
		isRecord(value) && typeof value.evidence === "string" && typeof value.location === "string"
	);
}

/**
 * Whether a parsed finding carries every documented field, with a category this
 * stage's checker was actually offered.
 *
 * A category outside the offered set is rejected rather than passed through: it
 * means the model answered about something it was not asked to judge, and a
 * report is only comparable with the committed assessments if its vocabulary is
 * the one they use.
 *
 * @param value - The parsed finding to check.
 * @returns `true` when the value is a usable {@link QaDeficiency}.
 */
function isDeficiency(value: unknown): value is QaDeficiency {
	if (!isRecord(value)) {
		return false;
	}
	const { source } = value;
	return (
		typeof value.severity === "string" &&
		SEVERITIES.has(value.severity) &&
		typeof value.type === "string" &&
		VERIFICATION_TYPES.has(value.type) &&
		typeof value.description === "string" &&
		typeof value.suggestedFix === "string" &&
		typeof value.outputLocation === "string" &&
		(source === null || isSourceAnchor(source))
	);
}

/**
 * Whether a parsed entry is something the checker examined and cleared.
 *
 * @param value - The parsed entry to check.
 * @returns `true` when the value is a usable {@link QaConsideration}.
 */
function isConsideration(value: unknown): value is QaConsideration {
	return isRecord(value) && isSourceAnchor(value.source) && typeof value.whyNotRaised === "string";
}

/**
 * Whether a parsed reply is the documented report.
 *
 * @param value - The parsed reply to check.
 * @returns `true` when the value is a usable {@link QaFindingsReport}.
 */
function isFindingsReport(value: unknown): value is QaFindingsReport {
	if (!isRecord(value)) {
		return false;
	}
	const { deficiencies, considered, overallVerdict } = value;
	return (
		(overallVerdict === "pass" || overallVerdict === "fail") &&
		typeof value.coverageScore === "number" &&
		Array.isArray(deficiencies) &&
		deficiencies.every(isDeficiency) &&
		Array.isArray(considered) &&
		considered.every(isConsideration)
	);
}

/** The report's shape in words, for the failure a user reads when a reply is not one. */
const DOCUMENTED_REPORT_SHAPE =
	"{ overallVerdict, coverageScore, deficiencies, considered } report";

/**
 * Compares the structured transcript with the raw one and writes what the
 * checker found (technical-design.md §5, Stage 4).
 *
 * The verdict is recorded and never acted on. A report saying the structuring
 * lost half the lecture completes exactly as a clean one does: this stage exists
 * to tell the user something, and a checker that can stop a run is one whose
 * false positives cost them the run.
 *
 * @param args - The run inputs.
 * @param args.input - The two versions to compare.
 * @param args.context - The current lecture run context.
 * @param args.logger - The run's logger, on which the model call is recorded.
 * @param args.client - The OpenAI client the completion goes through.
 * @returns The report's path, how much it found, the call's cost, and the file written.
 * @throws {TranscriptVerificationError} If the reply is not the documented report.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger carries mutable properties the rule cannot see past; it is only logged to here (CLAUDE.md permits dropping readonly where a library requires a mutable type)
async function verifyTranscript({
	input,
	context,
	logger,
	client,
}: ModelStageRunArgs<TranscriptVerificationInput>): Promise<
	StageResult<TranscriptVerificationOutput>
> {
	const { reply: report, cost } = await requestJsonReply({
		messages: buildVerificationMessages({
			transcriptText: input.transcriptText,
			structuredTranscriptText: input.structuredTranscriptText,
		}),
		stageId: STAGE_ID,
		context,
		isReply: isFindingsReport,
		documentedShape: DOCUMENTED_REPORT_SHAPE,
		fail: (message) => new TranscriptVerificationError(message),
		logger,
		client,
	});
	/* jscpd:ignore-start -- every stage that writes one output calls writeStageOutput
	   with its own id, its workspace and its content, so the call reads the same in
	   each. The shared code is the function being called; there is nothing left in a
	   call to it to extract. */
	const { path, filesWritten } = await writeStageOutput({
		stageId: STAGE_ID,
		workspaceRoot: context.workspaceRoot,
		content: JSON.stringify(report, null, REPORT_INDENT),
	});
	/* jscpd:ignore-end */
	// Recorded, not acted on: the count says what the stage found, and the stage
	// completes whatever it is.
	logger.info(
		{ findings: report.deficiencies.length, verdict: report.overallVerdict },
		"Transcript verified",
	);
	return {
		output: { verificationReportPath: path, findingCount: report.deficiencies.length },
		cost,
		filesWritten,
	};
}

/**
 * Builds Stage 4, which compares `Structured transcript/structured-transcript.md`
 * with the `Transcript/transcript.txt` it was made from and writes
 * `Transcript verification/verification-report.json` (technical-design.md §5,
 * Stage 4).
 *
 * @param args - The stage's dependencies.
 * @param args.logger - The run's logger; the factory binds it to this stage.
 * @param args.client - The invocation's OpenAI client, handed to the stage as the logger is (§4.7).
 * @returns The transcript-verification stage.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger and the OpenAI client carry mutable properties the rule cannot see past; both are only read from here (CLAUDE.md permits dropping readonly where a library requires a mutable type)
export function createTranscriptVerificationStage({
	logger,
	client,
}: ModelStageDependencies): PipelineStage<
	TranscriptVerificationInput,
	TranscriptVerificationOutput
> {
	return createPipelineStage({
		stageId: STAGE_ID,
		logger,
		getInput: readBothVersions,
		run: (args) => verifyTranscript({ ...args, client }),
	});
}
