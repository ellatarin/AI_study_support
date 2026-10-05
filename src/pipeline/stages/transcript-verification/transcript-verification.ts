/* jscpd:ignore-start -- every stage pulls in the same pipeline types, error, and
   file helpers, so sibling stages' import blocks match line for line. There is
   nothing to extract: imports cannot be shared, and barrel files are forbidden
   (CLAUDE.md, File Organisation). Only the imports are exempt; the code below is
   checked as normal. */
import { readFile } from "node:fs/promises";
import {
	QA_SEVERITIES,
	type QaCheckerReport,
	type QaConsideration,
	type QaDeficiency,
	type QaSourcePassage,
	type StageContext,
	type StageResult,
} from "../../../types/pipeline.js";
import { errorMessage, NamedError } from "../../../utils/errors.js";
import { isRecord } from "../../../utils/record.js";
import { type StageWithOutputFile, stageOutputPath } from "../../layout.js";
import {
	defineModelStage,
	type ModelStageFactory,
	type ModelStageRunArgs,
	requestJsonReply,
} from "../model-stage.js";
import { writeStageOutputWithMarkdownVersion } from "../pipeline-stage.js";
import { buildVerificationMessages } from "./transcript-verification.prompt.js";
import { renderVerificationReportMarkdown } from "./transcript-verification.view.js";
/* jscpd:ignore-end */

/**
 * Thrown when the structured transcript cannot be verified: either version is
 * missing or empty, or the checker's reply is not the documented report.
 *
 * A report full of deficiencies is emphatically NOT one of these — that is the stage
 * working. Nothing about a verdict fails this stage (technical-design.md §5,
 * `transcript-verification`).
 */
export class TranscriptVerificationError extends NamedError {}

/** The two versions `transcript-verification` compares. */
export type TranscriptVerificationInput = {
	/** The full text of `Transcript/transcript.txt`, as `transcription` wrote it. */
	readonly transcriptText: string;
	/** The full text of `Structured transcript/structured-transcript.md`, as `transcript-structuring` wrote it. */
	readonly structuredTranscriptText: string;
};

/** Where this stage's report landed, and how much it found. */
export type TranscriptVerificationOutput = {
	/** Absolute path to the written `Transcript verification/verification-report.json`. */
	readonly verificationReportPath: string;
	/**
	 * How many deficiencies the report carries. Surfaced so the runner can say what
	 * the stage did without reading the file — and never acted on: no count
	 * fails a stage or a run (technical-design.md §5, `transcript-verification`).
	 */
	readonly deficiencyCount: number;
};

const STAGE_ID = "transcript-verification";

/** How the report is indented on disk: written for a person to read, not only a parser. */
const REPORT_INDENT = 2;

/**
 * The deficiency types this stage's checker may report.
 *
 * The faithfulness half of `QaDeficiencyType`. The prose fault types are absent
 * because this call compares two transcripts and has no notes to judge the
 * writing of, and a checker offered a deficiency type it cannot judge will find one
 * (technical-design.md §5, `qa-loop`).
 */
const VERIFICATION_TYPES = new Set([
	"omission",
	"underexplained",
	"distortion",
	"unsourced-addition",
	"other",
]);

/** The severities a deficiency may carry, as `QA_SEVERITIES` declares them. */
const SEVERITIES = new Set<string>(QA_SEVERITIES);

/* jscpd:ignore-start -- the division stages share this reader as stage-input.ts;
   this stage keeps its own copy, untouched, until the stage is deleted. */
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
/* jscpd:ignore-end */

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
 * Whether a value is the `{ evidence, location }` pair that names the source
 * passage a deficiency is about.
 *
 * @param value - The parsed value to check.
 * @returns `true` when both fields are present as strings.
 */
function isSourcePassage(value: unknown): value is QaSourcePassage {
	return (
		isRecord(value) && typeof value.evidence === "string" && typeof value.location === "string"
	);
}

/**
 * Whether a parsed deficiency carries every documented field, with a deficiency
 * type this stage's checker was actually offered.
 *
 * A deficiency type outside the offered set is rejected rather than passed through: it
 * means the model answered about something it was not asked to judge, and a
 * report is only comparable with the committed assessments if its vocabulary is
 * the one they use.
 *
 * @param value - The parsed deficiency to check.
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
		(source === null || isSourcePassage(source))
	);
}

/**
 * Whether a parsed entry is something the checker examined and cleared.
 *
 * @param value - The parsed entry to check.
 * @returns `true` when the value is a usable {@link QaConsideration}.
 */
function isConsideration(value: unknown): value is QaConsideration {
	return isRecord(value) && isSourcePassage(value.source) && typeof value.whyNotRaised === "string";
}

/**
 * Whether a parsed reply is the documented report.
 *
 * @param value - The parsed reply to check.
 * @returns `true` when the value is a usable {@link QaCheckerReport}.
 */
function isCheckerReport(value: unknown): value is QaCheckerReport {
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
 * checker found, both as the stored report and as a page a person reads
 * (technical-design.md §5, `transcript-verification`).
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
 * @param args.sendGate - The run's turns to send, which the call waits on.
 * @returns The report's path, how much it found, the call's cost, and both files written.
 * @throws {TranscriptVerificationError} If the reply is not the documented report.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger carries mutable properties the rule cannot see past; it is only logged to here (CLAUDE.md permits dropping readonly where a library requires a mutable type)
async function verifyTranscript({
	input,
	context,
	logger,
	client,
	sendGate,
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
		isReply: isCheckerReport,
		documentedShape: DOCUMENTED_REPORT_SHAPE,
		fail: (message) => new TranscriptVerificationError(message),
		logger,
		client,
		sendGate,
	});
	const { path, filesWritten } = await writeStageOutputWithMarkdownVersion({
		stageId: STAGE_ID,
		workspaceRoot: context.workspaceRoot,
		content: JSON.stringify(report, null, REPORT_INDENT),
		markdownVersion: renderVerificationReportMarkdown({ report }),
	});
	// Recorded, not acted on: the count says what the stage found, and the stage
	// completes whatever it is.
	logger.info(
		{ deficiencies: report.deficiencies.length, verdict: report.overallVerdict },
		"Transcript verified",
	);
	return {
		output: { verificationReportPath: path, deficiencyCount: report.deficiencies.length },
		cost,
		filesWritten,
	};
}

/**
 * Builds `transcript-verification`, which compares `Structured transcript/structured-transcript.md`
 * with the `Transcript/transcript.txt` it was made from and writes
 * `Transcript verification/verification-report.json`, with the verification
 * report Markdown, `verification-report.md`, beside it (technical-design.md §5, `transcript-verification`),
 * from the run's logger and the invocation's OpenAI client.
 */
export const createTranscriptVerificationStage: ModelStageFactory<
	TranscriptVerificationInput,
	TranscriptVerificationOutput
> = defineModelStage({ stageId: STAGE_ID, getInput: readBothVersions, run: verifyTranscript });
