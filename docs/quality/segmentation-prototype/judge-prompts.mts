/**
 * The judge prompts, versioned.
 *
 * A judge is a second model call made after a panel of grouping runs: it is
 * given the subtopics and the distinct groupings the runs proposed, and picks
 * one. Counting runs cannot do better than the runs' majority; reading the
 * alternatives side by side might. A version is never edited once it has runs
 * against it — add the next id instead.
 */

import { TOPIC_IS_ONE_OF_A_HANDFUL, WHAT_DECIDES_A_BORDER } from "./group-prompts.mts";

/** A judge prompt version, with the record of what it changed and why. */
export type JudgePromptVersion = {
	/** Short id used on the command line and in every run file. */
	readonly id: string;
	/** What this version is, in one line. */
	readonly summary: string;
	/** What changed from the previous version. */
	readonly changed: string;
	/** The system prompt. */
	readonly prompt: string;
};

/**
 * j1. The judge is told to weigh the arrangements rather than the prose of their
 * reasons, because on lectures 4 and 5 the groupings the user ruled against
 * carried the tidier single-subject reasons and the ruled ones read as lists.
 */
const J1 = `# Task

You are given the subtopics of a university lecture, in order, each with its full text and an \`id\`. You are also given two or more candidate arrangements of those subtopics into TOPICS, each produced independently. Choose the candidate whose topics best match how the lecture itself is organised.

## What a topic is

A **topic** is a major division of the lecture: a run of consecutive subtopics that belong together.

## How to judge

1. Find where the candidates differ: the subtopics that one candidate places in a different topic from another.
2. Read those subtopics, and the subtopics either side of them, in full.
3. Decide which topic each of them belongs with, from what the lecture is doing at that point.
4. Choose the candidate that places them that way.

Judge the arrangements, not the wording of their labels or reasons. A reason can be well written for a poor grouping, or awkward for a good one.

## Reply format

Reply with a single JSON object and nothing else, in this exact shape:

{
  "choice": "A",
  "why": "one sentence on where the candidates differ and why the chosen one places it right"
}

\`choice\` is the letter of the chosen candidate.`;

/**
 * j2, as agreed with the user. g20, which checks a grouping presented as a
 * draft, kept every border and topic in 18 calls on lecture 4 — the merged
 * groupings and the right ones alike — after arguing the division correctly.
 * j2 removes the draft: one stretch, two arrangements made independently, no
 * labels or reasons, listed in an order that means nothing. The border rules are
 * g20's, so only the framing differs.
 */
const J2 = `# Task

You are given the subtopics of a university lecture, in order, each with its full text and an \`id\`. You are also given one stretch of those subtopics and two ways of arranging that stretch into TOPICS. Everything outside the stretch is settled: a topic starts at the stretch's first subtopic, and the next topic starts right after its last. Choose the arrangement that better matches how the lecture itself is organised.

## What a topic is

${TOPIC_IS_ONE_OF_A_HANDFUL}

## How to judge

Neither arrangement is a draft or a default. They were made independently, and the order they are listed in means nothing.

1. For each arrangement, say what each of its topics is about, as narrowly as its own subtopics allow.
2. Make the case for arrangement 1, and the case for arrangement 2.
3. Choose.

${WHAT_DECIDES_A_BORDER}

## Reply format

Reply with a single JSON object and nothing else, in this exact shape:

{
  "arrangement1Topics": ["what each topic in arrangement 1 is about, in order"],
  "arrangement2Topics": ["what each topic in arrangement 2 is about, in order"],
  "caseFor1": "the case for arrangement 1",
  "caseFor2": "the case for arrangement 2",
  "choice": "1 or 2"
}`;

/** Every judge prompt that has been run, oldest first. */
export const JUDGE_PROMPTS: readonly JudgePromptVersion[] = [
	{
		id: "j1",
		summary: "Pick the candidate grouping that matches how the lecture is organised, judging arrangements rather than the prose of their reasons.",
		changed: "First version.",
		prompt: J1,
	},
	{
		id: "j2",
		summary: "Choose between two arrangements of one stretch of subtopics, neither presented as a draft, with g20's border rules.",
		changed:
			"A different job from j1: one stretch between settled borders and two arrangements of it, given as topic starts with no labels or reasons, in an order stated to mean nothing. The model names each arrangement's topics narrowly, argues both, and chooses. The border rules are g20's word for word. g20, shown a grouping as a draft, kept every border and topic in 18 calls on lecture 4 whichever grouping it was shown; j2 tests whether the same judgement without a draft follows the lecture instead.",
		prompt: J2,
	},
];

/**
 * Look up a judge prompt version by id.
 *
 * @param options - Options object.
 * @param options.id - The version id, such as "j1".
 * @returns The version.
 * @throws Error when no version carries that id.
 */
export function judgePromptVersion({ id }: { readonly id: string }): JudgePromptVersion {
	const found = JUDGE_PROMPTS.find((version) => version.id === id);
	if (found === undefined) {
		throw new Error(`No judge prompt "${id}". Known versions: ${JUDGE_PROMPTS.map((v) => v.id).join(", ")}`);
	}
	return found;
}
