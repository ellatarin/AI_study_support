/**
 * Pass one: cutting the transcript into subtopics, with the prompt versioned.
 *
 * The same harness `failure-trial.mts` provides for the archived modes, but
 * driven by `split-prompts.mts` rather than by a mode name — so a pass-one
 * prompt can be revised and measured the way a pass-two prompt already can.
 * Every run records which version produced it and which lecture it was made
 * against, and both go into the filename, so two lectures' runs can never
 * overwrite one another.
 *
 * The topic layer the model returns is kept for reference but is not the point:
 * `group-trial.mts` throws it away and groups the subtopics itself.
 *
 * Usage:
 *   TRIAL_MODEL=google/gemini-3.7-flash \
 *     pnpm exec tsx split-trial.mts <version> <transcript-path> <instance>
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { applyCuts, judgeFidelity, type Miss } from "./cut-blocks.mts";
import { lectureKeyFor } from "./lecture-key.mts";
import { splitPromptVersion } from "./split-prompts.mts";
import {
	callTrialModel,
	loadTrialConfig,
	OUT_DIR,
	threwVerdict,
	VERDICT,
} from "./trial-model.mts";

const MODEL = process.env["TRIAL_MODEL"] ?? "google/gemini-3.7-flash";

/**
 * How many times the transcript is sent before a run keeps a division with a
 * boundary missing from it.
 *
 * A quote the model mis-copies cannot be located, and the boundary it named is
 * then dropped — silently, since the run simply comes back with one section
 * fewer. Measured over every pass-one run made: 10 boundaries lost out of 2,713
 * asked for, never more than one in a run. Asking again costs one call and
 * restores the whole division, which is worth more than the independence a
 * re-ask gives up: the vote is over runs, and a run missing a boundary votes
 * wrongly on it.
 */
const MAX_ATTEMPTS = 3;

/** What one run is worth knowing about, without opening its blocks. */
type SplitOutcome = {
	readonly promptVersion: string;
	readonly lecture: string;
	readonly instance: string;
	readonly modelId: string;
	readonly transcriptPath: string;
	readonly seconds: number;
	readonly promptTokens: number | null;
	readonly completionTokens: number | null;
	readonly finishReason: string | null;
	readonly verdict: string;
	/** How many topics the model proposed. Pass two discards these and regroups. */
	readonly topics: number | null;
	readonly subtopics: number | null;
	readonly fidelity: string | null;
	/** How many times the transcript was sent; more than one means a quote could not be placed. */
	readonly attempts: number;
	/** What was wrong with the quotes this run never placed, on the attempt it kept. */
	readonly unplaced: readonly Miss[];
};

/** One subtopic as the model returns it: a label, a reason, and where it starts. */
type ReplySubtopic = {
	readonly label: string;
	readonly groupedBecause?: string;
	readonly startsWith: string;
};

/** One topic as the model returns it. Its position comes from its first subtopic. */
type ReplyTopic = {
	readonly label: string;
	readonly groupedBecause?: string;
	readonly subtopics?: readonly ReplySubtopic[];
};

/**
 * The reply's shape, as far as this harness reads it.
 *
 * Two shapes, because the versions differ in what they are asked for: up to s2
 * the model returns topics each holding subtopics, and from s3 it returns the
 * subtopics alone. Both reduce to the same ordered list of cuts.
 */
type SplitReply = {
	readonly topics?: readonly ReplyTopic[];
	readonly subtopics?: readonly ReplySubtopic[];
};

/** Stands in for a topic that came back with no subtopics, so the flatten still types. */
const NO_SUBTOPICS: readonly ReplySubtopic[] = [];

/** One cut: where a subtopic starts, and the labels that ride along with it. */
type Cut = {
	readonly id: number;
	readonly label: string;
	readonly startsWith: string;
	readonly topicLabel: string;
	readonly topicWhy: string;
	readonly why: string;
	readonly opensTopic: boolean;
};

/**
 * Reduce either reply shape to one ordered list of cuts.
 *
 * Flattening rather than branching downstream keeps the cutting a single
 * operation over the whole transcript, which is what makes it impossible to
 * leave a gap between two divisions. A reply with no topic layer carries empty
 * topic labels, and every subtopic opens its own "topic", so a renderer built
 * for the two-level shape still has something coherent to show.
 *
 * @param options - Options object.
 * @param options.parsed - The model's reply, in whichever shape it came back.
 * @returns The cuts, or null when the reply carries neither shape.
 */
function toCuts({ parsed }: { readonly parsed: SplitReply }): readonly Cut[] | null {
	if (Array.isArray(parsed.subtopics)) {
		const subtopics: readonly ReplySubtopic[] = parsed.subtopics;
		return subtopics.map((subtopic, index) => ({
			id: index,
			label: subtopic.label,
			startsWith: subtopic.startsWith,
			topicLabel: "",
			topicWhy: "",
			why: subtopic.groupedBecause ?? "",
			opensTopic: true,
		}));
	}
	if (!Array.isArray(parsed.topics)) {
		return null;
	}
	const topics: readonly ReplyTopic[] = parsed.topics;
	return topics.flatMap((topic, topicIndex) =>
		(topic.subtopics ?? NO_SUBTOPICS).map((subtopic, subIndex) => ({
			id: topicIndex,
			label: subtopic.label,
			startsWith: subtopic.startsWith,
			topicLabel: topic.label,
			topicWhy: topic.groupedBecause ?? "",
			why: subtopic.groupedBecause ?? "",
			opensTopic: subIndex === 0,
		})),
	);
}

/** One block as the page and the ledger read it: the text, with why it is here. */
type RenderedBlock = {
	label: string;
	content: string;
	topicLabel: string;
	topicWhy: string;
	why: string;
	opensTopic: boolean;
};

/** What one send of the transcript produced. */
type Attempt = {
	readonly reply: Awaited<ReturnType<typeof callTrialModel>>;
	readonly verdict: string;
	readonly topics: number | null;
	readonly subtopics: number | null;
	readonly fidelity: string | null;
	readonly blocks: readonly RenderedBlock[];
	readonly misses: readonly Miss[];
};

/** The reply every attempt starts from, and what a failed call leaves behind. */
const NO_REPLY = {
	content: "",
	promptTokens: null as number | null,
	completionTokens: null as number | null,
	finishReason: null as string | null,
	nativeFinishReason: null as string | null,
	provider: null as string | null,
};

/**
 * Sends the transcript once and cuts it at whatever came back.
 *
 * @param options - Options object.
 * @param options.config - The config carrying the OpenRouter credentials.
 * @param options.systemPrompt - The splitting prompt for this version.
 * @param options.transcriptText - The transcript to divide.
 * @returns What this send produced, including the quotes it could not place.
 */
async function attemptSplit({
	config,
	systemPrompt,
	transcriptText,
}: {
	readonly config: Awaited<ReturnType<typeof loadTrialConfig>>;
	readonly systemPrompt: string;
	readonly transcriptText: string;
}): Promise<Attempt> {
	const nothingCut = { topics: null, subtopics: null, fidelity: null, blocks: [], misses: [] };
	let reply = NO_REPLY;
	try {
		reply = await callTrialModel({
			config,
			modelId: MODEL,
			messages: [
				{ role: "system", content: systemPrompt },
				{ role: "user", content: `Transcript:\n${transcriptText}` },
			],
		});
	} catch (error: unknown) {
		return { reply, verdict: threwVerdict(error), ...nothingCut };
	}
	if (reply.content.length === 0) {
		return { reply, verdict: VERDICT.empty, ...nothingCut };
	}
	let parsed: SplitReply;
	try {
		parsed = JSON.parse(reply.content) as SplitReply;
	} catch {
		return { reply, verdict: VERDICT.unparseable, ...nothingCut };
	}
	const flat = toCuts({ parsed });
	if (flat === null) {
		return { reply, verdict: VERDICT.wrongShape, ...nothingCut };
	}
	const { blocks, misses } = applyCuts(transcriptText, flat);
	const judged = judgeFidelity(transcriptText, blocks);
	return {
		reply,
		verdict: VERDICT.ok,
		// Null rather than zero for a version that was never asked for topics:
		// the ledger must be able to tell "none proposed" from "none found".
		topics: parsed.topics === undefined ? null : parsed.topics.length,
		subtopics: blocks.length,
		fidelity: misses.length === 0 ? judged : `${judged} MISSED:${misses.length}`,
		blocks: blocks.map((block, index) => ({
			...block,
			topicLabel: flat[index]?.topicLabel ?? "",
			topicWhy: flat[index]?.topicWhy ?? "",
			why: flat[index]?.why ?? "",
			opensTopic: flat[index]?.opensTopic ?? false,
		})),
		misses,
	};
}

async function main(): Promise<void> {
	const version = splitPromptVersion({ id: process.argv[2] ?? "s1" });
	const transcriptPath = process.argv[3];
	if (transcriptPath === undefined) {
		throw new Error("Usage: split-trial.mts <version> <transcript-path> <instance>");
	}
	const instance = process.argv[4] ?? "1";
	const lecture = lectureKeyFor({ transcriptPath });
	await mkdir(OUT_DIR, { recursive: true });

	const transcriptText = (await readFile(transcriptPath, "utf8")).trim();
	const config = await loadTrialConfig({ modelId: MODEL });

	const startedAt = performance.now();
	// The transcript goes back whenever a quote could not be placed: the division
	// that comes back short of a boundary is not a division of this lecture, and
	// keeping it would cost that boundary a vote it should have had.
	let attempt = await attemptSplit({ config, systemPrompt: version.build(), transcriptText });
	let attempts = 1;
	while (attempt.misses.length > 0 && attempts < MAX_ATTEMPTS) {
		attempt = await attemptSplit({ config, systemPrompt: version.build(), transcriptText });
		attempts += 1;
	}
	const seconds = Math.round((performance.now() - startedAt) / 1000);

	const { reply, verdict } = attempt;
	const stem = `split-${version.id}-${lecture}-${instance}`;
	await writeFile(join(OUT_DIR, `${stem}.raw.json`), reply.content, "utf8");
	const rendered = attempt.blocks;

	const outcome: SplitOutcome = {
		promptVersion: version.id,
		lecture,
		instance,
		modelId: MODEL,
		transcriptPath,
		seconds,
		promptTokens: reply.promptTokens,
		completionTokens: reply.completionTokens,
		finishReason: reply.finishReason,
		verdict,
		topics: attempt.topics,
		subtopics: attempt.subtopics,
		fidelity: attempt.fidelity,
		attempts,
		unplaced: attempt.misses,
	};
	await writeFile(join(OUT_DIR, `${stem}.outcome.json`), JSON.stringify(outcome, null, 2), "utf8");
	if (rendered.length > 0) {
		await writeFile(
			join(OUT_DIR, `${stem}.blocks.json`),
			JSON.stringify({ ...outcome, blocks: rendered }, null, 2),
			"utf8",
		);
	}
	console.log(
		`${stem.padEnd(20)} ${String(seconds).padStart(3)}s ` +
			`prov=${(reply.provider ?? "-").padEnd(14)} ` +
			`in=${String(reply.promptTokens ?? "-").padStart(6)} out=${String(reply.completionTokens ?? "-").padStart(6)} ` +
			`t=${String(attempt.topics ?? "-").padStart(3)} s=${String(attempt.subtopics ?? "-").padStart(3)} ` +
			`asked=${attempts} ` +
			`${verdict} ${attempt.fidelity ?? ""}`,
	);
}

await main();
