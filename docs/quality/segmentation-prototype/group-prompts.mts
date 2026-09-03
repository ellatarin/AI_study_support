/**
 * The grouping prompts, versioned.
 *
 * One entry per version that has been RUN. A version is never edited once it has
 * results against it — the numbers in `GROUPING-RESULTS.md` refer to this exact
 * text, so changing it would silently invalidate them. To try something new, add
 * the next version.
 *
 * Every version takes `labelsShown`, because whether pass one's subtopic labels
 * are sent up is an independent dimension measured against each prompt.
 */

/** A grouping prompt version, with the record of what it changed and why. */
export type GroupPromptVersion = {
	/** Short id used on the command line and in every run file. */
	readonly id: string;
	/** What this version is, in one line. */
	readonly summary: string;
	/** What changed from the previous version. */
	readonly changed: string;
	/** Builds the system prompt for this version. */
	readonly build: (options: { readonly labelsShown: boolean }) => string;
};

/** The clause that differs between the labelled and unlabelled variants. */
function namedFrom({ labelsShown }: { readonly labelsShown: boolean }): string {
	return labelsShown
		? "as a reader of those subtopic labels would summarise them"
		: "as a reader of those subtopics would summarise them";
}

const OPENING = `You are given the subtopics of a university lecture, in order, each with its full text. They were found by reading the transcript and they are fixed: you may not split one, merge two, reorder them, or change their text.

Your only job is to group them into TOPICS.

A TOPIC is a major division of the lecture — one of the handful of things the lecture is about. Each topic is a run of consecutive subtopics.

Do not decide in advance how many topics there should be. Let the number be whatever the material turns out to support.`;

const KIND_RULE = `
THINGS THAT DIFFER IN KIND DO NOT SHARE A TOPIC.
Do not put under one topic subtopics that differ in kind, even when the lecturer treats them one after another and for the same purpose. A biological agent and a chemical agent differ in kind. A physical agent such as radiation and a chemical one differ in kind. A process that damages DNA and a process that does not differ in kind. An experiment in living animals and one in cultured cells differ in kind. Serving the same argument does not make two subtopics one topic, and neither does being adjacent in the lecture.
This does NOT apply to a thing and its own mechanism: an agent and the damage it causes, or a process and the molecular change it produces, belong together.`;

/** The opening rule's body, shared by the prose versions and the structured one. */
const OPENING_BODY = `A lecture opens with framing that is not yet its subject: welcome, learning outcomes, what the lecture will cover, how it relates to other lectures. That opening is its own topic, separate from the first substantive topic.`;

/** The naming rule's body, shared by the prose versions and the structured one. */
const NAMING_BODY = (labelsShown: boolean): string => `A topic's label must describe what its subtopics have in common, ${namedFrom({ labelsShown })}. Do not introduce any idea that none of its subtopics carries, and do not name a topic from what you expect a lecture on this subject to contain. If the subtopics do not support a tidy heading, give an untidy one that fits them.`;

const OPENING_IS_ITS_OWN = `
THE OPENING IS ITS OWN TOPIC.
${OPENING_BODY}`;

const NAMING = (labelsShown: boolean): string => `
NAME EACH TOPIC FROM ITS OWN SUBTOPICS.
${NAMING_BODY(labelsShown)}`;

/** The justification rule as g1 to g3 state it: write it honestly, divide if it is thin. */
const WHY_HONEST = `
SAY WHY EACH GROUPING HOLDS.
Every topic carries a "groupedBecause": one sentence saying what makes its subtopics one thing. Write it honestly, and say what they SHARE rather than restating one of them. If the most you can say is that these were discussed together, or that they are all examples of something broad, then it is not one topic and you must divide it.`;

/**
 * g4's justification rule. The test becomes comparative rather than absolute:
 * not "is this sentence thin?" but "would the sentences be BETTER split?". This
 * is the first version that asks the model to weigh an alternative arrangement
 * instead of judging the one it already has.
 */
const WHY_COMPARED = `
SAY WHY EACH GROUPING HOLDS.
Every topic carries a "groupedBecause": one sentence saying what makes its subtopics one thing.
Consider carefully when you look at the content within the grouping whether splitting the group would end up with better “groupedBecause” reasons. If it does, then you must divide the topic.`;

/**
 * g5's addition. Every g4 run that merged two topics justified the merge with a
 * LIST of kinds — "infectious agents, dietary toxins, radiation, and chemical
 * carcinogens" — while every run that kept them apart named a single kind or a
 * single mechanism. The tell is grammatical rather than subject-specific, so the
 * rule is stated without any of the lecture's own nouns.
 */
const NO_ENUMERATION = `
If a "groupedBecause" has to name the different kinds of thing in the topic in order to say what they share, it is not describing one topic. Read it back: if the sentence only works as a list — this kind, and that kind, and the other kind — then the subtopics do not share a topic and you must divide them. What they share must be sayable as one thing.`;

/** g4's instruction to weigh the arrangement as a whole before settling on it. */
const ANALYSE = `
You must carefully analyse all the subtopic content to determine which subtopics should live together under a topic, and which should live apart in separate topics. The goal is to determine the optimum arrangement of subtopics under topics.`;

const REREAD = `
THEN READ IT AGAIN.
When you have grouped them, read each topic once more and ask whether it holds subtopics that differ in kind. If it does, divide it.`;

const REREAD_NO_KIND = `
THEN READ IT AGAIN.
When you have grouped them, read each topic once more and ask whether it is really one thing. If it is not, divide it.`;

const REPLY_SHAPE = `
Reply with a single JSON object and nothing else, in this exact shape:

{
  "topics": [
    {
      "label": "what these subtopics have in common",
      "groupedBecause": "one sentence on what makes these subtopics one topic",
      "firstSubtopicId": 1
    }
  ]
}

"firstSubtopicId" is the id of the first subtopic in the topic. Topics appear in order, the first begins at subtopic 1, and each topic runs to the subtopic before the next topic's first. Every subtopic therefore belongs to exactly one topic; do not list them individually and do not leave any out.`;


/**
 * g6 restates g5's rules as a structured document: markdown headings, numbered
 * and NAMED rules, and a checklist that names each rule it is checking. Not one
 * rule is added, removed or reworded in substance — the only variable is whether
 * a rule the model can point to binds better than the same rule in prose. g5's
 * failure was a rule that described its own violation and did not prevent it.
 */
const STRUCTURED_PROMPT = ({
	labelsShown,
	r4,
}: {
	readonly labelsShown: boolean;
	readonly r4: string;
}): string => `# Task

You are given the subtopics of a university lecture, in order, each with its full text. Group them into TOPICS.

## What you are given

- The subtopics are **fixed**: you may not split one, merge two, reorder them, or change their text.
- They are in lecture order, and each carries an \`id\`.

## What a topic is

A **topic** is a major division of the lecture — one of the handful of things the lecture is about. Each topic is a run of consecutive subtopics.

## Method

1. Read all the subtopic content and analyse which subtopics should live together under a topic, and which should live apart in separate topics. The goal is the optimum arrangement of subtopics under topics.
2. Decide the topics.
3. Write each topic's label and \`groupedBecause\`.
4. Check your answer against every rule below, by name, before replying.

## Rules

### R1 — Let the material set the number

Do not decide in advance how many topics there should be. Let the number be whatever the material turns out to support.

### R2 — The opening is its own topic

${OPENING_BODY}

### R3 — Name each topic from its own subtopics

${NAMING_BODY(labelsShown)}

${r4}

### R5 — Split when splitting gives better reasons

Consider carefully when you look at the content within the grouping whether splitting the group would end up with better \`groupedBecause\` reasons. If it does, then you must divide the topic.

### R6 — A reason that is a list is not a reason

If a \`groupedBecause\` has to name the different kinds of thing in the topic in order to say what they share, it is not describing one topic. Read it back: if the sentence only works as a list — this kind, and that kind, and the other kind — then the subtopics do not share a topic and you must divide them. What they share must be sayable as one thing.

## Check before replying

- **R2**: is the opening framing its own topic, separate from the first substantive topic?
- **R3**: does every label describe only what its own subtopics carry?
- **R5**: is there any topic that would produce better reasons if it were split?
- **R6**: is any \`groupedBecause\` written as a list of kinds? If so, split that topic.

## Reply format

Reply with a single JSON object and nothing else, in this exact shape:

{
  "topics": [
    {
      "label": "what these subtopics have in common",
      "groupedBecause": "one sentence on what makes these subtopics one topic",
      "firstSubtopicId": 1
    }
  ]
}

\`firstSubtopicId\` is the id of the first subtopic in the topic. Topics appear in order, the first begins at subtopic 1, and each topic runs to the subtopic before the next topic's first. Every subtopic therefore belongs to exactly one topic; do not list them individually and do not leave any out.`;

/** g6's rationale rule. */
const R4_STATES_WHY = `### R4 — Every topic says why it holds

Every topic carries a \`groupedBecause\`: one sentence saying what makes its subtopics one thing.`;

/**
 * g7's rationale rule, as the user wrote it. The instruction shifts from a
 * property the topic carries to an action the model performs, and is framed
 * around a PROPOSED topic — so the rationale is written while the grouping is
 * still open rather than as a description of one already settled. Kept verbatim,
 * misspelling included, so the version reproduces exactly what was run.
 */
const R4_STATE_RATIONALE = `### R4 — For every propsosed topic state the rationale

For every topic state a \`groupedBecause\`: one sentence saying what makes its subtopics one thing.`;

/** Every grouping prompt that has been run, oldest first. */
export const GROUP_PROMPTS: readonly GroupPromptVersion[] = [
	{
		id: "g1",
		summary: "The kind rule stated for topics, plus a re-read pass that asks only whether to divide.",
		changed: "First version.",
		build: ({ labelsShown }) =>
			[OPENING, KIND_RULE, OPENING_IS_ITS_OWN, NAMING(labelsShown), WHY_HONEST, REREAD, REPLY_SHAPE].join(
				"\n",
			),
	},
	{
		id: "g2",
		summary: "The kind rule removed; the re-read pass kept, reworded to ask whether the topic is one thing.",
		changed:
			"Dropped THINGS THAT DIFFER IN KIND. The re-read paragraph could no longer reference it, so it now asks whether the topic is really one thing.",
		build: ({ labelsShown }) =>
			[OPENING, OPENING_IS_ITS_OWN, NAMING(labelsShown), WHY_HONEST, REREAD_NO_KIND, REPLY_SHAPE].join(
				"\n",
			),
	},
	{
		id: "g3",
		summary: "The kind rule and the re-read pass both removed.",
		changed:
			"Dropped THEN READ IT AGAIN entirely. It only ever asked whether to divide a topic, never whether to join two, so it could push the topic count in one direction only.",
		build: ({ labelsShown }) =>
			[OPENING, OPENING_IS_ITS_OWN, NAMING(labelsShown), WHY_HONEST, REPLY_SHAPE].join("\n"),
	},
	{
		id: "g4",
		summary:
			"g3 plus an instruction to analyse for the optimum arrangement, and a groupedBecause test that compares splitting against keeping.",
		changed:
			"Added ANALYSE, which asks for the optimum arrangement rather than a walk through the subtopics in order. Replaced the honest-justification test with a comparative one: split when the groupedBecause sentences would be better for it. The first version to weigh an alternative arrangement rather than judge the one in hand.",
		build: ({ labelsShown }) =>
			[
				OPENING,
				ANALYSE,
				OPENING_IS_ITS_OWN,
				NAMING(labelsShown),
				WHY_COMPARED,
				REPLY_SHAPE,
			].join("\n"),
	},
	{
		id: "g5",
		summary: "g4 plus a rule that a groupedBecause built as a list of kinds is not one topic.",
		changed:
			"Added NO_ENUMERATION to g4's justification paragraph. Derived from g4's own runs: all six that merged two topics justified the merge by listing kinds, while all ten that kept them apart named a single kind or mechanism. Stated with none of the lecture's nouns, so it does not teach this transcript.",
		build: ({ labelsShown }) =>
			[
				OPENING,
				ANALYSE,
				OPENING_IS_ITS_OWN,
				NAMING(labelsShown),
				WHY_COMPARED,
				NO_ENUMERATION,
				REPLY_SHAPE,
			].join("\n"),
	},
	{
		id: "g6",
		summary: "g5's rules restated as a structured document — markdown headings, named rules R1 to R6, and a checklist.",
		changed:
			"Presentation only. Every rule of g5 is carried over unchanged in substance; they are now named and numbered so the model can check its answer against them by name. Tests whether a rule that can be pointed at binds better than the same rule in prose — g5's added rule described its own violation without preventing it.",
		build: ({ labelsShown }) => STRUCTURED_PROMPT({ labelsShown, r4: R4_STATES_WHY }),
	},
	{
		id: "g7",
		summary: "g6 with R4 reworded: state the rationale for every proposed topic, rather than every topic carrying one.",
		changed:
			"R4 only. The rule becomes an instruction to perform rather than a property to satisfy, and names the topic as PROPOSED — asking for the rationale while the grouping is still open. Everything else is g6 byte for byte.",
		build: ({ labelsShown }) => STRUCTURED_PROMPT({ labelsShown, r4: R4_STATE_RATIONALE }),
	},
];

/**
 * Look up a grouping prompt version by id.
 *
 * @param options - Options object.
 * @param options.id - The version id, such as "g3".
 * @returns The version.
 * @throws Error when no version carries that id.
 */
export function groupPromptVersion({ id }: { readonly id: string }): GroupPromptVersion {
	const found = GROUP_PROMPTS.find((version) => version.id === id);
	if (found === undefined) {
		throw new Error(
			`No grouping prompt "${id}". Known versions: ${GROUP_PROMPTS.map((v) => v.id).join(", ")}`,
		);
	}
	return found;
}
