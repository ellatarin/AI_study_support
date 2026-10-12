/**
 * Runs checker prompts against saved rewrites, outside the pipeline. It reads a
 * lecture's structured transcript, term corrections and one rewrites folder, and
 * never writes to the lecture. Each pair of model and prompt version gets its
 * own folder under `runs/`. A subtopic with a saved result is not sent again,
 * so a second command finishes a run that failed part of the way.
 *
 * Usage, from the project root:
 *   pnpm exec tsx docs/quality/checker-prototype/check-trial.mts \
 *     --lecture 2026-03-04 --rewrites "Rewrites (sonnet-5.5, w1)" \
 *     --prompts c3 --models google/gemini-3.8-flash,openai/gpt-5.6-sol-pro
 */

import "dotenv/config";

import { mkdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import pino from "pino";
import { parseConfig } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/pipeline/config.js";
import { stageOutputPath } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/pipeline/layout.js";
import { callModel, createOpenRouterClientProvider } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/pipeline/openrouter.js";
import { rewriteAttemptFilePath, subtopicPromptMessages } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/pipeline/stages/rewrite-attempts.js";
import { readStructuredTranscript } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/pipeline/stages/structured-transcript.js";
import { isSubtopicRewrite } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/pipeline/stages/subtopic-rewrites.js";
import { isTermCorrectionResult } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/pipeline/stages/term-corrections.js";
import { mapWithConcurrency } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/utils/concurrency.js";
import { createCostTally } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/utils/cost.js";
import { pathExists, writeJsonAtomic } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/utils/files.js";
import { isRecord } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/utils/record.js";
import { type FailedSend, sendUntilAccepted } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/utils/resend.js";
import { createSendGate } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/utils/send-gate.js";
import { checkerSystemPrompt } from "./checker-prompts.mts";
import { checkRunFolder, PROJECT_ROOT, subtopicResultFile, workspaceOf } from "./prototype-layout.mts";

/** The stage whose configuration the trial borrows, with the model of each run in place of its own. */
const STAGE_ID = "check-rewrite-attempts";

/** The most subtopics of one run in flight at once, as in the pipeline's configuration. */
const CONCURRENCY = 10;

/** The gap between the sends of one run, as in the pipeline's configuration. */
const SEND_GAP_SECONDS = 0.25;

/** The rewrite attempt that the trial reads: the first round. */
const ATTEMPT_NUMBER = 1;

/** What the checker gets for one subtopic: the same material as in the pipeline. */
type Material = {
	readonly subtopicId: number;
	readonly text: string;
	readonly corrections: readonly { readonly wrongForm: string; readonly rightForm: string; readonly reason: string }[];
	readonly rewrite: readonly string[];
};

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
 * @param args.material - The material of each subtopic.
 * @param args.baseConfig - The pipeline configuration.
 * @returns A one-line summary of the run.
 */
async function runOne({
	lecture,
	rewrites,
	modelId,
	version,
	material,
	baseConfig,
}: {
	readonly lecture: string;
	readonly rewrites: string;
	readonly modelId: string;
	readonly version: string;
	readonly material: readonly Material[];
	readonly baseConfig: ReturnType<typeof parseConfig>;
}): Promise<string> {
	const folder = checkRunFolder({ lecture, rewrites, modelId, version });
	await mkdir(folder, { recursive: true });
	const borrowed = baseConfig.stages[STAGE_ID];
	if (borrowed === undefined) {
		throw new Error(`The pipeline configuration has no ${STAGE_ID} entry`);
	}
	const config = { ...baseConfig, stages: { ...baseConfig.stages, [STAGE_ID]: { ...borrowed, modelId } } };
	const system = checkerSystemPrompt({ version, language: config.finalOutput.language });
	const client = createOpenRouterClientProvider({ openRouter: config.openRouter });
	const sendGate = createSendGate({ gapSeconds: SEND_GAP_SECONDS });
	const costTally = createCostTally();
	const logger = pino({ enabled: false });
	const unusableReplies: Record<string, unknown>[] = [];
	const failedSubtopics: Record<string, unknown>[] = [];
	const startedAt = new Date();
	let checked = 0;

	await mapWithConcurrency({
		items: material,
		limit: CONCURRENCY,
		work: async ({ item: { subtopicId, ...subtopic } }) => {
			const resultPath = join(folder, subtopicResultFile(subtopicId));
			if (await pathExists(resultPath)) {
				return;
			}
			try {
				const { sent } = await sendUntilAccepted<CheckerReply, UnusableReply>({
					send: async () => {
						const { content } = await callModel({
							messages: subtopicPromptMessages({ system, material: subtopic }),
							stageId: STAGE_ID,
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
				await writeJsonAtomic({
					path: resultPath,
					value: { subtopicId, checkerPromptVersion: version, modelId, ...sent },
				});
				checked += 1;
			} catch (error: unknown) {
				failedSubtopics.push({ subtopicId, error: String(error) });
			}
		},
	});

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
	return `${modelId} ${version}: ${checked} checked, ${failedSubtopics.length} failed, ${costText}`;
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

const { values } = parseArgs({
	options: {
		lecture: { type: "string" },
		rewrites: { type: "string" },
		prompts: { type: "string" },
		models: { type: "string" },
	},
});
const prompts = list(values.prompts);
const models = list(values.models);
if (values.lecture === undefined || values.rewrites === undefined || prompts.length === 0 || models.length === 0) {
	throw new Error("Give --lecture, --rewrites, --prompts and --models. See the usage at the top of this file.");
}
const { lecture, rewrites } = values;
const baseConfig = parseConfig(JSON.parse(await readFile(join(PROJECT_ROOT, "pipeline-config.json"), "utf8")));
const material = await readMaterial({ workspaceRoot: await workspaceOf(lecture), rewrites });
const summaries = await Promise.all(
	models.flatMap((modelId) =>
		prompts.map((version) => runOne({ lecture, rewrites, modelId, version, material, baseConfig })),
	),
);
for (const summary of summaries) {
	console.log(summary);
}
