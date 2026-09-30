/**
 * Ask a model which of a grouping prompt's rules, if any, require dividing each
 * topic of a given grouping. A diagnostic, not a grouping version: it shows
 * which rule drives a model to split where the user's rulings keep together.
 *
 * Usage:
 *   TRIAL_MODEL=openai/gpt-6.1-sol-pro \
 *     pnpm exec tsx rule-probe.mts <source-run> <group-version> <starts> <instance>
 *   e.g. rule-probe.mts chosen-live18-rt9-l1 g23 1,2,9,13,16 1
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { groupPromptVersion } from "./group-prompts.mts";
import { callTrialModel, EFFORT, EFFORT_TAG, loadTrialConfig, MODEL, MODEL_TAG, OUT_DIR } from "./trial-model.mts";

/** The probe's task, sent as the system prompt after the grouping prompt's own rules. */
const PROBE_TASK = `# Your task now

Below the rules above, you are given the subtopics and a proposed grouping of them into topics. Do not produce a grouping of your own.

For each proposed topic, decide whether the rules above require it to be divided. If they do, name every rule that requires it, quote the words of each rule that apply, and say where you would divide the topic. If they do not, say why it stands.

Reply with a single JSON object and nothing else, in this exact shape:

{
  "topics": [
    {
      "firstSubtopicId": <id>,
      "mustDivide": true or false,
      "rules": ["<rule name>"],
      "quotedWords": ["<words of the rule that apply>"],
      "divideAt": [<subtopic ids where a new topic would start>],
      "reason": "why the rules do or do not require dividing it"
    }
  ]
}`;

async function main(): Promise<void> {
	const [sourceRun = "chosen-live18-rt9-l1", versionId = "g23", startsArg = "1,2,9,13,16", instance = "1"] = process.argv.slice(2);
	const version = groupPromptVersion({ id: versionId });
	const starts = startsArg.split(",").map(Number);
	const source = JSON.parse(await readFile(join(OUT_DIR, `${sourceRun}.blocks.json`), "utf8")) as {
		readonly blocks: readonly { readonly label: string; readonly content: string }[];
	};
	const payload = {
		subtopics: source.blocks.map((block, index) => ({ id: index + 1, label: block.label, text: block.content.trim() })),
		proposedTopics: starts.map((first, index) => ({
			firstSubtopicId: first,
			lastSubtopicId: (starts[index + 1] ?? source.blocks.length + 1) - 1,
		})),
	};
	const reply = await callTrialModel({
		config: await loadTrialConfig({ modelId: MODEL }),
		modelId: MODEL,
		reasoningEffort: EFFORT,
		messages: [
			{ role: "system", content: `${version.build({ labelsShown: true })}\n\n${PROBE_TASK}` },
			{ role: "user", content: JSON.stringify(payload) },
		],
	});
	if (reply.content === "") throw new Error(`empty reply: ${reply.error ?? reply.finishReason}`);
	const stem = `probe-${versionId}${MODEL_TAG}${EFFORT_TAG}-${sourceRun}-${starts.join("_")}-${instance}`;
	await writeFile(join(OUT_DIR, `${stem}.json`), JSON.stringify({ sourceRun, versionId, starts, modelId: MODEL, reply: JSON.parse(reply.content) }, null, 2), "utf8");
	console.log(stem);
	console.log(JSON.stringify(JSON.parse(reply.content), null, 2));
}

await main();
