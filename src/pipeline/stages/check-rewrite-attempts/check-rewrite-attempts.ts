/**
 * The `check-rewrite-attempts` stage. It checks each rewritten subtopic against
 * what the lecturer said (technical-design.md §5, `check-rewrite-attempts`).
 */

/* jscpd:ignore-start -- the model-calling stages import the same pipeline types,
   division helpers and model-stage helpers. So their import blocks are the
   same line for line. Imports cannot be shared, and CLAUDE.md (File
   Organisation) forbids barrel files. Only the imports are exempt. jscpd
   checks the code below. */
import { join, relative } from "node:path";
import type { StageContext } from "../../../types/pipeline.js";
import { NamedError } from "../../../utils/errors.js";
import { writeJsonAtomic } from "../../../utils/files.js";
import { isRecord } from "../../../utils/record.js";
import { stageDirectoryPath } from "../../layout.js";
import { FIRST_ROUND } from "../../manifest.js";
import { defineModelStage, type ModelStageFactory } from "../model-stage.js";
import {
	hasRewriteAttemptFields,
	type RewriteAttemptFields,
	type RewriteAttemptWork,
	readOrMakeRewriteAttempts,
} from "../rewrite-attempts.js";
import { readStageSubtopics } from "../stage-input.js";
import { readSubtopicRewrite } from "../subtopic-rewrites.js";
import { readTermCorrectionResult } from "../term-corrections.js";
import {
	buildCheckerMessages,
	CHECKER_PROMPT_VERSION,
	type MaterialToCheck,
} from "./check-rewrite-attempts.prompt.js";
/* jscpd:ignore-end */

/**
 * The error when an input file is missing or unreadable. A call whose third send
 * is still unusable fails the stage with `ResendsExhaustedError`.
 */
export class CheckRewriteAttemptsError extends NamedError {}

/**
 * Builds the stage's own error from a message.
 *
 * @param message - The message.
 * @returns The error.
 */
function fail(message: string): Error {
	return new CheckRewriteAttemptsError(message);
}

const STAGE_ID = "check-rewrite-attempts";

/** A subtopic, and what the checker gets for it. */
type SubtopicToCheck = { readonly subtopicId: number } & MaterialToCheck;

/** The subtopics to check, in lecture order. */
type CheckRewriteAttemptsInput = { readonly subtopics: readonly SubtopicToCheck[] };

/** A place where the rewrite is not faithful to the text (CONTEXT.md, "Checking quality"). */
type Deficiency = { readonly description: string } & (
	| {
			readonly deficiencyType: "omission";
			readonly sourcePassage: string;
			/** The words of the rewrite where the omitted fact should be, or `null` when the checker quotes none. */
			readonly rewritePassage: string | null;
	  }
	| {
			readonly deficiencyType: "distortion";
			readonly sourcePassage: string;
			readonly rewritePassage: string;
	  }
	| {
			readonly deficiencyType: "unsourced-addition";
			/** The source sentences that the addition is built on, or `null` when the checker quotes none. */
			readonly sourcePassage: string | null;
			readonly rewritePassage: string;
	  }
);

/** A passage that the checker examined and found not to be a deficiency, with the reason. */
type Consideration = { readonly sourcePassage: string; readonly reason: string };

/** The reply that the checker prompt asks for. */
type CheckerReply = {
	readonly deficiencies: readonly Deficiency[];
	readonly considerations: readonly Consideration[];
};

/** The form of one passage of a deficiency: a quote, or either a quote or `null`. */
type PassageForm = "quote" | "quote or null";

/** The form of each passage that a deficiency of each type gives. */
const PASSAGE_FORMS: Readonly<
	Record<
		Deficiency["deficiencyType"],
		{ readonly source: PassageForm; readonly rewrite: PassageForm }
	>
> = {
	omission: { source: "quote", rewrite: "quote or null" },
	distortion: { source: "quote", rewrite: "quote" },
	"unsourced-addition": { source: "quote or null", rewrite: "quote" },
};

/**
 * Checks that a passage of a deficiency has the form that the deficiency type gives it.
 *
 * @param args - The passage, and its form.
 * @param args.passage - The passage of the reply.
 * @param args.form - The form that the deficiency type gives the passage.
 * @returns `true` when the passage agrees with its type.
 */
function isPassageAsTyped({
	passage,
	form,
}: {
	readonly passage: unknown;
	readonly form: PassageForm;
}): boolean {
	const isQuote = typeof passage === "string";
	return form === "quote" ? isQuote : isQuote || passage === null;
}

/**
 * Checks that a value is a deficiency of a known type, with a description and
 * the passages of its type.
 *
 * @param value - One entry of the list of deficiencies.
 * @returns `true` when the value is a {@link Deficiency}.
 */
function isDeficiency(value: unknown): value is Deficiency {
	if (
		!isRecord(value) ||
		typeof value.description !== "string" ||
		typeof value.deficiencyType !== "string" ||
		!Object.hasOwn(PASSAGE_FORMS, value.deficiencyType)
	) {
		return false;
	}
	const forms = PASSAGE_FORMS[value.deficiencyType as Deficiency["deficiencyType"]];
	return (
		isPassageAsTyped({ passage: value.sourcePassage, form: forms.source }) &&
		isPassageAsTyped({ passage: value.rewritePassage, form: forms.rewrite })
	);
}

/**
 * Checks that a value is a consideration: a `sourcePassage` and a `reason`, both strings.
 *
 * @param value - One entry of the list of considerations.
 * @returns `true` when the value is a {@link Consideration}.
 */
function isConsideration(value: unknown): value is Consideration {
	return (
		isRecord(value) && typeof value.sourcePassage === "string" && typeof value.reason === "string"
	);
}

/** The check of one rewrite attempt of a subtopic, as the stage writes it (technical-design.md §5, `check-rewrite-attempts`). */
type SubtopicCheck = RewriteAttemptFields &
	CheckerReply & {
		readonly checkerPromptVersion: string;
	};

/** The output of `check-rewrite-attempts`. */
type CheckRewriteAttemptsOutput = {
	/** The check of each subtopic, in lecture order. */
	readonly checks: readonly SubtopicCheck[];
};

/** The text that ends the failure "The model's reply is not the documented …". */
const DOCUMENTED_REPLY_SHAPE = "{ deficiencies, considerations } object";

/**
 * Checks that a parsed reply has a list `deficiencies` of deficiencies and a
 * list `considerations` of considerations.
 *
 * @param value - The parsed reply.
 * @returns `true` when the value is a {@link CheckerReply}.
 */
function isCheckerReply(value: unknown): value is CheckerReply {
	return (
		isRecord(value) &&
		Array.isArray(value.deficiencies) &&
		value.deficiencies.every(isDeficiency) &&
		Array.isArray(value.considerations) &&
		value.considerations.every(isConsideration)
	);
}

/**
 * Checks that a parsed saved file is a subtopic check.
 *
 * @param value - The parsed file.
 * @returns `true` when the value is a {@link SubtopicCheck}.
 */
function isSubtopicCheck(value: unknown): value is SubtopicCheck {
	return (
		hasRewriteAttemptFields(value) &&
		typeof value.checkerPromptVersion === "string" &&
		isCheckerReply(value)
	);
}

/**
 * Reads, for each subtopic of the structured transcript, its text, the kept
 * corrections and the rewrite of the first rewrite attempt.
 *
 * @param context - The stage context.
 * @returns The subtopics to check, in lecture order.
 * @throws {CheckRewriteAttemptsError} If an input file is missing, unreadable or the wrong shape.
 */
async function readCheckRewriteAttemptsInput(
	context: StageContext,
): Promise<CheckRewriteAttemptsInput> {
	const subtopics = await readStageSubtopics({ context, purpose: "check", fail });
	const attempt = { context, attemptNumber: FIRST_ROUND, fail };
	return {
		subtopics: await Promise.all(
			subtopics.map(async ({ subtopicId, text }) => {
				const [{ corrections }, { rewrittenSubtopic }] = await Promise.all([
					readTermCorrectionResult({ ...attempt, subtopicId }),
					readSubtopicRewrite({ ...attempt, subtopicId }),
				]);
				return {
					subtopicId,
					text,
					corrections: corrections.map(({ wrongForm, rightForm, reason }) => ({
						wrongForm,
						rightForm,
						reason,
					})),
					rewrite: rewrittenSubtopic,
				};
			}),
		),
	};
}

/**
 * Checks the rewrite of one subtopic.
 *
 * @param args - The subtopic, the stage context and the model calls of the stage run.
 * @param args.subtopic - What the checker gets for the subtopic.
 * @param args.context - The stage context. It holds the language of the notes.
 * @param args.calls - The model calls of this stage run.
 * @returns The subtopic check.
 * @throws {ResendsExhaustedError} If the third send is still unusable.
 */
async function checkSubtopic({
	subtopic,
	context,
	calls,
}: RewriteAttemptWork<CheckRewriteAttemptsInput, SubtopicToCheck>): Promise<SubtopicCheck> {
	const { subtopicId, ...material } = subtopic;
	const sent = await calls.sendJsonWithResends({
		what: `Check of subtopic ${subtopicId}`,
		messages: buildCheckerMessages({ material, language: context.config.finalOutput.language }),
		isReply: isCheckerReply,
		documentedShape: DOCUMENTED_REPLY_SHAPE,
		use: (reply) => ({ reply }),
	});
	return {
		subtopicId,
		attemptNumber: FIRST_ROUND,
		checkerPromptVersion: CHECKER_PROMPT_VERSION,
		...sent.reply,
	};
}

/**
 * Writes the result file of the round, which names each subtopic whose check
 * found a deficiency. The runner reads it to decide the next round
 * (technical-design.md §4.7, "The rewrite loop").
 *
 * @param args - The workspace, and the check of each subtopic.
 * @param args.workspaceRoot - The absolute path to the lecture workspace.
 * @param args.checks - The check of each subtopic, in lecture order.
 * @returns The `filesWritten` entry of the result file.
 */
async function writeRoundResult({
	workspaceRoot,
	checks,
}: {
	readonly workspaceRoot: string;
	readonly checks: readonly SubtopicCheck[];
}): Promise<string> {
	const path = join(
		stageDirectoryPath({ workspaceRoot, stageId: STAGE_ID }),
		`round-${FIRST_ROUND}.json`,
	);
	await writeJsonAtomic({
		path,
		value: {
			round: FIRST_ROUND,
			failedSubtopicIds: checks
				.filter((check) => check.deficiencies.length > 0)
				.map((check) => check.subtopicId),
		},
	});
	return relative(workspaceRoot, path);
}

/** Builds the `check-rewrite-attempts` stage from the logger and the OpenAI client of the invocation. */
export const createCheckRewriteAttemptsStage: ModelStageFactory<
	CheckRewriteAttemptsInput,
	CheckRewriteAttemptsOutput
> = defineModelStage({
	stageId: STAGE_ID,
	getInput: readCheckRewriteAttemptsInput,
	run: async (run) => {
		const { contents, filesWritten } = await readOrMakeRewriteAttempts({
			stageId: STAGE_ID,
			subtopicsOf: (input) => input.subtopics,
			isSaved: isSubtopicCheck,
			saved: { content: "subtopic check", remake: "check the subtopic" },
			fail,
			make: checkSubtopic,
			...run,
		});
		const roundFile = await writeRoundResult({
			workspaceRoot: run.context.workspaceRoot,
			checks: contents,
		});
		return { output: { checks: contents }, filesWritten: [...filesWritten, roundFile] };
	},
});
