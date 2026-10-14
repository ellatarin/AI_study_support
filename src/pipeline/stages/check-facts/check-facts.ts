/**
 * The `check-facts` stage. It sends the whole rewrite of the lecture to one or two
 * models, and merges their factual errors (technical-design.md §5, `check-facts`).
 *
 * The stage is not yet in `STAGE_IDS`. So this module gives the work of the stage,
 * and a later change builds the pipeline stage around it.
 */

/* jscpd:ignore-start -- the modules that log and write files import the same
   node and pino modules and pipeline types. So their import blocks are the same
   line for line. Imports cannot be shared, and CLAUDE.md (File Organisation)
   forbids barrel files. Only the imports are exempt. jscpd checks the code below. */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "pino";
import type {
	CostTally,
	FactCheckModel,
	ModelRole,
	StageContext,
} from "../../../types/pipeline.js";
import type { CostTallyByModel } from "../../../utils/cost.js";
import { NamedError } from "../../../utils/errors.js";
import { writeJsonAtomic } from "../../../utils/files.js";
import { factCheckFileName } from "../../../utils/model-id.js";
import { isOneOf, isRecord, readerFromCheck } from "../../../utils/record.js";
import { collapseWhitespace } from "../../../utils/text.js";
import { type PromptMessages, readJsonReplyAs, sendWithResends } from "../model-stage.js";
import { readOrMakeSavedFiles, unreadableSavedFileMessage } from "../saved-files.js";
import { readStageSubtopics } from "../stage-input.js";
import { hasSubtopicId } from "../subtopic-files.js";
import { readSubtopicRewrite } from "../subtopic-rewrites.js";
import {
	buildFactCheckMessages,
	FACT_CHECK_PROMPT_VERSION,
	subtopicNotes,
	type TitledSubtopicRewrite,
} from "./check-facts.prompt.js";
import {
	type FactualError,
	type FactualErrorFoundBy,
	type ModelFactualErrors,
	mergeFactualErrors,
	SEVERITIES,
} from "./merge-factual-errors.js";
/* jscpd:ignore-end */

/**
 * The error of the stage in three cases:
 * - an input file is missing or unreadable
 * - the `models` list has no primary model
 * - a saved file of a model holds nothing readable.
 *
 * The config loader refuses a list with no primary model, so only a caller that
 * skips the loader meets that case. A call whose third send is still unusable
 * fails the stage with `ResendsExhaustedError`.
 */
export class CheckFactsError extends NamedError {}

/** The folder of the stage in the lecture's workspace. */
export const FACT_CHECKS_DIR = "Fact checks";

/** The file of the merged factual errors of the lecture, in {@link FACT_CHECKS_DIR}. */
const FACTUAL_ERRORS_FILE = "factual-errors.json";

/**
 * Gives the absolute path of the stage's folder in a lecture's workspace.
 *
 * @param workspaceRoot - The absolute path of the lecture's workspace.
 * @returns The absolute path of {@link FACT_CHECKS_DIR}.
 */
function factChecksDirectory(workspaceRoot: string): string {
	return join(workspaceRoot, FACT_CHECKS_DIR);
}

/**
 * Sends the messages of the fact check to one model, and gives the text of the
 * reply. Each send adds its cost to `costTally`. The pipeline stage gives the
 * OpenRouter call, and a test gives a stub.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- the message-param type of the OpenAI library is not deeply readonly. CLAUDE.md allows a mutable type where a library requires one.
export type SendToModel = (args: {
	readonly model: FactCheckModel;
	readonly messages: PromptMessages;
	readonly costTally: CostTally;
}) => Promise<{ readonly content: string }>;

/** A factual error of the merged file: the models that report it, and whether its passage is in its subtopic. */
type MergedFactualError = FactualErrorFoundBy & { readonly wordsFound: boolean };

/** The file of one model in {@link FACT_CHECKS_DIR}. */
type ModelFactCheckFile = ModelFactualErrors & { readonly factCheckPromptVersion: string };

/** The merged file of the lecture, {@link FACTUAL_ERRORS_FILE}. */
type FactualErrorsFile = {
	readonly factCheckPromptVersion: string;
	readonly factualErrors: readonly MergedFactualError[];
};

/**
 * The result of the fact check of one lecture, for the pipeline stage. The stage result
 * and the stage entry do not yet have `notices` and `configUsed.models`. A later
 * change adds them (technical-design.md §4.5, §10). The cost of each model is in
 * the caller's {@link CostTallyByModel}.
 */
type FactCheckResult = {
	/** The merged file. */
	readonly output: FactualErrorsFile;
	/** The stage notices that the user must see. */
	readonly notices: readonly string[];
	/** The config of each model that is not disabled, with its role. */
	readonly configUsed: { readonly models: readonly FactCheckModel[] };
};

/** One error of a fact-check reply, in the words of the reply. */
type ReplyError = {
	/** The subtopic number. A model sometimes gives it as text. */
	readonly subtopic: number | string;
	readonly passage: string;
	readonly problem: string;
	readonly correction: string;
	readonly severity: FactualError["severity"];
};

/** The part of a fact-check reply that the stage reads. The reply's `checked` list is not read. */
type FactCheckReply = { readonly errors: readonly ReplyError[] };

/** The text that ends the failure "The model's reply is not the documented …". */
const DOCUMENTED_REPLY_SHAPE =
	"{ errors: [{ subtopic, passage, problem, correction, severity }] } object";

const isSeverity = isOneOf(SEVERITIES);

/**
 * Checks that a value is one error of a fact-check reply.
 *
 * @param value - One entry of the reply's `errors`.
 * @returns `true` when the value is a {@link ReplyError}.
 */
function isReplyError(value: unknown): value is ReplyError {
	return (
		isRecord(value) &&
		(typeof value.subtopic === "number" || typeof value.subtopic === "string") &&
		typeof value.passage === "string" &&
		typeof value.problem === "string" &&
		typeof value.correction === "string" &&
		isSeverity(value.severity)
	);
}

/**
 * Checks that a value is one factual error of a saved model file.
 *
 * @param value - One entry of the file's `factualErrors`.
 * @returns `true` when the value is a {@link FactualError}.
 */
function isFactualError(value: unknown): value is FactualError {
	return (
		hasSubtopicId(value) &&
		typeof value.passage === "string" &&
		typeof value.problem === "string" &&
		typeof value.correctStatement === "string" &&
		isSeverity(value.severity)
	);
}

/**
 * Checks that a parsed file is the file of one model.
 *
 * @param value - The parsed file.
 * @returns `true` when the value is a {@link ModelFactCheckFile}.
 */
function isModelFactCheckFile(value: unknown): value is ModelFactCheckFile {
	return (
		isRecord(value) &&
		typeof value.modelId === "string" &&
		typeof value.factCheckPromptVersion === "string" &&
		Array.isArray(value.factualErrors) &&
		value.factualErrors.every(isFactualError)
	);
}

/**
 * Checks that a parsed reply has a list `errors` of reply errors.
 *
 * @param value - The parsed reply.
 * @returns `true` when the value is a {@link FactCheckReply}.
 */
function isFactCheckReply(value: unknown): value is FactCheckReply {
	return isRecord(value) && Array.isArray(value.errors) && value.errors.every(isReplyError);
}

/** A subtopic number that a reply gives as text: digits only. */
const SUBTOPIC_DIGITS = /^\d+$/u;

/**
 * Gives the subtopic id that a reply error names. A model sometimes gives the
 * number as text, such as "3".
 *
 * @param subtopic - The subtopic of the reply error.
 * @returns The subtopic id, or `null` when the text is not digits only.
 */
function subtopicIdOf(subtopic: ReplyError["subtopic"]): number | null {
	if (typeof subtopic === "number") {
		return subtopic;
	}
	return SUBTOPIC_DIGITS.test(subtopic) ? Number(subtopic) : null;
}

/**
 * Gives the factual errors of a reply, in the project's words. The reply's
 * "correction" becomes the `correctStatement`. A reply that names a subtopic id
 * that is not in the lecture is unusable.
 *
 * @param args - The reply, and the subtopics of the lecture.
 * @param args.reply - The parsed reply, with the documented shape.
 * @param args.subtopicIds - The subtopic ids of the lecture.
 * @returns The factual errors, or the reason that the reply is unusable.
 */
function factualErrorsOf({
	reply,
	subtopicIds,
}: {
	readonly reply: FactCheckReply;
	readonly subtopicIds: readonly number[];
}): { readonly reply: readonly FactualError[] } | { readonly failure: string } {
	type NamedReplyError = { readonly error: ReplyError; readonly subtopicId: number | null };
	const named: readonly NamedReplyError[] = reply.errors.map((error) => ({
		error,
		subtopicId: subtopicIdOf(error.subtopic),
	}));
	const isInLecture = (
		entry: NamedReplyError,
	): entry is NamedReplyError & { readonly subtopicId: number } =>
		entry.subtopicId !== null && subtopicIds.includes(entry.subtopicId);
	if (!named.every(isInLecture)) {
		const unknown = named
			.filter((entry) => !isInLecture(entry))
			.map(({ error }) => `"${error.subtopic}"`);
		return {
			failure: `The model's reply names subtopics that are not in the lecture: ${unknown.join(", ")}`,
		};
	}
	return {
		reply: named.map(({ error, subtopicId }) => ({
			subtopicId,
			passage: error.passage,
			problem: error.problem,
			correctStatement: error.correction,
			severity: error.severity,
		})),
	};
}

/**
 * Gives the subtopic ids of the rewrite, in lecture order.
 *
 * @param subtopics - The rewrite of each subtopic, in lecture order.
 * @returns The subtopic ids.
 */
function subtopicIdsOf(subtopics: readonly TitledSubtopicRewrite[]): readonly number[] {
	return subtopics.map(({ subtopicId }) => subtopicId);
}

/** The input of the fact check: the lecture title and the rewrite of each subtopic. */
type FactCheckInput = Pick<FactCheckRun, "lectureTitle" | "subtopics">;

/**
 * Builds the stage's own error from a message.
 *
 * @param message - The message.
 * @returns The error.
 */
function fail(message: string): Error {
	return new CheckFactsError(message);
}

/**
 * Reads the subtopics of the structured transcript, and the rewrite of each one.
 *
 * @param context - The stage context.
 * @returns The lecture title, and the rewrite of each subtopic in lecture order, with its id and title.
 * @throws {CheckFactsError} If an input file is missing, unreadable or the wrong shape.
 */
export async function readFactCheckInput(context: StageContext): Promise<FactCheckInput> {
	const subtopics = await readStageSubtopics({ context, purpose: "check the facts", fail });
	return {
		lectureTitle: context.lectureTitle,
		subtopics: await Promise.all(
			subtopics.map(async ({ subtopicId, title }) => ({
				subtopicId,
				title,
				rewrittenSubtopic: (await readSubtopicRewrite({ context, subtopicId, fail }))
					.rewrittenSubtopic,
			})),
		),
	};
}

/** The fact check of one lecture: the rewrite, the models, and what the stage run uses. */
type FactCheckRun = {
	/** The lecture title from the structured transcript. */
	readonly lectureTitle: string;
	/** The rewrite of each subtopic, in lecture order. */
	readonly subtopics: readonly TitledSubtopicRewrite[];
	/** The `models` list of the stage. */
	readonly models: readonly FactCheckModel[];
	/** The absolute path of the lecture's workspace. */
	readonly workspaceRoot: string;
	readonly sendToModel: SendToModel;
	readonly logger: Logger;
	/** The cost tally of the stage run. */
	readonly costTally: CostTally;
	/** The cost tally of each model of the stage run. Each model's cost is there after a failure too. */
	readonly costTallyByModel: CostTallyByModel;
};

/**
 * Asks one model for the factual errors of the lecture. An unusable reply is resent.
 *
 * @param args - The fact check, and the model.
 * @param args.model - The model to call.
 * @param args.lectureTitle - The lecture title from the structured transcript.
 * @param args.subtopics - The rewrite of each subtopic, in lecture order.
 * @param args.sendToModel - Sends the messages to the model.
 * @param args.logger - The logger of the stage.
 * @param args.costTally - The cost tally of the model. Each send adds its cost to it.
 * @returns The factual errors of the model, in the order of its reply.
 * @throws {ResendsExhaustedError} If the third send is still unusable.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger type has mutable properties that the rule sees. This code only logs to it. CLAUDE.md allows a mutable type where a library requires one.
async function askModel({
	model,
	lectureTitle,
	subtopics,
	sendToModel,
	logger,
	costTally,
}: FactCheckRun & { readonly model: FactCheckModel }): Promise<readonly FactualError[]> {
	const messages = buildFactCheckMessages({ lectureTitle, subtopics });
	const { reply: factualErrors } = await sendWithResends({
		what: `Fact check by ${model.modelId}`,
		logger,
		send: async () =>
			readJsonReplyAs({
				content: (await sendToModel({ model, messages, costTally })).content,
				isReply: isFactCheckReply,
				documentedShape: DOCUMENTED_REPLY_SHAPE,
				use: (reply) => factualErrorsOf({ reply, subtopicIds: subtopicIdsOf(subtopics) }),
			}),
	});
	return factualErrors;
}

/**
 * Checks that the passage of a factual error is in the text of its subtopic. Each
 * run of whitespace counts as one space in both texts.
 *
 * @param args - The factual error, and the rewrite.
 * @param args.error - The factual error.
 * @param args.subtopics - The rewrite of each subtopic.
 * @returns `true` when the passage is in the subtopic.
 */
function passageFound({
	error,
	subtopics,
}: {
	readonly error: FactualError;
	readonly subtopics: readonly TitledSubtopicRewrite[];
}): boolean {
	const subtopic = subtopics.find(({ subtopicId }) => subtopicId === error.subtopicId);
	return (
		subtopic !== undefined &&
		collapseWhitespace(subtopicNotes(subtopic)).includes(collapseWhitespace(error.passage))
	);
}

/**
 * Finds the factual errors in the whole rewrite of one lecture, with each model of
 * the `models` list that is not disabled. It writes the file of each model and the
 * merged file `factual-errors.json`.
 *
 * @param run - The fact check of the lecture.
 * @returns The merged file, the stage notices, the cost of each called model and the config of each model that is not disabled.
 * @throws {CheckFactsError} If the `models` list has no primary model, or a saved file holds nothing readable.
 * @throws The error of a model that fails, after the other model's check settles.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger type has mutable properties that the rule sees. This code only passes it on. CLAUDE.md allows a mutable type where a library requires one.
export async function checkFacts(run: FactCheckRun): Promise<FactCheckResult> {
	// The pipeline stage factory makes the folders of a stage that is in
	// `STAGE_IDS`. This stage is not yet there, so it makes its own folder.
	await mkdir(factChecksDirectory(run.workspaceRoot), { recursive: true });
	const { primary, secondary } = modelsByRole(run.models);
	const models = secondary === undefined ? [primary] : [primary, secondary];
	const checks = models.map((model) => ({
		model,
		path: join(factChecksDirectory(run.workspaceRoot), factCheckFileName(model.modelId)),
		modelCostTally: run.costTallyByModel.tallyOf(model.modelId),
	}));
	const { contents } = await readOrMakeSavedFiles({
		files: checks,
		label: "Fact checks",
		concurrency: checks.length,
		readSaved: readerFromCheck(isModelFactCheckFile),
		unreadable: (path) =>
			new CheckFactsError(
				unreadableSavedFileMessage({
					path,
					content: "fact check",
					remake: "check the facts with the model",
				}),
			),
		make: (check) => makeModelFile({ run, ...check }),
	});
	// The contents are in the order of `checks`: one for each model, the primary model first.
	const [primaryFile, secondaryFile] = contents as readonly [
		ModelFactCheckFile,
		ModelFactCheckFile?,
	];
	const merged = mergeFactualErrors({
		subtopicIds: subtopicIdsOf(run.subtopics),
		primary: primaryFile,
		secondary: secondaryFile,
	});
	const output: FactualErrorsFile = {
		factCheckPromptVersion: FACT_CHECK_PROMPT_VERSION,
		factualErrors: merged.map((error) => ({
			...error,
			wordsFound: passageFound({ error, subtopics: run.subtopics }),
		})),
	};
	await writeJsonAtomic({
		path: join(factChecksDirectory(run.workspaceRoot), FACTUAL_ERRORS_FILE),
		value: output,
	});
	return {
		output,
		notices: wordsNotFoundNotices(output.factualErrors),
		configUsed: { models },
	};
}

/**
 * Asks one model for the factual errors of the lecture, and gives the content of
 * the model's file. Each send adds its cost to the model's tally and to the
 * stage's tally.
 *
 * @param args - The fact check, the model, and the model's cost tally.
 * @param args.run - The fact check of the lecture.
 * @param args.model - The model to call.
 * @param args.modelCostTally - The cost tally of the model.
 * @returns The content of the model's file.
 * @throws {ResendsExhaustedError} If the third send is still unusable.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger type has mutable properties that the rule sees. This code only passes it on. CLAUDE.md allows a mutable type where a library requires one.
async function makeModelFile({
	run,
	model,
	modelCostTally,
}: {
	readonly run: FactCheckRun;
	readonly model: FactCheckModel;
	readonly modelCostTally: CostTally;
}): Promise<ModelFactCheckFile> {
	const factualErrors = await askModel({
		...run,
		model,
		costTally: {
			add: (cost) => {
				modelCostTally.add(cost);
				run.costTally.add(cost);
			},
			total: modelCostTally.total,
		},
	});
	return {
		modelId: model.modelId,
		factCheckPromptVersion: FACT_CHECK_PROMPT_VERSION,
		factualErrors,
	};
}

/**
 * Gives the primary model and the secondary model of the `models` list.
 *
 * @param models - The `models` list of the stage.
 * @returns The primary model, and the secondary model or `undefined` when the list has none.
 * @throws {CheckFactsError} If the list has no primary model.
 */
function modelsByRole(models: readonly FactCheckModel[]): {
	readonly primary: FactCheckModel;
	readonly secondary: FactCheckModel | undefined;
} {
	const modelOf = (role: ModelRole): FactCheckModel | undefined =>
		models.find((model) => model.role === role);
	const primary = modelOf("primary");
	if (primary === undefined) {
		throw new CheckFactsError("The models list has no primary model");
	}
	return { primary, secondary: modelOf("secondary") };
}

/**
 * Gives a stage notice for each factual error whose passage is not in its
 * subtopic (technical-design.md §10, "Stage Notices").
 *
 * @param factualErrors - The merged factual errors.
 * @returns One notice for each factual error with `wordsFound` false. Each notice names the subtopic.
 */
function wordsNotFoundNotices(factualErrors: readonly MergedFactualError[]): readonly string[] {
	return factualErrors
		.filter(({ wordsFound }) => !wordsFound)
		.map(
			({ subtopicId, passage }) =>
				`The passage of a factual error is not in subtopic ${subtopicId}: "${passage}"`,
		);
}
