/**
 * Retitle the subtopics of a chosen division whose title was written for a larger piece.
 *
 * A subtopic's title is stale when it came from the initial split but the
 * subtopic no longer ends where that initial subtopic ended: deepening cut it,
 * and this first piece kept the whole one's title. Each stale subtopic is sent
 * alone, with its neighbours' titles, and given a title of its own. Only the
 * titles change; the division is never touched. With `all` as the third
 * argument every subtopic is retitled, stale or not; a whole-lecture version
 * (r4 on) titles every subtopic in one call. `TRIAL_EFFORT` sets the
 * thinking level. A run number, when given, ends the run file's name, so
 * repeat runs sit side by side.
 *
 * Usage:
 *   pnpm exec tsx retitle-trial.mts <division-stem> <version> [stale|all] [run]
 *   e.g. retitle-trial.mts closest-d13-l4-r1to9-k5 r1
 *        TRIAL_EFFORT=high retitle-trial.mts chosen-live18-l4 r4 all 2
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { retitlePromptVersion } from "./retitle-prompts.mts";
import {
	callTrialModel,
	EFFORT,
	EFFORT_TAG,
	loadTrialConfig,
	MODEL,
	MODEL_TAG,
	OUT_DIR,
	type TrialReply,
} from "./trial-model.mts";

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

/**
 * The ids (from 1) of the subtopics to retitle: every one, or only the stale ones.
 *
 * @param options - Options object.
 * @param options.division - The chosen division, as written.
 * @param options.everySubtopic - Whether to retitle every subtopic rather than only the stale ones.
 * @returns The ids, in order.
 */
async function subtopicsToRetitle({
	division,
	everySubtopic,
}: {
	readonly division: Record<string, unknown> & { readonly blocks: readonly Block[] };
	readonly everySubtopic: boolean;
}): Promise<readonly number[]> {
	if (everySubtopic) return division.blocks.map((_, index) => index + 1);
	const chosen = String(division["chosenRun"]).replace(".blocks.json", "");
	const outcome = JSON.parse(await readFile(join(OUT_DIR, `${chosen}.outcome.json`), "utf8")) as { readonly source: string };
	const initial = await readRun({ stem: outcome.source });
	return staleTitles({ blocks: division.blocks, initial: initial.blocks });
}

/** One subtopic's title before and after, with the tokens its call used; a whole-lecture call's tokens sit on its first entry. */
type Retitled = {
	readonly id: number;
	readonly oldTitle: string;
	readonly newTitle: string;
	readonly promptTokens: number | null;
	readonly completionTokens: number | null;
};

/**
 * Title every subtopic of the division in one call, sending each one's id and text but no title.
 *
 * @param options - Options object.
 * @param options.blocks - The chosen division.
 * @param options.ask - Sends one payload under the version's prompt.
 * @returns Every subtopic's old and new title, in order.
 * @throws Error when the reply leaves out a subtopic.
 */
async function retitleWholeLecture({
	blocks,
	ask,
}: {
	readonly blocks: readonly Block[];
	readonly ask: (payload: unknown) => Promise<TrialReply>;
}): Promise<readonly Retitled[]> {
	const reply = await ask({ subtopics: blocks.map((block, index) => ({ id: index + 1, text: block.content.trim() })) });
	if (reply.content === "") {
		const { finishReason, nativeFinishReason, provider, promptTokens, completionTokens, error } = reply;
		throw new Error(`empty reply: ${JSON.stringify({ finishReason, nativeFinishReason, provider, promptTokens, completionTokens, error })}`);
	}
	const titles = (JSON.parse(reply.content) as { readonly titles: readonly { readonly id: number; readonly title: string }[] }).titles;
	return blocks.map((block, index) => {
		const found = titles.find((entry) => entry.id === index + 1);
		if (found === undefined) throw new Error(`reply has no title for subtopic ${index + 1}: ${reply.content}`);
		const first = index === 0;
		return {
			id: index + 1,
			oldTitle: block.label,
			newTitle: found.title,
			promptTokens: first ? reply.promptTokens : null,
			completionTokens: first ? reply.completionTokens : null,
		};
	});
}

async function main(): Promise<void> {
	const stem = process.argv[2] ?? "closest-d13-l4-r1to9-k5";
	const version = retitlePromptVersion({ id: process.argv[3] ?? "r1" });
	const everySubtopic = process.argv[4] === "all";
	const division = await readRun({ stem });
	const config = await loadTrialConfig({ modelId: MODEL });
	const ask = async (payload: unknown): Promise<TrialReply> =>
		callTrialModel({
			config,
			modelId: MODEL,
			reasoningEffort: EFFORT,
			messages: [
				{ role: "system", content: version.prompt },
				{ role: "user", content: JSON.stringify(payload) },
			],
		});

	const retitled = version.scope === "lecture" ? await retitleWholeLecture({ blocks: division.blocks, ask }) : await Promise.all(
		(await subtopicsToRetitle({ division, everySubtopic })).map(async (id) => {
			const block = division.blocks[id - 1] as Block;
			const reply = await ask({
				previousSubtopicTitle: division.blocks[id - 2]?.label ?? null,
				subtopic: block.content.trim(),
				nextSubtopicTitle: division.blocks[id]?.label ?? null,
			});
			const title = (JSON.parse(reply.content) as { readonly title: string }).title;
			return { id, oldTitle: block.label, newTitle: title, promptTokens: reply.promptTokens, completionTokens: reply.completionTokens };
		}),
	);
	const allTag = everySubtopic || version.scope === "lecture" ? "-all" : "";
	const run = process.argv[5];
	const runTag = run === undefined ? "" : `-${run}`;
	await writeFile(
		join(OUT_DIR, `retitle-${version.id}${MODEL_TAG}${EFFORT_TAG}${allTag}-${stem}${runTag}.json`),
		JSON.stringify({ division: stem, promptVersion: version.id, modelId: MODEL, reasoningEffort: EFFORT ?? null, retitled }, null, 2),
		"utf8",
	);
	for (const entry of retitled) console.log(`${stem} ${entry.id}: ${entry.oldTitle}  ->  ${entry.newTitle}`);
}

await main();
