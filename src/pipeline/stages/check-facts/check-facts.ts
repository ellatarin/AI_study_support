/**
 * The `check-facts` stage. It sends the whole rewrite of the lecture to one or two
 * models, and merges their factual errors (technical-design.md §5, `check-facts`).
 */

/* jscpd:ignore-start -- the modules of the fact-check stages import the same
   pipeline types and shared helpers. So their import blocks are the same line
   for line. Imports cannot be shared, and CLAUDE.md (File Organisation) forbids
   barrel files. Only the imports are exempt. jscpd checks the code below. */
import { join, relative } from "node:path";
import type { Logger } from "pino";
import type {
	CostTally,
	CostTallyByModel,
	FactCheckModel,
	ModelRole,
	StageContext,
	StageResult,
} from "../../../types/pipeline.js";
import { NamedError } from "../../../utils/errors.js";
import { writeJsonAtomic } from "../../../utils/files.js";
import { factCheckFileName } from "../../../utils/model-id.js";
import { isRecord, readerFromCheck } from "../../../utils/record.js";
import { createSendGate } from "../../../utils/send-gate.js";
import { unconfiguredStageMessage } from "../../../utils/stage-config.js";
import { collapseWhitespace } from "../../../utils/text.js";
import { callModel } from "../../openrouter.js";
import {
	type FactualError,
	type FactualErrorsFile,
	factChecksDirectory,
	factualErrorsPath,
	isFactualError,
	isSeverity,
	type MergedFactualError,
} from "../factual-errors.js";
import {
	type ModelStageFactory,
	type PromptMessages,
	readJsonReplyAs,
	sendWithResends,
} from "../model-stage.js";
import { createPipelineStage } from "../pipeline-stage.js";
import { readOrMakeSavedFiles, unreadableSavedFileMessage } from "../saved-files.js";
import { readTitledRewrites, type TitledSubtopicRewrite } from "../subtopic-rewrites.js";
import {
	buildFactCheckMessages,
	FACT_CHECK_PROMPT_VERSION,
	subtopicNotes,
} from "./check-facts.prompt.js";
import { type ModelFactualErrors, mergeFactualErrors } from "./merge-factual-errors.js";
/* jscpd:ignore-end */

/**
 * The error of the stage in three cases:
 * - an input file is missing or unreadable
 * - the `models` list has no primary model
 * - a saved file of a model holds nothing readable.
 *
 * The config loader refuses a list with no primary model, so only a caller that
 * skips the loader meets that case.
 */
export class CheckFactsError extends NamedError {}

const STAGE_ID = "check-facts";

/**
 * Sends the messages of one call to a model of the `models` list, and gives the
 * text of the reply. Each send adds its cost to `costTally`. The stage gives the
 * OpenRouter call, and a test gives a stub.
 */
export type SendToListedModel = (
	// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- the message-param type of the OpenAI library is not deeply readonly. CLAUDE.md allows a mutable type where a library requires one.
	args: {
		readonly messages: PromptMessages;
		readonly costTally: CostTally;
		readonly model: FactCheckModel;
	},
) => Promise<{ readonly content: string }>;

/** The file of one model in the folder `Fact checks`. */
type ModelFactCheckFile = ModelFactualErrors & { readonly factCheckPromptVersion: string };

/**
 * The result of the fact check of one lecture, for the pipeline stage. The cost
 * of each model is in the caller's {@link CostTallyByModel}.
 */
type FactCheckResult = {
	/** The merged file. */
	readonly output: FactualErrorsFile;
	/** The `filesWritten` entry of the file of each model and of the merged file. */
	readonly filesWritten: readonly string[];
	/** The stage notices that the user must see. */
	readonly notices: readonly string[];
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

const DOCUMENTED_REPLY_SHAPE =
	"{ errors: [{ subtopic, passage, problem, correction, severity }] } object";

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
	return {
		lectureTitle: context.lectureTitle,
		subtopics: await readTitledRewrites({ context, purpose: "check the facts", fail }),
	};
}

/** The fact check of one lecture: the rewrite, the models, and what the stage run uses. */
type FactCheckRun = {
	/** The absolute path of the lecture's workspace. */
	readonly workspaceRoot: string;
	readonly logger: Logger;
	/** The cost tally of the stage run. */
	readonly costTally: CostTally;
	/** The lecture title from the structured transcript. */
	readonly lectureTitle: string;
	/** The rewrite of each subtopic, in lecture order. */
	readonly subtopics: readonly TitledSubtopicRewrite[];
	/** The `models` list of the stage. */
	readonly models: readonly FactCheckModel[];
	readonly sendToModel: SendToListedModel;
	/** The cost tally of each model of the stage run. Each model's cost is there after a failure too. */
	readonly costTallyByModel: CostTallyByModel;
};

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
 * @returns The merged file, the `filesWritten` entry of each file, and the stage notices.
 * @throws {CheckFactsError} If the `models` list has no primary model, or a saved file holds nothing readable.
 * @throws The error of a model that fails, after the other model's check settles.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger type has mutable properties that the rule sees. This code only passes it on. CLAUDE.md allows a mutable type where a library requires one.
export async function checkFacts(run: FactCheckRun): Promise<FactCheckResult> {
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
		bypassed: false,
		checkedBy: models.map(({ modelId }) => modelId),
		factualErrors: merged.map((error) => ({
			...error,
			wordsFound: passageFound({ error, subtopics: run.subtopics }),
		})),
	};
	const mergedPath = await writeFactualErrorsFile({ workspaceRoot: run.workspaceRoot, output });
	return {
		output,
		filesWritten: [...checks.map(({ path }) => path), mergedPath].map((path) =>
			relative(run.workspaceRoot, path),
		),
		notices: wordsNotFoundNotices(output.factualErrors),
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
	const messages = buildFactCheckMessages(run);
	const costTally: CostTally = {
		add: (cost) => {
			modelCostTally.add(cost);
			run.costTally.add(cost);
		},
		total: modelCostTally.total,
	};
	const { reply: factualErrors } = await sendWithResends({
		what: `Fact check by ${model.modelId}`,
		logger: run.logger,
		send: async () =>
			readJsonReplyAs({
				content: (await run.sendToModel({ messages, costTally, model })).content,
				isReply: isFactCheckReply,
				documentedShape: DOCUMENTED_REPLY_SHAPE,
				use: (reply) => factualErrorsOf({ reply, subtopicIds: subtopicIdsOf(run.subtopics) }),
			}),
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

/**
 * Writes the merged file of the lecture.
 *
 * @param args - The workspace, and the file.
 * @param args.workspaceRoot - The absolute path of the lecture's workspace.
 * @param args.output - The merged file.
 * @returns The absolute path of the merged file.
 */
async function writeFactualErrorsFile({
	workspaceRoot,
	output,
}: {
	readonly workspaceRoot: string;
	readonly output: FactualErrorsFile;
}): Promise<string> {
	const mergedPath = factualErrorsPath(workspaceRoot);
	await writeJsonAtomic({ path: mergedPath, value: output });
	return mergedPath;
}

/**
 * Writes the merged file of a bypassed fact check: no model, and no factual
 * error. The fact correction then has nothing to correct, and the stages after it
 * run as usual (CONTEXT.md, "Bypassed stage").
 *
 * @param workspaceRoot - The absolute path of the lecture's workspace.
 * @returns The result of a bypassed stage: the merged file and its `filesWritten` entry.
 */
async function writeBypassedFactCheck(
	workspaceRoot: string,
): Promise<StageResult<FactualErrorsFile>> {
	const output: FactualErrorsFile = {
		factCheckPromptVersion: FACT_CHECK_PROMPT_VERSION,
		bypassed: true,
		checkedBy: [],
		factualErrors: [],
	};
	const mergedPath = await writeFactualErrorsFile({ workspaceRoot, output });
	return { output, filesWritten: [relative(workspaceRoot, mergedPath)], bypassed: true };
}

/**
 * Builds the `check-facts` stage from the logger and the OpenAI client of the
 * invocation. Each call goes to a model of the stage's `models` list, with that
 * model's settings.
 *
 * @param dependencies - The logger and the client of the invocation.
 * @param dependencies.logger - The logger of the invocation.
 * @param dependencies.client - The provider of the invocation's OpenAI client.
 * @returns The stage.
 */
export const createCheckFactsStage: ModelStageFactory<FactCheckInput, FactualErrorsFile> = ({
	logger,
	client,
}) => {
	// The two models are called at the same time, so their sends are not spaced.
	const sendGate = createSendGate({ gapSeconds: undefined });
	return createPipelineStage({
		stageId: STAGE_ID,
		logger,
		getInput: readFactCheckInput,
		run: async ({ input, context, logger: stageLogger, costTally, costTallyByModel }) => {
			const stageConfig = context.config.stages[STAGE_ID];
			if (stageConfig === undefined) {
				throw new CheckFactsError(unconfiguredStageMessage({ stageId: STAGE_ID }));
			}
			if (stageConfig.bypass) {
				return writeBypassedFactCheck(context.workspaceRoot);
			}
			const { models } = stageConfig;
			const { output, filesWritten, notices } = await checkFacts({
				...input,
				models,
				workspaceRoot: context.workspaceRoot,
				logger: stageLogger,
				costTally,
				costTallyByModel,
				sendToModel: ({ messages, costTally: modelCostTally, model }) =>
					callModel({
						messages,
						stageId: STAGE_ID,
						stageConfig: {
							modelId: model.modelId,
							temperature: model.temperature,
							maxTokens: model.maxTokens,
						},
						responseFormat: "json",
						logger: stageLogger,
						client,
						sendGate,
						costTally: modelCostTally,
					}),
			});
			return { output, filesWritten, notices };
		},
	});
};
