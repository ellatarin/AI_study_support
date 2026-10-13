/**
 * Scores each fault of one or more check runs with Jev, and writes the scores
 * to `jev-scores.json` in each run folder. A second command scores the run
 * again and replaces the file.
 *
 * Usage, from the project root:
 *   pnpm exec tsx docs/quality/checker-prototype/judge-faults.mts \
 *     --lecture 2026-03-04 --rewrites "Rewrites (sonnet-5.5, w1)" \
 *     --runs "gemini-3.8-flash c20,gemini-3.8-flash c20 run 2"
 */

import "dotenv/config";

import { join } from "node:path";
import { parseArgs } from "node:util";
import { readMaterial } from "./check-results.mts";
import { createJevCall, scoreRunFaults } from "./jev-scores.mts";
import { rewritesRunsFolder, workspaceOf } from "./prototype-layout.mts";

const { values } = parseArgs({
	options: { lecture: { type: "string" }, rewrites: { type: "string" }, runs: { type: "string" } },
});
if (values.lecture === undefined || values.rewrites === undefined || values.runs === undefined) {
	throw new Error("Give --lecture, --rewrites and --runs. See the usage at the top of this file.");
}
const apiKey = process.env.TYPESAFE_API_KEY;
if (apiKey === undefined) {
	throw new Error("TYPESAFE_API_KEY is not set. Run the command from the project root, where .env is.");
}
const { lecture, rewrites } = values;
const material = await readMaterial({ workspaceRoot: await workspaceOf(lecture), rewrites });
const askJev = createJevCall(apiKey);
for (const run of values.runs.split(",")) {
	const { faults, inputTokens } = await scoreRunFaults({
		runFolder: join(rewritesRunsFolder({ lecture, rewrites }), run),
		material,
		askJev,
	});
	console.log(`${run}: ${faults} faults scored, ${inputTokens} input tokens`);
}
