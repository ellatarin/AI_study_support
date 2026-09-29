/**
 * Retitle the subtopics of a chosen division whose title was written for a larger piece.
 *
 * A subtopic's title is stale when it came from the initial split but the
 * subtopic no longer ends where that initial subtopic ended: deepening cut it,
 * and this first piece kept the whole one's title. Each stale subtopic is sent
 * alone, with its neighbours' titles, and given a title of its own. Only the
 * titles change; the division is never touched.
 *
 * Usage:
 *   pnpm exec tsx retitle-trial.mts <division-stem> <version>
 *   e.g. retitle-trial.mts closest-d13-l4-r1to9-k5 r1
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { retitlePromptVersion } from "./retitle-prompts.mts";
import { callTrialModel, loadTrialConfig, OUT_DIR } from "./trial-model.mts";

const MODEL = process.env["TRIAL_MODEL"] ?? "google/gemini-3.7-flash";

type Block = { readonly label: string; readonly content: string };

/**
 * Read a run file's blocks.
 *
 * @param options - Options object.
 * @param options.stem - The run's stem in `runs/`.
 * @returns The run as written.
 */
async function readRun({ stem }: { readonly stem: string }): Promise<Record<string, unknown> & { readonly blocks: readonly Block[] }> {
	return JSON.parse(await readFile(join(OUT_DIR, `${stem}.blocks.json`), "utf8"));
}

/**
 * The ids (from 1) of the subtopics carrying a title from an initial subtopic they no longer end with.
 *
 * @param options - Options object.
 * @param options.blocks - The chosen division.
 * @param options.initial - The initial split the chosen run was deepened from.
 * @returns The stale subtopics' ids, in order.
 */
function staleTitles({ blocks, initial }: { readonly blocks: readonly Block[]; readonly initial: readonly Block[] }): readonly number[] {
	const initialEnds = new Set<number>();
	let end = 0;
	for (const block of initial) {
		end += block.content.length;
		initialEnds.add(end);
	}
	const initialLabels = new Set(initial.map((block) => block.label));
	const stale: number[] = [];
	end = 0;
	blocks.forEach((block, index) => {
		end += block.content.length;
		if (initialLabels.has(block.label) && !initialEnds.has(end)) stale.push(index + 1);
	});
	return stale;
}

async function main(): Promise<void> {
	const stem = process.argv[2] ?? "closest-d13-l4-r1to9-k5";
	const version = retitlePromptVersion({ id: process.argv[3] ?? "r1" });
	const division = await readRun({ stem });
	const chosen = String(division["chosenRun"]).replace(".blocks.json", "");
	const outcome = JSON.parse(await readFile(join(OUT_DIR, `${chosen}.outcome.json`), "utf8")) as { readonly source: string };
	const initial = await readRun({ stem: outcome.source });
	const config = await loadTrialConfig({ modelId: MODEL });
	const ids = staleTitles({ blocks: division.blocks, initial: initial.blocks });

	const retitled = await Promise.all(
		ids.map(async (id) => {
			const block = division.blocks[id - 1] as Block;
			const payload = {
				previousSubtopicTitle: division.blocks[id - 2]?.label ?? null,
				subtopic: block.content.trim(),
				nextSubtopicTitle: division.blocks[id]?.label ?? null,
			};
			const reply = await callTrialModel({
				config,
				modelId: MODEL,
				messages: [
					{ role: "system", content: version.prompt },
					{ role: "user", content: JSON.stringify(payload) },
				],
			});
			const title = (JSON.parse(reply.content) as { readonly title: string }).title;
			return { id, oldTitle: block.label, newTitle: title, promptTokens: reply.promptTokens, completionTokens: reply.completionTokens };
		}),
	);
	await writeFile(
		join(OUT_DIR, `retitle-${version.id}-${stem}.json`),
		JSON.stringify({ division: stem, promptVersion: version.id, modelId: MODEL, retitled }, null, 2),
		"utf8",
	);
	for (const entry of retitled) console.log(`${stem} ${entry.id}: ${entry.oldTitle}  ->  ${entry.newTitle}`);
}

await main();
