/**
 * Judge between two arrangements of one stretch of a division's subtopics.
 *
 * `judge-trial.mts` compares whole groupings a panel proposed. This compares
 * two arrangements of a single stretch between settled borders, given as topic
 * starts only — no labels, no reasons, and neither presented as a draft — so a
 * choice can only come from the transcript. Which arrangement is listed first
 * is set on the command line, so each comparison can be run in both orders.
 *
 * Usage:
 *   pnpm exec tsx stretch-judge-trial.mts <source-run> <judge-version> <first> <last> <starts1> <starts2> <instance>
 * e.g. `stretch-judge-trial.mts chosen-live18-l4 j2 7 17 7 7,14 1`, where each
 * `starts` list is the arrangement's topic starts inside the stretch, comma
 * separated, the stretch's first subtopic always among them.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { judgePromptVersion } from "./judge-prompts.mts";
import { callTrialModel, EFFORT, EFFORT_TAG, loadTrialConfig, MODEL, OUT_DIR, threwVerdict, VERDICT } from "./trial-model.mts";

/** The part of a division's blocks file this script reads. */
type Division = { readonly blocks: readonly { readonly content: string }[] };

/**
 * Parse a comma-separated list of topic starts.
 *
 * @param options - Options object.
 * @param options.list - The list as typed, such as "7,14".
 * @returns The starts as numbers, in the order given.
 */
function startsFrom({ list }: { readonly list: string }): readonly number[] {
	return list.split(",").map(Number);
}

async function main(): Promise<void> {
	const [sourceRun = "", versionId = "", first = "", last = "", starts1 = "", starts2 = "", instance = "1"] =
		process.argv.slice(2);
	const version = judgePromptVersion({ id: versionId });
	const division = JSON.parse(await readFile(join(OUT_DIR, `${sourceRun}.blocks.json`), "utf8")) as Division;

	const payload = {
		subtopics: division.blocks.map((block, index) => ({ id: index + 1, text: block.content.trim() })),
		stretch: { firstSubtopicId: Number(first), lastSubtopicId: Number(last) },
		arrangement1: { topicsStartAt: startsFrom({ list: starts1 }) },
		arrangement2: { topicsStartAt: startsFrom({ list: starts2 }) },
	};
	const config = await loadTrialConfig({ modelId: MODEL });

	let verdict: string = VERDICT.ok;
	let content = "";
	let completionTokens: number | null = null;
	try {
		const reply = await callTrialModel({
			config,
			modelId: MODEL,
			messages: [
				{ role: "system", content: version.prompt },
				{ role: "user", content: JSON.stringify(payload) },
			],
			reasoningEffort: EFFORT,
		});
		content = reply.content;
		completionTokens = reply.completionTokens;
	} catch (error: unknown) {
		verdict = threwVerdict(error);
	}

	let chosen: readonly number[] | null = null;
	if (verdict === VERDICT.ok) {
		try {
			const choice = String((JSON.parse(content) as { choice?: unknown }).choice ?? "").trim();
			chosen = choice === "1" ? payload.arrangement1.topicsStartAt : choice === "2" ? payload.arrangement2.topicsStartAt : null;
			if (chosen === null) {
				verdict = VERDICT.wrongShape;
			}
		} catch {
			verdict = VERDICT.unparseable;
		}
	}

	const stem = `judge-${version.id}${EFFORT_TAG}-${sourceRun}-${first}to${last}-${starts1}-vs-${starts2}-${instance}`;
	await writeFile(
		join(OUT_DIR, `${stem}.json`),
		JSON.stringify({ ...payload, subtopics: undefined, verdict, chosen, completionTokens, reply: content }, null, 2),
		"utf8",
	);
	console.log(`${stem} out=${String(completionTokens ?? "-")} chose=${JSON.stringify(chosen)} ${verdict}`);
}

await main();
