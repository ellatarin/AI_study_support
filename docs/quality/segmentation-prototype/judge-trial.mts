/**
 * Judge between the groupings a panel of grouping runs proposed.
 *
 * Counting runs cannot do better than the runs' majority. This tries the other
 * thing: one more model call that reads the lecture's subtopics and the distinct
 * groupings side by side, each with a real run's labels and reasons, and picks
 * one. Which candidate is listed first alternates between instances, and the run
 * whose labels and reasons stand for each candidate rotates, so neither position
 * nor one run's wording can settle the result.
 *
 * Usage:
 *   TRIAL_MODEL=google/gemini-3.7-flash \
 *     pnpm exec tsx judge-trial.mts <lecture> <group-version> <judge-version> <instance>
 * e.g. `judge-trial.mts l5 g12 j1 1`. Reads the voted division
 * `voted-d9-<lecture>-r1to9-k5` and every grouping run of that version on it.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { judgePromptVersion } from "./judge-prompts.mts";
import { callTrialModel, loadTrialConfig, MODEL, OUT_DIR, threwVerdict, VERDICT } from "./trial-model.mts";

/** A topic as a grouping run left it. */
type Topic = {
	readonly firstSubtopicId: number;
	readonly lastSubtopicId: number;
	readonly label: string;
	readonly groupedBecause: string;
};

/** One grouping run: its instance and its topics. */
type GroupingRun = { readonly instance: number; readonly topics: readonly Topic[] };

/** A distinct grouping, with every run that made it. */
type Candidate = { readonly key: string; readonly runs: readonly GroupingRun[] };

/** The part of a grouping run's blocks file this script reads. */
type GroupBlocks = {
	readonly blocks: readonly {
		readonly topicLabel: string;
		readonly topicWhy: string;
		readonly opensTopic: boolean;
	}[];
};

/**
 * Rebuild a run's topics from its blocks.
 *
 * @param options - Options object.
 * @param options.blocks - The run's blocks, one per subtopic.
 * @returns The run's topics in order.
 */
function topicsOf({ blocks }: GroupBlocks): readonly Topic[] {
	const topics: Topic[] = [];
	blocks.forEach((block, index) => {
		const id = index + 1;
		const last = topics.at(-1);
		if (block.opensTopic || last === undefined) {
			topics.push({ firstSubtopicId: id, lastSubtopicId: id, label: block.topicLabel, groupedBecause: block.topicWhy });
			return;
		}
		topics[topics.length - 1] = { ...last, lastSubtopicId: id };
	});
	return topics;
}

/**
 * Read every grouping run of one version on one lecture's voted division.
 *
 * @param options - Options object.
 * @param options.lecture - The lecture key, such as "l5".
 * @param options.groupVersion - The grouping prompt version, such as "g12".
 * @returns The runs, in instance order.
 */
async function loadGroupingRuns({
	lecture,
	groupVersion,
}: {
	readonly lecture: string;
	readonly groupVersion: string;
}): Promise<readonly GroupingRun[]> {
	const prefix = `group-${groupVersion}-voted-d9-${lecture}-r1to9-k5-`;
	const names = (await readdir(OUT_DIR)).filter((name) => name.startsWith(prefix) && name.endsWith(".blocks.json"));
	const runs = await Promise.all(
		names.map(async (name) => ({
			instance: Number(name.slice(prefix.length, -".blocks.json".length)),
			topics: topicsOf(JSON.parse(await readFile(join(OUT_DIR, name), "utf8")) as GroupBlocks),
		})),
	);
	return runs.sort((a, b) => a.instance - b.instance);
}

/**
 * Collect the distinct groupings, most common first.
 *
 * @param options - Options object.
 * @param options.runs - The grouping runs.
 * @returns One candidate per distinct set of topic starts.
 */
function distinctGroupings({ runs }: { readonly runs: readonly GroupingRun[] }): readonly Candidate[] {
	const byKey = new Map<string, GroupingRun[]>();
	for (const run of runs) {
		const key = run.topics.map((topic) => topic.firstSubtopicId).join(",");
		byKey.set(key, [...(byKey.get(key) ?? []), run]);
	}
	return [...byKey.entries()]
		.map(([key, members]) => ({ key, runs: members }))
		.sort((a, b) => b.runs.length - a.runs.length || a.key.localeCompare(b.key));
}

async function main(): Promise<void> {
	const lecture = process.argv[2] ?? "l5";
	const groupVersion = process.argv[3] ?? "g12";
	const judge = judgePromptVersion({ id: process.argv[4] ?? "j1" });
	const instance = Number(process.argv[5] ?? "1");

	const division = JSON.parse(
		await readFile(join(OUT_DIR, `voted-d9-${lecture}-r1to9-k5.blocks.json`), "utf8"),
	) as { readonly blocks: readonly { readonly content: string }[] };
	const candidates = distinctGroupings({ runs: await loadGroupingRuns({ lecture, groupVersion }) });
	// Rotate which candidate comes first, and which run speaks for each, by instance.
	const shift = (instance - 1) % candidates.length;
	const ordered = [...candidates.slice(shift), ...candidates.slice(0, shift)];
	const turn = Math.floor((instance - 1) / candidates.length);
	const shown = ordered.map((candidate, index) => ({
		letter: String.fromCharCode(65 + index),
		key: candidate.key,
		run: candidate.runs[turn % candidate.runs.length] ?? candidate.runs[0],
	}));

	const payload = {
		subtopics: division.blocks.map((block, index) => ({ id: index + 1, text: block.content.trim() })),
		candidates: shown.map(({ letter, run }) => ({ letter, topics: run?.topics ?? [] })),
	};
	const config = await loadTrialConfig({ modelId: MODEL });
	const startedAt = performance.now();
	let verdict: string = VERDICT.ok;
	let reply = { content: "", promptTokens: null as number | null, completionTokens: null as number | null };
	try {
		reply = await callTrialModel({
			config,
			modelId: MODEL,
			messages: [
				{ role: "system", content: judge.prompt },
				{ role: "user", content: JSON.stringify(payload) },
			],
		});
	} catch (error: unknown) {
		verdict = threwVerdict(error);
	}
	const seconds = Math.round((performance.now() - startedAt) / 1000);

	let choice: { readonly letter: string; readonly key: string } | null = null;
	let why = "";
	if (verdict === VERDICT.ok && reply.content.length === 0) {
		verdict = VERDICT.empty;
	} else if (verdict === VERDICT.ok) {
		try {
			const parsed = JSON.parse(reply.content) as { choice?: unknown; why?: unknown };
			const picked = shown.find((candidate) => candidate.letter === parsed.choice);
			if (picked === undefined) {
				verdict = VERDICT.wrongShape;
			} else {
				choice = { letter: picked.letter, key: picked.key };
				why = typeof parsed.why === "string" ? parsed.why : "";
			}
		} catch {
			verdict = VERDICT.unparseable;
		}
	}

	const stem = `judge-${judge.id}-${groupVersion}-${lecture}-${instance}`;
	await writeFile(join(OUT_DIR, `${stem}.raw.json`), reply.content, "utf8");
	const outcome = {
		lecture,
		groupVersion,
		judgeVersion: judge.id,
		instance,
		modelId: MODEL,
		seconds,
		promptTokens: reply.promptTokens,
		completionTokens: reply.completionTokens,
		verdict,
		shown: shown.map(({ letter, key, run }) => ({ letter, key, fromRun: run?.instance ?? null })),
		runsPerCandidate: Object.fromEntries(candidates.map((candidate) => [candidate.key, candidate.runs.length])),
		chosenKey: choice?.key ?? null,
		why,
	};
	await writeFile(join(OUT_DIR, `${stem}.outcome.json`), JSON.stringify(outcome, null, 2), "utf8");
	console.log(`${stem.padEnd(24)} ${String(seconds).padStart(3)}s chose ${choice?.key ?? "-"} ${verdict}`);
}

await main();
