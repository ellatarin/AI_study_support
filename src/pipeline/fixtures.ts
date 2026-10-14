/**
 * Test fixtures and helpers that the pipeline suites share.
 *
 * `PipelineConfig` and `Manifest` have many required fields. The builders here
 * make them, so a new field needs one edit and not one edit in each suite. Each
 * builder takes `overrides`, so a test states only the fields that its behaviour
 * depends on.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import nock from "nock";
import type OpenAI from "openai";
import type { Logger } from "pino";
import { afterEach, beforeEach, expect, it, type Mock, vi } from "vitest";
import type {
	CostTally,
	FactCheckModel,
	FactCorrectionStageConfig,
	Manifest,
	ModelCost,
	OutputLanguage,
	PipelineConfig,
	PipelineStage,
	SingleModelStageId,
	StageConfig,
	StageConfigUsed,
	StageContext,
	StageCost,
	StageEntry,
	StageId,
	StageResult,
} from "../types/pipeline.js";
import { createCostTally, createCostTallyByModel } from "../utils/cost.js";
import { NamedError } from "../utils/errors.js";
import { pathExists } from "../utils/files.js";
import { MAX_SENDS } from "../utils/resend.js";
import { createSendGate, type SendGate } from "../utils/send-gate.js";
import { parseConfig } from "./config.js";
import {
	lectureNotesDirPath,
	type ModuleDirs,
	moduleDirs,
	notesPagePath,
	type StageWithOutputFile,
	sharedLectureFileDirs,
	stageDirectoryPath,
	stageOutputEntry,
	stageOutputPath,
	workspaceRootFor,
} from "./layout.js";
import { baseNameForLecture } from "./lecture-files.js";
import { MANIFEST_VERSION, pendingStages } from "./manifest.js";
import {
	createOpenRouterClientProvider,
	API_KEY_VARIABLE as OPENROUTER_KEY_VARIABLE,
	OPENROUTER_PATHS,
	type OpenRouterClient,
} from "./openrouter.js";
import { createMoneyFormatter, type MoneyFormatter } from "./reports.js";
import { assembleContext } from "./stage-context.js";
import { type Subtopic, type SubtopicWithIdAndText, subtopicText } from "./stages/division.js";
import type { FactCorrectedSubtopics } from "./stages/fact-corrections.js";
import type { FactualError, MergedFactualError } from "./stages/factual-errors.js";
import { type ModelStageFactory, ResendsExhaustedError } from "./stages/model-stage.js";
import { SavedRunUnreadableError } from "./stages/panel-runs.js";
import type { SlidePlacement, SlidePlacements } from "./stages/slide-placements.js";
import type { ReadingStage } from "./stages/stage-input.js";
import type { StructuredTranscript } from "./stages/structured-transcript.js";
import type { TitledSubtopicRewrite } from "./stages/subtopic-rewrites.js";
import type { Topic } from "./stages/topics.js";
import {
	API_KEY_VARIABLE as ELEVENLABS_KEY_VARIABLE,
	ELEVENLABS_PATHS,
} from "./stages/transcription/transcription.js";

/**
 * Awaits a promise that must reject, and returns the error. A test can then make
 * several assertions about one error. `rejects.toThrow` checks only one
 * condition. A bare try/catch passes when the promise resolves, so this function
 * throws in that case.
 *
 * @param promise - The promise under test. It must reject.
 * @returns The error that the promise rejected with.
 * @throws {Error} If the promise resolves.
 */
// prefer-readonly-parameter-types cannot see a Promise as read-only, because a
// Promise is a built-in type with methods. To await a promise does not change it,
// so the rule protects nothing here.
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
export async function captureError(promise: Promise<unknown>): Promise<Error> {
	try {
		await promise;
	} catch (error: unknown) {
		return error as Error;
	}
	throw new Error("Expected the promise to reject, but it resolved");
}

/**
 * The time limit of a test whose call is sent three times. Two real pauses, of two
 * seconds and then four seconds, come before the third send.
 */
export const resendPausesTimeoutMs = 10_000;

/** The calls that a stub recorded, as a check reads them. A vitest `Mock` gives them. */
type RecordedCalls = { readonly mock: { readonly calls: readonly unknown[] } };

/**
 * Checks that a stage run failed because the reply of the third send was still
 * unusable. It also checks that each call was sent three times, and that the
 * stage wrote no output file.
 *
 * @param args - The stage run, the stub client, and the output file to look for.
 * @param args.pending - The stage run.
 * @param args.create - The completion stub of the stage's client. Only its calls are read.
 * @param args.calls - The number of calls that were in flight. Each is sent three times.
 * @param args.outputPath - The absolute path of the output file that the failed call would write.
 * @returns A promise that resolves when the checks pass.
 */
async function expectResendsExhaustedWithoutOutput({
	pending,
	create,
	calls,
	outputPath,
}: {
	readonly pending: Readonly<Promise<unknown>>;
	readonly create: RecordedCalls;
	readonly calls: number;
	readonly outputPath: string;
}): Promise<void> {
	expect(await captureError(pending)).toBeInstanceOf(ResendsExhaustedError);
	expect(create.mock.calls).toHaveLength(MAX_SENDS * calls);
	expect(await pathExists(outputPath)).toBe(false);
}

/**
 * Adds the test that a stage with one file for each subtopic fails when each reply is
 * unusable. Each call is sent three times, and the stage writes no file for the
 * subtopic.
 *
 * @param args - The stage run, the stub client, and the file to look for.
 * @param args.run - Runs the stage.
 * @param args.create - Gives the completion stub of the current test.
 * @param args.calls - The number of calls that were in flight. Each is sent three times.
 * @param args.outputPath - Gives the absolute path of the file of one subtopic in the current test.
 */
export function itFailsAfterTheThirdUnusableSend({
	run,
	create,
	calls,
	outputPath,
}: {
	readonly run: () => Promise<unknown>;
	readonly create: () => StubbedCompletionCall;
	readonly calls: number;
	readonly outputPath: () => string;
}): void {
	it("should fail without writing the subtopic's file when the third send is still unusable", {
		timeout: resendPausesTimeoutMs,
	}, async () => {
		create().mockResolvedValue(openRouterReplyBody({ content: JSON.stringify({}) }));

		await expectResendsExhaustedWithoutOutput({
			pending: run(),
			create: create(),
			calls,
			outputPath: outputPath(),
		});
	});
}

/**
 * Adds the two tests of the saved files of a stage with one file for each
 * subtopic. A stage that starts again makes no call. An unreadable saved file
 * fails the stage with its own error, and the error names the file.
 *
 * @param args - The stage run, its stub, a saved file, and the stage's error.
 * @param args.run - Runs the stage.
 * @param args.create - Gives the stubbed completion call of the current test.
 * @param args.savedFilePath - Gives the absolute path of the file of one subtopic in the current test.
 * @param args.stageError - The error class of the stage.
 */
export function itReadsSavedSubtopicFiles({
	run,
	create,
	savedFilePath,
	stageError,
}: {
	readonly run: () => Promise<unknown>;
	readonly create: () => StubbedCompletionCall;
	readonly savedFilePath: () => string;
	readonly stageError: new (message: string) => Error;
}): void {
	it("should make no call for a subtopic with a saved file when the stage starts again", async () => {
		await run();
		create().mockClear();

		await run();

		expect(create()).not.toHaveBeenCalled();
	});

	it(`should fail with ${stageError.name} that names the file when a saved file holds nothing readable`, async () => {
		await seedJsonFile({ path: savedFilePath(), contents: {} });

		const error = await captureError(run());

		expect(error).toBeInstanceOf(stageError);
		expect(error.message).toContain(savedFilePath());
	});
}

/** The pino levels that {@link makeStubLogger} records. */
const LOGGED_LEVELS = ["debug", "info", "warn", "error"] as const;

/** One level that a stub logger records. */
export type LoggedLevel = (typeof LOGGED_LEVELS)[number];

/** One call to a {@link makeStubLogger} logger, with the bindings of the logger that took it. */
export type LoggedEntry = {
	readonly level: LoggedLevel;
	readonly bindings: Readonly<Record<string, unknown>>;
	readonly payload: Readonly<Record<string, unknown>>;
	readonly message: string;
};

/** A logger to inject, and each entry that it records. */
export type StubLogger = {
	readonly logger: Logger;
	readonly entries: readonly LoggedEntry[];
};

/**
 * A pino stand-in that records each call to it.
 *
 * Callers log through a child logger that is bound to the stage. So the stub
 * supports `child()`. Each child records the bindings of its parent logger and
 * its own bindings. A test can then check
 * that a line was logged against the correct stage. The stub records every
 * level, not only `error`. A test asks the same three things of a `debug` line
 * and of a failure: the message, the payload and the bindings.
 *
 * @returns The logger to inject, and each entry that it records.
 */
export function makeStubLogger(): StubLogger {
	const entries: LoggedEntry[] = [];
	const makeChild = (bindings: Readonly<Record<string, unknown>>): Logger => {
		const record =
			(level: LoggedLevel) =>
			// eslint-disable-next-line max-params -- pino's own signature is (payload, message)
			(payload: Readonly<Record<string, unknown>>, message: string) => {
				entries.push({ level, bindings, payload, message });
			};
		const levels = Object.fromEntries(LOGGED_LEVELS.map((level) => [level, record(level)]));
		return {
			...levels,
			child: (childBindings: Readonly<Record<string, unknown>>) =>
				makeChild({ ...bindings, ...childBindings }),
		} as unknown as Logger;
	};
	return { logger: makeChild({}), entries };
}

/**
 * Gives a suite its own stub logger, made again before each test. A test that
 * checks the log then never reads the entries of an earlier test.
 *
 * Each suite that reads its log needs a stub logger that is made again before
 * each test. So this function is in this file, and no suite has its own `let`
 * and hook for the stub logger.
 *
 * The function returns a reader, not the logger, because the logger does not
 * exist until the hook runs. {@link useTempDir} has the same shape.
 *
 * @returns A function that gives the stub logger of the current test.
 */
export function useStubLogger(): () => StubLogger {
	let stubLogger: StubLogger | null = null;

	beforeEach(() => {
		stubLogger = makeStubLogger();
	});

	return () => {
		if (stubLogger === null) {
			throw new Error("The stub logger is only available inside a test");
		}
		return stubLogger;
	};
}

/**
 * The entries that a stub logger recorded at one level, in the order of logging.
 *
 * @param args - The entries and the level.
 * @param args.entries - All the entries that the stub logger recorded.
 * @param args.level - The level to keep.
 * @returns The entries at that level.
 */
export function loggedAt({
	entries,
	level,
}: {
	readonly entries: readonly LoggedEntry[];
	readonly level: LoggedLevel;
}): readonly LoggedEntry[] {
	return entries.filter((entry) => entry.level === level);
}

/**
 * The example configuration in the repository, after the config check.
 *
 * Tests read configuration from here and do not restate it. A suite that needs
 * the OpenRouter address or a timeout takes it from here. A new required field
 * then needs an edit in one file. The fixtures read the example, not
 * `pipeline-config.json`, because git ignores that file and each machine has
 * its own copy. A test must give the same result on every machine.
 *
 * The real config check parses the example. So each suite also checks that the
 * example loads. Nothing else checks this.
 */
export const exampleConfig: PipelineConfig = parseConfig(
	JSON.parse(
		readFileSync(join(import.meta.dirname, "..", "..", "pipeline-config.example.json"), "utf8"),
	),
);

/**
 * The number of pounds for one US dollar in the suites. It is not taken from
 * `currency.gbpPerUsd`.
 *
 * Each expected pounds figure in a suite is calculated by hand at this rate. If
 * the rate came from the config, a change to the config rate would make those
 * assertions fail. The failure would then seem to come from the formatter. If
 * the expected figures used the config rate, they would use the same rate as the
 * code under test, and they would prove nothing.
 */
export const GBP_PER_USD = 0.74;

/**
 * The money formatter of the suites, at {@link GBP_PER_USD}. The reports take a
 * formatter, not a rate. The suites share this one formatter, as the CLI makes
 * one formatter for its stage notices and its summaries.
 */
export const formatTestMoney: MoneyFormatter = createMoneyFormatter({ gbpPerUsd: GBP_PER_USD });

/** A configured service address, split into the two parts that nock needs. */
type ServiceAddress = {
	/** The scheme and host, for the nock scope. */
	readonly origin: string;
	/**
	 * The full path to one endpoint of the service: the configured base path and
	 * then the endpoint route. An interceptor matches on this path.
	 *
	 * @param endpoint - The route of the endpoint, as the production code gives it.
	 * @returns The path to intercept.
	 */
	readonly pathTo: (endpoint: string) => string;
};

/**
 * Splits a configured base URL into the parts that a suite needs to intercept
 * the service.
 *
 * Each address that a suite intercepts comes from this one parse of the
 * configuration. So if a base URL changes, the interceptors change with it. Also,
 * the origin of a scope always agrees with the path that the scope matches.
 *
 * @param baseUrl - The configured address of the service.
 * @returns The origin, and the paths to the endpoints.
 */
function configuredAddress(baseUrl: string): ServiceAddress {
	const address = new URL(baseUrl);
	// A base URL that is only a host parses to the path "/". The endpoint route
	// starts with "/" too, so the trailing "/" is removed.
	const basePath = address.pathname.replace(/\/$/, "");
	return { origin: address.origin, pathTo: (endpoint) => `${basePath}${endpoint}` };
}

/**
 * The OpenRouter addresses that a suite gives to nock, for one base URL.
 *
 * The addresses come from the base URL and from the endpoint paths that the
 * production code calls. So a suite does not restate the URL or an endpoint. If
 * either changes, the interceptors change with it. The function takes the
 * address, and does not read the example, because some suites use a gateway
 * address. They prove that the code reads the configured address.
 *
 * @param baseUrl - The configured OpenRouter base URL.
 * @returns The origin, the endpoint paths, and the models page for people.
 */
export function openRouterUrlsAt(baseUrl: string): {
	readonly origin: string;
	readonly completions: string;
	readonly models: string;
	readonly modelsPage: string;
} {
	const address = configuredAddress(baseUrl);
	return {
		origin: address.origin,
		completions: address.pathTo(OPENROUTER_PATHS.completions),
		models: address.pathTo(OPENROUTER_PATHS.models),
		// The models page for people, which the error of a failed model-ID check
		// gives. It is on the origin, not the API base path, as in the production code.
		modelsPage: `${address.origin}${OPENROUTER_PATHS.models}`,
	};
}

/** The OpenRouter addresses of the example configuration, for nock. */
export const openRouterUrls = openRouterUrlsAt(exampleConfig.openRouter.baseUrl);

/**
 * The OpenRouter client provider for a config, made as the CLI makes it.
 *
 * A stage gets a client provider, as it gets its logger. So each suite that
 * runs a stage or a model call gives one, from here. A suite that needs the
 * client calls the provider.
 *
 * @param args - The config.
 * @param args.config - The checked config whose `openRouter` section the client uses.
 * @returns A provider that gives one client for that config.
 */
export function openRouterClientFor({
	config,
}: {
	readonly config: PipelineConfig;
}): OpenRouterClient {
	return createOpenRouterClientProvider({ openRouter: config.openRouter });
}

/** The stub of the chat completion call of a {@link stubbedOpenRouterClient}. */
export type StubbedCompletionCall = Mock<
	(body: Readonly<Record<string, unknown>>) => Promise<unknown>
>;

/**
 * A stub OpenRouter client, for a suite that builds a model stage with it. The
 * stage then runs the real model-call code. Each completion call goes to
 * `create`. The suite sets the reply on `create` and reads each request body
 * from its calls.
 *
 * @returns The client provider to build the stage with, and the stub of its completion call.
 */
export function stubbedOpenRouterClient(): {
	readonly client: OpenRouterClient;
	readonly create: StubbedCompletionCall;
} {
	const create: StubbedCompletionCall = vi.fn();
	const openAi = { chat: { completions: { create } } } as unknown as OpenAI;
	return { client: () => openAi, create };
}

/**
 * Gives a suite a new {@link stubbedOpenRouterClient} before each test. The
 * function returns readers, because the client does not exist until the hook
 * runs. {@link useStubLogger} has the same shape.
 *
 * @returns Readers for the client and the completion call of the current test.
 */
export function useStubbedOpenRouter(): {
	readonly client: () => OpenRouterClient;
	readonly create: () => StubbedCompletionCall;
} {
	let stubbed = stubbedOpenRouterClient();
	beforeEach(() => {
		stubbed = stubbedOpenRouterClient();
	});
	return { client: () => stubbed.client, create: () => stubbed.create };
}

const elevenLabsAddress = configuredAddress(exampleConfig.elevenLabs.baseUrl);

/**
 * The ElevenLabs addresses of the example configuration, for nock. They come
 * from the configured address and the SDK route, as {@link openRouterUrls} does.
 * So a suite does not restate the host or the endpoint.
 */
export const elevenLabsUrls = {
	/** The scheme and host, for the nock scope. */
	origin: elevenLabsAddress.origin,
	/** The path to the speech-to-text endpoint that the transcription stage posts to. */
	speechToText: elevenLabsAddress.pathTo(ELEVENLABS_PATHS.speechToText),
} as const;

/**
 * The configuration of a stage in the example configuration. A suite takes the
 * model and tuning from here and does not restate them. If the example does not
 * configure the stage, the suite fails.
 *
 * @param stageId - The stage whose configuration to read.
 * @returns The configuration of the stage.
 * @throws {Error} If the example does not configure the stage.
 */
export function exampleStageConfig(stageId: SingleModelStageId): StageConfig {
	const configured = exampleConfig.stages[stageId];
	if (configured === undefined) {
		throw new Error(`pipeline-config.example.json configures no stage "${stageId}"`);
	}
	return configured;
}

/** The Scribe model ID in the example, with the provider prefix that `transcription` expects. */
export const transcriptionModelId = exampleStageConfig("transcription").modelId;

/**
 * A real OpenRouter model ID for the suites. It is not from the example config.
 * Each OpenRouter stage there has a placeholder such as `<REASONING_MODEL>`,
 * which fails the model-ID check.
 */
export const openRouterModelId = "openai/gpt-4o";

/** The primary model of a `check-facts` models list in the suites. */
export const primaryFactCheckModel: FactCheckModel = {
	modelId: "openai/gpt-5.6-sol-pro",
	role: "primary",
};

/** The secondary model of a `check-facts` models list in the suites. */
export const secondaryFactCheckModel: FactCheckModel = {
	modelId: "anthropic/claude-opus-5.5",
	role: "secondary",
};

/** A disabled model of a `check-facts` models list in the suites. */
export const disabledFactCheckModel: FactCheckModel = {
	modelId: "google/gemini-3.1-pro-preview",
	role: "disabled",
};

/** The ids of the two called models of a `check-facts` models list, the primary model first. */
export const factCheckModelIds = [primaryFactCheckModel.modelId, secondaryFactCheckModel.modelId];

/** Subtopic 1 of the lecture that the fact suites check. It has no factual error. */
export const openingSubtopic: TitledSubtopicRewrite = {
	subtopicId: 1,
	title: "Opening",
	rewrittenSubtopic: ["Cancer is a disease of cells."],
};

/** Subtopic 2 of the lecture that the fact suites check. Its second paragraph has {@link snuffFactualError}. */
export const tobaccoSubtopic: TitledSubtopicRewrite = {
	subtopicId: 2,
	title: "Tobacco",
	rewrittenSubtopic: ["Tobacco smoke causes most lung cancers.", "Snuff is harmless."],
};

/** The rewrite of each subtopic of the lecture that the fact suites check, in lecture order. */
export const factCheckedSubtopics: readonly TitledSubtopicRewrite[] = [
	openingSubtopic,
	tobaccoSubtopic,
];

/** The factual error of {@link tobaccoSubtopic}, in the project's words. */
export const snuffFactualError: FactualError = {
	subtopicId: 2,
	passage: "Snuff is harmless.",
	problem: "Snuff causes oral cancer.",
	correctStatement: "Snuff causes cancer of the mouth.",
	severity: "serious",
};

/**
 * The token counts in the `usage` of a stubbed OpenRouter reply. A suite that
 * checks a `StageCost` checks that the pipeline kept these counts unchanged.
 */
export const stubbedTokenUsage = { promptTokens: 120, completionTokens: 45 } as const;

/** The price of one stubbed model call, in US dollars. */
export const stubbedCostUsd = 0.004;

/**
 * The `usage` of a stubbed OpenRouter reply: {@link stubbedTokenUsage} at the
 * price {@link stubbedCostUsd}, in the OpenRouter field names.
 */
export const stubbedReplyUsage = {
	prompt_tokens: stubbedTokenUsage.promptTokens,
	completion_tokens: stubbedTokenUsage.completionTokens,
	cost: stubbedCostUsd,
} as const;

/** The cost of one stubbed model call: its tokens, one call and its price. */
export const stubbedCallCost: StageCost = {
	...stubbedTokenUsage,
	callCount: 1,
	costUsd: stubbedCostUsd,
};

/**
 * The cost of a stage that made `calls` stubbed model calls: {@link stubbedCallCost}
 * `calls` times.
 *
 * @param args - The number of calls.
 * @param args.calls - The number of stubbed model calls.
 * @returns The total cost of the calls.
 */
export function stubbedCallsCost({ calls }: { readonly calls: number }): StageCost {
	return {
		promptTokens: stubbedTokenUsage.promptTokens * calls,
		completionTokens: stubbedTokenUsage.completionTokens * calls,
		callCount: calls,
		costUsd: stubbedCostUsd * calls,
	};
}

/**
 * The time limit of a test that makes real media with ffmpeg. It is much longer
 * than the default, because these tests encode and probe a real file.
 */
export const mediaTestTimeoutMs = 30_000;

/**
 * The full configuration of a stage in the example, with its tuning, and with
 * a real model ID in place of the placeholder.
 *
 * A suite takes the tuning from here and does not state `temperature` or
 * `maxTokens` itself. A suite that restated the tuning would still pass after
 * the example tuning changed.
 *
 * @param args - The stage, and the model to use.
 * @param args.stageId - The stage whose configuration to take.
 * @param args.modelId - The model ID to use. The default is {@link openRouterModelId}.
 * @returns The stage config, for {@link makeConfig}.
 * @throws {Error} If the example does not configure the stage.
 */
export function openRouterStageConfig({
	stageId,
	modelId = openRouterModelId,
}: {
	readonly stageId: SingleModelStageId;
	readonly modelId?: string;
}): StageConfig {
	return { ...exampleStageConfig(stageId), modelId };
}

/** Text that is not valid JSON, for the suites that check the error for a corrupt file. */
export const corruptJson = "{ not json";

/**
 * A correct Scribe single-channel response body, as the SDK reads it.
 *
 * The shape belongs to ElevenLabs, not to the suites. It includes the language
 * fields that the stage does not read. So the suites that intercept a
 * transcription share this one body.
 *
 * @param args - The transcript.
 * @param args.text - The transcript text to return.
 * @returns The response body.
 */
export function scribeResponseBody({ text }: { readonly text: string }): Record<string, unknown> {
	return { language_code: "eng", language_probability: 0.99, text, words: [] };
}

/**
 * A correct OpenRouter reply body, in the shape of the chat completions API. The
 * shape belongs to the API, not to the suites, so the suites share this body.
 *
 * @param args - The reply text, and the finish reason.
 * @param args.content - The content of the assistant message.
 * @param args.finishReason - The finish reason. The default is `"stop"`. `null` gives no finish reason.
 * @returns The response body.
 */
export function openRouterReplyBody({
	content,
	finishReason = "stop",
}: {
	readonly content: string;
	readonly finishReason?: string | null;
}): Record<string, unknown> {
	return {
		// eslint-disable-next-line id-length -- the field name belongs to OpenRouter, so this code cannot change it
		id: "gen-abc",
		choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finishReason }],
		usage: stubbedReplyUsage,
	};
}

/**
 * Gives a stub completion that picks its reply by the text of the request. A
 * stage can send several calls at the same time. Then the replies cannot follow
 * the call order, so a suite picks the reply of a call by what the call sends.
 *
 * @param args - The text to find, and the two replies.
 * @param args.holds - The text that a request holds to get `matching`, such as a paragraph or an image in base64.
 * @param args.matching - The reply body to a request that holds the text.
 * @param args.other - The reply body to every other request.
 * @returns The completion, for `mockImplementation` of a {@link StubbedCompletionCall}.
 */
export function replyingWhenRequestHolds({
	holds,
	matching,
	other,
}: {
	readonly holds: string;
	readonly matching: unknown;
	readonly other: unknown;
}): (body: Readonly<Record<string, unknown>>) => Promise<unknown> {
	return (body) => Promise.resolve(JSON.stringify(body).includes(holds) ? matching : other);
}

/**
 * Intercepts one JSON-mode model call, and replies with `reply` at the price
 * {@link stubbedCostUsd}. It keeps the request body that the stage sent.
 *
 * Each suite of a stage that calls a model over real HTTP needs this interceptor
 * and this capture, so the suites share this function. The suite reads the body through the
 * returned function, not through a variable of its own. So no test has to reset
 * it.
 *
 * @param reply - The JSON object that the model replies with.
 * @returns A function that gives the request body that the stage sent.
 */
export function stubModelReply(
	reply: Readonly<Record<string, unknown>>,
): () => Record<string, unknown> {
	let capturedBody: Record<string, unknown> = {};
	nock(openRouterUrls.origin)
		.post(openRouterUrls.completions)
		// eslint-disable-next-line max-params -- nock gives (uri, body) to its reply callback as positional parameters. The signature belongs to the library
		.reply((_uri, body) => {
			capturedBody = body as Record<string, unknown>;
			return [200, openRouterReplyBody({ content: JSON.stringify(reply) })];
		});
	return () => capturedBody;
}

/**
 * Checks that a captured request asks for JSON, with the routing that JSON mode
 * needs (technical-design.md §6).
 *
 * The function checks `response_format` and `require_parameters` together. A
 * suite that checked only one of them could pass on a stage that sends only one of the two fields. That stage
 * would pay for a call and get a reply that it cannot parse.
 *
 * @param request - The request body that the stage sent, as `stubModelReply` captured it.
 * @returns Nothing.
 */
export function expectJsonModeRequest(request: Readonly<Record<string, unknown>>): void {
	expect(request.response_format).toEqual({ type: "json_object" });
	expect(request.provider).toEqual({ require_parameters: true });
}

/**
 * The example configuration with no module roots and no stages. All other
 * values are the real example values.
 *
 * A suite states the stages that it tests, and does not get every stage of the
 * example. So a test that does not configure a stage fails, and does not use a
 * placeholder model.
 *
 * @param overrides - The top-level fields to replace.
 * @returns The config.
 */
export function makeConfig(overrides: Partial<PipelineConfig> = {}): PipelineConfig {
	return { ...exampleConfig, moduleRoots: [], stages: {}, ...overrides };
}

/**
 * Each language that the pipeline can write, with the name that a prompt gives
 * it. The names are stated here, and not taken from the production code.
 */
export const outputLanguageNames = [
	{ language: "en-GB", name: "British English" },
	{ language: "en-US", name: "American English" },
] as const;

/**
 * A {@link makeConfig} configuration with exactly one stage, on
 * {@link openRouterModelId}, for a suite that tests one stage.
 *
 * @param args - The stage, and the language of the notes.
 * @param args.stageId - The stage to configure.
 * @param args.language - The language that the prose stages must use. The default is the language of the example config.
 * @returns The config.
 */
export function configuringStage({
	stageId,
	language,
}: {
	readonly stageId: SingleModelStageId;
	readonly language?: OutputLanguage;
}): PipelineConfig {
	const config = makeConfig();
	return {
		...config,
		finalOutput: language === undefined ? config.finalOutput : { ...config.finalOutput, language },
		stages: { [stageId]: openRouterStageConfig({ stageId }) },
	};
}

/** A directory that does not exist, which holds {@link testModuleRoot} and {@link otherModuleRoot}. */
const SYNTHETIC_MODULES_DIR = "/modules";

/** The identity and the file names of one lecture in the suites. */
export type TestLecture = {
	readonly number: number;
	readonly date: string;
	readonly title: string;
	readonly baseName: string;
	/** The video recording that {@link makeLectureTree} writes for the lecture. */
	readonly videoRecordingFile: string;
	/** The slide deck that {@link makeLectureTree} writes for the lecture. */
	readonly slideDeckFile: string;
	/** The folder of the lecture's notes, which {@link makeLectureTree} makes in the final output folder. */
	readonly finalOutputFile: string;
};

/**
 * Gives a lecture the base name that `source-normalisation` gives it. A fixture
 * then cannot describe a lecture that the pipeline would not make. A base name
 * that disagreed with its date would make suites fail for an unrelated reason.
 *
 * The video recording, the slide deck and the notes have that base name, as
 * `source-normalisation` leaves them. So their names come from here too, and a
 * suite does not make them again from `${baseName}.mp4`.
 *
 * @param lecture - The number, date and title of the lecture.
 * @returns The lecture with its base name and file names.
 */
function describeLecture(lecture: Pick<TestLecture, "number" | "date" | "title">): TestLecture {
	const baseName = baseNameForLecture({
		lectureNumber: lecture.number,
		title: lecture.title,
		lectureDate: lecture.date,
	});
	return {
		...lecture,
		baseName,
		videoRecordingFile: `${baseName}.mp4`,
		slideDeckFile: `${baseName}.pdf`,
		finalOutputFile: baseName,
	};
}

/**
 * The lecture that the suites use when they need one. Its number, date and title
 * have one home. So a change to them is one edit, and the suites cannot disagree
 * about them.
 *
 * Suites that test the naming keep their own literals. A derived value checked
 * against itself proves nothing.
 */
export const testLecture = describeLecture({
	number: 1,
	date: "2025-10-10",
	title: "Cell Injury",
});

/** The module of {@link testLecture}. */
export const testModuleName = "Biology of Disease";

/** The source files of one lecture, with the names that the lecturer gave them. */
export type LectureSources = {
	readonly videoRecording: string;
	/** The slide deck with the same date. */
	readonly slideDeck: string;
	/**
	 * The date in both names. It is stated, and not read from the names, because
	 * the suites test the rule that reads a date from a filename.
	 */
	readonly date: string;
};

/**
 * Source files, and the base names that `source-normalisation` gives them.
 *
 * Two suites use these names: the `source-normalisation` suite, which writes the
 * files on disk, and the `lecture-resolution` suite, which reads the names with no disk.
 * The two suites must agree about the base names that `source-normalisation`
 * gives, so the names are stated once.
 *
 * The base names below are stated in full, not derived as in
 * {@link describeLecture}. Both suites test the naming and numbering rules. An
 * expected value from {@link baseNameForLecture} would check the rule against
 * itself. Some of these strings are the same as a `baseName` from
 * {@link describeLecture}. That is an accident of the example, not a shared
 * fact.
 */
export const cellInjurySources: LectureSources = {
	videoRecording: "2025-10-10 BOD_Cell Injury.mp4",
	slideDeck: "2025-10-10 Cell Injury deck.pdf",
	// This is the lecture of {@link testLecture}, so the date comes from there.
	date: testLecture.date,
};

/** The source files of the second lecture. See {@link cellInjurySources}. */
export const vaccinationSources: LectureSources = {
	videoRecording: "2025-10-17 BOD_Vaccination.mp4",
	slideDeck: "2025-10-17 Vaccination deck.pdf",
	date: "2025-10-17",
};

/** The source files of a lecture dated between the other two, for the renumbering cases. */
export const immunitySources: LectureSources = {
	videoRecording: "2025-10-13 BOD_Immunity to Infection.mp4",
	slideDeck: "2025-10-13 Immunity deck.pdf",
	date: "2025-10-13",
};

/** The base name of {@link cellInjurySources} when it is the first lecture of the module. */
export const cellInjuryAsFirst = "Lecture 1 - Cell Injury - 2025-10-10";

/** The base name of {@link vaccinationSources} when it is the second of two lectures. */
export const vaccinationAsSecond = "Lecture 2 - Vaccination - 2025-10-17";

/** The base name of {@link immunitySources} when it is added as the second of three lectures. */
export const immunityAsSecond = "Lecture 2 - Immunity to Infection - 2025-10-13";

/** The base name of {@link vaccinationSources} after {@link immunitySources} is added. */
export const vaccinationAsThird = "Lecture 3 - Vaccination - 2025-10-17";

/** The base name of {@link vaccinationSources} after the first lecture is removed. */
export const vaccinationAsFirst = "Lecture 1 - Vaccination - 2025-10-17";

/**
 * The text of a transcript, for the suites that write a transcript and the
 * suites that read one. No assertion reads the words. Each suite checks only
 * that the text that it gave is the text that it received. So it is one value,
 * and a suite that states its own text says that the words matter.
 */
export const transcriptText = "Today we are covering cell injury and the immune system.";

/** {@link transcriptText} with whitespace at the two ends, as a transcript file can hold it. */
export const paddedTranscriptText = `  ${transcriptText}\n\n`;

/** The start words of the second subtopic of {@link transcriptDivision}. */
export const transcriptSecondStartWords = "cell injury and the immune system";

/** The position of {@link transcriptSecondStartWords} in {@link transcriptText}. */
const SECOND_SUBTOPIC_START = transcriptText.indexOf(transcriptSecondStartWords);

/**
 * {@link transcriptText} divided in two, as a splitting run saves it. The
 * `initial-subtopic-splitting` suite expects a saved run to hold it, and the
 * `deepen-subtopic-splitting` suite starts from it.
 */
export const transcriptDivision: readonly Subtopic[] = [
	{ start: 0, end: SECOND_SUBTOPIC_START, title: "Opening", reason: "The framing." },
	{
		start: SECOND_SUBTOPIC_START,
		end: transcriptText.length,
		title: "Cell injury",
		reason: "One topic.",
	},
];

/**
 * The text of each subtopic of {@link transcriptDivision}, trimmed, as a stage
 * sends it to a model. The texts are stated in full here, and not cut by the
 * production code.
 */
export const transcriptSubtopicTexts = [
	"Today we are covering",
	"cell injury and the immune system.",
] as const;

/**
 * The subtopic id, the title and the text of each subtopic of
 * {@link transcriptDivision}. A stage sends them to a model in this form, and
 * the structured transcript holds them in this form.
 */
export const transcriptSubtopicsWithIdAndText: readonly SubtopicWithIdAndText[] = [
	...transcriptDivision.entries(),
].map(([index, subtopic]) => ({
	subtopicId: index + 1,
	title: subtopic.title,
	text: transcriptSubtopicTexts[index] ?? "",
}));

/** The first topic of {@link transcriptTopics}. It holds the first subtopic. */
export const openingTopic: Topic = {
	title: "The lecture's opening",
	groupedBecause: "It frames the lecture.",
	firstSubtopicId: 1,
};

/** The second topic of {@link transcriptTopics}. It holds the last subtopic. */
export const subjectTopic: Topic = {
	title: "Cell injury",
	groupedBecause: "It is the lecture's subject.",
	firstSubtopicId: 2,
};

/**
 * {@link transcriptDivision} grouped into topics, as `group-into-topics` writes
 * them. Each subtopic is a topic of its own.
 */
export const transcriptTopics: readonly Topic[] = [openingTopic, subjectTopic];

/**
 * {@link transcriptTopics} with their subtopics, as `structure-transcript` writes
 * them under the title of {@link testLecture}.
 */
export const transcriptStructuredTranscript: StructuredTranscript = {
	lectureTitle: testLecture.title,
	topics: [
		{ title: openingTopic.title, subtopics: transcriptSubtopicsWithIdAndText.slice(0, 1) },
		{ title: subjectTopic.title, subtopics: transcriptSubtopicsWithIdAndText.slice(1) },
	],
};

/**
 * A saved run that an earlier invocation left. It holds {@link transcriptText}
 * as one subtopic, which no stubbed reply of the division suites makes. So if a
 * suite finds it after the stage runs, the stage kept the saved run and did not
 * make the splitting run again.
 */
export const earlierSavedRun: readonly Subtopic[] = [
	{ start: 0, end: transcriptText.length, title: "Whole", reason: "Earlier." },
];

/**
 * The ways in which the transcript that a division stage reads can be unusable,
 * for a suite's `it.each`. Each one has a function that spoils the transcript
 * of a workspace, and the text that the error then contains.
 */
export const unusableTranscripts: readonly {
	readonly state: string;
	readonly spoil: (workspaceRoot: string) => Promise<void>;
	readonly says: string;
}[] = [
	{
		state: "missing",
		spoil: (workspaceRoot) => rm(stageOutputPath({ workspaceRoot, stageId: "transcription" })),
		says: "run transcription first",
	},
	{
		state: "blank",
		spoil: (workspaceRoot) =>
			writeFile(stageOutputPath({ workspaceRoot, stageId: "transcription" }), " \n"),
		says: "holds no text; there is nothing to divide",
	},
];

/**
 * The ways in which a JSON input file that a stage reads can be unusable, for a
 * suite's `it.each`. A `null` content means that the file is deleted. The wrong
 * shape is wrong for every JSON file that a stage reads.
 */
export const unusableJsonContents: readonly {
	readonly state: string;
	readonly contents: string | null;
}[] = [
	{ state: "missing", contents: null },
	{ state: "not JSON", contents: "Opening, then cell injury." },
	{ state: "the wrong shape", contents: JSON.stringify({}) },
];

/** The error of the reading stage in a suite of a lecture file reader. */
export class ReadingStageError extends NamedError {}

/**
 * Runs a reader of a lecture file against the workspace of the current test, with
 * {@link ReadingStageError} as the reading stage's error.
 *
 * @param args - The reader, and the workspace.
 * @param args.reader - The reader of the lecture file.
 * @param args.workspaceRoot - Gives the workspace of the current test.
 * @returns What the reader gives.
 * @typeParam TFile - The content of the lecture file.
 */
export function readLectureFile<TFile>({
	reader,
	workspaceRoot,
}: {
	readonly reader: (reading: ReadingStage) => Promise<TFile>;
	readonly workspaceRoot: () => string;
}): Promise<TFile> {
	return reader({
		context: makeStageContext({ workspaceRoot: workspaceRoot() }),
		fail: (message) => new ReadingStageError(message),
	});
}

/**
 * Adds one test for each of the {@link unusableJsonContents} and for each lecture
 * file with an entry of the wrong shape. Each test spoils the lecture file and
 * runs its reader. It checks that the reader fails with the reading stage's
 * error, and that the error names the file.
 *
 * @param args - The reader, its file and the entries of the wrong shape.
 * @param args.reader - The reader of the lecture file.
 * @param args.workspaceRoot - Gives the workspace of the current test.
 * @param args.path - Gives the absolute path of the lecture file in a workspace.
 * @param args.wrongEntries - Each lecture file with one entry that lacks a field, and the name of that state.
 */
export function itFailsNamingAnUnusableLectureFile({
	path,
	wrongEntries,
	...read
}: Parameters<typeof readLectureFile>[0] & {
	readonly path: (workspaceRoot: string) => string;
	readonly wrongEntries: readonly { readonly state: string; readonly contents: string }[];
}): void {
	it.each([
		...unusableJsonContents,
		...wrongEntries,
	])("should fail with the reading stage's error that names the file when the lecture file is $state", async ({
		contents,
	}) => {
		const spoiled = path(read.workspaceRoot());
		if (contents !== null) {
			await seedTextFile({ path: spoiled, contents });
		}

		const error = await captureError(readLectureFile(read));

		expect(error).toBeInstanceOf(ReadingStageError);
		expect(error.message).toContain(spoiled);
	});
}

/**
 * Pairs each input file with each of the {@link unusableJsonContents}, for a
 * suite's `it.each`.
 *
 * @param files - The input files, each with the fields that the test reads.
 * @returns One row for each file and each unusable content.
 * @typeParam TFile - The fields of an input file.
 */
export function eachUnusableJsonFile<TFile extends object>(
	files: readonly TFile[],
): readonly (TFile & (typeof unusableJsonContents)[number])[] {
	return files.flatMap((file) =>
		unusableJsonContents.map((unusable) => ({ ...file, ...unusable })),
	);
}

/** A JSON input file of a stage: its name in a test title, and how to find its path. */
export type InputFile = {
	readonly file: string;
	readonly path: (workspaceRoot: string) => string;
};

/**
 * Gives the output file of an earlier stage as an input file.
 *
 * @param args - The name of the file, and the stage that writes it.
 * @param args.file - The name of the file in a test title.
 * @param args.stageId - The stage that writes the file.
 * @returns The input file.
 */
export function stageOutputInput({
	file,
	stageId,
}: {
	readonly file: string;
	readonly stageId: StageWithOutputFile;
}): InputFile {
	return { file, path: (workspaceRoot) => stageOutputPath({ workspaceRoot, stageId }) };
}

/**
 * Gives the reading of one slide as an input file.
 *
 * @param slideNumber - The number of the slide in the deck, from 1.
 * @returns The input file.
 */
export function slideReadingInput(slideNumber: number): InputFile {
	return {
		file: `reading of slide ${slideNumber}`,
		path: (workspaceRoot) => join(workspaceRoot, readingFile(slideNumber)),
	};
}

/**
 * Gives the function that makes the file of a stage for one subtopic an input
 * file.
 *
 * @param args - The name of the file in a test title, and its path.
 * @param args.name - The name of the file, such as `rewrite file`.
 * @param args.file - Gives the workspace-relative path of the file of a subtopic.
 * @returns The function that gives the input file of a subtopic.
 */
function subtopicFileInput({
	name,
	file,
}: {
	readonly name: string;
	readonly file: (subtopicId: number) => string;
}): (subtopicId: number) => InputFile {
	return (subtopicId) => ({
		file: `${name} of subtopic ${subtopicId}`,
		path: (workspaceRoot) => join(workspaceRoot, file(subtopicId)),
	});
}

/** Gives the term-correction file of one subtopic as an input file. */
export const termCorrectionInput = subtopicFileInput({
	name: "term-correction file",
	file: termCorrectionFile,
});

/** Gives the rewrite file of one subtopic as an input file. */
export const rewriteInput = subtopicFileInput({ name: "rewrite file", file: rewriteFile });

/** The structured transcript as an input file. */
export const structuredTranscriptInput = stageOutputInput({
	file: "structured transcript file",
	stageId: "structure-transcript",
});

/** The retitled subtopics as an input file. */
export const retitledSubtopicsInput = stageOutputInput({
	file: "retitled subtopics file",
	stageId: "retitle-subtopics",
});

/** The JSON files that `readTopicsWithSubtopics` reads. */
export const topicsWithSubtopicsInputs: readonly InputFile[] = [
	retitledSubtopicsInput,
	stageOutputInput({ file: "topics file", stageId: "group-into-topics" }),
];

/**
 * The JSON files that `readTopicsWithSubtopics` reads, each with each of the
 * {@link unusableJsonContents}, for a suite's `it.each`.
 */
export const unusableTopicsWithSubtopicsFiles = eachUnusableJsonFile(topicsWithSubtopicsInputs);

/**
 * Makes a JSON input file unusable: it deletes the file when `contents` is
 * `null`, and otherwise writes `contents` over it.
 *
 * @param args - The file, and its new contents.
 * @param args.path - The absolute path of the file.
 * @param args.contents - The new text of the file, or `null` to delete it.
 * @returns A promise that resolves when the file is changed.
 */
export function spoilJsonFile({
	path,
	contents,
}: {
	readonly path: string;
	readonly contents: string | null;
}): Promise<void> {
	return contents === null ? rm(path) : writeFile(path, contents);
}

/**
 * Adds one test for each input file and each of the {@link unusableJsonContents}.
 * Each test spoils the file and runs the stage. It checks that the stage fails
 * with its own error, that the error names the file, and that the stage made no
 * model call.
 *
 * @param args - The input files, and the suite's stage run and stubs.
 * @param args.files - The input files of the stage.
 * @param args.workspaceRoot - Gives the workspace of the current test.
 * @param args.run - Runs the stage.
 * @param args.errorType - The error class of the stage.
 * @param args.create - Gives the stubbed completion call of the current test.
 */
export function itFailsNamingEachSpoiledFile({
	files,
	workspaceRoot,
	run,
	errorType,
	create,
}: {
	readonly files: readonly InputFile[];
	readonly workspaceRoot: () => string;
	readonly run: () => Promise<unknown>;
	readonly errorType: abstract new (...args: never[]) => Error;
	readonly create: () => StubbedCompletionCall;
}): void {
	it.each(
		eachUnusableJsonFile(files),
	)("should fail naming the file, without calling the model, when the $file is $state", async ({
		path,
		contents,
	}) => {
		const spoiled = path(workspaceRoot());
		await spoilJsonFile({ path: spoiled, contents });

		const error = await captureError(run());

		expect(error).toBeInstanceOf(errorType);
		expect(error.message).toContain(spoiled);
		expect(create()).not.toHaveBeenCalled();
	});
}

/** A Scribe upload that a suite intercepted, and the body that the stage sent. */
export type ScribeUpload = {
	/** The nock scope, to check whether the upload was made. */
	readonly scope: nock.Scope;
	/**
	 * The request body that ElevenLabs received, or `""` if no upload was made. It
	 * is a function because the upload occurs while the stage runs, after the
	 * caller got this value.
	 */
	readonly uploadedBody: () => string;
};

/**
 * Intercepts the speech-to-text upload of the transcription stage, replies with
 * a transcript, and records the body that the stage sent.
 *
 * Almost every test in the transcription suites needs the same correct reply
 * from the configured host. So the host and the reply have defaults here. A
 * different `origin` intercepts a host for another data residency. A different
 * `body` gives a reply that the stage must reject.
 *
 * @param args - The host and the reply.
 * @param args.origin - The host to intercept. The default is the configured host.
 * @param args.body - The response body. The default is a transcript of {@link transcriptText}.
 * @returns The intercepted upload.
 */
export function interceptScribeUpload({
	origin = elevenLabsUrls.origin,
	body = scribeResponseBody({ text: transcriptText }),
}: {
	readonly origin?: string;
	readonly body?: Record<string, unknown>;
} = {}): ScribeUpload {
	let uploaded = "";
	const scope = nock(origin)
		.post(elevenLabsUrls.speechToText)
		// eslint-disable-next-line max-params, @typescript-eslint/prefer-readonly-parameter-types -- nock sets this reply signature: two positional parameters. The second is a library type with mutable properties that the rule cannot ignore. This code only reads it.
		.reply(200, (_uri: string, requestBody: nock.Body) => {
			uploaded = typeof requestBody === "string" ? requestBody : JSON.stringify(requestBody);
			return body;
		});
	return { scope, uploadedBody: () => uploaded };
}

/**
 * {@link testLecture} with the AI-derived title that the `judge-lecture-title`
 * model proposes when it judges the provisional title not meaningful.
 */
export const aiDerivedLecture = describeLecture({
	number: testLecture.number,
	date: testLecture.date,
	title: "Innate Immune Response",
});

/** The title judgement when the model keeps the provisional title. */
export const titleKept = { provisionalTitleMeaningful: true, suggestedTitle: null };

/**
 * The title judgement when the model judges the provisional title not
 * meaningful and proposes the title of {@link aiDerivedLecture}.
 */
export const titleRejected = {
	provisionalTitleMeaningful: false,
	suggestedTitle: aiDerivedLecture.title,
};

/** The reason that a stubbed `judge-lecture-title` reply gives. */
export const stubbedJudgedBecause = "It names the subject.";

/**
 * A usable `judge-lecture-title` reply. The default title judgement is
 * {@link titleKept}.
 *
 * @param overrides - The fields that the behaviour of the test depends on.
 * @returns The reply, to serialise as the content of the model reply.
 */
export function titleJudgementReply(
	overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
	return { ...titleKept, judgedBecause: stubbedJudgedBecause, ...overrides };
}

/**
 * A usable `read-slides` reply: a subject-matter slide with one figure. Each
 * suite that needs a slide reading takes the shape from here. It changes only
 * the field that the test is about.
 *
 * @param overrides - The fields that the behaviour of the test depends on.
 * @returns The reply, to serialise as the content of the model reply.
 */
export function slideReadingReply(
	overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
	return {
		title: "Cell injury",
		body: "- Injury can be reversible",
		tables: [],
		figures: [
			{ type: "diagram", description: "A cell that swells, with arrows to its organelles." },
		],
		caption: "The two outcomes of cell injury.",
		kind: "subject-matter",
		...overrides,
	};
}

/**
 * Gives the name of the image and the reading of one slide, with no extension,
 * such as `slide-001`. The name is stated in full here, and not taken from the
 * production code.
 *
 * @param slideNumber - The number of the slide in the deck, from 1.
 * @returns The name.
 */
function slideFileStem(slideNumber: number): string {
	return `slide-${String(slideNumber).padStart(3, "0")}`;
}

/**
 * Writes `count` slide images into a workspace, as `render-slides` leaves them.
 * The bytes of each image are its file name, so a suite can tell the images
 * apart. The file names are stated in full here, and not taken from the
 * production code.
 *
 * @param args - The workspace, and the number of slides.
 * @param args.workspaceRoot - The absolute path to the lecture workspace.
 * @param args.count - The number of slides.
 * @returns The bytes of each image, in deck order.
 */
export async function seedSlideImages({
	workspaceRoot,
	count,
}: {
	readonly workspaceRoot: string;
	readonly count: number;
}): Promise<readonly Buffer[]> {
	const directory = join(workspaceRoot, "Slide images");
	await mkdir(directory, { recursive: true });
	const images: Buffer[] = [];
	for (let slideNumber = 1; slideNumber <= count; slideNumber++) {
		const name = `${slideFileStem(slideNumber)}.png`;
		const bytes = Buffer.from(name);
		await writeFile(join(directory, name), bytes);
		images.push(bytes);
	}
	return images;
}

/**
 * The workspace-relative path of the reading of slide `slideNumber`. The name is
 * stated in full here, and not taken from the production code. So a test that
 * finds a reading at this path checks the name.
 *
 * @param slideNumber - The number of the slide in the deck, from 1.
 * @returns The path, relative to the workspace.
 */
export function readingFile(slideNumber: number): string {
	return `Slide readings/${slideFileStem(slideNumber)}.json`;
}

/**
 * The slide readings that {@link seedEarlierOutputs} writes for `read-slides`, in
 * deck order. Slides 1 and 2 are subject matter, slide 3 is content-free, and
 * slide 4 is references.
 */
export const slideDeckReadings: readonly Readonly<Record<string, unknown>>[] = [
	{ slideNumber: 1, ...slideReadingReply() },
	{ slideNumber: 2, ...slideReadingReply({ title: "Reversible injury" }) },
	{ slideNumber: 3, ...slideReadingReply({ title: "Questions?", kind: "content-free" }) },
	{ slideNumber: 4, ...slideReadingReply({ title: "References", kind: "references" }) },
];

/** The reason that a stubbed `place-slides` reply entry and each stored placement give. */
export const stubbedPlacedBecause = "The lecturer explains the slide here.";

/**
 * Gives a placement for each slide, in the subtopic that the map gives it.
 *
 * @param subtopicIds - The subtopic of each slide, by slide number.
 * @returns The placements, in slide-number order.
 */
export function slidePlacementsIn(
	subtopicIds: Readonly<Record<number, number>>,
): readonly SlidePlacement[] {
	return Object.entries(subtopicIds).map(([slideNumber, subtopicId]) => ({
		slideNumber: Number(slideNumber),
		subtopicId,
		startWords: null,
		positionInSubtopic: 0,
		placedBecause: stubbedPlacedBecause,
	}));
}

/**
 * The slide placements that {@link seedEarlierOutputs} writes for `place-slides`.
 * Slides 1, 2 and 4 of the {@link slideDeckReadings} are all in subtopic 2. So
 * subtopic 1 has no placed slide.
 */
export const slideDeckPlacements: SlidePlacements = {
	promptVersion: "p2",
	placements: slidePlacementsIn({ 1: 2, 2: 2, 4: 2 }),
};

/**
 * The workspace-relative path of the term-correction file of a subtopic. The
 * name is stated in full here, and not taken from the production code.
 *
 * @param subtopicId - The subtopic.
 * @returns The path, relative to the workspace.
 */
export function termCorrectionFile(subtopicId: number): string {
	return `Term corrections/subtopic-${subtopicId}.json`;
}

/**
 * A correction that passes each check of `correct-terms`. Its wrong form is in
 * subtopic 2, and its right form is the title of slide 1.
 */
export const usableTermCorrection = {
	wrongForm: "cell injury",
	rightForm: "Cell injury",
	reason: "The transcriber misheard the term on slide 1.",
} as const;

/** The text of subtopic 2 after {@link usableTermCorrection}. */
export const correctedSubtopicText = "Cell injury and the immune system.";

/**
 * The term-correction file of subtopic 1, which has no placed slide. Term
 * correction made no call, so the text is unchanged.
 */
export const noSlideTermCorrection = {
	subtopicId: 1,
	termCorrectionPromptVersion: "t1",
	slideNumbers: [],
	corrections: [],
	ignoredCorrections: [],
	correctedText: transcriptSubtopicTexts[0],
} as const;

/** The term-correction file of subtopic 2, as `correct-terms` writes it after {@link usableTermCorrection}. */
export const usedTermCorrection = {
	subtopicId: 2,
	termCorrectionPromptVersion: "t1",
	slideNumbers: [1, 2],
	corrections: [{ ...usableTermCorrection, occurrencesChanged: 1 }],
	ignoredCorrections: [],
	correctedText: correctedSubtopicText,
} as const;

/**
 * The workspace-relative path of the rewrite of a subtopic. The name is stated
 * in full here, and not taken from the production code.
 *
 * @param subtopicId - The subtopic.
 * @returns The path, relative to the workspace.
 */
export function rewriteFile(subtopicId: number): string {
	return `Rewrites/subtopic-${subtopicId}.json`;
}

/** The workspace-relative path of the merged file of `check-facts`, stated in full here. */
export const factualErrorsFile = "Fact checks/factual-errors.json";

/**
 * The workspace-relative path of the file of one model of `check-facts`. The
 * folder is stated in full here, and not taken from the production code.
 *
 * @param fileName - The file name of the model, such as `gpt-5.6-sol-pro.json`.
 * @returns The path, relative to the workspace.
 */
export function factCheckModelFile(fileName: string): string {
	return `Fact checks/${fileName}`;
}

/**
 * The workspace-relative path of the fact-correction file of a subtopic. The name
 * is stated in full here, and not taken from the production code.
 *
 * @param subtopicId - The subtopic.
 * @returns The path, relative to the workspace.
 */
export function factCorrectionFile(subtopicId: number): string {
	return `Fact corrections/subtopic-${subtopicId}.json`;
}

/** The workspace-relative path of the lecture file of `correct-factual-errors`, stated in full here. */
export const factCorrectedSubtopicsFile = "Fact corrections/fact-corrected-subtopics.json";

/**
 * The workspace-relative path of the slide-relocation file of a subtopic. The
 * name is stated in full here, and not taken from the production code.
 *
 * @param subtopicId - The subtopic.
 * @returns The path, relative to the workspace.
 */
export function slideRelocationFile(subtopicId: number): string {
	return `Slide relocations/subtopic-${subtopicId}.json`;
}

/**
 * Gives the reader of the JSON files of a suite's workspace.
 *
 * @param workspaceRoot - Gives the absolute path to the lecture workspace of the current test.
 * @returns A function that reads a file by its path relative to the workspace, and gives the parsed file.
 */
export function workspaceJsonReader(
	workspaceRoot: () => string,
): (file: string) => Promise<unknown> {
	return (file) => readJsonFile(join(workspaceRoot(), file));
}

/** The paragraph that the writer writes for each subtopic of {@link transcriptDivision}. */
export const rewrittenParagraphs = [
	"The lecture covers its subject today.",
	"Cell injury involves the immune system.",
] as const;

/** The rewrite file of each subtopic, as `rewrite-subtopics` writes it. */
const subtopicRewrites: readonly Readonly<Record<string, unknown>>[] = [
	...rewrittenParagraphs.entries(),
].map(([index, paragraph]) => ({
	subtopicId: index + 1,
	writerPromptVersion: "w1",
	rewrittenSubtopic: [paragraph],
}));

/**
 * The rewrite of each subtopic that {@link seedEarlierOutputs} writes, with the id
 * and the title from the structured transcript, in lecture order.
 */
export const seededTitledRewrites: readonly TitledSubtopicRewrite[] = [
	...transcriptSubtopicsWithIdAndText.entries(),
].map(([index, { subtopicId, title }]) => {
	const paragraph = rewrittenParagraphs[index];
	if (paragraph === undefined) {
		throw new Error(`rewrittenParagraphs has no paragraph for subtopic ${subtopicId}`);
	}
	return { subtopicId, title, rewrittenSubtopic: [paragraph] };
});

/**
 * Gives the function that writes the subtopic files of a stage into a
 * workspace, as the stage leaves them.
 *
 * @param args - The content of each file, and the path of the file of a subtopic.
 * @param args.contents - The content of each file. Each one has a `subtopicId`.
 * @param args.file - Gives the workspace-relative path of the file of a subtopic.
 * @returns The function that writes the files into a workspace.
 */
function seedingSubtopicFiles({
	contents,
	file,
}: {
	readonly contents: readonly Readonly<Record<string, unknown>>[];
	readonly file: (subtopicId: number) => string;
}): (workspaceRoot: string) => Promise<void> {
	return async (workspaceRoot) => {
		for (const content of contents) {
			await seedJsonFile({
				path: join(workspaceRoot, file(Number(content.subtopicId))),
				contents: content,
			});
		}
	};
}

/**
 * Writes each slide reading into a workspace, as `read-slides` leaves it.
 *
 * @param args - The workspace, and the readings.
 * @param args.workspaceRoot - The absolute path to the lecture workspace.
 * @param args.readings - The readings, each with its slide number.
 * @returns A promise that resolves when every reading is written.
 */
export async function seedSlideReadings({
	workspaceRoot,
	readings,
}: {
	readonly workspaceRoot: string;
	readonly readings: readonly Readonly<Record<string, unknown>>[];
}): Promise<void> {
	for (const reading of readings) {
		await seedJsonFile({
			path: join(workspaceRoot, readingFile(Number(reading.slideNumber))),
			contents: reading,
		});
	}
}

/** The user title that the CLI `rename` command sets. */
export const testUserTitle = "Cell Injury and Death";

/** The manifest fields of {@link testLecture} after `rename`. The user title is the lecture title. */
export const withUserTitle = { userTitle: testUserTitle, lectureTitle: testUserTitle };

/** The date to which the CLI `change-date` command moves {@link testLecture}. */
export const changedDate = "2025-10-24";

/**
 * The time at which a stage completed. No assertion depends on the
 * value. So the suites share it, and no suite has a timestamp that seems to
 * matter.
 */
export const stageCompletedAt = `${testLecture.date}T10:00:00.000Z`;

/**
 * An id in the form that `deriveTimestampId` gives. Tests use it as a pipeline
 * run id and as an invocation id. The value does not matter, as for
 * {@link stageCompletedAt}. The suite that checks the form makes its own id.
 */
export const testTimestampId = `${testLecture.date}T09-00-00Z`;

/**
 * The start and end of a pipeline run or a batch, for a suite that does not
 * check them. `PipelineRunSummary` and `BatchSummary` require them. The value
 * does not matter, as for {@link stageCompletedAt}. A suite that states its own
 * time period says that the period matters.
 */
export const testTimePeriod = {
	startedAt: `${testLecture.date}T09:00:00.000Z`,
	endedAt: `${testLecture.date}T09:30:00.000Z`,
} as const;

/**
 * The stage entry of a completed stage, with the status `complete` or `skipped`.
 * The two statuses have the same fields, and both mean that the output of the
 * stage is on disk.
 *
 * Each field has a default, because most suites need only one field. A suite
 * that states a field says that its value matters.
 *
 * @param args - The fields of the entry. Each one is optional.
 * @param args.status - `complete` or `skipped`. The default is `complete`.
 * @param args.completedAt - The time at which the stage completed. The default is {@link stageCompletedAt}.
 * @param args.configUsed - The model and tuning that the stage used. The default is `null`.
 * @param args.cost - The cost of the stage. The default is `null`.
 * @param args.costByModel - The cost of each model. The default is no field, as for a stage with one model.
 * @param args.filesWritten - The workspace-relative files that the stage recorded. The default is none.
 * @returns The stage entry.
 */
export function completedEntry({
	status = "complete",
	completedAt = stageCompletedAt,
	configUsed = null,
	cost = null,
	costByModel,
	filesWritten = [],
}: {
	readonly status?: "complete" | "skipped";
	readonly completedAt?: string;
	readonly configUsed?: StageConfigUsed | null;
	readonly cost?: StageCost | null;
	readonly costByModel?: readonly ModelCost[];
	readonly filesWritten?: readonly string[];
} = {}): StageEntry {
	return {
		status,
		completedAt,
		configUsed,
		cost,
		...costByModelField(costByModel),
		filesWritten,
	};
}

/**
 * Gives the `costByModel` field of a stage entry, or no field.
 *
 * @param costByModel - The cost of each model, or `undefined` for a stage with one model.
 * @returns The field, or an empty object.
 */
function costByModelField(costByModel: readonly ModelCost[] | undefined): {
	readonly costByModel?: readonly ModelCost[];
} {
	return costByModel === undefined ? {} : { costByModel };
}

/** The stage entry of a stage that is running, or that was running when the invocation stopped. */
export const runningEntry: StageEntry = { status: "running" };

/**
 * The stage entry of a failed stage. It has every field. So a suite tests a
 * failed stage against data that a real pipeline run can make, and not against a
 * partial object with a cast.
 *
 * @param args - The files that the stage recorded before it failed, and what it spent.
 * @param args.filesWritten - The workspace-relative files that the stage left. The default is none.
 * @param args.cost - What the stage spent before it failed. The default is `null`.
 * @param args.costByModel - What each model spent before the stage failed. The default is no field, as for a stage with one model.
 * @returns The stage entry.
 */
export function failedEntry({
	filesWritten = [],
	cost = null,
	costByModel,
}: {
	readonly filesWritten?: readonly string[];
	readonly cost?: StageCost | null;
	readonly costByModel?: readonly ModelCost[];
} = {}): StageEntry {
	return {
		status: "failed",
		failedAt: stageCompletedAt,
		error: "the stage threw",
		configUsed: null,
		cost,
		...costByModelField(costByModel),
		filesWritten,
	};
}

/**
 * A second lecture, with a number, date and title different from those of
 * {@link testLecture}. Suites use it to check that a lecture stays unchanged,
 * and as the second choice in a picker. The caller says which module it is in.
 */
export const otherLecture = describeLecture({
	number: 2,
	date: "2025-10-17",
	title: "Inflammation",
});

/**
 * A second lecture with the date of {@link testLecture}, for the cases where a
 * date names more than one lecture and the CLI asks which one.
 *
 * {@link otherLecture} has a different date, so it cannot be used for these
 * cases.
 */
export const sameDateLecture = describeLecture({
	number: 2,
	date: testLecture.date,
	title: "Antigens",
});

/** A second module, for the cases where a date matches across modules. */
export const otherModuleName = "Immunology";

/**
 * An absolute module root for the suites that do not use the disk. Argument
 * parsing, prompt rendering and the runner unit tests need a path that seems
 * real but does not exist. Suites that write to disk use a temporary directory
 * ({@link makeLectureTree}).
 */
export const testModuleRoot = join(SYNTHETIC_MODULES_DIR, testModuleName);

/** The module root of {@link otherModuleName}, as {@link testModuleRoot} is for its module. */
export const otherModuleRoot = join(SYNTHETIC_MODULES_DIR, otherModuleName);

/**
 * Makes a valid {@link Manifest} for {@link testLecture}, with every stage
 * pending and no cost.
 *
 * @param overrides - The top-level fields to replace.
 * @returns The manifest.
 */
export function makeManifest(overrides: Partial<Manifest> = {}): Manifest {
	return {
		version: MANIFEST_VERSION,
		lectureNumber: testLecture.number,
		lectureDate: testLecture.date,
		provisionalTitle: testLecture.title,
		lectureTitle: testLecture.title,
		userTitle: null,
		aiDerivedTitle: null,
		baseName: testLecture.baseName,
		createdAt: `${testLecture.date}T00:00:00.000Z`,
		updatedAt: `${testLecture.date}T00:00:00.000Z`,
		stages: pendingStages(),
		...overrides,
	};
}

/**
 * The API key that a stubbed service gets. A suite that checks the key in the
 * request checks for the key that the fixture set in the environment. So it is
 * one value.
 */
export const stubbedApiKey = "test-key";

/**
 * Removes all remaining interceptors and blocks all outbound connections. So a
 * request that a test did not intercept fails, and does not reach the real
 * service.
 *
 * {@link stubOpenRouterApi} and {@link stubElevenLabsApi} also do this, and add
 * a key. A suite whose code under test sends no key needs only this.
 * {@link resetStubbedApi} reverses it.
 *
 * @returns Nothing.
 */
export function blockNetwork(): void {
	nock.cleanAll();
	nock.disableNetConnect();
}

/**
 * Prepares a test to call a paid API without a connection to it. The function
 * blocks the network as {@link blockNetwork} does, and sets a dummy key.
 *
 * @param apiKeyVariable - The environment variable from which the service reads its key.
 * @returns Nothing.
 */
function stubApi(apiKeyVariable: string): void {
	blockNetwork();
	vi.stubEnv(apiKeyVariable, stubbedApiKey);
}

/**
 * Prepares a test to make an OpenRouter call without a connection to OpenRouter.
 *
 * @returns Nothing.
 */
export function stubOpenRouterApi(): void {
	stubApi(OPENROUTER_KEY_VARIABLE);
}

/**
 * Reverses {@link blockNetwork}, {@link stubOpenRouterApi} or
 * {@link stubElevenLabsApi}. The next suite gets the real network and the real
 * environment.
 *
 * There is one function, not one for each service, because nothing in it is
 * specific to a service. `vi.unstubAllEnvs` removes the keys of both services.
 *
 * @returns Nothing.
 */
export function resetStubbedApi(): void {
	nock.cleanAll();
	nock.enableNetConnect();
	vi.unstubAllEnvs();
}

/**
 * Prepares a test to run the transcription stage without a connection to ElevenLabs.
 *
 * @returns Nothing.
 */
export function stubElevenLabsApi(): void {
	stubApi(ELEVENLABS_KEY_VARIABLE);
}

/**
 * Makes a temporary module tree with the layout of the pipeline,
 * `<moduleRoot>/Pipeline processing/<baseName>`, and returns the two roots.
 *
 * Stage tests need this layout, because {@link makeStageContext} finds
 * `moduleRoot` two levels above the workspace, as a real pipeline run does. The
 * caller must remove `moduleRoot`.
 *
 * @param args - The layout inputs.
 * @param args.prefix - The prefix of the temporary directory name, which names the suite.
 * @param args.baseName - The base name of the lecture. The default is that of {@link testLecture}.
 * @returns The module root and the workspace root in it.
 */
export async function makeWorkspaceTree({
	prefix,
	baseName = testLecture.baseName,
}: {
	readonly prefix: string;
	readonly baseName?: string;
}): Promise<{ readonly moduleRoot: string; readonly workspaceRoot: string }> {
	const moduleRoot = await makeTempDir({ prefix });
	const workspaceRoot = workspaceRootFor({ moduleRoot, baseName });
	await mkdir(workspaceRoot, { recursive: true });
	return { moduleRoot, workspaceRoot };
}

/** A module tree with the workspace of one lecture in it. */
export type WorkspaceTree = {
	readonly moduleRoot: string;
	readonly workspaceRoot: string;
};

/**
 * Gives a suite a workspace that holds the transcript of `transcription`. The
 * workspace is made before each test and removed after it.
 *
 * Each stage after transcription starts from this state. Each suite of such a
 * stage needs a tree, a transcript in it, and the removal of the tree after the
 * test. So this function is in this file, and no suite has two `let`s and two
 * hooks for the workspace.
 * Also, two suites then cannot use different transcript text.
 *
 * The function returns a reader, not the tree, because the tree does not exist
 * until the hook runs. {@link useStubLogger} has the same shape.
 *
 * @param args - The name of the temporary directory.
 * @param args.prefix - The prefix of the temporary directory name, which names the suite.
 * @returns A function that gives the workspace of the current test.
 */
export function useTranscribedWorkspace({
	prefix,
}: {
	readonly prefix: string;
}): () => WorkspaceTree {
	let tree: WorkspaceTree | null = null;

	beforeEach(async () => {
		tree = await makeWorkspaceTree({ prefix });
		await seedStageOutput({
			workspaceRoot: tree.workspaceRoot,
			stageId: "transcription",
			contents: transcriptText,
		});
	});

	afterEach(async () => {
		if (tree !== null) {
			await rm(tree.moduleRoot, { recursive: true, force: true });
		}
	});

	return () => {
		if (tree === null) {
			throw new Error("The workspace is only available inside a test");
		}
		return tree;
	};
}

/**
 * Writes the lecture {@link testLecture} on disk as `source-normalisation`
 * leaves it. The tree has the module directories and the empty workspace. It
 * also has a video recording, a slide deck and the notes, each with the base
 * name of the workspace. The notes are a folder that holds the notes page.
 *
 * Code that moves a lecture needs the module directories, the workspace, the
 * video recording, the slide deck and the notes. The `change-date` command and
 * `judge-lecture-title` both rename the four lecture files together. So the suites that test a rename get the layout from here.
 * The caller writes all other files that its code reads, such as a transcript
 * or a manifest. The caller removes `tempDir` after the test.
 *
 * The file names come from {@link testLecture}, because `describeLecture` is the
 * one place that makes the file names of a lecture.
 *
 * @param args - The layout inputs.
 * @param args.prefix - The prefix of the temporary directory name, which names the suite.
 * @returns The temporary directory to remove, the module root and its directories, and the workspace.
 */
export async function makeLectureTree({ prefix }: { readonly prefix: string }): Promise<{
	readonly tempDir: string;
	readonly moduleRoot: string;
	readonly dirs: ModuleDirs;
	readonly workspaceRoot: string;
}> {
	const tempDir = await makeTempDir({ prefix });
	const moduleRoot = join(tempDir, testModuleName);
	const dirs = moduleDirs({ moduleRoot });
	const workspaceRoot = workspaceRootFor({ moduleRoot, baseName: testLecture.baseName });
	const notesDir = lectureNotesDirPath({ moduleRoot, baseName: testLecture.baseName });

	for (const dir of [...sharedLectureFileDirs({ dirs }), workspaceRoot, notesDir]) {
		await mkdir(dir, { recursive: true });
	}
	await writeFile(join(dirs.videoRecording, testLecture.videoRecordingFile), "video");
	await writeFile(join(dirs.slideDeck, testLecture.slideDeckFile), "slides");
	await writeFile(notesPagePath({ moduleRoot, baseName: testLecture.baseName }), "notes");

	return { tempDir, moduleRoot, dirs, workspaceRoot };
}

/**
 * Removes the notes of {@link testLecture} from a tree that {@link makeLectureTree}
 * made. The lecture is then as it is before `build-notes-page` runs.
 *
 * @param args - The module.
 * @param args.dirs - The folders of the module.
 * @returns A promise that resolves when the notes are removed.
 */
export async function removeTestLectureNotes({
	dirs,
}: {
	readonly dirs: ModuleDirs;
}): Promise<void> {
	await rm(join(dirs.finalOutput, testLecture.finalOutputFile), { recursive: true });
}

/**
 * Gives the page views of a notes page, from the ids of their sections.
 *
 * @param html - The notes page.
 * @returns The id of each page view, in page order.
 */
export function pageViewsIn(html: string): readonly string[] {
	return [...html.matchAll(/<div class="view" id="(\w+)-view">/gu)].map(([, view]) => view ?? "");
}

/**
 * Makes an empty temporary directory, in which a suite makes its own tree. The
 * suite removes it after the test.
 *
 * Each integration test that uses the filesystem starts with an empty temporary
 * directory. So the call that makes the directory and the platform imports that
 * the call needs are here, and not in each suite. For a
 * lecture workspace, {@link makeWorkspaceTree} also makes the layout.
 *
 * @param args - The directory inputs.
 * @param args.prefix - The prefix of the directory name, which names the suite in `/tmp`.
 * @returns The absolute path of the new directory.
 */
export function makeTempDir({ prefix }: { readonly prefix: string }): Promise<string> {
	return mkdtemp(join(tmpdir(), prefix));
}

/**
 * Gives a suite its own temporary directory, made before each test and removed
 * after it. The two hooks are together, so a suite cannot have one without the
 * other.
 *
 * It is for a suite whose setup is only the directory. A suite that also makes
 * a module tree in the directory has a different setup, and keeps its own hooks.
 *
 * The function returns a reader, not the path, because the path does not exist
 * until the hook runs. The stage suites use the same shape for `audioPath()`
 * and `stageDir()`.
 *
 * @param args - The name of the directory.
 * @param args.prefix - The prefix for {@link makeTempDir}.
 * @returns A function that gives the temporary directory of the current test.
 */
export function useTempDir({ prefix }: { readonly prefix: string }): () => string {
	let tempDir: string | null = null;

	beforeEach(async () => {
		tempDir = await makeTempDir({ prefix });
	});

	afterEach(async () => {
		if (tempDir !== null) {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	return () => {
		if (tempDir === null) {
			throw new Error("The temporary directory is only available inside a test");
		}
		return tempDir;
	};
}

/**
 * Captures what each test of a suite writes to stderr, where the progress bars
 * go. A progress bar writes nothing when stderr is not a terminal, so the suite
 * sets whether stderr claims to be one. The two hooks restore stderr after each
 * test.
 *
 * @param args - Whether stderr claims to be a terminal.
 * @param args.isTerminal - `true` makes stderr claim to be a terminal.
 * @returns A function that gives the text written to stderr in the current test.
 */
export function useCapturedStderr({ isTerminal }: { readonly isTerminal: boolean }): () => string {
	const realIsTTY = process.stderr.isTTY;
	let written: string[] = [];

	beforeEach(() => {
		written = [];
		process.stderr.isTTY = isTerminal;
		vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown): boolean => {
			written.push(String(chunk));
			return true;
		});
	});

	afterEach(() => {
		vi.mocked(process.stderr.write).mockRestore();
		process.stderr.isTTY = realIsTTY;
	});

	return () => written.join("");
}

/**
 * Writes the text in red, as a terminal gets it. The fixture writes the escape
 * sequence out and does not take it from `progress.ts`. So a test does not check
 * the sequence against the code that makes it.
 *
 * @param text - The text to show in red.
 * @returns The text between the escape sequences for red and for normal.
 */
export function inRed(text: string): string {
	const esc = String.fromCharCode(27);
	return `${esc}[31m${text}${esc}[0m`;
}

/**
 * Makes a media file for a test with the `ffmpeg` program. An integration test
 * can then make its own audio or video, and no binary file is in git.
 *
 * The function starts `ffmpeg` itself, not through fluent-ffmpeg. fluent-ffmpeg
 * checks input formats against `ffmpeg -formats`, which does not list the
 * `lavfi` synthetic source that these files come from.
 *
 * @param args - The ffmpeg inputs.
 * @param args.ffmpegArgs - The ffmpeg arguments, without the first `-y`.
 * @returns A promise that resolves when ffmpeg exits with code 0.
 * @throws {Error} If ffmpeg cannot start, or exits with a code that is not 0.
 */
export function renderFixtureMedia({
	ffmpegArgs,
}: {
	readonly ffmpegArgs: readonly string[];
}): Promise<void> {
	// eslint-disable-next-line max-params -- the language specification sets the signature of a Promise executor
	return new Promise((resolve, reject) => {
		const child = spawn("ffmpeg", ["-y", ...ffmpegArgs], { stdio: "ignore" });
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`ffmpeg exited with code ${String(code)} rendering a fixture`));
		});
	});
}

/**
 * The ffmpeg arguments that give a synthetic `lavfi` source as the input.
 *
 * @param source - The lavfi source, such as `sine=frequency=440:duration=2`.
 * @returns The arguments for that input.
 */
export function lavfiInput(source: string): readonly string[] {
	return ["-f", "lavfi", "-i", source];
}

/**
 * The ffmpeg input for a synthetic audio track: a 440 Hz tone. No suite checks
 * the pitch. A suite checks only that ffprobe can read the audio. So the
 * frequency is one value here, and each suite sets its own length.
 *
 * @param args - The length of the tone.
 * @param args.seconds - The length of the track, in seconds.
 * @returns The arguments for that input.
 */
export function toneInput({ seconds }: { readonly seconds: number }): readonly string[] {
	return lavfiInput(`sine=frequency=440:duration=${String(seconds)}`);
}

/**
 * Makes the `stages` of a manifest with every stage pending except one. A test
 * then states only the stage entry that its behaviour depends on.
 *
 * @param args - The one stage entry to set.
 * @param args.stageId - The stage whose entry is not pending.
 * @param args.entry - The stage entry for that stage.
 * @returns The `stages` of the manifest.
 */
export function stagesWith({
	stageId,
	entry,
}: {
	readonly stageId: StageId;
	readonly entry: StageEntry;
}): Manifest["stages"] {
	return { ...pendingStages(), [stageId]: entry } as Manifest["stages"];
}

/**
 * Makes a {@link StageContext} with `assembleContext`, which the runner also
 * uses. So the context is the same as in a real pipeline run. It finds
 * `moduleRoot` two levels above the workspace. So a test must use the layout of
 * the pipeline: `moduleRoot/Pipeline processing/<baseName>`.
 *
 * @param args - The context inputs.
 * @param args.workspaceRoot - The absolute path to the lecture workspace.
 * @param args.manifest - The manifest of the lecture. The default is {@link makeManifest}.
 * @param args.config - The pipeline config. The default is {@link makeConfig}.
 * @returns The stage context.
 */
export function makeStageContext({
	workspaceRoot,
	manifest = makeManifest(),
	config = makeConfig(),
}: {
	readonly workspaceRoot: string;
	readonly manifest?: Manifest;
	readonly config?: PipelineConfig;
}): StageContext {
	return assembleContext({ workspaceRoot, manifest, config });
}

/**
 * A stage context whose manifest has one stage entry for one stage. All other
 * stages are pending. A suite uses it when the behaviour under test depends on
 * the stage entry of one stage.
 *
 * @param args - The workspace, and the stage entry.
 * @param args.workspaceRoot - The absolute path to the lecture workspace.
 * @param args.stageId - The stage of the stage entry.
 * @param args.entry - The stage entry.
 * @returns The stage context.
 */
export function contextWithEntry({
	workspaceRoot,
	stageId,
	entry,
}: {
	readonly workspaceRoot: string;
	readonly stageId: StageId;
	readonly entry: StageEntry;
}): StageContext {
	return makeStageContext({
		workspaceRoot,
		manifest: makeManifest({ stages: stagesWith({ stageId, entry }) }),
	});
}

/**
 * A stage context whose manifest records the stage as completed, with the one
 * output file that the layout gives the stage. The caller decides whether the
 * file is on disk. The idempotency tests depend on that difference.
 *
 * @param args - The workspace, the stage, and its status.
 * @param args.workspaceRoot - The absolute path to the lecture workspace.
 * @param args.stageId - The completed stage.
 * @param args.status - `complete` or `skipped`. The default is `complete`.
 * @returns The stage context.
 */
export function contextWithOutput({
	workspaceRoot,
	stageId,
	status = "complete",
}: {
	readonly workspaceRoot: string;
	readonly stageId: StageWithOutputFile;
	readonly status?: "complete" | "skipped";
}): StageContext {
	return contextWithEntry({
		workspaceRoot,
		stageId,
		entry: completedEntry({ status, filesWritten: [stageOutputEntry(stageId)] }),
	});
}

/**
 * Writes the output file of a stage at its path in the layout, as a completed
 * stage leaves it. The function returns the workspace-relative path for `filesWritten`. So a
 * suite that prepares a workspace, or needs the output of an earlier stage, does
 * not state that path.
 *
 * The production `writeStageOutput` writes into a directory that the stage
 * factory made before the stage ran. This function prepares a workspace in which
 * no stage ran, so it makes the directory itself. The name "seed" shows this
 * difference.
 *
 * @param args - The output to write, and its text.
 * @param args.workspaceRoot - The absolute path to the lecture workspace.
 * @param args.stageId - The stage whose output to write.
 * @param args.contents - The text of the file. The default is one character
 * that no test reads, for the suites that need only the file to exist.
 * @returns The `filesWritten` path of that output.
 */
export async function seedStageOutput({
	workspaceRoot,
	stageId,
	contents = "x",
}: {
	readonly workspaceRoot: string;
	readonly stageId: StageWithOutputFile;
	readonly contents?: string;
}): Promise<string> {
	await seedTextFile({ path: stageOutputPath({ workspaceRoot, stageId }), contents });
	return stageOutputEntry(stageId);
}

/**
 * Makes a stage that calls a model, with the logger and the client of the suite.
 * The function then runs the stage against a workspace, as the runner does.
 *
 * @param args - The stage factory, the client, the config, the workspace and the logger.
 * @param args.factory - The stage factory, as the CLI calls it.
 * @param args.client - The client of the stage: a {@link stubbedOpenRouterClient}, or
 *   {@link openRouterClientFor} in a suite that stubs the network.
 * @param args.config - The configuration that the stage reads.
 * @param args.workspaceRoot - The absolute path to the lecture workspace.
 * @param args.logger - The stub logger of the suite.
 * @param args.manifest - The manifest of the lecture. The default is {@link makeManifest}.
 * @param args.costTally - The cost tally of the stage run. The default is a new tally.
 * @returns The result of the stage.
 * @typeParam TInput - The input of the stage.
 * @typeParam TOutput - The output of the stage.
 */
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- pino's Logger has mutable properties that the rule cannot ignore. This code only gives it to the stage
export function driveModelStage<TInput, TOutput>({
	factory,
	client,
	config,
	workspaceRoot,
	logger,
	manifest,
	costTally,
}: {
	readonly factory: ModelStageFactory<TInput, TOutput>;
	readonly client: OpenRouterClient;
	readonly config: PipelineConfig;
	readonly workspaceRoot: string;
	readonly logger: Logger;
	readonly manifest?: Manifest;
	readonly costTally?: CostTally;
}): Promise<StageResult<TOutput>> {
	return driveStage({
		stage: factory({ logger, client }),
		context: makeStageContext({ workspaceRoot, config, manifest }),
		costTally,
	});
}

/** A send gate with no gap, for a suite that calls the model outside a stage. */
export const unspacedSends: SendGate = createSendGate({ gapSeconds: undefined });

/**
 * The step, in milliseconds, by which {@link settleThroughPauses} moves the fake
 * clock. A stubbed reply is noted at the step in which it arrives. So a time
 * that a suite reads from the fake clock can be up to one step after the send
 * started.
 */
export const SETTLE_STEP_MS = 100;

/**
 * Moves a fake clock forward until `pending` settles. A pause before a resend,
 * or a wait for the turn of a send, starts only after the previous reply
 * arrives. So the clock moves in small steps, and stubbed replies arrive between
 * the steps. Large steps would pass a reply and fire the timeout of the call.
 *
 * @param pending - The work to complete. The suite must use a fake `setTimeout`.
 * @returns The value that `pending` resolves to.
 * @typeParam TResult - The type of that value.
 */
export async function settleThroughPauses<TResult>(
	pending: Readonly<Promise<TResult>>,
): Promise<TResult> {
	let settled = false;
	const watched = pending.finally(() => {
		settled = true;
	});
	while (!settled) {
		await new Promise((resolve) => {
			setImmediate(resolve);
		});
		await vi.advanceTimersByTimeAsync(SETTLE_STEP_MS);
	}
	return watched;
}

/**
 * Gives the function that writes one JSON output of an earlier stage.
 *
 * @param args - The earlier stage, and its output.
 * @param args.stageId - The earlier stage.
 * @param args.output - The output, written as JSON.
 * @returns The function that writes the output into a workspace.
 */
function seedingJsonOutput({
	stageId,
	output,
}: {
	readonly stageId: StageWithOutputFile;
	readonly output: unknown;
}): (workspaceRoot: string) => Promise<string> {
	return (workspaceRoot) =>
		seedStageOutput({ workspaceRoot, stageId, contents: JSON.stringify(output) });
}

/**
 * The factual error that {@link seedEarlierOutputs} writes for `check-facts`. Its
 * passage is the seeded rewrite of subtopic 2. Both fact-check models report it.
 */
export const seededFactualError: MergedFactualError = {
	subtopicId: 2,
	passage: rewrittenParagraphs[1],
	problem: "Cell injury does not always involve the immune system.",
	correctStatement: "Cell injury can involve the immune system.",
	severity: "minor",
	foundBy: factCheckModelIds,
	wordsFound: true,
};

/**
 * Gives `fact-corrected-subtopics.json` with the given paragraphs of each
 * subtopic, each with no factual error.
 *
 * @param subtopics - The id and the fact-corrected paragraphs of each subtopic, in lecture order.
 * @returns The content of the file.
 */
export function factCorrectedSubtopicsOf(
	subtopics: readonly { readonly subtopicId: number; readonly paragraphs: readonly string[] }[],
): FactCorrectedSubtopics {
	return {
		factCorrectedSubtopics: subtopics.map(({ subtopicId, paragraphs }) => ({
			subtopicId,
			factCorrectionPromptVersion: "k3",
			factualErrors: [],
			factCorrectedSubtopic: paragraphs,
			changes: [],
			checkedBy: factCheckModelIds,
			paragraphCountBefore: paragraphs.length,
			paragraphCountAfter: paragraphs.length,
		})),
	};
}

/** The writer of the output of each earlier stage, which {@link seedEarlierOutputs} calls. */
const EARLIER_OUTPUT_SEEDS = {
	"choose-division": seedingJsonOutput({ stageId: "choose-division", output: transcriptDivision }),
	"retitle-subtopics": seedingJsonOutput({
		stageId: "retitle-subtopics",
		output: transcriptDivision,
	}),
	"group-into-topics": seedingJsonOutput({
		stageId: "group-into-topics",
		output: transcriptTopics,
	}),
	"structure-transcript": seedingJsonOutput({
		stageId: "structure-transcript",
		output: transcriptStructuredTranscript,
	}),
	"render-slides": (workspaceRoot: string) =>
		seedSlideImages({ workspaceRoot, count: slideDeckReadings.length }),
	"read-slides": (workspaceRoot: string) =>
		seedSlideReadings({ workspaceRoot, readings: slideDeckReadings }),
	"place-slides": seedingJsonOutput({ stageId: "place-slides", output: slideDeckPlacements }),
	"correct-terms": seedingSubtopicFiles({
		contents: [noSlideTermCorrection, usedTermCorrection],
		file: termCorrectionFile,
	}),
	"rewrite-subtopics": seedingSubtopicFiles({ contents: subtopicRewrites, file: rewriteFile }),
	"check-facts": seedingJsonOutput({
		stageId: "check-facts",
		output: {
			factCheckPromptVersion: "f2",
			checkedBy: factCheckModelIds,
			factualErrors: [seededFactualError],
		},
	}),
	"correct-factual-errors": seedingJsonOutput({
		stageId: "correct-factual-errors",
		output: factCorrectedSubtopicsOf(
			seededTitledRewrites.map(({ subtopicId, rewrittenSubtopic }) => ({
				subtopicId,
				paragraphs: rewrittenSubtopic,
			})),
		),
	}),
} as const;

/** An earlier stage whose output {@link seedEarlierOutputs} can write. */
type SeededStage = keyof typeof EARLIER_OUTPUT_SEEDS;

/**
 * Writes into a workspace the output of each earlier stage that a stage reads.
 * A division is {@link transcriptDivision}, and the topics are
 * {@link transcriptTopics}. The slides are one image and one reading for each of
 * the {@link slideDeckReadings}. The caller writes the transcript.
 *
 * @param args - The workspace, and the earlier stages.
 * @param args.workspaceRoot - The absolute path to the lecture workspace.
 * @param args.readsFrom - The earlier stages whose output to write.
 * @returns A promise that resolves when every file is written.
 */
export async function seedEarlierOutputs({
	workspaceRoot,
	readsFrom,
}: {
	readonly workspaceRoot: string;
	readonly readsFrom: readonly SeededStage[];
}): Promise<void> {
	for (const earlierStage of readsFrom) {
		await EARLIER_OUTPUT_SEEDS[earlierStage](workspaceRoot);
	}
}

/**
 * {@link useStageReadingEarlierOutputs} for a stage that writes one output file,
 * such as a stage that reads the division of an earlier stage.
 *
 * @param args - As for {@link useStageReadingEarlierOutputs}. The stage must write one output file.
 * @returns As for {@link useStageReadingEarlierOutputs}. It also gives a check that a run fails after the third unusable send of `calls` calls and writes no output.
 * @typeParam TInput - The input of the stage.
 * @typeParam TOutput - The output of the stage.
 */
export function useStageReadingDivision<TInput, TOutput>(
	args: StageReadingEarlierOutputs<TInput, TOutput> & { readonly stageId: StageWithOutputFile },
): StageReadingEarlierOutputsSuite<TOutput> & {
	readonly expectResendsExhausted: (args: { readonly calls: number }) => Promise<void>;
} {
	const suite = useStageReadingEarlierOutputs(args);
	return {
		...suite,
		expectResendsExhausted: ({ calls }) =>
			expectResendsExhaustedWithoutOutput({
				pending: suite.run(),
				create: suite.create(),
				calls,
				outputPath: stageOutputPath({
					workspaceRoot: suite.workspaceRoot(),
					stageId: args.stageId,
				}),
			}),
	};
}

/**
 * The stage under test, the earlier stages, the stage factory and the stubbed
 * reply, for {@link useStageReadingEarlierOutputs}.
 *
 * @typeParam TInput - The input of the stage.
 * @typeParam TOutput - The output of the stage.
 */
type StageReadingEarlierOutputs<TInput, TOutput> = {
	/** The stage under test. It names the temporary directory and selects the config. */
	readonly stageId: SingleModelStageId;
	/** The earlier stages whose output the stage reads. */
	readonly readsFrom: readonly SeededStage[];
	/** The stage factory, as the CLI calls it. */
	readonly factory: ModelStageFactory<TInput, TOutput>;
	/** The content of the reply to every call, stubbed before each test. `null` in a suite that stubs the network and not the client. */
	readonly reply: string | null;
	/** The fields of the stage's config to replace. The default replaces none. */
	readonly tuning?: Partial<FactCorrectionStageConfig>;
	/** The language of the notes. The default is the language of the example config. */
	readonly language?: OutputLanguage;
};

/**
 * The parts that {@link useStageReadingEarlierOutputs} gives a suite.
 *
 * @typeParam TOutput - The output of the stage.
 */
type StageReadingEarlierOutputsSuite<TOutput> = {
	readonly config: PipelineConfig;
	readonly workspaceRoot: () => string;
	readonly logged: () => StubLogger;
	readonly create: () => StubbedCompletionCall;
	readonly run: (manifest?: Partial<Manifest>) => Promise<StageResult<TOutput>>;
	/** Gives the cost tally that `run` gives to the stage in the current test. */
	readonly costTally: () => CostTally;
	readonly expectOneCallSending: (value: unknown) => Promise<void>;
	readonly expectCallsSending: (values: readonly unknown[]) => Promise<void>;
};

/**
 * Prepares the suite of a stage that calls a model and reads the output of
 * earlier stages. Before each test, the function makes a new
 * {@link stubbedOpenRouterClient} and stubs its reply. It also writes the output
 * of each earlier stage into a workspace with a transcript, through
 * {@link seedEarlierOutputs}. The setup is in one place, so two such suites cannot
 * start from different states.
 *
 * @param args - The stage, the earlier stages, the stage factory and the stubbed reply.
 * @param args.stageId - The stage under test.
 * @param args.readsFrom - The earlier stages whose output the stage reads.
 * @param args.factory - The stage factory.
 * @param args.reply - The stubbed reply.
 * @param args.tuning - The fields of the stage's config to replace.
 * @param args.language - The language of the notes. The default is the language of the example config.
 * @returns The config of the stage, and readers for the workspace, the stub logger and the completion call of the current test. It also gives a function that runs the stage with the stub client. The run takes the manifest fields to replace. Last, it gives a check that a run makes one call, and that the user message of the call holds a value as JSON. It also gives a check that a run makes one call for each of several values. The calls come in any order, and each call sends one value as the subtopic.
 * @typeParam TInput - The input of the stage.
 * @typeParam TOutput - The output of the stage.
 */
export function useStageReadingEarlierOutputs<TInput, TOutput>({
	stageId,
	readsFrom,
	factory,
	reply,
	tuning = {},
	language,
}: StageReadingEarlierOutputs<TInput, TOutput>): StageReadingEarlierOutputsSuite<TOutput> {
	const workspace = useTranscribedWorkspace({ prefix: `${stageId}-` });
	const logged = useStubLogger();
	const configured = configuringStage({ stageId, language });
	const config = {
		...configured,
		stages: { [stageId]: { ...configured.stages[stageId], ...tuning } },
	} as PipelineConfig;
	const workspaceRoot = (): string => workspace().workspaceRoot;
	const { client, create } = useStubbedOpenRouter();
	const costTally = useCostTally();

	beforeEach(async () => {
		if (reply !== null) {
			create().mockResolvedValue(openRouterReplyBody({ content: reply }));
		}
		await seedEarlierOutputs({ workspaceRoot: workspaceRoot(), readsFrom });
	});

	const run = (manifest: Partial<Manifest> = {}): Promise<StageResult<TOutput>> =>
		driveModelStage({
			factory,
			client: client(),
			config,
			workspaceRoot: workspaceRoot(),
			logger: logged().logger,
			manifest: makeManifest(manifest),
			costTally: costTally(),
		});

	return {
		config,
		workspaceRoot,
		logged,
		create,
		run,
		costTally,
		expectOneCallSending: async (value) => {
			await run();

			expect(create()).toHaveBeenCalledTimes(1);
			expect(sentUserMessage(create().mock.calls)).toContain(JSON.stringify(value));
		},
		expectCallsSending: async (values) => {
			await run();

			const sent = sentUserContents(create().mock.calls);
			expect(sent).toHaveLength(values.length);
			expect(sent).toStrictEqual(
				expect.arrayContaining(values.map((value) => `Subtopic:\n${JSON.stringify(value)}`)),
			);
		},
	};
}

/**
 * The path at which a panel stage saves run `runNumber`. The file name is
 * stated in full here, and not taken from the production code. So a suite that
 * finds a saved run at this path checks the name.
 *
 * @param args - The workspace, the panel stage and the run.
 * @param args.workspaceRoot - The absolute path to the lecture workspace.
 * @param args.stageId - The panel stage.
 * @param args.runNumber - The number of the run, from 1.
 * @returns The absolute path of the saved run.
 */
export function savedRunPath({
	workspaceRoot,
	stageId,
	runNumber,
}: {
	readonly workspaceRoot: string;
	readonly stageId: StageId;
	readonly runNumber: number;
}): string {
	return join(
		stageDirectoryPath({ workspaceRoot, stageId }),
		`run-${String(runNumber).padStart(2, "0")}.json`,
	);
}

/**
 * Writes a saved run on disk, as an earlier invocation or an earlier stage
 * saves it.
 *
 * @param args - The run, and its contents.
 * @param args.workspaceRoot - The absolute path to the lecture workspace.
 * @param args.stageId - The panel stage.
 * @param args.runNumber - The number of the run, from 1.
 * @param args.contents - The run, written as JSON.
 * @returns A promise that resolves when the file is written.
 */
export async function seedSavedRun({
	contents,
	...run
}: Parameters<typeof savedRunPath>[0] & { readonly contents: unknown }): Promise<void> {
	await seedJsonFile({ path: savedRunPath(run), contents });
}

/**
 * Writes a text file on disk, and makes its folder first, as an earlier stage or
 * an earlier invocation leaves it.
 *
 * @param args - The file, and its text.
 * @param args.path - The absolute path of the file.
 * @param args.contents - The text of the file.
 * @returns A promise that resolves when the file is written.
 */
export async function seedTextFile({
	path,
	contents,
}: {
	readonly path: string;
	readonly contents: string;
}): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, contents);
}

/**
 * {@link seedTextFile} for a JSON file.
 *
 * @param args - The file, and its contents.
 * @param args.path - The absolute path of the file.
 * @param args.contents - The contents, written as JSON.
 * @returns A promise that resolves when the file is written.
 */
export function seedJsonFile({
	path,
	contents,
}: {
	readonly path: string;
	readonly contents: unknown;
}): Promise<void> {
	return seedTextFile({ path, contents: JSON.stringify(contents) });
}

type FirstSavedRun = {
	/** Writes saved run 1 on disk with `contents`, as JSON. */
	readonly leaveFirstRun: (contents: unknown) => Promise<void>;
	/** Writes saved run 1 with `contents`, runs the stage, and checks that the stage fails because it cannot read run 1. */
	readonly expectUnreadableFirstRun: (contents: unknown) => Promise<void>;
};

/**
 * Makes the helpers with which the suite of a panel stage writes saved run 1
 * before the stage runs.
 *
 * @param args - The panel stage, its workspace, and a function that runs it.
 * @param args.workspaceRoot - Gives the absolute path to the lecture workspace of the current test.
 * @param args.stageId - The panel stage.
 * @param args.run - Runs the stage.
 * @returns The two helpers.
 */
export function firstSavedRun({
	workspaceRoot,
	stageId,
	run,
}: {
	readonly workspaceRoot: () => string;
	readonly stageId: StageId;
	readonly run: () => Promise<unknown>;
}): FirstSavedRun {
	const leaveFirstRun = (contents: unknown): Promise<void> =>
		seedSavedRun({ workspaceRoot: workspaceRoot(), stageId, runNumber: 1, contents });
	return {
		leaveFirstRun,
		expectUnreadableFirstRun: async (contents) => {
			await leaveFirstRun(contents);
			expect(await captureError(run())).toBeInstanceOf(SavedRunUnreadableError);
		},
	};
}

/**
 * Writes saved runs 1 to `count` of a panel on disk, as an earlier invocation
 * or an earlier stage saves them.
 *
 * @param args - The panel, the number of runs, and their contents.
 * @param args.workspaceRoot - The absolute path to the lecture workspace.
 * @param args.stageId - The panel stage.
 * @param args.count - The number of saved runs to write, from run 1.
 * @param args.contents - Gives the contents of run `runNumber`, written as JSON.
 * @returns A promise that resolves when every file is written.
 */
export async function seedSavedRuns({
	workspaceRoot,
	stageId,
	count,
	contents,
}: Omit<Parameters<typeof savedRunPath>[0], "runNumber"> & {
	readonly count: number;
	readonly contents: (runNumber: number) => unknown;
}): Promise<void> {
	for (let runNumber = 1; runNumber <= count; runNumber += 1) {
		await seedSavedRun({ workspaceRoot, stageId, runNumber, contents: contents(runNumber) });
	}
}

/**
 * The text of the subtopics of a division, joined in order. If the division is
 * lossless, this is the transcript.
 *
 * @param args - The divided text, and the spans of its subtopics.
 * @param args.text - The text that was divided.
 * @param args.subtopics - The span of each subtopic, in order.
 * @returns The text of the spans, joined.
 */
export function joinedSubtopics({
	text,
	subtopics,
}: {
	readonly text: string;
	readonly subtopics: readonly { readonly start: number; readonly end: number }[];
}): string {
	return subtopics.map((subtopic) => subtopicText({ text, subtopic })).join("");
}

/**
 * One message of the first call that a stage made to a stub client.
 *
 * @param args - The calls, and the place of the message.
 * @param args.calls - The calls to the completion stub of the client, as its `mock.calls`.
 * @param args.index - The place of the message: 0 for the system message, 1 for the user message.
 * @returns The content of the message.
 */
function sentMessage({
	calls,
	index,
}: {
	readonly calls: readonly (readonly unknown[])[];
	readonly index: number;
}): string | undefined {
	const [{ messages }] = calls[0] as [{ messages: { content: string }[] }];
	return messages[index]?.content;
}

/**
 * The user message of the first call that a stage made to a stub client. It
 * holds the material that the prompt is about.
 *
 * @param calls - The calls to the completion stub of the client, as its `mock.calls`.
 * @returns The user message of the first call.
 */
export function sentUserMessage(calls: readonly (readonly unknown[])[]): string | undefined {
	return sentMessage({ calls, index: 1 });
}

/**
 * The system message of the first call that a stage made to a stub client. It
 * holds the prompt.
 *
 * @param calls - The calls to the completion stub of the client, as its `mock.calls`.
 * @returns The system message of the first call.
 */
export function sentSystemMessage(calls: readonly (readonly unknown[])[]): string | undefined {
	return sentMessage({ calls, index: 0 });
}

/**
 * The content of the user message of each call that a stage made, in call
 * order. A message that carries an image has a list of content parts, and not
 * a string.
 *
 * @param calls - The calls to a stub, as its `mock.calls`. Each call takes an object with `messages` first.
 * @returns The content of the user message of each call.
 */
export function sentUserContents(calls: readonly (readonly unknown[])[]): readonly unknown[] {
	return calls.map((call) => {
		const [{ messages }] = call as [{ messages: { content: unknown }[] }];
		return messages[1]?.content;
	});
}

/**
 * Reads a JSON file that a stage or the runner wrote, and parses it.
 *
 * @param path - The absolute path of the file.
 * @returns The parsed file, for the suite to check.
 */
export async function readJsonFile(path: string): Promise<unknown> {
	return JSON.parse(await readFile(path, "utf8"));
}

/**
 * Reads a saved run that a stage wrote, and parses it. It does not check the run.
 *
 * @param run - The run, as for {@link savedRunPath}.
 * @returns The parsed JSON.
 */
export function readSavedRunJson(run: Parameters<typeof savedRunPath>[0]): Promise<unknown> {
	return readJsonFile(savedRunPath(run));
}

/**
 * Gives a new cost tally before each test, for a suite that checks what a stage
 * spent (technical-design.md §7).
 *
 * @returns A function that gives the cost tally of the current test.
 */
export function useCostTally(): () => CostTally {
	let costTally = createCostTally();
	beforeEach(() => {
		costTally = createCostTally();
	});
	return () => costTally;
}

/**
 * Runs a stage as the runner does: first `getInput`, then `run` with that
 * input. So a suite calls the stage in the same order as the pipeline.
 *
 * The stage is `Readonly` because a type with methods is not deeply readonly.
 * `prefer-readonly-parameter-types` reports each function that takes such a
 * type. `PipelineRunnerFacade` gives the same reason.
 *
 * @param args - The stage, its context and its cost tally.
 * @param args.stage - The stage under test.
 * @param args.context - The context that the runner makes for the stage.
 * @param args.costTally - The cost tally of the stage run. The default is a new tally.
 * @returns The result of the stage.
 */
export async function driveStage<TInput, TOutput>({
	stage,
	context,
	costTally = createCostTally(),
}: {
	readonly stage: Readonly<PipelineStage<TInput, TOutput>>;
	readonly context: StageContext;
	readonly costTally?: CostTally;
}): Promise<StageResult<TOutput>> {
	return stage.run({
		input: await stage.getInput(context),
		context,
		costTally,
		costTallyByModel: createCostTallyByModel(),
	});
}

/**
 * Resolves after `turns` turns of the event loop. Tasks that a suite starts
 * together then run at the same time, and no task finishes before the next one
 * starts. A task that waits more turns finishes after a task that waits fewer.
 *
 * @param args - The wait.
 * @param args.turns - The number of event loop turns to wait.
 * @returns A promise that resolves after those turns.
 */
export async function waitTurns({ turns }: { readonly turns: number }): Promise<void> {
	for (let turn = 0; turn < turns; turn += 1) {
		await new Promise((resolve) => {
			setImmediate(resolve);
		});
	}
}

/**
 * Wraps a task, so a suite can see how many calls of it were in flight at the
 * same time. Each call adds one to the count, and waits one turn so that calls
 * started with it overlap it. Then it does the task, and subtracts one from the
 * count.
 *
 * @param task - The task to track.
 * @returns The tracked task, and the largest number of calls that were in flight at the same time.
 * @typeParam TTaskArgs - The arguments of the task.
 * @typeParam TTaskResult - The result of the task.
 */
export function trackingInFlight<TTaskArgs, TTaskResult>(
	task: (args: TTaskArgs) => Promise<TTaskResult>,
): {
	readonly tracked: (args: TTaskArgs) => Promise<TTaskResult>;
	readonly peak: () => number;
} {
	let inFlight = 0;
	let peak = 0;
	return {
		tracked: async (args) => {
			inFlight += 1;
			peak = Math.max(peak, inFlight);
			await waitTurns({ turns: 1 });
			try {
				return await task(args);
			} finally {
				inFlight -= 1;
			}
		},
		peak: () => peak,
	};
}

/**
 * Makes a stub task whose first `count` calls each wait until all of them have
 * arrived. A stage reads a file before each call. Without this wait, the calls
 * would not all overlap, and a suite could not see them in flight together.
 *
 * @param args - The number of calls that wait, and the reply of each call.
 * @param args.count - The number of calls that wait for each other.
 * @param args.reply - Gives the reply of one call.
 * @returns The stub task.
 * @typeParam TReply - The reply of one call.
 */
export function arrivingTogether<TReply>({
	count,
	reply,
}: {
	readonly count: number;
	readonly reply: () => TReply;
}): () => Promise<TReply> {
	let arrived = 0;
	let releaseAll: () => void = () => undefined;
	const allArrived = new Promise<void>((resolve) => {
		releaseAll = resolve;
	});
	return async () => {
		arrived += 1;
		if (arrived === count) {
			releaseAll();
		}
		if (arrived <= count) {
			await allArrived;
		}
		return reply();
	};
}
