import "dotenv/config";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseConfig } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/pipeline/config.js";
import {
	createOpenRouterClientProvider,
	makeCompletionCall,
} from "/Users/ellatarin/my_repositories/Ella_AI_project/src/pipeline/openrouter.js";
import { createRootLogger } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/utils/logger.js";

const PROJECT_ROOT = "/Users/ellatarin/my_repositories/Ella_AI_project";
const SCRATCH = "/private/tmp/claude-501/-Users-ellatarin-my-repositories-Ella-AI-project/12ebf5da-9b38-49bf-8b96-99bc3b6ebd08/scratchpad";
const TRANSCRIPT = join(PROJECT_ROOT, "docs/quality/2026-08-31-lecture-3-transcript.txt");
const OUT_DIR = join(SCRATCH, "block-split-runs");

/** The stage whose config entry is borrowed to carry the model; there is no segmentation stage id. */
const BORROWED_STAGE_ID = "transcript-structuring";

const SYSTEM_PROMPT = `You are dividing a university lecture transcript into topic blocks.

A block is a stretch of the lecture in which the lecturer is dealing with one subject. A new block begins where the subject matter changes.

Decide where the subject changes by reading what is being talked about. Do NOT rely on the speaker announcing a change. This lecturer says "So", "Right", and "Okay" constantly without changing subject, and several real changes of subject arrive with no announcement at all. The words are not the signal; the subject is.

Do not decide in advance how many blocks there should be. Divide the transcript wherever the subject genuinely changes, and let the number be whatever it turns out to be.

You are cutting the transcript, not editing it:
- Each block's "content" must be the transcript's own text, character for character. Add nothing, remove nothing, reword nothing, correct nothing, tidy nothing.
- Nothing may be left out. Concatenating every block's "content" in order must reproduce the entire transcript exactly.
- Passages you might consider unimportant — asides, admin, hesitation, applause, jokes — are transcript text like any other. They stay exactly where they fall, inside whichever block they land in. Do not separate them out and do not judge them.

Give each block a short descriptive label saying what it is about.`;

const REPLY_CONTRACT = `Reply with a single JSON object and nothing else, in this exact shape:

{
  "blocks": [
    { "id": 1, "label": "short description of the subject", "content": "the transcript text of this block, verbatim" }
  ]
}

"id" counts up from 1. Blocks appear in transcript order.`;

type Block = { readonly id: number; readonly label: string; readonly content: string };

/** Every character that is not whitespace, so a comparison ignores where lines were broken. */
function stripped(text: string): string {
	return text.replace(/\s+/gu, "");
}

/** Where two strings first differ, or -1 when one is a prefix of the other. */
function firstDivergence(left: string, right: string): number {
	const limit = Math.min(left.length, right.length);
	for (let index = 0; index < limit; index += 1) {
		if (left[index] !== right[index]) {
			return index;
		}
	}
	return left.length === right.length ? -1 : limit;
}

function isBlock(value: unknown): value is Block {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (
		typeof record["id"] === "number" &&
		typeof record["label"] === "string" &&
		typeof record["content"] === "string"
	);
}

async function main(): Promise<void> {
	const modelId = process.argv[2] ?? "google/gemini-3.7-flash";
	const runId = new Date().toISOString().replace(/[:.]/gu, "-");
	const tag = `${runId}__${modelId.replace(/[/.]/gu, "-")}`;
	await mkdir(OUT_DIR, { recursive: true });

	const transcriptText = (await readFile(TRANSCRIPT, "utf8")).trim();
	const baseConfig = parseConfig(
		JSON.parse(await readFile(join(PROJECT_ROOT, "pipeline-config.json"), "utf8")),
	);

	// maxTokens MUST be cleared: the configured 8192 is below what this transcript needs,
	// and a truncated reply would be indistinguishable from the model choosing to stop.
	const borrowed = baseConfig.stages[BORROWED_STAGE_ID];
	if (borrowed === undefined) {
		throw new Error(`pipeline-config.json has no ${BORROWED_STAGE_ID} entry to borrow`);
	}
	const config = {
		...baseConfig,
		stages: {
			...baseConfig.stages,
			// undefined, not null: the config parser maps JSON null to undefined so the
			// field is omitted from the request body. Building the override by hand
			// bypasses that, and null would be sent literally.
			[BORROWED_STAGE_ID]: {
				...borrowed,
				modelId,
				maxTokens: undefined,
				temperature: undefined,
			},
		},
	};

	const logger = createRootLogger({ logFile: join(OUT_DIR, `${tag}.log`) });
	const client = createOpenRouterClientProvider({ openRouter: config.openRouter });

	console.log(`model: ${modelId}`);
	console.log(`transcript: ${transcriptText.split(/\s+/u).length} words, ${transcriptText.length} chars`);
	console.log("calling…");
	const startedAt = performance.now();

	const { content, cost } = await makeCompletionCall({
		messages: [
			{ role: "system", content: `${SYSTEM_PROMPT}\n\n${REPLY_CONTRACT}` },
			{ role: "user", content: `Transcript:\n${transcriptText}` },
		],
		stageId: BORROWED_STAGE_ID,
		config,
		responseFormat: "json",
		logger,
		client,
	});

	const elapsedSeconds = Math.round((performance.now() - startedAt) / 1000);

	// Saved BEFORE any validation: a malformed reply is the most informative failure available
	// and must never be discarded.
	const rawPath = join(OUT_DIR, `${tag}.raw.json`);
	await writeFile(rawPath, content, "utf8");
	console.log(`\nraw reply saved: ${rawPath}`);
	console.log(
		`${elapsedSeconds}s | ${cost.promptTokens} in / ${cost.completionTokens} out | ${cost.costUsd === null ? `cost n/a (${cost.costResolutionError ?? "unknown"})` : `$${cost.costUsd}`}`,
	);

	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch (error: unknown) {
		console.error(`\nFAILED: reply is not JSON — ${String(error)}`);
		process.exitCode = 1;
		return;
	}

	const blocksValue = (parsed as Record<string, unknown>)["blocks"];
	if (!Array.isArray(blocksValue) || !blocksValue.every(isBlock)) {
		console.error("\nFAILED: reply is not { blocks: [{ id, label, content }] }");
		process.exitCode = 1;
		return;
	}
	const blocks: readonly Block[] = blocksValue;

	const rejoined = blocks.map((block) => block.content).join(" ");
	const sourceStripped = stripped(transcriptText);
	const rejoinedStripped = stripped(rejoined);
	const lossless = sourceStripped === rejoinedStripped;

	console.log(`\n${blocks.length} blocks\n`);
	for (const block of blocks) {
		const words = block.content.split(/\s+/u).filter(Boolean).length;
		console.log(`  ${String(block.id).padStart(3)}  ${String(words).padStart(5)}w  ${block.label}`);
	}

	console.log(`\n--- losslessness ---`);
	console.log(`source   ${sourceStripped.length} non-whitespace chars`);
	console.log(`rejoined ${rejoinedStripped.length} non-whitespace chars`);
	if (lossless) {
		console.log("PASS — the blocks reproduce the transcript exactly.");
	} else {
		const at = firstDivergence(sourceStripped, rejoinedStripped);
		console.log(`FAIL — diverges at non-whitespace character ${at}`);
		console.log(`  source   …${sourceStripped.slice(Math.max(0, at - 60), at + 60)}…`);
		console.log(`  rejoined …${rejoinedStripped.slice(Math.max(0, at - 60), at + 60)}…`);
		process.exitCode = 1;
	}

	await writeFile(
		join(OUT_DIR, `${tag}.blocks.json`),
		JSON.stringify({ modelId, elapsedSeconds, cost, lossless, blocks }, null, 2),
		"utf8",
	);
	console.log(`\nblocks saved: ${join(OUT_DIR, `${tag}.blocks.json`)}`);
}

await main();
