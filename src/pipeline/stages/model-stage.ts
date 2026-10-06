/**
 * The parts that the model-calling stages share: two dependencies, the arguments
 * of `run`, and the request for a JSON reply (technical-design.md §5, §6).
 *
 * This module is kept apart from `pipeline-stage.ts`, so that the stage factory
 * knows nothing about models.
 */

import type OpenAI from "openai";
import type { Logger } from "pino";
import type { PipelineStage, StageContext, StageCost, StageResult } from "../../types/pipeline.js";
import { errorMessage } from "../../utils/errors.js";
import { createSendGate } from "../../utils/send-gate.js";
import { configuredStage } from "../../utils/stage-config.js";
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
 * the dependencies, and the send gate. Every call of the stage run waits on the
 * send gate.
 *
 * @typeParam TInput - The input that the stage's `getInput` gave.
 */
export type ModelStageRunArgs<TInput> = {
	readonly input: TInput;
	readonly context: StageContext;
} & ModelStageDependencies &
	Pick<ModelCallRequest, "sendGate">;

/**
 * A request for a JSON reply: the prompt, the stage, and the check of the reply.
 * {@link tryJsonReply} and {@link requestJsonReply} take it. They differ only in
 * what they do with an unusable reply.
 *
 * @typeParam TReply - The reply that the stage expects.
 */
export type JsonReplyRequest<TReply> = Pick<
	ModelCallRequest,
	"messages" | "stageId" | "sendGate"
> & {
	readonly context: StageContext;
	readonly isReply: (value: unknown) => value is TReply;
	readonly documentedShape: string;
} & ModelStageDependencies;

/**
 * A JSON reply that has the documented shape, and the cost of the call.
 *
 * @typeParam TReply - The reply that the stage expects.
 */
export type UsableJsonReply<TReply> = { readonly reply: TReply; readonly cost: StageCost };

/**
 * The outcome of one JSON call: the documented reply, or the reason that the reply
 * is unusable. Both carry the cost, because the call was made.
 *
 * @typeParam TReply - The reply that the stage expects.
 */
export type JsonReplyOutcome<TReply> =
	| UsableJsonReply<TReply>
	| { readonly failure: string; readonly cost: StageCost };

/**
 * Asks the model for a JSON reply for a stage. It gives the reply when the reply
 * has the documented shape. Otherwise it gives the reason that the reply is
 * unusable: empty, not JSON, or the wrong shape.
 *
 * A reply in JSON mode can still be empty, prose or the wrong shape, so the reply
 * is checked (technical-design.md §6). An unusable reply is returned and not
 * thrown, so that a caller that resends still has the cost of the call.
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
 * @returns The checked reply or the reason that it is unusable, with the cost of the call.
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
}: JsonReplyRequest<TReply>): Promise<JsonReplyOutcome<TReply>> {
	const { content, cost } = await callModel({
		messages,
		stageId,
		config: context.config,
		responseFormat: "json",
		logger,
		client,
		sendGate,
	});
	if (content.trim() === "") {
		return { failure: "The model's reply was empty", cost };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch (error: unknown) {
		return {
			failure: `The model answered with something other than JSON (${errorMessage(error)})`,
			cost,
		};
	}
	if (!isReply(parsed)) {
		return { failure: `The model's reply is not the documented ${documentedShape}`, cost };
	}
	return { reply: parsed, cost };
}

/**
 * {@link tryJsonReply} for a stage that makes one call and cannot go on without
 * the answer. An unusable reply becomes the error that `fail` builds. So each
 * stage raises its own error, and the reasons are the same in every stage
 * (technical-design.md §6).
 *
 * @param args - As for {@link tryJsonReply}, and the error to raise.
 * @param args.fail - Builds the stage's own error from a message.
 * @returns The checked reply, and the cost of the call.
 * @throws The error that `fail` builds, if the reply is empty, not JSON, or not the documented shape.
 * @typeParam TReply - The reply that the stage expects.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- as for tryJsonReply: library types that are not deeply readonly
export async function requestJsonReply<TReply>({
	fail,
	...request
}: JsonReplyRequest<TReply> & {
	readonly fail: (message: string) => Error;
}): Promise<UsableJsonReply<TReply>> {
	const outcome = await tryJsonReply(request);
	if ("failure" in outcome) {
		throw fail(outcome.failure);
	}
	return outcome;
}

/** The messages that a stage sends: its prompt, then the material that the prompt is about. */
export type PromptMessages = readonly OpenAI.Chat.Completions.ChatCompletionMessageParam[];

/**
 * Builds the two messages that a stage sends: the prompt as the system message,
 * and the material as the user message.
 *
 * @param args - The prompt, and the material.
 * @param args.system - The stage's prompt.
 * @param args.user - The material, under the heading that the prompt expects.
 * @returns The system message, then the user message.
 */
export function promptMessages({
	system,
	user,
}: {
	readonly system: string;
	readonly user: string;
}): PromptMessages {
	return [
		{ role: "system", content: system },
		{ role: "user", content: user },
	];
}

/**
 * {@link tryJsonReply}, then `use` makes what the stage keeps from a usable reply.
 * `use` can also find the reply unusable, for example when its start words are not
 * in the transcript. That failure is returned like any other, with the cost of the
 * call, so a caller that resends treats every failure the same.
 *
 * @param args - As for {@link tryJsonReply}, and the use of the reply.
 * @param args.use - Makes what the stage keeps from the documented reply, or gives the reason that it cannot.
 * @returns The value that the stage keeps, or the reason that the reply is unusable, with the cost of the call.
 * @typeParam TReply - The reply that the stage expects.
 * @typeParam TKept - The value that the stage keeps from the reply.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- as for tryJsonReply: library types that are not deeply readonly
export async function tryJsonReplyAs<TReply, TKept>({
	use,
	...request
}: JsonReplyRequest<TReply> & {
	readonly use: (reply: TReply) => { readonly reply: TKept } | { readonly failure: string };
}): Promise<JsonReplyOutcome<TKept>> {
	const outcome = await tryJsonReply(request);
	if ("failure" in outcome) {
		return outcome;
	}
	return { ...use(outcome.reply), cost: outcome.cost };
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
 * gets the client of the invocation and a send gate (technical-design.md §4.7).
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
	return ({ logger, client }) =>
		createPipelineStage({
			stageId,
			logger,
			getInput,
			run: (args) =>
				run({
					...args,
					client,
					// Each stage run gets a new send gate, so it never waits on a turn from an earlier one.
					sendGate: createSendGate({
						gapSeconds: configuredStage({ config: args.context.config, stageId })?.sendGapSeconds,
					}),
				}),
		});
}
