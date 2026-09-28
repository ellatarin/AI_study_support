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


/** The reply format as the structured versions, g6 onwards, state it. */
const REPLY_FORMAT_SECTION = `## Reply format

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

/** What a topic is, as g6 and g7 define it. */
const TOPIC_IS_ONE_OF_A_HANDFUL = `A **topic** is a major division of the lecture — one of the handful of things the lecture is about. Each topic is a run of consecutive subtopics.`;

/**
 * What a topic is, as the user defined it for g8 and g9: a logical grouping,
 * with no pull towards a small number.
 */
const TOPIC_IS_A_LOGICAL_GROUPING = `A **topic** is a major division of the lecture — a group of subtopics that logically belong together. Each topic is a run of consecutive subtopics, which should be split apart when subtopics do not belong logically together.`;

/**
 * What a topic is, as the user redefined it for g10: "major" dropped, and the
 * grouping asked for as the MOST logical one rather than any logical one.
 */
const TOPIC_IS_THE_MOST_LOGICAL_GROUP = `A **topic** is a division of the lecture — the most logical group of subtopics that belong together. Each topic is a run of consecutive subtopics, which should be split apart when subtopics do not belong together.`;

/** g6's R2, the opening alone. */
const OPENING_RULE = `### R2 — The opening is its own topic

${OPENING_BODY}`;

/** g6's checklist question for R2. */
const OPENING_RULE_CHECK = "is the opening framing its own topic, separate from the first substantive topic?";

/**
 * g12's R2. g11's limit on single-subtopic topics folded a lecture's closing
 * goodbye into its last topic in half the runs on lecture 1; the user wants the
 * closing kept apart exactly as the opening is.
 */
const OPENING_AND_CLOSING_RULE = `### R2 — The opening and the closing are their own topics

${OPENING_BODY} Likewise, a lecture closes with framing that is no longer its subject: thanks, goodbye, what comes next, recommended reading, housekeeping. That closing is its own topic, separate from the last substantive topic.`;

/** g12's checklist question for R2. */
const OPENING_AND_CLOSING_RULE_CHECK =
	"is the opening framing its own topic, separate from the first substantive topic, and the closing framing its own topic, separate from the last?";

/** g6's R5 body: split whenever the reasons would be better for it. */
const SPLIT_FOR_BETTER_REASONS = `Consider carefully when you look at the content within the grouping whether splitting the group would end up with better \`groupedBecause\` reasons. If it does, then you must divide the topic.`;

/** g6's checklist question for R5. */
const SPLIT_FOR_BETTER_REASONS_CHECK = "is there any topic that would produce better reasons if it were split?";

/**
 * g11's R5 body. Across g6's runs on all eight lectures, 77 of the 93 contested
 * topic boundaries were a single subtopic being cut off as a topic of its own,
 * and those subtopics carry the argument before them further. A one-subtopic
 * topic always has the tightest reason, so g6's R5 favours it every time. The
 * limit is written inside R5's own sentence rather than as a separate rule.
 */
const SPLIT_UNLESS_IT_STRANDS_A_CONTINUATION = `${SPLIT_FOR_BETTER_REASONS.replace(/\.$/, "")} — unless dividing it would leave a single subtopic that only carries its neighbour's argument further, such as a consequence of it, a complication of it, or a further point in it. A subtopic like that stays in the topic whose argument it continues. A single subtopic is a topic of its own only when it takes up a question neither neighbouring topic is asking.`;

/** g11's checklist question for R5, as the user revised it. */
const SPLIT_UNLESS_IT_STRANDS_A_CONTINUATION_CHECK =
	"is there any topic that would produce better reasons if it were split whilst avoiding creating a single subtopic that only continues its neighbour's argument?";

/** g12's R5 body: g11's, with the opening and closing handed to R2. */
const SPLIT_UNLESS_IT_STRANDS_A_CONTINUATION_BAR_R2 = `${SPLIT_UNLESS_IT_STRANDS_A_CONTINUATION.replace(/\.$/, "")}, or when it is the opening or the closing under R2.`;

/** g12's checklist question for R5: g11's, with the opening and closing excepted. */
const SPLIT_UNLESS_IT_STRANDS_A_CONTINUATION_BAR_R2_CHECK = `${SPLIT_UNLESS_IT_STRANDS_A_CONTINUATION_CHECK.replace(/\?$/, "")} (the opening and the closing under R2 excepted)?`;

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
	topicDefinition = TOPIC_IS_ONE_OF_A_HANDFUL,
	r5 = SPLIT_FOR_BETTER_REASONS,
	r5Check = SPLIT_FOR_BETTER_REASONS_CHECK,
	r2 = OPENING_RULE,
	r2Check = OPENING_RULE_CHECK,
}: {
	readonly labelsShown: boolean;
	readonly r4: string;
	readonly topicDefinition?: string;
	readonly r2?: string;
	readonly r2Check?: string;
	readonly r5?: string;
	readonly r5Check?: string;
}): string => `# Task

You are given the subtopics of a university lecture, in order, each with its full text. Group them into TOPICS.

## What you are given

- The subtopics are **fixed**: you may not split one, merge two, reorder them, or change their text.
- They are in lecture order, and each carries an \`id\`.

## What a topic is

${topicDefinition}

## Method

1. Read all the subtopic content and analyse which subtopics should live together under a topic, and which should live apart in separate topics. The goal is the optimum arrangement of subtopics under topics.
2. Decide the topics.
3. Write each topic's label and \`groupedBecause\`.
4. Check your answer against every rule below, by name, before replying.

## Rules

### R1 — Let the material set the number

Do not decide in advance how many topics there should be. Let the number be whatever the material turns out to support.

${r2}

### R3 — Name each topic from its own subtopics

${NAMING_BODY(labelsShown)}

${r4}

### R5 — Split when splitting gives better reasons

${r5}

### R6 — A reason that is a list is not a reason

If a \`groupedBecause\` has to name the different kinds of thing in the topic in order to say what they share, it is not describing one topic. Read it back: if the sentence only works as a list — this kind, and that kind, and the other kind — then the subtopics do not share a topic and you must divide them. What they share must be sayable as one thing.

## Check before replying

- **R2**: ${r2Check}
- **R3**: does every label describe only what its own subtopics carry?
- **R5**: ${r5Check}
- **R6**: is any \`groupedBecause\` written as a list of kinds? If so, split that topic.

${REPLY_FORMAT_SECTION}`;

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

/**
 * g8, as the user wrote it, with only typos corrected. A topic is defined as a
 * logical grouping rather than "one of the handful of things the lecture is
 * about", and g6's split-for-better-reasons rule is gone — the two pulls that
 * split g6's runs into a coarse camp and a fine camp. Adds a label check (R6).
 */
const G8_PROMPT = ({ labelsShown }: { readonly labelsShown: boolean }): string => `# Task

You are given the subtopics of a university lecture, in order, each with its full text. Group them into TOPICS.

## What you are given

- The subtopics are **fixed**: you may not split one, merge two, reorder them, or change their text.
- They are in lecture order, and each carries an \`id\`.

## What a topic is

${TOPIC_IS_A_LOGICAL_GROUPING}

## Method

1. Read all the subtopic content and analyse which subtopics should live together under a topic, and where the splits should be that divide one logical grouping of subtopics from the next logical grouping of subtopics. Your work must create the most logical arrangement of topics and their underlying subtopics.
2. Decide on the names for the topics.
3. Write each topic's label and the reason for grouping all its subtopics - \`groupedBecause\`.
4. Check your answer against every rule below, by name, and revise your arrangement of subtopics and naming of topics before replying if the rules require.

## Rules

### R1 — Let the material set the number

Do not decide in advance how many topics there should be. Let the number be whatever the material turns out to support.

### R2 — The opening is its own topic

${OPENING_BODY}

### R3 — Name each topic from its own subtopics

A topic's label must describe what its subtopics have in common, ${namedFrom({ labelsShown })}. Topic labels should encapsulate all subtopics without listing them. Do not introduce any idea that none of its subtopics carries, and do not name a topic from what you expect a lecture on this subject to contain. If the subtopics do not support a tidy heading, give an untidy one that fits them.

### R4 — Every topic gives a clear rationale for the subtopics it contains

Every topic carries a \`groupedBecause\`: one sentence saying why it has been chosen as the most logical grouping. A \`groupedBecause\` should be able to be written without listing subtopics, and should be consistent with its topic label.

### R5 — A reason that is a list is not a reason

If a \`groupedBecause\` has to list the different kinds of thing in the topic in order to say what they share, it is not describing one topic. Read it back: if the rationale only works as a list of topics, then the subtopics do not share a topic and you should divide them. The result must be a clearly logical group of subtopics. If it isn't – revise whatever groupings you need to fix it.

### R6 — Check every label against its subtopics

Read each topic's label, then read each of its subtopics in turn. Every subtopic must be something a reader would expect to find under that label; if one is not, the label or the grouping is wrong — fix whichever is at fault. The label must not name anything none of its subtopics carries. It must not be a string of its subtopics' subjects.

## Check before replying

Before replying, check your prospective output against Rules R1-R6. If any of the rules seem not to be met, then you must revise your output before replying.

${REPLY_FORMAT_SECTION}`;

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
	{
		id: "g8",
		summary:
			"A topic is a logical grouping, not one of a handful; the split-for-better-reasons rule dropped; labels checked against their subtopics.",
		changed:
			"User-written, from g6. The topic definition and method now ask for logical groupings and where they divide, instead of 'one of the handful of things the lecture is about'. g6's R5 (split when splitting gives better reasons) is removed. Labels must cover their subtopics without listing them (R3), rationales must match their labels (R4), and a new R6 checks each label against each of its subtopics. The checklist becomes one instruction to check R1-R6. Aimed at g6's coarse and fine camps, which those two opposing pulls produced.",
		build: G8_PROMPT,
	},
	{
		id: "g9",
		summary: "g6 with the topic defined as a logical grouping rather than one of a handful.",
		changed:
			"The 'What a topic is' paragraph only, taken from g8. Removes the pull towards few topics and keeps g6's R5 and its checklist, isolating the one g8 change that was aimed at g6's coarse and fine camps. Everything else is g6 byte for byte.",
		build: ({ labelsShown }) =>
			STRUCTURED_PROMPT({ labelsShown, r4: R4_STATES_WHY, topicDefinition: TOPIC_IS_A_LOGICAL_GROUPING }),
	},
	{
		id: "g10",
		summary: "g6 with the topic defined as the most logical group of subtopics, no longer a major division.",
		changed:
			"The 'What a topic is' paragraph only, user-written, replacing g9's: 'major' is dropped, 'logically belong together' becomes 'the most logical group of subtopics that belong together', and the split clause loses 'logically'. Everything else is g6 byte for byte.",
		build: ({ labelsShown }) =>
			STRUCTURED_PROMPT({ labelsShown, r4: R4_STATES_WHY, topicDefinition: TOPIC_IS_THE_MOST_LOGICAL_GROUP }),
	},
	{
		id: "g11",
		summary: "g6 with R5 limited: never split off a single subtopic that only continues its neighbour's argument.",
		changed:
			"R5 and its checklist question only. R5 gains a clause, inside its own sentence, refusing a split that would leave a lone subtopic carrying its neighbour's argument further; the checklist question (user-revised) asks for better reasons while avoiding such a subtopic. Aimed at g6's contested boundaries, 77 of 93 of which were exactly that split. Everything else is g6 byte for byte.",
		build: ({ labelsShown }) =>
			STRUCTURED_PROMPT({
				labelsShown,
				r4: R4_STATES_WHY,
				r5: SPLIT_UNLESS_IT_STRANDS_A_CONTINUATION,
				r5Check: SPLIT_UNLESS_IT_STRANDS_A_CONTINUATION_CHECK,
			}),
	},
	{
		id: "g12",
		summary: "g11 with the closing made its own topic, like the opening, and excepted from R5's limit.",
		changed:
			"R2 and R5, with their checklist questions. R2 now makes the closing framing its own topic as well as the opening. R5's limit on single-subtopic topics, and its checklist question, except the opening and closing. Under g11 the closing goodbye merged into the last topic in 5 of 10 runs on lecture 1; the user wants it apart. Everything else is g11 byte for byte.",
		build: ({ labelsShown }) =>
			STRUCTURED_PROMPT({
				labelsShown,
				r4: R4_STATES_WHY,
				r2: OPENING_AND_CLOSING_RULE,
				r2Check: OPENING_AND_CLOSING_RULE_CHECK,
				r5: SPLIT_UNLESS_IT_STRANDS_A_CONTINUATION_BAR_R2,
				r5Check: SPLIT_UNLESS_IT_STRANDS_A_CONTINUATION_BAR_R2_CHECK,
			}),
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
