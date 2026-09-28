/**
 * What every stage that calls a language model has in common: the two
 * dependencies it is handed, the arguments its run receives, and the single act
 * of asking the model for a JSON reply and insisting on getting one.
 *
 * Written once here rather than at each stage because the pieces had already
 * been copied: two stages declared the same dependency pair, took the same run
 * arguments, and parsed a JSON reply with the same two failures reported in the
 * same words. Kept apart from `pipeline-stage.ts`, which knows nothing about
 * models and should not start to (technical-design.md §5, §6).
 */

import type { Logger } from "pino";
import type { StageContext, StageCost } from "../../types/pipeline.js";
import { errorMessage } from "../../utils/errors.js";
import {
	type CompletionRequest,
	makeCompletionCall,
	type OpenRouterClient,
} from "../openrouter.js";

/**
 * The two things a model-calling stage is handed at construction: where to log,
 * and what to call the model through. Both are the invocation's rather than the
 * stage's, so a stage holds no state that outlives a run (technical-design.md §4.7).
 */
export type ModelStageDependencies = {
	readonly logger: Logger;
	readonly client: OpenRouterClient;
};

/**
 * What a model-calling stage's run receives: its prepared input and the lecture
 * it belongs to, alongside the dependencies the factory bound to it.
 *
 * @typeParam TInput - The input the stage's `getInput` produced.
 */
export type ModelStageRunArgs<TInput> = {
	readonly input: TInput;
	readonly context: StageContext;
} & ModelStageDependencies;

/**
 * What a stage asks when it wants a JSON reply: the prompt, on whose behalf,
 * and what counts as an answer. Shared by {@link tryJsonReply} and
 * {@link requestJsonReply}, which differ only in what they do with a bad reply.
 *
 * @typeParam TReply - The reply the stage expects back.
 */
export type JsonReplyRequest<TReply> = Pick<CompletionRequest, "messages" | "stageId"> & {
	readonly context: StageContext;
	readonly isReply: (value: unknown) => value is TReply;
	readonly documentedShape: string;
} & ModelStageDependencies;

/**
 * One JSON-mode call's outcome: the documented reply, or why the reply could
 * not be used. Either way the call was made, so either way it carries its cost.
 *
 * @typeParam TReply - The reply the stage expects back.
 */
export type JsonReplyOutcome<TReply> =
	| { readonly reply: TReply; readonly cost: StageCost }
	| { readonly failure: string; readonly cost: StageCost };

/**
 * Asks the model for a JSON reply on a stage's behalf and reports what came
 * back: the reply once it has been shown to be the documented one, or the
 * reason it could not be used — empty, not JSON, or the wrong shape.
 *
 * The validation is the point, not ceremony. JSON mode is a routing preference
 * rather than a guarantee, so a model whose providers cannot honour it answers
 * in prose and the request still succeeds — the stage would then be reading
 * fields off a sentence (technical-design.md §6).
 *
 * A bad reply is returned rather than thrown so that a caller resending it still
 * has the failed call's cost: the call was made and billed either way. The
 * reasons are worded once here, so a user reading one has read them all.
 *
 * @param args - What to ask, on whose behalf, and what counts as an answer.
 * @param args.messages - The prompt, as the stage's prompt module built it.
 * @param args.stageId - The stage making the call; picks its model and tuning.
 * @param args.context - The current lecture run context, which carries the configuration.
 * @param args.isReply - Whether a parsed value is the documented reply.
 * @param args.documentedShape - The reply's shape in words, for the failure a user reads.
 * @param args.logger - The run's logger, on which the call is recorded.
 * @param args.client - The OpenAI client the completion goes through.
 * @returns The validated reply or the reason it failed, with what the call cost.
 * @typeParam TReply - The reply the stage expects back.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- the message-param, pino Logger and OpenAI client types are library types that are not deeply readonly (CLAUDE.md permits dropping readonly where a library requires mutable types)
export async function tryJsonReply<TReply>({
	messages,
	stageId,
	context,
	isReply,
	documentedShape,
	logger,
	client,
}: JsonReplyRequest<TReply>): Promise<JsonReplyOutcome<TReply>> {
	const { content, cost } = await makeCompletionCall({
		messages,
		stageId,
		config: context.config,
		responseFormat: "json",
		logger,
		client,
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
 * its answer: a bad reply becomes the stage's own named error. The caller
 * supplies how to fail rather than an error type, so each stage keeps raising
 * its own error while the reasons stay identical across stages.
 *
 * @param args - As for {@link tryJsonReply}, plus how to fail.
 * @param args.fail - Builds the stage's own error from a message.
 * @returns The validated reply and what the call cost.
 * @throws The error `fail` builds, if the reply is empty, not JSON, or not the documented shape.
 * @typeParam TReply - The reply the stage expects back.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- as for tryJsonReply: library types that are not deeply readonly
export async function requestJsonReply<TReply>({
	fail,
	...request
}: JsonReplyRequest<TReply> & {
	readonly fail: (message: string) => Error;
}): Promise<{ readonly reply: TReply; readonly cost: StageCost }> {
	const outcome = await tryJsonReply(request);
	if ("failure" in outcome) {
		throw fail(outcome.failure);
	}
	return outcome;
}
