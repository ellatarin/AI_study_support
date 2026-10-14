/**
 * The parts that the model-calling stages share: two dependencies, the arguments
 * of `run`, and the request for a JSON reply (technical-design.md §5, §6).
 *
 * This module is kept apart from `pipeline-stage.ts`, so that the stage factory
 * knows nothing about models.
 */

import type OpenAI from "openai";
import type { Logger } from "pino";
import type { CostTally, PipelineStage, StageContext, StageResult } from "../../types/pipeline.js";
import { errorMessage, NamedError } from "../../utils/errors.js";
import { type FailedSend, sendUntilAccepted } from "../../utils/resend.js";
import { createSendGate, type SendGate } from "../../utils/send-gate.js";
import { configuredConcurrency, configuredStage } from "../../utils/stage-config.js";
import { callModel, type ModelCallRequest, type OpenRouterClient } from "../openrouter.js";
import { createPipelineStage } from "./pipeline-stage.js";

/**
 * The logger and the client that a model-calling stage gets when it is built. Both
 * belong to the invocation, so no module-level state holds them (technical-design.md §6).
 */
export type ModelStageDependencies = {
	readonly logger: Logger;
	readonly client: OpenRouterClient;
};

/**
 * The arguments of a model-calling stage's `run`: the input, the stage context,
 * the logger, the model calls of the stage run, and the stage's `concurrency`.
 *
 * @typeParam TInput - The input that the stage's `getInput` gave.
 */
export type ModelStageRunArgs<TInput> = {
	readonly input: TInput;
	readonly context: StageContext;
	readonly logger: Logger;
	readonly calls: StageModelCalls;
	/** The stage's `concurrency` (technical-design.md §6). Unset means one at a time. */
	readonly concurrency: number | undefined;
};

/**
 * A request for a JSON reply: the prompt, the stage, and the check of the reply.
 * {@link tryJsonReply} takes it.
 *
 * @typeParam TReply - The reply that the stage expects.
 */
export type JsonReplyRequest<TReply> = Pick<
	ModelCallRequest,
	"messages" | "stageId" | "sendGate"
> & {
	readonly context: StageContext;
	readonly costTally: CostTally;
	readonly isReply: (value: unknown) => value is TReply;
	readonly documentedShape: string;
} & ModelStageDependencies;

/**
 * A JSON reply that has the documented shape.
 *
 * @typeParam TReply - The reply that the stage expects.
 */
export type UsableJsonReply<TReply> = { readonly reply: TReply };

/**
 * An unusable reply: the reason, and the text of the reply. The debug log keeps
 * the text, so that a reader can see the fault in the reply.
 */
type UnusableJsonReply = FailedSend & { readonly replyText: string };

/**
 * The outcome of one JSON call: the documented reply, or the unusable reply.
 *
 * @typeParam TReply - The reply that the stage expects.
 */
export type JsonReplyOutcome<TReply> = UsableJsonReply<TReply> | UnusableJsonReply;

/**
 * Asks the model for a JSON reply for a stage. It gives the reply when the reply
 * has the documented shape. Otherwise it gives the reason that the reply is
 * unusable: empty, not JSON, or the wrong shape.
 *
 * A reply in JSON mode can still be empty, prose or the wrong shape, so the reply
 * is checked (technical-design.md §6). An unusable reply is returned and not
 * thrown, so that a caller can resend it.
 *
 * @param args - The prompt, the stage, and the check of the reply.
 * @param args.messages - The prompt, as the stage's prompt module built it.
 * @param args.stageId - The stage that makes the call. It sets the model and the tuning.
 * @param args.context - The stage context of the current lecture. It holds the configuration.
 * @param args.isReply - Tells whether a parsed value is the documented reply.
 * @param args.documentedShape - The text that ends the failure "The model's reply is not the documented …".
 * @param args.logger - The logger of the stage. The call is logged on it.
 * @param args.client - The OpenAI client that makes the model call.
 * @param args.sendGate - The send gate of the stage run. The call waits on it.
 * @param args.costTally - The cost tally of the stage run. Each send of the call adds its cost to it.
 * @returns The checked reply, or the reason that it is unusable.
 * @typeParam TReply - The reply that the stage expects.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- the message-param, pino Logger and OpenAI client types are library types that are not deeply readonly. CLAUDE.md allows a mutable type where a library requires one.
export async function tryJsonReply<TReply>({
	messages,
	stageId,
	context,
	isReply,
	documentedShape,
	logger,
	client,
	sendGate,
	costTally,
}: JsonReplyRequest<TReply>): Promise<JsonReplyOutcome<TReply>> {
	const { content } = await callModel({
		messages,
		stageId,
		config: context.config,
		responseFormat: "json",
		logger,
		client,
		sendGate,
		costTally,
	});
	return readJsonReply({ content, isReply, documentedShape });
}

/**
 * Checks the text of a JSON reply. It gives the reply when the reply has the
 * documented shape. Otherwise it gives the reason that the reply is unusable:
 * empty, not JSON, or the wrong shape. `check-facts` calls it directly, because
 * its model comes from its `models` list and not from its stage id.
 *
 * @param args - The text of the reply, and the check of its shape.
 * @param args.content - The text of the reply.
 * @param args.isReply - Tells whether a parsed value is the documented reply.
 * @param args.documentedShape - The text that ends the failure "The model's reply is not the documented …".
 * @returns The checked reply, or the reason that it is unusable.
 * @typeParam TReply - The reply that the stage expects.
 */
export function readJsonReply<TReply>({
	content,
	isReply,
	documentedShape,
}: Pick<JsonReplyRequest<TReply>, "isReply" | "documentedShape"> & {
	readonly content: string;
}): JsonReplyOutcome<TReply> {
	const unusable = (failure: string): UnusableJsonReply => ({ failure, replyText: content });
	if (content.trim() === "") {
		return unusable("The model's reply was empty");
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch (error: unknown) {
		return unusable(`The model answered with something other than JSON (${errorMessage(error)})`);
	}
	if (!isReply(parsed)) {
		return unusable(`The model's reply is not the documented ${documentedShape}`);
	}
	return { reply: parsed };
}

/** The messages that a stage sends: its prompt, then the material that the prompt is about. */
export type PromptMessages = readonly OpenAI.Chat.Completions.ChatCompletionMessageParam[];

/**
 * Sends the messages of one call to the model of the stage's own config entry,
 * and gives the text of the reply. Each send adds its cost to `costTally`. The
 * pipeline stage gives the OpenRouter call, and a test gives a stub.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- the message-param type of the OpenAI library is not deeply readonly. CLAUDE.md allows a mutable type where a library requires one.
export type SendToStageModel = (args: {
	readonly messages: PromptMessages;
	readonly costTally: CostTally;
}) => Promise<{ readonly content: string }>;

/**
 * The run of a stage that is not yet in `STAGE_IDS`. The pipeline stage factory
 * gives these values to a listed stage. An unlisted stage gets them from its
 * caller, so its module gives only the work of the stage. A later change builds
 * the pipeline stage around that work.
 */
export type UnlistedStageRun = {
	/** The absolute path of the lecture's workspace. */
	readonly workspaceRoot: string;
	readonly sendToModel: SendToStageModel;
	readonly logger: Logger;
	/** The cost tally of the stage run. */
	readonly costTally: CostTally;
	/** The stage's `concurrency`. Unset means one piece of work at a time. */
	readonly concurrency: number | undefined;
};

/**
 * Builds the material of a user message from structured data: the heading that
 * the prompt expects, on its own line, then the data as JSON.
 *
 * @param args - The heading, and the data.
 * @param args.label - The heading, such as `Lecture`.
 * @param args.value - The data.
 * @returns The material.
 */
export function labelledJson({
	label,
	value,
}: {
	readonly label: string;
	readonly value: unknown;
}): string {
	return `${label}:\n${JSON.stringify(value)}`;
}

/**
 * Builds the two messages that a stage sends: the prompt as the system message,
 * and the material as the user message.
 *
 * @param args - The prompt, and the material.
 * @param args.system - The stage's prompt.
 * @param args.user - The material: text under the heading that the prompt expects,
 *   or one PNG image as base64, which the user message then holds alone.
 * @returns The system message, then the user message.
 */
export function promptMessages({
	system,
	user,
}: {
	readonly system: string;
	readonly user: string | { readonly pngBase64: string };
}): PromptMessages {
	return [
		{ role: "system", content: system },
		typeof user === "string"
			? { role: "user", content: user }
			: {
					role: "user",
					content: [
						{ type: "image_url", image_url: { url: `data:image/png;base64,${user.pngBase64}` } },
					],
				},
	];
}

/**
 * {@link tryJsonReply}, then `use` makes what the stage keeps from a usable reply.
 * `use` can also find the reply unusable, for example when its start words are not
 * in the transcript. That failure is returned like any other, so a caller that
 * resends treats every failure the same.
 *
 * @param args - As for {@link tryJsonReply}, and the use of the reply.
 * @param args.use - Makes what the stage keeps from the documented reply, or gives the reason that it cannot.
 * @returns The value that the stage keeps, or the reason that the reply is unusable.
 * @typeParam TReply - The reply that the stage expects.
 * @typeParam TKept - The value that the stage keeps from the reply.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- as for tryJsonReply: library types that are not deeply readonly
export async function tryJsonReplyAs<TReply, TKept>({
	use,
	...request
}: JsonReplyRequest<TReply> & {
	readonly use: UseOfReply<TReply, TKept>;
}): Promise<JsonReplyOutcome<TKept>> {
	return useJsonReply({ outcome: await tryJsonReply(request), use });
}

/** Makes what a stage keeps from a documented reply, or gives the reason that it cannot. */
export type UseOfReply<TReply, TKept> = (
	reply: TReply,
) => { readonly reply: TKept } | { readonly failure: string };

/**
 * Checks the paragraphs of a reply. A reply with a blank paragraph is unusable. A
 * reply with no paragraph is usable (technical-design.md §5, `rewrite-subtopics`).
 *
 * @param reply - The parsed reply, with its paragraphs.
 * @returns The reply, or the reason that it is unusable.
 * @typeParam TReply - The reply that the stage expects.
 */
export function rejectBlankParagraphs<TReply extends { readonly paragraphs: readonly string[] }>(
	reply: TReply,
): { readonly reply: TReply } | { readonly failure: string } {
	return reply.paragraphs.some((paragraph) => paragraph.trim() === "")
		? { failure: "The model's reply gives a blank paragraph" }
		: { reply };
}

/**
 * Applies `use` to a usable reply. An unusable reply stays as it is.
 *
 * @param args - The outcome of one JSON call, and the use of the reply.
 * @param args.outcome - The documented reply, or the unusable reply.
 * @param args.use - Makes what the stage keeps from the documented reply, or gives the reason that it cannot.
 * @returns The value that the stage keeps, or the reason that the reply is unusable.
 * @typeParam TReply - The reply that the stage expects.
 * @typeParam TKept - The value that the stage keeps from the reply.
 */
function useJsonReply<TReply, TKept>({
	outcome,
	use,
}: {
	readonly outcome: JsonReplyOutcome<TReply>;
	readonly use: UseOfReply<TReply, TKept>;
}): JsonReplyOutcome<TKept> {
	if ("failure" in outcome) {
		return outcome;
	}
	const kept = use(outcome.reply);
	return "failure" in kept ? { ...kept, replyText: JSON.stringify(outcome.reply) } : kept;
}

/**
 * {@link readJsonReply}, then `use` makes what the stage keeps from a usable
 * reply, as in {@link tryJsonReplyAs}.
 *
 * @param args - As for {@link readJsonReply}, and the use of the reply.
 * @param args.use - Makes what the stage keeps from the documented reply, or gives the reason that it cannot.
 * @returns The value that the stage keeps, or the reason that the reply is unusable.
 * @typeParam TReply - The reply that the stage expects.
 * @typeParam TKept - The value that the stage keeps from the reply.
 */
export function readJsonReplyAs<TReply, TKept>({
	use,
	...check
}: Parameters<typeof readJsonReply<TReply>>[0] & {
	readonly use: UseOfReply<TReply, TKept>;
}): JsonReplyOutcome<TKept> {
	return useJsonReply({ outcome: readJsonReply(check), use });
}

/** A call whose reply is still unusable after its last send. The message names the call and the last reason. */
export class ResendsExhaustedError extends NamedError {}

/**
 * Sends one call until its reply is usable: up to three sends, with a pause of two
 * seconds and then four between them.
 *
 * Only an unusable reply is resent. An error that the call throws is not resent.
 * The OpenAI client and the model call already resend a failed call that can
 * succeed when it is sent again. See technical-design.md §5, "Dividing the
 * transcript", Panel runs, and §6, §8.
 *
 * Each unusable reply is logged as a warning. The warning gives the call, the
 * send number, the reason and the reply text (technical-design.md §5, "Dividing
 * the transcript", Panel runs).
 *
 * @param args - The call, its name, and the logger.
 * @param args.send - Makes the call once.
 * @param args.what - The name of the call in the log and in a failure, such as "run 3".
 * @param args.logger - The logger of the stage.
 * @returns The usable reply.
 * @throws {ResendsExhaustedError} When the reply of the third send is still unusable.
 * @typeParam TReply - The reply that the call expects.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger type has mutable properties that the rule sees. This code only logs to it. CLAUDE.md allows a mutable type where a library requires one.
export async function sendWithResends<TReply>({
	send,
	what,
	logger,
}: {
	readonly send: () => Promise<JsonReplyOutcome<TReply>>;
	readonly what: string;
	readonly logger: Logger;
}): Promise<UsableJsonReply<TReply>> {
	const { sent } = await sendUntilAccepted<UsableJsonReply<TReply>, UnusableJsonReply>({
		send,
		onFailure: ({ send: sends, failure, replyText }) => {
			logger.warn({ what, send: sends, reason: failure, replyText }, "Unusable reply");
		},
		exhausted: ({ failure, sends }) =>
			new ResendsExhaustedError(`${what} failed after ${sends} sends: ${failure}`),
	});
	return sent;
}

/**
 * Sends one call of an unlisted stage until its reply is usable:
 * {@link sendWithResends} over {@link readJsonReplyAs}, with the stage's
 * {@link SendToStageModel}.
 *
 * @param args - The call, the check and use of its reply, and the stage run.
 * @param args.what - The name of the call in the log and in a failure, such as "Fact correction of subtopic 2".
 * @param args.messages - The messages of the call.
 * @param args.sendToModel - Sends the messages to the model.
 * @param args.logger - The logger of the stage.
 * @param args.costTally - The cost tally that each send adds its cost to.
 * @returns The value that the stage keeps from the usable reply.
 * @throws {ResendsExhaustedError} When the reply of the third send is still unusable.
 * @typeParam TReply - The reply that the stage expects.
 * @typeParam TKept - The value that the stage keeps from the reply.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- the message-param and pino Logger types are library types that are not deeply readonly. CLAUDE.md allows a mutable type where a library requires one.
export function sendToStageModelWithResends<TReply, TKept>({
	what,
	messages,
	sendToModel,
	logger,
	costTally,
	...check
}: Pick<UnlistedStageRun, "sendToModel" | "logger" | "costTally"> &
	Omit<Parameters<typeof readJsonReplyAs<TReply, TKept>>[0], "content"> & {
		readonly what: string;
		readonly messages: PromptMessages;
	}): Promise<UsableJsonReply<TKept>> {
	return sendWithResends({
		what,
		logger,
		send: async () =>
			readJsonReplyAs({ content: (await sendToModel({ messages, costTally })).content, ...check }),
	});
}

/**
 * Asks the model for a JSON reply for a stage, and resends the call until the reply
 * is usable: {@link sendWithResends} over {@link tryJsonReplyAs}. Every call of the
 * splitting, retitling, grouping and title-judging stages uses it.
 *
 * @param args - The request and the use of the reply, as for {@link tryJsonReplyAs}, and the name of the call.
 * @param args.what - The name of the call in the log and in a failure, such as "Grouping run 3".
 * @returns The value that the stage keeps from the usable reply.
 * @throws {ResendsExhaustedError} When the reply of the third send is still unusable.
 * @typeParam TReply - The reply that the stage expects.
 * @typeParam TKept - The value that the stage keeps from the reply.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- the message-param, pino Logger and OpenAI client types are library types that are not deeply readonly. CLAUDE.md allows a mutable type where a library requires one.
export function sendJsonWithResends<TReply, TKept>({
	what,
	...request
}: Parameters<typeof tryJsonReplyAs<TReply, TKept>>[0] & { readonly what: string }): Promise<
	UsableJsonReply<TKept>
> {
	return sendWithResends({ what, logger: request.logger, send: () => tryJsonReplyAs(request) });
}

/**
 * The part of a JSON request that a stage chooses: the prompt, and the check of
 * the reply.
 *
 * @typeParam TReply - The reply that the stage expects.
 */
export type OwnJsonRequest<TReply> = Pick<
	JsonReplyRequest<TReply>,
	"messages" | "isReply" | "documentedShape"
>;

/**
 * The model calls of one stage run. They already hold the stage id, the stage
 * context, the logger, the client, the send gate and the cost tally of the stage
 * run. So a stage passes only its own part of each request.
 */
export type StageModelCalls = {
	/** {@link sendJsonWithResends} for this stage run. */
	readonly sendJsonWithResends: <TReply, TKept>(
		// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- the message-param type of the OpenAI library is not deeply readonly. CLAUDE.md allows a mutable type where a library requires one.
		request: OwnJsonRequest<TReply> & {
			readonly what: string;
			readonly use: UseOfReply<TReply, TKept>;
		},
	) => Promise<UsableJsonReply<TKept>>;
};

/**
 * Gives the model calls of one stage run.
 *
 * @param run - The stage, the stage context, the dependencies, and the send gate and cost tally of the stage run.
 * @returns The model calls, with these values given.
 */
function stageModelCalls(
	// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- the pino Logger and OpenAI client types have mutable properties that the rule sees. This code only passes them on. CLAUDE.md allows a mutable type where a library requires one.
	run: Pick<JsonReplyRequest<unknown>, "stageId" | "context" | "sendGate" | "costTally"> &
		ModelStageDependencies,
): StageModelCalls {
	return {
		sendJsonWithResends: (request) => sendJsonWithResends({ ...run, ...request }),
	};
}

/**
 * The factory that the CLI builds a model-calling stage with. It takes the logger
 * and the client of the invocation, and gives the stage.
 *
 * @typeParam TInput - The stage's input.
 * @typeParam TOutput - The stage's output.
 */
export type ModelStageFactory<TInput, TOutput> = (
	// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- the pino Logger and OpenAI client types have mutable properties that the rule sees. This code only reads them. CLAUDE.md allows a mutable type where a library requires one.
	dependencies: ModelStageDependencies,
) => PipelineStage<TInput, TOutput>;

/**
 * Defines a stage that calls a model, and gives the factory that the CLI builds it
 * with. The factory uses {@link createPipelineStage}. The `run` of the stage also
 * gets the model calls of the stage run. They use the client of the invocation and
 * one send gate that every run of the stage shares (technical-design.md §4.7).
 *
 * @param definition - The stage id and the behaviour of the stage.
 * @param definition.stageId - The stage that this defines.
 * @param definition.getInput - Gets and checks the input of the stage.
 * @param definition.run - Does the work of the stage.
 * @returns A factory that takes the logger and the client of the invocation.
 * @typeParam TInput - The input that `getInput` gives and `run` takes.
 * @typeParam TOutput - The output that `run` gives.
 */
export function defineModelStage<TInput, TOutput>({
	stageId,
	getInput,
	run,
}: Pick<Parameters<typeof createPipelineStage<TInput, TOutput>>[0], "stageId" | "getInput"> & {
	// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- the pino Logger and OpenAI client types have mutable properties that the rule sees. This code only reads them. CLAUDE.md allows a mutable type where a library requires one.
	readonly run: (args: ModelStageRunArgs<TInput>) => Promise<StageResult<TOutput>>;
}): ModelStageFactory<TInput, TOutput> {
	return ({ logger, client }) => {
		// One gate for every run of this stage, so the lectures of a batch share the gap.
		// The config is the invocation's, so the first run's gap holds for every run.
		let sendGate: SendGate | undefined;
		return createPipelineStage({
			stageId,
			logger,
			getInput,
			run: (args) => {
				sendGate ??= createSendGate({
					gapSeconds: configuredStage({ config: args.context.config, stageId })?.sendGapSeconds,
				});
				return run({
					...args,
					concurrency: configuredConcurrency({ config: args.context.config, stageId }),
					calls: stageModelCalls({
						stageId,
						context: args.context,
						logger: args.logger,
						client,
						sendGate,
						costTally: args.costTally,
					}),
				});
			},
		});
	};
}
