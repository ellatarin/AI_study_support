import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	createOpenRouterClientProvider,
	makeCompletionCall,
} from "/Users/ellatarin/my_repositories/Ella_AI_project/src/pipeline/openrouter.js";
import { createRootLogger } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/utils/logger.js";
import { applyCuts, judgeFidelity } from "./cut-blocks.mts";
import { splitPromptVersion } from "./split-prompts.mts";
import {
	BORROWED_STAGE_ID,
	callTrialModel,
	loadTrialConfig,
	OUT_DIR,
	PROJECT_ROOT,
} from "./trial-model.mts";

const MODEL = process.env["TRIAL_MODEL"] ?? "google/gemini-3.7-flash";

/** The prototype's full rules block — the long system prompt under suspicion. */
const LONG_PROMPT = `You are dividing a university lecture transcript into topic blocks.

A block is a stretch of the lecture in which the lecturer is dealing with one subject. A new block begins where the subject matter changes.

Decide where the subject changes by reading what is being talked about. Do NOT rely on the speaker announcing a change. This lecturer says "So", "Right", and "Okay" constantly without changing subject, and several real changes of subject arrive with no announcement at all. The words are not the signal; the subject is.

Do not decide in advance how many blocks there should be. Divide the transcript wherever the subject genuinely changes, and let the number be whatever it turns out to be.

You are cutting the transcript, not editing it:
- Each block's "content" must be the transcript's own text, character for character. Add nothing, remove nothing, reword nothing, correct nothing, tidy nothing.
- Nothing may be left out. Concatenating every block's "content" in order must reproduce the entire transcript exactly.
- Passages you might consider unimportant — asides, admin, hesitation, applause, jokes — are transcript text like any other. They stay exactly where they fall, inside whichever block they land in. Do not separate them out and do not judge them.

Give each block a short descriptive label saying what it is about.

Reply with a single JSON object and nothing else, in this exact shape:

{
  "blocks": [
    { "id": 1, "label": "short description of the subject", "content": "the transcript text of this block, verbatim" }
  ]
}

"id" counts up from 1. Blocks appear in transcript order.`;

/**
 * The cut-positions prompt: the model says WHERE each block starts and the code
 * does the cutting, so the reply is a few hundred bytes rather than the whole
 * transcript and truncation cannot lose content.
 */
const CUTS_PROMPT = `You are dividing a university lecture transcript into topic blocks.

A block is a stretch of the lecture in which the lecturer is dealing with one subject. A new block begins where the subject matter changes.

Decide where the subject changes by reading what is being talked about. Do NOT rely on the speaker announcing a change. This lecturer says "So", "Right", and "Okay" constantly without changing subject, and several real changes of subject arrive with no announcement at all. The words are not the signal; the subject is.

Do not decide in advance how many blocks there should be. Divide the transcript wherever the subject genuinely changes, and let the number be whatever it turns out to be.

You are not reproducing the transcript. For each block you give only the first few words, so that the position of the cut can be found:
- "startsWith" must be the first EIGHT to TWELVE words of the block, copied from the transcript exactly as they appear. Do not tidy them, do not drop a leading "So" or "Right", do not change capitalisation, do not paraphrase. It is used to locate the cut, so it must match the transcript character for character.
- The first block begins at the very start of the transcript.
- Blocks are contiguous and in order: each block runs from its own start to the next block's start.

Give each block a short descriptive label saying what it is about.

Reply with a single JSON object and nothing else, in this exact shape:

{
  "blocks": [
    { "id": 1, "label": "short description of the subject", "startsWith": "the first eight to twelve words of this block, verbatim" }
  ]
}

"id" counts up from 1. Blocks appear in transcript order.`;

/**
 * VERSION 1 — the best output so far, kept verbatim as the reference every later
 * version is measured against. It produced run h4, which separated infectious
 * from chemical carcinogens, gave tumour promotion its own topic, and gave UV
 * its own subtopic. Do not edit this constant; add a new version instead.
 */
const HIER_PROMPT_V1 = `You are dividing a university lecture transcript into topics, and each topic into subtopics.

A TOPIC is a major division of the lecture — one of the handful of things the lecture is about.
A SUBTOPIC is a distinct step within a topic: a single claim developed, a mechanism explained, an example worked through.

Decide where topics and subtopics change by reading what is being talked about. Do NOT rely on the speaker announcing a change. This lecturer says "So", "Right", and "Okay" constantly without changing subject, and several real changes of subject arrive with no announcement at all. The words are not the signal; the subject is.

Do not decide in advance how many topics or subtopics there should be. Divide wherever the subject genuinely changes, and let the numbers be whatever they turn out to be. Every topic has at least one subtopic; a short topic may have exactly one.

You are not reproducing the transcript. Only subtopics carry a position, and a topic begins where its first subtopic begins:
- "startsWith" must be the first EIGHT to TWELVE words of the subtopic, copied from the transcript exactly as they appear. Do not tidy them, do not drop a leading "So" or "Right", do not change capitalisation, do not paraphrase. It is used to locate the cut, so it must match the transcript character for character.
- The first subtopic of the first topic begins at the very start of the transcript.
- Subtopics are contiguous and in order, and together they cover the whole transcript.

Work from the bottom up. Find and label the subtopics first, from the transcript. Only then name each topic, and name it FROM ITS OWN SUBTOPICS:
- A topic's label must describe what its subtopics have in common, as a reader of those subtopic labels would summarise them.
- Do not introduce into a topic label any idea that none of its subtopics carries, and do not name a topic from what you expect a lecture on this subject to contain. If the subtopics do not support a tidy heading, give an untidy one that fits them.

Give every subtopic a short descriptive label taken from what the transcript actually says there.

Reply with a single JSON object and nothing else, in this exact shape:

{
  "topics": [
    {
      "id": 1,
      "label": "what these subtopics have in common",
      "subtopics": [
        { "id": 1, "label": "what this subtopic is about", "startsWith": "the first eight to twelve words, verbatim" }
      ]
    }
  ]
}

Ids count up from 1 within their own list. Topics and subtopics appear in transcript order.`;

/**
 * VERSION 2 — version 1 plus four changes, each aimed at a fault found by
 * reading the six version-1 runs:
 *  - a "different in kind" rule, since every over-grouping complaint (pathogens
 *    with chemicals, UV with aflatoxin, in vivo with in vitro) was the same
 *    fault, with a carve-out so a thing and its mechanism stay together
 *  - a stated reason for each grouping, since the failure is over-grouping and a
 *    grab-bag is hard to justify in a sentence
 *  - an instructed re-read of each subtopic
 *  - the lecture's opening framing named as its own division, which no
 *    version-1 run separated
 */
const HIER_PROMPT_V2 = `You are dividing a university lecture transcript into topics, and each topic into subtopics.

A TOPIC is a major division of the lecture — one of the handful of things the lecture is about.
A SUBTOPIC is a distinct step within a topic: a single claim developed, a mechanism explained, an example worked through.

Decide where topics and subtopics change by reading what is being talked about. Do NOT rely on the speaker announcing a change. This lecturer says "So", "Right", and "Okay" constantly without changing subject, and several real changes of subject arrive with no announcement at all. The words are not the signal; the subject is.

Do not decide in advance how many topics or subtopics there should be. Divide wherever the subject genuinely changes, and let the numbers be whatever they turn out to be. Every topic has at least one subtopic; a short topic may have exactly one.

THINGS THAT DIFFER IN KIND DO NOT SHARE A HEADING.
Do not put under one heading things that differ in kind, even when the lecturer treats them one after another and for the same purpose. A biological agent and a chemical agent differ in kind. A physical agent such as radiation and a chemical one differ in kind. An experiment in living animals and one in cultured cells differ in kind. Serving the same argument does not make two things one subject, and neither does being adjacent in the lecture.
This does NOT apply to a thing and its own mechanism: an agent and the damage it causes, or a process and the molecular change it produces, are one subject and belong together.

THE OPENING IS ITS OWN DIVISION.
A lecture opens with framing that is not yet its subject: welcome, learning outcomes, what the lecture will cover, how it relates to other lectures. That opening is its own division, separate from the first substantive topic. Do not fold it into the first thing the lecturer actually teaches.

Work from the bottom up. Find and label the subtopics first, from the transcript. Only then name each topic, and name it FROM ITS OWN SUBTOPICS:
- A topic's label must describe what its subtopics have in common, as a reader of those subtopic labels would summarise them.
- Do not introduce into a topic label any idea that none of its subtopics carries, and do not name a topic from what you expect a lecture on this subject to contain. If the subtopics do not support a tidy heading, give an untidy one that fits them.

Give every subtopic a short descriptive label taken from what the transcript actually says there.

SAY WHY EACH GROUPING HOLDS.
Every topic and every subtopic carries a "groupedBecause": one sentence saying what makes its contents one thing. Write it honestly. If the most you can say is that these were discussed together, or that they are all examples of something broad, then it is not one grouping and you must divide it.

THEN READ IT AGAIN.
When you have divided the transcript, read each subtopic once more and ask whether the lecturer changes subject inside it. If so, split it. Do the same for each topic and its subtopics.

You are not reproducing the transcript. Only subtopics carry a position, and a topic begins where its first subtopic begins:
- "startsWith" must be the first EIGHT to TWELVE words of the subtopic, copied from the transcript exactly as they appear. Do not tidy them, do not drop a leading "So" or "Right", do not change capitalisation, do not paraphrase. It is used to locate the cut, so it must match the transcript character for character.
- The first subtopic of the first topic begins at the very start of the transcript.
- Subtopics are contiguous and in order, and together they cover the whole transcript.

Reply with a single JSON object and nothing else, in this exact shape:

{
  "topics": [
    {
      "id": 1,
      "label": "what these subtopics have in common",
      "groupedBecause": "one sentence on what makes these subtopics one topic",
      "subtopics": [
        {
          "id": 1,
          "label": "what this subtopic is about",
          "groupedBecause": "one sentence on what makes this passage one subtopic",
          "startsWith": "the first eight to twelve words, verbatim"
        }
      ]
    }
  ]
}

Ids count up from 1 within their own list. Topics and subtopics appear in transcript order.`;

/**
 * VERSION 3 — version 2 with ONE change: the "different in kind" rule now binds
 * subtopics only, and topics are told explicitly that they may span kinds.
 *
 * In version 2 the rule bound both levels, and the result was topic-level
 * fragmentation: UV, aflatoxin, and the two kinds of carcinogenicity test each
 * got promoted to a topic of its own, so half the runs produced 13–14 topics
 * over ~21 subtopics and the topic level stopped grouping anything. Nothing else
 * is changed, so any difference is attributable to this.
 *
 * The text now lives in `split-prompts.mts` as version `s1`, so pass one is
 * versioned the way pass two is. It moved there character for character, and
 * `mode === "hierv3"` still sends exactly what every archived `hierv3-*` run was
 * sent. New pass-one work goes through `split-trial.mts`; this mode stays so the
 * archived runs remain reproducible.
 */
const HIER_PROMPT_V3 = splitPromptVersion({ id: "s1" }).build();

/**
 * Three levels, with only the deepest carrying a position and every label built
 * from the level below it, so no heading can name something its own contents do
 * not contain.
 */
const HIER3_PROMPT = `You are dividing a university lecture transcript into three levels: topics, subtopics within them, and sub-subtopics within those.

A SUB-SUBTOPIC is the finest division: one thing the lecturer says and finishes — a single claim made, a mechanism explained, one example worked through, one number given and glossed.
A SUBTOPIC groups the sub-subtopics that belong to one line of argument.
A TOPIC groups the subtopics that make up one major division of the lecture.

Decide where each level changes by reading what is being talked about. Do NOT rely on the speaker announcing a change. This lecturer says "So", "Right", and "Okay" constantly without changing subject, and several real changes of subject arrive with no announcement at all. The words are not the signal; the subject is.

Do not decide in advance how many of anything there should be. Divide wherever the subject genuinely changes, and let the numbers be whatever they turn out to be. Every topic has at least one subtopic; every subtopic has at least one sub-subtopic; a short one may have exactly one.

WORK FROM THE BOTTOM UP, and build every label from the level beneath it:
1. First find the sub-subtopics and label each from what the transcript actually says there.
2. Then group them into subtopics, and label each subtopic by what ITS OWN sub-subtopics have in common.
3. Then group those into topics, and label each topic by what ITS OWN subtopics have in common.

At every level, do not introduce into a label any idea that nothing beneath it carries, and never name a division from what you expect a lecture on this subject to contain. If the parts do not support a tidy heading, give an untidy one that fits them.

Only sub-subtopics carry a position. A subtopic begins where its first sub-subtopic begins, and a topic begins where its first subtopic begins:
- "startsWith" must be the first EIGHT to TWELVE words of the sub-subtopic, copied from the transcript exactly as they appear. Do not tidy them, do not drop a leading "So" or "Right", do not change capitalisation, do not paraphrase. It is used to locate the cut, so it must match the transcript character for character.
- The first sub-subtopic of the first subtopic of the first topic begins at the very start of the transcript.
- Sub-subtopics are contiguous and in order, and together they cover the whole transcript.

Reply with a single JSON object and nothing else, in this exact shape:

{
  "topics": [
    {
      "id": 1,
      "label": "what these subtopics have in common",
      "subtopics": [
        {
          "id": 1,
          "label": "what these sub-subtopics have in common",
          "subsubtopics": [
            { "id": 1, "label": "what the transcript says here", "startsWith": "the first eight to twelve words, verbatim" }
          ]
        }
      ]
    }
  ]
}

Ids count up from 1 within their own list. Everything appears in transcript order.`;

/** The probe's terse prompt — the one that appeared to succeed. */
const SHORT_PROMPT =
	'Split the transcript into topic blocks. Reply with JSON {"blocks":[{"id":1,"label":"...","content":"verbatim text"}]}. Content must be the transcript verbatim; concatenating all blocks must reproduce it exactly.';

type Outcome = {
	readonly mode: string;
	readonly instance: string;
	readonly seconds: number;
	readonly promptTokens: number | null;
	readonly completionTokens: number | null;
	readonly contentLength: number;
	readonly finishReason: string | null;
	readonly verdict: string;
	readonly blocks: number | null;
	readonly fidelity: string | null;
};

async function main(): Promise<void> {
	const mode = process.argv[2] ?? "probe";
	const instance = process.argv[3] ?? "0";
	await mkdir(OUT_DIR, { recursive: true });

	const transcriptPath =
		process.argv[4] ?? join(PROJECT_ROOT, "docs/quality/2026-08-31-lecture-3-transcript.txt");
	const transcriptText = (await readFile(transcriptPath, "utf8")).trim();
	const config = await loadTrialConfig({ modelId: MODEL });

	// Only "prototype" goes through the pipeline's own wrapper; every other mode
	// calls the SDK directly, because the wrapper hides provider and finish_reason
	// and those are what this trial is measuring.
	const usesLongPrompt = mode === "prototype";
	const systemPrompt =
		mode === "hier3"
			? HIER3_PROMPT
			: mode === "hierv3"
			? HIER_PROMPT_V3
			: mode === "hierv2"
			? HIER_PROMPT_V2
			: mode === "hier"
			? HIER_PROMPT_V1
			: mode === "cuts"
				? CUTS_PROMPT
				: mode === "content" || usesLongPrompt
					? LONG_PROMPT
					: SHORT_PROMPT;
	/** An explicit output ceiling, when given, to test whether omitting it invites a low provider default. */
	const explicitMaxTokens =
		process.argv[5] === undefined ? undefined : Number.parseInt(process.argv[5], 10);
	const messages = [
		{ role: "system" as const, content: systemPrompt },
		{ role: "user" as const, content: `Transcript:\n${transcriptText}` },
	];

	const startedAt = performance.now();
	let content = "";
	let promptTokens: number | null = null;
	let completionTokens: number | null = null;
	let finishReason: string | null = null;
	let provider: string | null = null;
	let nativeFinish: string | null = null;
	let verdict = "OK";

	try {
		if (usesLongPrompt) {
			// The pipeline's own path: makeCompletionCall, which hides finish_reason.
			const logger = createRootLogger({ logFile: join(OUT_DIR, `${mode}-${instance}.log`) });
			const client = createOpenRouterClientProvider({ openRouter: config.openRouter });
			const result = await makeCompletionCall({
				messages,
				stageId: BORROWED_STAGE_ID,
				config,
				responseFormat: "json",
				logger,
				client,
			});
			content = result.content;
			promptTokens = result.cost.promptTokens;
			completionTokens = result.cost.completionTokens;
		} else {
			// The probe's path: the SDK directly, so the whole response is visible.
			const reply = await callTrialModel({
				config,
				modelId: MODEL,
				messages,
				maxTokens: explicitMaxTokens,
			});
			content = reply.content;
			promptTokens = reply.promptTokens;
			completionTokens = reply.completionTokens;
			finishReason = reply.finishReason;
			nativeFinish = reply.nativeFinishReason;
			provider = reply.provider;
		}
	} catch (error: unknown) {
		verdict = `THREW: ${String(error).slice(0, 120)}`;
	}

	const seconds = Math.round((performance.now() - startedAt) / 1000);
	await writeFile(join(OUT_DIR, `${mode}-${instance}.raw.json`), content, "utf8");

	let blocks: number | null = null;
	let fidelity: string | null = null;
	/** The blocks as finally constituted, whichever mode produced them, for rendering. */
	let rendered: readonly {
		label: string;
		content: string;
		topicLabel?: string;
		subtopicLabel?: string;
		topicWhy?: string;
		why?: string;
		opensTopic?: boolean;
		opensSubtopic?: boolean;
	}[] = [];
	/** How many topics the hierarchical modes found; null for the flat modes. */
	let topics: number | null = null;
	/** How many subtopics the three-level mode found; null otherwise. */
	let subtopics: number | null = null;
	if (verdict === "OK") {
		if (content.length === 0) {
			verdict = "EMPTY";
		} else {
			try {
				if (mode === "hier3") {
					const parsed = JSON.parse(content) as {
						topics?: readonly {
							label: string;
							subtopics?: readonly {
								label: string;
								subsubtopics?: readonly { label: string; startsWith: string }[];
							}[];
						}[];
					};
					if (!Array.isArray(parsed.topics)) {
						verdict = "SHAPE";
					} else {
						const flat = parsed.topics.flatMap((topic) =>
							(topic.subtopics ?? []).flatMap((subtopic, subIndex) =>
								(subtopic.subsubtopics ?? []).map((leaf, leafIndex) => ({
									id: 0,
									label: leaf.label,
									startsWith: leaf.startsWith,
									topicLabel: topic.label,
									subtopicLabel: subtopic.label,
									opensTopic: subIndex === 0 && leafIndex === 0,
									opensSubtopic: leafIndex === 0,
								})),
							),
						);
						const { blocks: cut, misses } = applyCuts(transcriptText, flat);
						blocks = cut.length;
						rendered = cut.map((block, index) => ({
							...block,
							topicLabel: flat[index]?.topicLabel ?? "",
							subtopicLabel: flat[index]?.subtopicLabel ?? "",
							opensTopic: flat[index]?.opensTopic ?? false,
							opensSubtopic: flat[index]?.opensSubtopic ?? false,
						}));
						topics = parsed.topics.length;
						subtopics = parsed.topics.reduce(
							(total, topic) => total + (topic.subtopics?.length ?? 0),
							0,
						);
						fidelity =
							misses.length === 0
								? judgeFidelity(transcriptText, cut)
								: `${judgeFidelity(transcriptText, cut)} MISSED:${misses.length}`;
					}
				} else if (mode === "hier" || mode === "hierv2" || mode === "hierv3") {
					const parsed = JSON.parse(content) as {
						topics?: readonly {
							label: string;
							groupedBecause?: string;
							subtopics?: readonly {
								label: string;
								groupedBecause?: string;
								startsWith: string;
							}[];
						}[];
					};
					if (!Array.isArray(parsed.topics)) {
						verdict = "SHAPE";
					} else {
						// Flattened to one ordered list of cuts; the hierarchy is carried
						// alongside as labels, so the cutting stays a single operation.
						const flat = parsed.topics.flatMap((topic, topicIndex) =>
							(topic.subtopics ?? []).map((sub, subIndex) => ({
								id: 0,
								label: sub.label,
								startsWith: sub.startsWith,
								topicIndex,
								topicLabel: topic.label,
								topicWhy: topic.groupedBecause ?? "",
								why: sub.groupedBecause ?? "",
								opensTopic: subIndex === 0,
							})),
						);
						const { blocks: cut, misses } = applyCuts(transcriptText, flat);
						blocks = cut.length;
						rendered = cut.map((block, index) => ({
							...block,
							topicLabel: flat[index]?.topicLabel ?? "",
							topicWhy: flat[index]?.topicWhy ?? "",
							why: flat[index]?.why ?? "",
							opensTopic: flat[index]?.opensTopic ?? false,
						}));
						topics = parsed.topics.length;
						fidelity =
							misses.length === 0
								? judgeFidelity(transcriptText, cut)
								: `${judgeFidelity(transcriptText, cut)} MISSED:${misses.length}`;
					}
				} else if (mode === "cuts") {
					const parsed = JSON.parse(content) as {
						blocks?: readonly { id: number; label: string; startsWith: string }[];
					};
					if (!Array.isArray(parsed.blocks)) {
						verdict = "SHAPE";
					} else {
						const { blocks: cut, misses } = applyCuts(transcriptText, parsed.blocks);
						blocks = cut.length;
						rendered = cut;
						fidelity =
							misses.length === 0
								? judgeFidelity(transcriptText, cut)
								: `${judgeFidelity(transcriptText, cut)} MISSED:${misses.length}`;
					}
				} else {
					const parsed = JSON.parse(content) as {
						blocks?: readonly { label: string; content: string }[];
					};
					blocks = Array.isArray(parsed.blocks) ? parsed.blocks.length : null;
					verdict = blocks === null ? "SHAPE" : "OK";
					if (parsed.blocks !== undefined) {
						rendered = parsed.blocks;
						fidelity = judgeFidelity(transcriptText, parsed.blocks);
					}
				}
			} catch {
				verdict = "PARSE-FAIL";
			}
		}
	}

	const outcome: Outcome = {
		mode,
		instance,
		seconds,
		promptTokens,
		completionTokens,
		contentLength: content.length,
		finishReason,
		verdict,
		blocks,
		fidelity,
	};
	await writeFile(
		join(OUT_DIR, `${mode}-${instance}.outcome.json`),
		JSON.stringify(outcome, null, 2),
		"utf8",
	);
	if (rendered.length > 0) {
		await writeFile(
			join(OUT_DIR, `${mode}-${instance}.blocks.json`),
			JSON.stringify(
				{ ...outcome, topics, subtopics, transcriptPath, blocks: rendered },
				null,
				2,
			),
			"utf8",
		);
	}
	console.log(
		`${mode.padEnd(8)}#${instance.padEnd(3)} ${String(seconds).padStart(3)}s ` +
			`prov=${(provider ?? "-").padEnd(18)} ` +
			`out=${String(completionTokens ?? "-").padStart(6)} len=${String(content.length).padStart(6)} ` +
			`finish=${String(finishReason ?? "-").padEnd(6)}/${(nativeFinish ?? "-").padEnd(10)} ` +
			`t=${String(topics ?? "-").padStart(3)} s=${String(subtopics ?? "-").padStart(3)} ` +
			`leaves=${String(blocks ?? "-").padStart(3)} ` +
			`${verdict} ${fidelity ?? ""}`,
	);
}

await main();
