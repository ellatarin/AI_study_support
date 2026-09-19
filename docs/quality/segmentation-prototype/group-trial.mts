/**
 * Pass two: grouping subtopics into topics as a separate model call.
 *
 * Pass one (`failure-trial.mts` in a hierarchical mode) cuts the transcript into
 * subtopics. This script throws that run's topic layer away, hands the model the
 * subtopics ALONE — each with its full text — and asks only for the grouping.
 * The two decisions that currently share one call are thereby separated, so the
 * unstable one can be prompted and measured on its own.
 *
 * The model never returns transcript text: it names the subtopic each topic
 * starts at, and the code rebuilds the blocks from pass one's own slices. A
 * topic boundary can therefore only ever fall on a subtopic boundary, and the
 * transcript reaching the page is still the transcript.
 *
 * Usage:
 *   TRIAL_MODEL=google/gemini-3.7-flash \
 *     pnpm exec tsx group-trial.mts <source-run> <version> <instance> [nolabels]
 * where <source-run> is a blocks.json stem in runs/, e.g. "hierv3-w1", and
 * <version> is a grouping prompt id from `group-prompts.mts`, e.g. "g3".
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { groupPromptVersion } from "./group-prompts.mts";
import { lectureKeyFor } from "./lecture-key.mts";
import {
	callTrialModel,
	loadTrialConfig,
	OUT_DIR,
	threwVerdict,
	VERDICT,
} from "./trial-model.mts";

const MODEL = process.env["TRIAL_MODEL"] ?? "google/gemini-3.7-flash";

/** A subtopic as pass one left it: its label and the transcript it owns. */
type SourceSubtopic = {
	readonly label: string;
	readonly content: string;
	readonly why: string;
};

/** What pass one wrote, of which only the subtopic layer is read. */
type SourceRun = {
	readonly transcriptPath?: string;
	/** Written by `split-trial.mts`; absent from runs made before the key existed. */
	readonly lecture?: string;
	readonly blocks: readonly {
		readonly label: string;
		readonly content: string;
		readonly why?: string;
	}[];
};

type GroupOutcome = {
	readonly sourceRun: string;
	readonly promptVersion: string;
	/** Which lecture this grouping is of. Numbers are only comparable within one. */
	readonly lecture: string;
	readonly instance: string;
	readonly modelId: string;
	readonly labelsShown: boolean;
	readonly seconds: number;
	readonly promptTokens: number | null;
	readonly completionTokens: number | null;
	readonly finishReason: string | null;
	readonly verdict: string;
	readonly topics: number | null;
	readonly subtopics: number;
	readonly topicSizes: readonly number[];
};

/**
 * Turn the model's topic starts into one topic index per subtopic.
 *
 * @param options - Options object.
 * @param options.starts - The `firstSubtopicId` of each topic, as returned.
 * @param options.subtopicCount - How many subtopics pass one produced.
 * @returns The topic index of each subtopic, or a reason the grouping is unusable.
 */
function assignTopics({
	starts,
	subtopicCount,
}: {
	readonly starts: readonly number[];
	readonly subtopicCount: number;
}): { readonly ok: true; readonly owners: readonly number[] } | { readonly ok: false; readonly why: string } {
	if (starts.length === 0) {
		return { ok: false, why: "no topics" };
	}
	if (starts[0] !== 1) {
		return { ok: false, why: `first topic starts at ${String(starts[0])}, not 1` };
	}
	for (let index = 1; index < starts.length; index += 1) {
		const previous = starts[index - 1] ?? 0;
		const current = starts[index] ?? 0;
		if (current <= previous) {
			return { ok: false, why: `topic starts not ascending at ${String(current)}` };
		}
		if (current > subtopicCount) {
			return { ok: false, why: `topic starts at ${String(current)}, past subtopic ${String(subtopicCount)}` };
		}
	}
	const owners: number[] = [];
	let topicIndex = 0;
	for (let id = 1; id <= subtopicCount; id += 1) {
		const nextStart = starts[topicIndex + 1];
		if (nextStart !== undefined && id >= nextStart) {
			topicIndex += 1;
		}
		owners.push(topicIndex);
	}
	return { ok: true, owners };
}

async function main(): Promise<void> {
	const sourceRun = process.argv[2] ?? "hierv3-w1";
	const version = groupPromptVersion({ id: process.argv[3] ?? "g3" });
	const instance = process.argv[4] ?? "1";
	// "nolabels" withholds pass one's subtopic labels, so the grouping is made on
	// the transcript alone. The labels are restored from pass one when the reply
	// comes back, so both variants produce the same document either way.
	const labelsShown = process.argv[5] !== "nolabels";
	await mkdir(OUT_DIR, { recursive: true });

	const source = JSON.parse(
		await readFile(join(OUT_DIR, `${sourceRun}.blocks.json`), "utf8"),
	) as SourceRun;
	// Pass one's own key when it recorded one; otherwise read back from the
	// transcript it cut, which every pass-one run has always written.
	const lecture =
		source.lecture ??
		(source.transcriptPath === undefined
			? "unknown"
			: lectureKeyFor({ transcriptPath: source.transcriptPath }));
	const subtopics: readonly SourceSubtopic[] = source.blocks.map((block) => ({
		label: block.label,
		content: block.content,
		why: block.why ?? "",
	}));

	// The whole transcript goes up, but carved into the subtopics pass one found:
	// the grouping is judged on the material, not on pass one's paraphrases.
	const payload = {
		subtopics: subtopics.map((subtopic, index) => ({
			id: index + 1,
			...(labelsShown ? { label: subtopic.label } : {}),
			text: subtopic.content.trim(),
		})),
	};
	const config = await loadTrialConfig({ modelId: MODEL });

	const startedAt = performance.now();
	let verdict: string = VERDICT.ok;
	let reply = {
		content: "",
		promptTokens: null as number | null,
		completionTokens: null as number | null,
		finishReason: null as string | null,
		nativeFinishReason: null as string | null,
		provider: null as string | null,
	};
	try {
		reply = await callTrialModel({
			config,
			modelId: MODEL,
			messages: [
				{ role: "system", content: version.build({ labelsShown }) },
				{ role: "user", content: JSON.stringify(payload) },
			],
		});
	} catch (error: unknown) {
		verdict = threwVerdict(error);
	}
	const seconds = Math.round((performance.now() - startedAt) / 1000);

	const stem = `group-${version.id}-${sourceRun}-${instance}`;
	await writeFile(join(OUT_DIR, `${stem}.raw.json`), reply.content, "utf8");

	let topicCount: number | null = null;
	let topicSizes: readonly number[] = [];
	let rendered: readonly {
		label: string;
		content: string;
		topicLabel: string;
		topicWhy: string;
		why: string;
		opensTopic: boolean;
	}[] = [];

	if (verdict === VERDICT.ok && reply.content.length === 0) {
		verdict = VERDICT.empty;
	} else if (verdict === VERDICT.ok) {
		try {
			const parsed = JSON.parse(reply.content) as {
				topics?: readonly {
					label: string;
					groupedBecause?: string;
					firstSubtopicId: number;
				}[];
			};
			if (!Array.isArray(parsed.topics)) {
				verdict = VERDICT.wrongShape;
			} else {
				const assignment = assignTopics({
					starts: parsed.topics.map((topic) => topic.firstSubtopicId),
					subtopicCount: subtopics.length,
				});
				if (!assignment.ok) {
					verdict = `INVALID: ${assignment.why}`;
				} else {
					topicCount = parsed.topics.length;
					const sizes = parsed.topics.map(
						(_topic, index) => assignment.owners.filter((owner) => owner === index).length,
					);
					topicSizes = sizes;
					rendered = subtopics.map((subtopic, index) => {
						const owner = assignment.owners[index] ?? 0;
						const topic = parsed.topics?.[owner];
						return {
							label: subtopic.label,
							content: subtopic.content,
							topicLabel: topic?.label ?? "",
							topicWhy: topic?.groupedBecause ?? "",
							why: subtopic.why,
							opensTopic: (assignment.owners[index - 1] ?? -1) !== owner,
						};
					});
					if (sizes.some((size) => size === 0)) {
						verdict = "INVALID: empty topic";
					}
				}
			}
		} catch {
			verdict = VERDICT.unparseable;
		}
	}

	const outcome: GroupOutcome = {
		sourceRun,
		promptVersion: version.id,
		lecture,
		instance,
		modelId: MODEL,
		labelsShown,
		seconds,
		promptTokens: reply.promptTokens,
		completionTokens: reply.completionTokens,
		finishReason: reply.finishReason,
		verdict,
		topics: topicCount,
		subtopics: subtopics.length,
		topicSizes,
	};
	await writeFile(join(OUT_DIR, `${stem}.outcome.json`), JSON.stringify(outcome, null, 2), "utf8");
	if (rendered.length > 0) {
		await writeFile(
			join(OUT_DIR, `${stem}.blocks.json`),
			JSON.stringify({ ...outcome, transcriptPath: source.transcriptPath, blocks: rendered }, null, 2),
			"utf8",
		);
	}
	console.log(
		`${stem.padEnd(24)} ${String(seconds).padStart(3)}s ` +
			`prov=${(reply.provider ?? "-").padEnd(14)} ` +
			`in=${String(reply.promptTokens ?? "-").padStart(6)} out=${String(reply.completionTokens ?? "-").padStart(6)} ` +
			`t=${String(topicCount ?? "-").padStart(3)} s=${String(subtopics.length).padStart(3)} ` +
			`sizes=${JSON.stringify(topicSizes)} ${verdict}`,
	);
}

await main();
