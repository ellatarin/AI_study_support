/**
 * Runs checker prompts against saved rewrites, outside the pipeline. It reads a
 * lecture's structured transcript, term corrections and one rewrites folder, and
 * never writes to the lecture. Each pair of model and prompt version gets its
 * own folder under `runs/`. A subtopic with a saved result is not sent again,
 * so a second command finishes a run that failed part of the way. `--runs`
 * gives the run numbers, 1 by default. A repeat run gets its own folder.
 *
 * Usage, from the project root:
 *   pnpm exec tsx docs/quality/checker-prototype/check-trial.mts \
 *     --lecture 2026-03-04 --rewrites "Rewrites (sonnet-5.5, w1)" \
 *     --prompts c3 --models google/gemini-3.8-flash,openai/gpt-5.6-sol-pro \
 *     --runs 2,3
 */

import "dotenv/config";

import { mkdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import pino from "pino";
import { parseConfig } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/pipeline/config.js";
import { stageOutputPath } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/pipeline/layout.js";
import {
	callModel,
	createOpenRouterClientProvider,
	type OpenRouterClient,
} from "/Users/ellatarin/my_repositories/Ella_AI_project/src/pipeline/openrouter.js";
import { rewriteAttemptFilePath, subtopicPromptMessages } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/pipeline/stages/rewrite-attempts.js";
import { readStructuredTranscript } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/pipeline/stages/structured-transcript.js";
import { isSubtopicRewrite } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/pipeline/stages/subtopic-rewrites.js";
import { isTermCorrectionResult } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/pipeline/stages/term-corrections.js";
import { createCostTally } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/utils/cost.js";
import { pathExists, writeJsonAtomic } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/utils/files.js";
import { isRecord } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/utils/record.js";
import { type FailedSend, sendUntilAccepted } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/utils/resend.js";
import { createSendGate } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/utils/send-gate.js";
import { checkerSystemPrompt } from "./checker-prompts.mts";
import { cutIntoParts, type SplitPart } from "./paragraph-parts.mts";
import {
	CHECK_STAGE_ID,
	checkRunFolder,
	PROJECT_ROOT,
	splitsFile,
	subtopicResultFile,
	workspaceOf,
} from "./prototype-layout.mts";

/** The rewrite attempt that the trial reads: the first round. */
const ATTEMPT_NUMBER = 1;

/** What the checker gets for one subtopic: the same material as in the pipeline. */
type Material = {
	readonly subtopicId: number;
	readonly text: string;
	readonly corrections: readonly { readonly wrongForm: string; readonly rightForm: string; readonly reason: string }[];
	readonly rewrite: readonly string[];
};

/** What the checker gets in one call: a whole subtopic, or one part of it. */
type CheckUnit = Omit<Material, "subtopicId">;

/** A subtopic with the units that the checker gets for it, one call each. */
type SubtopicUnits = { readonly subtopicId: number; readonly units: readonly CheckUnit[] };

/** The reasoning efforts that OpenRouter accepts for a model that reasons. */
const REASONING_EFFORTS = ["low", "medium", "high"] as const;

/** A reasoning effort, or null for the model's default. */
type ReasoningEffort = (typeof REASONING_EFFORTS)[number] | null;

/**
 * Wraps a client provider so that each request asks for a reasoning effort. The
 * pipeline's model call has no such setting, so the trial adds OpenRouter's
 * `reasoning` field to the request body here.
 *
 * @param args - The client provider and the effort.
 * @param args.provider - The pipeline's client provider.
 * @param args.effort - The reasoning effort, or null to leave each request as it is.
 * @returns A client provider whose requests carry the effort.
 */
function withReasoningEffort({
	provider,
	effort,
}: {
	readonly provider: OpenRouterClient;
	readonly effort: ReasoningEffort;
}): OpenRouterClient {
	if (effort === null) {
		return provider;
	}
	let patched = false;
	return () => {
		const client = provider();
		if (!patched) {
			const completions = client.chat.completions;
			const create = completions.create.bind(completions);
			completions.create = ((body: Record<string, unknown>, options?: unknown) =>
				create({ ...body, reasoning: { effort } } as never, options as never)) as unknown as typeof completions.create;
			patched = true;
		}
		return client;
	};
}

/** A reply that the trial cannot use, with its text. */
type UnusableReply = FailedSend & { readonly replyText: string };

/** The parsed reply of a checker. The trial keeps each field that the model gives. */
type CheckerReply = Record<string, unknown> & {
	readonly deficiencies: readonly unknown[];
	readonly considerations: readonly unknown[];
};

/**
 * Checks that a parsed reply has lists of deficiencies and considerations. The
 * trial does not check each deficiency, because prompt versions differ in shape.
 *
 * @param value - The parsed reply.
 * @returns `true` when the value has both lists.
 */
function isCheckerReply(value: unknown): value is CheckerReply {
	return isRecord(value) && Array.isArray(value.deficiencies) && Array.isArray(value.considerations);
}

/**
 * Reads a reply as a usable checker reply, or gives the reason that it is unusable.
 *
 * @param content - The text of the reply.
 * @returns The parsed reply, or the reason with the text.
 */
function readReply(content: string): CheckerReply | UnusableReply {
	const unusable = (failure: string): UnusableReply => ({ failure, replyText: content });
	if (content.trim() === "") {
		return unusable("empty");
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch (error: unknown) {
		return unusable(`not JSON (${String(error)})`);
	}
	return isCheckerReply(parsed) ? parsed : unusable("no deficiencies or considerations list");
}

/**
 * Reads a JSON file and checks its shape.
 *
 * @param args - The file and its check.
 * @param args.path - The absolute path.
 * @param args.isShape - Checks the parsed value.
 * @returns The parsed value.
 * @throws Error when the value does not have the shape.
 * @typeParam TValue - The shape of the file.
 */
async function readChecked<TValue>({
	path,
	isShape,
}: {
	readonly path: string;
	readonly isShape: (value: unknown) => value is TValue;
}): Promise<TValue> {
	const value: unknown = JSON.parse(await readFile(path, "utf8"));
	if (!isShape(value)) {
		throw new Error(`${path} does not have the expected shape`);
	}
	return value;
}

/**
 * Reads the material of each subtopic: its text, the kept corrections of the
 * first rewrite attempt, and its rewrite from the named rewrites folder.
 *
 * @param args - The workspace and the rewrites folder.
 * @param args.workspaceRoot - The absolute path of the workspace.
 * @param args.rewrites - The name of the rewrites folder in the workspace.
 * @returns The material of each subtopic, in lecture order.
 */
async function readMaterial({
	workspaceRoot,
	rewrites,
}: {
	readonly workspaceRoot: string;
	readonly rewrites: string;
}): Promise<readonly Material[]> {
	const transcript = readStructuredTranscript(
		JSON.parse(await readFile(stageOutputPath({ workspaceRoot, stageId: "structure-transcript" }), "utf8")),
	);
	if (transcript === null) {
		throw new Error(`The structured transcript of ${workspaceRoot} is not readable`);
	}
	const subtopics = transcript.topics.flatMap((topic) => topic.subtopics);
	return Promise.all(
		subtopics.map(async ({ subtopicId, text }) => {
			const attempt = { workspaceRoot, subtopicId, attemptNumber: ATTEMPT_NUMBER };
			const correction = await readChecked({
				path: rewriteAttemptFilePath({ ...attempt, stageId: "correct-terms" }),
				isShape: isTermCorrectionResult,
			});
			const rewriteFile = basename(rewriteAttemptFilePath({ ...attempt, stageId: "rewrite-subtopics" }));
			const rewrite = await readChecked({
				path: join(workspaceRoot, rewrites, rewriteFile),
				isShape: isSubtopicRewrite,
			});
			return {
				subtopicId,
				text,
				corrections: correction.corrections.map(({ wrongForm, rightForm, reason }) => ({
					wrongForm,
					rightForm,
					reason,
				})),
				rewrite: rewrite.rewrittenSubtopic,
			};
		}),
	);
}

/**
 * Runs one model with one prompt version on each subtopic that has no saved
 * result, and adds a record of the command to `run.json`.
 *
 * @param args - The run.
 * @param args.lecture - The date of the lecture.
 * @param args.rewrites - The name of the rewrites folder.
 * @param args.modelId - The OpenRouter model id.
 * @param args.version - The prompt version.
 * @param args.runNumber - The number of the run of this model and version, from 1.
 * @param args.byParagraph - Whether the checker gets one part of a subtopic at a time, not the whole subtopic.
 * @param args.effort - The reasoning effort of each call, or null for the model's default.
 * @param args.subtopics - The units of each subtopic.
 * @param args.baseConfig - The pipeline configuration.
 * @returns A one-line summary of the run.
 */
async function runOne({
	lecture,
	rewrites,
	modelId,
	version,
	runNumber,
	byParagraph,
	effort,
	subtopics,
	baseConfig,
}: {
	readonly lecture: string;
	readonly rewrites: string;
	readonly modelId: string;
	readonly version: string;
	readonly runNumber: number;
	readonly byParagraph: boolean;
	readonly effort: ReasoningEffort;
	readonly subtopics: readonly SubtopicUnits[];
	readonly baseConfig: ReturnType<typeof parseConfig>;
}): Promise<string> {
	const folder = checkRunFolder({ lecture, rewrites, modelId, version, runNumber, byParagraph, effort });
	const runName = basename(folder);
	await mkdir(folder, { recursive: true });
	const borrowed = baseConfig.stages[CHECK_STAGE_ID];
	if (borrowed === undefined) {
		throw new Error(`The pipeline configuration has no ${CHECK_STAGE_ID} entry`);
	}
	const config = { ...baseConfig, stages: { ...baseConfig.stages, [CHECK_STAGE_ID]: { ...borrowed, modelId } } };
	const system = checkerSystemPrompt({ version, language: config.finalOutput.language });
	const client = withReasoningEffort({
		provider: createOpenRouterClientProvider({ openRouter: config.openRouter }),
		effort,
	});
	if (borrowed.sendGapSeconds === undefined) {
		throw new Error(`The pipeline configuration sets no sendGapSeconds for ${CHECK_STAGE_ID}`);
	}
	const sendGate = createSendGate({ gapSeconds: borrowed.sendGapSeconds });
	const costTally = createCostTally();
	const logger = pino({ enabled: false });
	const unusableReplies: Record<string, unknown>[] = [];
	const failedSubtopics: Record<string, unknown>[] = [];
	const startedAt = new Date();
	let checked = 0;

	/**
	 * Sends one unit to the checker until a reply is usable.
	 *
	 * @param args - The subtopic and the unit.
	 * @param args.subtopicId - The subtopic of the unit.
	 * @param args.unit - The material of the call.
	 * @returns The usable reply.
	 */
	async function checkUnit({
		subtopicId,
		unit,
	}: {
		readonly subtopicId: number;
		readonly unit: CheckUnit;
	}): Promise<CheckerReply> {
		const { sent } = await sendUntilAccepted<CheckerReply, UnusableReply>({
			send: async () => {
				const { content } = await callModel({
					messages: subtopicPromptMessages({ system, material: unit }),
					stageId: CHECK_STAGE_ID,
					config,
					responseFormat: "json",
					logger,
					client,
					sendGate,
					costTally,
				});
				return readReply(content);
			},
			onFailure: ({ send, failure, replyText }) => {
				unusableReplies.push({ subtopicId, send, reason: failure, replyText });
			},
			exhausted: ({ failure, sends }) => new Error(`failed after ${sends} sends: ${failure}`),
		});
		return sent;
	}

	await Promise.all(
		subtopics.map(async ({ subtopicId, units }) => {
			const resultPath = join(folder, subtopicResultFile(subtopicId));
			if (await pathExists(resultPath)) {
				return;
			}
			try {
				const replies = await Promise.all(units.map((unit) => checkUnit({ subtopicId, unit })));
				const [only] = replies;
				const sent =
					replies.length === 1 && only !== undefined
						? only
						: {
								deficiencies: replies.flatMap((reply) => reply.deficiencies),
								considerations: replies.flatMap((reply) => reply.considerations),
							};
				await writeJsonAtomic({
					path: resultPath,
					value: { subtopicId, checkerPromptVersion: version, modelId, ...sent },
				});
				checked += 1;
			} catch (error: unknown) {
				failedSubtopics.push({ subtopicId, error: String(error) });
			}
		}),
	);

	const runFile = join(folder, "run.json");
	const earlier: unknown = (await pathExists(runFile)) ? JSON.parse(await readFile(runFile, "utf8")) : null;
	const commands = isRecord(earlier) && Array.isArray(earlier.commands) ? earlier.commands : [];
	const cost = costTally.total();
	await writeJsonAtomic({
		path: runFile,
		value: {
			lecture,
			rewrites,
			modelId,
			checkerPromptVersion: version,
			commands: [
				...commands,
				{
					startedAt: startedAt.toISOString(),
					seconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
					subtopicsChecked: checked,
					cost,
					unusableReplies,
					failedSubtopics,
				},
			],
		},
	});
	const costText = typeof cost?.costUsd === "number" ? `$${cost.costUsd.toFixed(2)}` : "cost unknown";
	return `${runName}: ${checked} checked, ${failedSubtopics.length} failed, ${costText}`;
}

/**
 * Splits a comma-separated option into its parts.
 *
 * @param value - The option, such as "c2,c3".
 * @returns The parts, with no empty part.
 */
function list(value: string | undefined): readonly string[] {
	return (value ?? "").split(",").map((part) => part.trim()).filter((part) => part !== "");
}

/**
 * Checks that a parsed value is one part of a cuts file.
 *
 * @param value - The parsed value.
 * @returns `true` when the value has a list of paragraph numbers and start words or null.
 */
function isSplitPart(value: unknown): value is SplitPart {
	return (
		isRecord(value) &&
		Array.isArray(value.paragraphs) &&
		value.paragraphs.every((paragraph) => typeof paragraph === "number") &&
		(value.startWords === null || typeof value.startWords === "string")
	);
}

/**
 * Checks that a parsed value is a cuts file: for each subtopic, its parts.
 *
 * @param value - The parsed value.
 * @returns `true` when the value has a list of subtopics, each with a number and a list of parts.
 */
function isSplitsFile(
	value: unknown,
): value is { readonly subtopics: readonly { readonly subtopicId: number; readonly parts: readonly SplitPart[] }[] } {
	return (
		isRecord(value) &&
		Array.isArray(value.subtopics) &&
		value.subtopics.every(
			(subtopic) =>
				isRecord(subtopic) &&
				typeof subtopic.subtopicId === "number" &&
				Array.isArray(subtopic.parts) &&
				subtopic.parts.every(isSplitPart),
		)
	);
}

/**
 * Gives the units of each subtopic. By subtopic, a unit is the whole subtopic.
 * By paragraph, the units are the parts of the cuts file, each with the term
 * corrections whose wrong form is in its text. A subtopic with no rewrite and no
 * cuts stays one unit.
 *
 * @param args - The lecture, the rewrites folder, the material and the unit of the check.
 * @param args.lecture - The date of the lecture.
 * @param args.rewrites - The name of the rewrites folder.
 * @param args.material - The material of each subtopic.
 * @param args.byParagraph - Whether the units are the parts of the cuts file.
 * @returns The units of each subtopic, in lecture order.
 * @throws Error when the cuts file does not have the expected shape, or a subtopic with a rewrite has no cuts.
 */
async function subtopicUnits({
	lecture,
	rewrites,
	material,
	byParagraph,
}: {
	readonly lecture: string;
	readonly rewrites: string;
	readonly material: readonly Material[];
	readonly byParagraph: boolean;
}): Promise<readonly SubtopicUnits[]> {
	if (!byParagraph) {
		return material.map(({ subtopicId, ...unit }) => ({ subtopicId, units: [unit] }));
	}
	const { subtopics } = await readChecked({ path: splitsFile({ lecture, rewrites }), isShape: isSplitsFile });
	return material.map(({ subtopicId, text, rewrite, corrections }) => {
		const cuts = subtopics.find((subtopic) => subtopic.subtopicId === subtopicId);
		if (cuts === undefined) {
			if (rewrite.length > 0) {
				throw new Error(`The cuts file has no parts for subtopic ${subtopicId}, which has a rewrite`);
			}
			return { subtopicId, units: [{ text, rewrite, corrections }] };
		}
		const parts = cutIntoParts({ text, rewrite, parts: cuts.parts });
		return {
			subtopicId,
			units: parts.map((part) => ({
				text: part.text,
				rewrite: part.rewrite,
				corrections: corrections.filter((correction) => part.text.includes(correction.wrongForm)),
			})),
		};
	});
}

const { values } = parseArgs({
	options: {
		lecture: { type: "string" },
		rewrites: { type: "string" },
		prompts: { type: "string" },
		models: { type: "string" },
		runs: { type: "string", default: "1" },
		unit: { type: "string", default: "subtopic" },
		effort: { type: "string" },
	},
});
if (values.unit !== "subtopic" && values.unit !== "paragraph") {
	throw new Error(`--unit is "subtopic" or "paragraph". It was "${values.unit}".`);
}
const byParagraph = values.unit === "paragraph";
const effort = REASONING_EFFORTS.find((known) => known === values.effort) ?? null;
if (values.effort !== undefined && effort === null) {
	throw new Error(`--effort is ${REASONING_EFFORTS.join(", ")}. It was "${values.effort}".`);
}
const prompts = list(values.prompts);
const models = list(values.models);
const runNumbers = list(values.runs).map(Number);
if (runNumbers.some((runNumber) => !Number.isInteger(runNumber) || runNumber < 1)) {
	throw new Error(`--runs takes run numbers from 1, such as "2,3". It was "${values.runs}".`);
}
if (values.lecture === undefined || values.rewrites === undefined || prompts.length === 0 || models.length === 0) {
	throw new Error("Give --lecture, --rewrites, --prompts and --models. See the usage at the top of this file.");
}
const { lecture, rewrites } = values;
const baseConfig = parseConfig(JSON.parse(await readFile(join(PROJECT_ROOT, "pipeline-config.json"), "utf8")));
const material = await readMaterial({ workspaceRoot: await workspaceOf(lecture), rewrites });
const subtopics = await subtopicUnits({ lecture, rewrites, material, byParagraph });
const summaries = await Promise.all(
	models.flatMap((modelId) =>
		prompts.flatMap((version) =>
			runNumbers.map((runNumber) =>
				runOne({ lecture, rewrites, modelId, version, runNumber, byParagraph, effort, subtopics, baseConfig }),
			),
		),
	),
);
for (const summary of summaries) {
	console.log(summary);
}
