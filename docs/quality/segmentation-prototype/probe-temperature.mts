import "dotenv/config";

import { readFile } from "node:fs/promises";
import { parseConfig } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/pipeline/config.js";
import { createOpenRouterClientProvider } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/pipeline/openrouter.js";

const PROJECT_ROOT = "/Users/ellatarin/my_repositories/Ella_AI_project";
const config = parseConfig(
	JSON.parse(await readFile(`${PROJECT_ROOT}/pipeline-config.json`, "utf8")),
);
const client = createOpenRouterClientProvider({ openRouter: config.openRouter })();

/** A tiny call, so the question costs a fraction of a penny to settle. */
async function attempt(name: string, body: Record<string, unknown>): Promise<void> {
	try {
		const response = (await client.chat.completions.create(
			body as never,
		)) as unknown as Record<string, unknown>;
		const choices = (response["choices"] ?? []) as readonly Record<string, unknown>[];
		const message = (choices[0]?.["message"] ?? {}) as Record<string, unknown>;
		console.log(
			`${name.padEnd(46)} OK    provider=${String(response["provider"])}  content=${JSON.stringify(message["content"])}`,
		);
	} catch (error: unknown) {
		console.log(`${name.padEnd(46)} FAIL  ${String(error).slice(0, 160)}`);
	}
}

const messages = [{ role: "user" as const, content: 'Reply with JSON: {"ok": true}' }];
const json = { response_format: { type: "json_object" } };

await attempt("temperature + require_parameters", {
	model: "google/gemini-3.7-flash",
	messages,
	temperature: 0.2,
	...json,
	provider: { require_parameters: true },
});

await attempt("temperature, NO require_parameters", {
	model: "google/gemini-3.7-flash",
	messages,
	temperature: 0.2,
	...json,
});

await attempt("no temperature + require_parameters (current)", {
	model: "google/gemini-3.7-flash",
	messages,
	...json,
	provider: { require_parameters: true },
});
