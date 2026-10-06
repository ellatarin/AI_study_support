/* jscpd:ignore-start -- every stage imports the same pipeline types, error and
   file helpers. So the import blocks of sibling stages are the same line for
   line. Imports cannot be shared, and CLAUDE.md (File Organisation) forbids
   barrel files. Only the imports are exempt. jscpd checks the code below. */
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
 * The error when the transcript or the structured transcript is missing or holds
 * no text, or when the reply is unusable. A verdict never causes it
 * (technical-design.md §5, `transcript-verification`).
 */
export class TranscriptVerificationError extends NamedError {}

/** The transcript and the structured transcript that `transcript-verification` compares. */
export type TranscriptVerificationInput = {
	/** The full text of `Transcript/transcript.txt`. */
	readonly transcriptText: string;
	/** The full text of `Structured transcript/structured-transcript.md`. */
	readonly structuredTranscriptText: string;
};

/** The path of the verification report, and the number of deficiencies in it. */
export type TranscriptVerificationOutput = {
	/** The absolute path of `Transcript verification/verification-report.json`. */
	readonly verificationReportPath: string;
	/** No count of deficiencies fails a stage or a pipeline run (technical-design.md §5, `transcript-verification`). */
	readonly deficiencyCount: number;
};

const STAGE_ID = "transcript-verification";

/** The indent of the verification report on disk. A person reads the file, as well as a parser. */
const REPORT_INDENT = 2;

/**
 * The deficiency types that the checker of this stage can report: the faults of
 * faithfulness, and `other`. The prose faults are not offered, because this call
 * has no notes to judge the prose of (technical-design.md §5, `qa-loop`). A
 * checker that is offered a deficiency type it cannot judge will report a
 * deficiency of that type.
 */
const VERIFICATION_TYPES = new Set([
	"omission",
	"underexplained",
	"distortion",
	"unsourced-addition",
	"other",
]);

const SEVERITIES = new Set<string>(QA_SEVERITIES);

/* jscpd:ignore-start -- the division stages share this reader in stage-input.ts.
   This stage keeps its own copy, with no change, until the stage is deleted. */
/**
 * Reads the output file of an earlier stage. The two reads of this stage share
 * one function, so that the two messages for a missing file cannot become
 * different.
 *
 * @param args - The stage context, and the stage whose output to read.
 * @param args.context - The stage context.
 * @param args.stageId - The stage whose output file to read. Only a stage that writes one.
 * @param args.producedBy - The name of that stage in the message for a missing file.
 * @returns The text of the file.
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
 * Reads the transcript and the structured transcript that the checker compares.
 *
 * @param context - The stage context.
 * @returns The transcript and the structured transcript.
 * @throws {TranscriptVerificationError} If either file is missing or holds no text.
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
 * Checks that a parsed value is a source passage.
 *
 * @param value - The parsed value.
 * @returns `true` when `evidence` and `location` are both strings.
 */
function isSourcePassage(value: unknown): value is QaSourcePassage {
	return (
		isRecord(value) && typeof value.evidence === "string" && typeof value.location === "string"
	);
}

/**
 * Checks that a parsed deficiency has every field, and a deficiency type that
 * the checker of this stage was offered. A deficiency of another deficiency type
 * makes the reply unusable, for two reasons. The model judged something that the prompt did
 * not ask for. Also, a report can be compared with the assessments in
 * `docs/quality/` only if it uses their deficiency types.
 *
 * @param value - The parsed deficiency.
 * @returns `true` when the value is a {@link QaDeficiency}.
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
 * Checks that a parsed entry is a consideration.
 *
 * @param value - The parsed entry.
 * @returns `true` when the value is a {@link QaConsideration}.
 */
function isConsideration(value: unknown): value is QaConsideration {
	return isRecord(value) && isSourcePassage(value.source) && typeof value.whyNotRaised === "string";
}

/**
 * Checks that a parsed reply is a verification report.
 *
 * @param value - The parsed reply.
 * @returns `true` when the value is a {@link QaCheckerReport}.
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

/** The text that ends the failure "The model's reply is not the documented …". */
const DOCUMENTED_REPORT_SHAPE =
	"{ overallVerdict, coverageScore, deficiencies, considered } report";

/**
 * Compares the structured transcript with the transcript in one model call. It
 * writes the verification report and the verification report Markdown
 * (technical-design.md §5, `transcript-verification`). The stage completes
 * whatever the verdict is, because the report only tells the user. It does not
 * gate the pipeline run.
 *
 * @param args - The input, the stage context and the dependencies of the stage.
 * @param args.input - The transcript and the structured transcript.
 * @param args.context - The stage context.
 * @param args.logger - The logger that records the model call.
 * @param args.client - The OpenRouter client that sends the call.
 * @param args.sendGate - The send gate of this stage run. The model call waits on it.
 * @returns The report path, the number of deficiencies, the cost of the call and the two files written.
 * @throws {TranscriptVerificationError} If the reply is unusable.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger has mutable properties that the rule cannot ignore. This function only writes log lines to it. CLAUDE.md permits a mutable type that a library requires.
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
 * Builds the `transcript-verification` stage from the logger and the OpenRouter
 * client of the invocation (technical-design.md §5, `transcript-verification`).
 */
export const createTranscriptVerificationStage: ModelStageFactory<
	TranscriptVerificationInput,
	TranscriptVerificationOutput
> = defineModelStage({ stageId: STAGE_ID, getInput: readBothVersions, run: verifyTranscript });
