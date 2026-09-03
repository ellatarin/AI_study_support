import "dotenv/config";

import { readFile } from "node:fs/promises";
import { parseConfig } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/pipeline/config.js";
import { createOpenRouterClientProvider } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/pipeline/openrouter.js";

const PROJECT_ROOT = "/Users/ellatarin/my_repositories/Ella_AI_project";
const TRANSCRIPT = `${PROJECT_ROOT}/docs/quality/2026-08-31-lecture-3-transcript.txt`;
const MODEL = process.argv[2] ?? "google/gemini-3.7-flash";

const config = parseConfig(
	JSON.parse(await readFile(`${PROJECT_ROOT}/pipeline-config.json`, "utf8")),
);
const client = createOpenRouterClientProvider({ openRouter: config.openRouter })();
const transcriptText = (await readFile(TRANSCRIPT, "utf8")).trim();

/** Dumps everything the pipeline's wrapper hides: finish_reason, usage, provider, any error. */
async function probe(
	name: string,
	body: Record<string, unknown>,
): Promise<void> {
	console.log(`\n${"=".repeat(70)}\n${name}\n${"=".repeat(70)}`);
	const startedAt = performance.now();
	try {
		const response = (await client.chat.completions.create(
			body as never,
		)) as unknown as Record<string, unknown>;
		const seconds = Math.round((performance.now() - startedAt) / 1000);
		const choices = (response["choices"] ?? []) as readonly Record<string, unknown>[];
		const first = choices[0] ?? {};
		const message = (first["message"] ?? {}) as Record<string, unknown>;
		const content = typeof message["content"] === "string" ? message["content"] : null;
		console.log(`  ${seconds}s`);
		console.log(`  id            : ${String(response["id"])}`);
		console.log(`  provider      : ${String(response["provider"])}`);
		console.log(`  model         : ${String(response["model"])}`);
		console.log(`  usage         : ${JSON.stringify(response["usage"])}`);
		console.log(`  choices       : ${choices.length}`);
		console.log(`  finish_reason : ${String(first["finish_reason"])}`);
		console.log(`  native_finish : ${String(first["native_finish_reason"])}`);
		console.log(`  content length: ${content === null ? "null" : content.length}`);
		if (response["error"] !== undefined) {
			console.log(`  ERROR FIELD   : ${JSON.stringify(response["error"])}`);
		}
		if (message["reasoning"] !== undefined) {
			console.log(`  reasoning len : ${String(String(message["reasoning"]).length)}`);
		}
		if (content !== null && content.length > 0) {
			console.log(`  head          : ${content.slice(0, 200).replace(/\n/gu, " ")}`);
		}
	} catch (error: unknown) {
		console.log(`  THREW after ${Math.round((performance.now() - startedAt) / 1000)}s`);
		console.log(`  ${String(error)}`);
	}
}

const jsonFields = {
	response_format: { type: "json_object" },
	provider: { require_parameters: true },
};

await probe("A — tiny prompt, plain text, no provider constraint", {
	model: MODEL,
	messages: [{ role: "user", content: "Reply with the single word: ok" }],
});

await probe("B — tiny prompt, json mode + require_parameters (the pipeline's shape)", {
	model: MODEL,
	messages: [
		{ role: "user", content: 'Reply with JSON: {"ok": true}' },
	],
	...jsonFields,
});

await probe("C — full transcript, json mode + require_parameters (the real call)", {
	model: MODEL,
	messages: [
		{ role: "system", content: 'Split the transcript into topic blocks. Reply with JSON {"blocks":[{"id":1,"label":"...","content":"verbatim text"}]}. Content must be the transcript verbatim; concatenating all blocks must reproduce it exactly.' },
		{ role: "user", content: `Transcript:\n${transcriptText}` },
	],
	...jsonFields,
});
