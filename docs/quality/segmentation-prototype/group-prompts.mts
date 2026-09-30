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

/**
 * A two-pass version's second call: it edits the grouping that a run of
 * `firstPass` proposed, rather than grouping the subtopics from scratch.
 */
export type EditPromptVersion = GroupPromptVersion & {
	/** The single-call version whose runs this one edits. */
	readonly firstPass: string;
	/** What of a first-pass run's reply goes up beside the subtopics. */
	readonly proposal: (options: { readonly firstPassReply: unknown }) => Readonly<Record<string, unknown>>;
};

/** The clause that differs between the labelled and unlabelled variants. */
function namedFrom({ labelsShown }: { readonly labelsShown: boolean }): string {
	return labelsShown
		? "as a reader of those subtopic labels would summarise them"
		: "as a reader of those subtopics would summarise them";
}

/** What may not be done to the subtopics, in every version's words. */
const SUBTOPICS_UNTOUCHABLE = "you may not split one, merge two, reorder them, or change their text.";

const OPENING = `You are given the subtopics of a university lecture, in order, each with its full text. They were found by reading the transcript and they are fixed: ${SUBTOPICS_UNTOUCHABLE}

Your only job is to group them into TOPICS.

A TOPIC is a major division of the lecture — one of the handful of things the lecture is about. Each topic is a run of consecutive subtopics.

Do not decide in advance how many topics there should be. Let the number be whatever the material turns out to support.`;

const KIND_RULE = `
THINGS THAT DIFFER IN KIND DO NOT SHARE A TOPIC.
Do not put under one topic subtopics that differ in kind, even when the lecturer treats them one after another and for the same purpose. A biological agent and a chemical agent differ in kind. A physical agent such as radiation and a chemical one differ in kind. A process that damages DNA and a process that does not differ in kind. An experiment in living animals and one in cultured cells differ in kind. Serving the same argument does not make two subtopics one topic, and neither does being adjacent in the lecture.
This does NOT apply to a thing and its own mechanism: an agent and the damage it causes, or a process and the molecular change it produces, belong together.`;

/** The opening rule's body, shared by the prose versions and the structured one. */
const OPENING_BODY = `A lecture opens with framing that is not yet its subject: welcome, learning outcomes, what the lecture will cover, how it relates to other lectures. That opening is its own topic, separate from the first substantive topic.`;

/** The closing rule's body, as g12 added it to R2; shared by R2 and g16. */
const CLOSING_BODY = `Likewise, a lecture closes with framing that is no longer its subject: thanks, goodbye, what comes next, recommended reading, housekeeping. That closing is its own topic, separate from the last substantive topic.`;

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
export const TOPIC_IS_ONE_OF_A_HANDFUL = `A **topic** is a major division of the lecture — one of the handful of things the lecture is about. Each topic is a run of consecutive subtopics.`;

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

${OPENING_BODY} ${CLOSING_BODY}`;

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

/** g6's R6 body: a reason that only works as a list of kinds means divide. */
const LIST_IS_NOT_A_REASON = `If a \`groupedBecause\` has to name the different kinds of thing in the topic in order to say what they share, it is not describing one topic. Read it back: if the sentence only works as a list — this kind, and that kind, and the other kind — then the subtopics do not share a topic and you must divide them. What they share must be sayable as one thing.`;

/** g6's checklist question for R6. */
const LIST_IS_NOT_A_REASON_CHECK = "is any `groupedBecause` written as a list of kinds? If so, split that topic.";

/**
 * g15's R7, as worded with the user. On lecture 6 a subtopic that sums up the
 * growth hallmarks and then says what comes next opens the metabolism topic in
 * 15 of 18 g12 runs. The rule turns on two things the model can check in the
 * text — does it sum up the subtopics just before it, and does it teach anything
 * new — rather than on the passage's purpose, which could be judged either way.
 */
const SUMMARY_STAYS_WITH_WHAT_IT_SUMS_UP = `### R7 — A subtopic that only looks back belongs to what it looks back on

If a subtopic sums up the subtopics just before it and teaches nothing new of its own — at most it also says what is coming next — it belongs to the topic it sums up: a topic never starts at it. A subtopic that goes on to teach new material is not covered by this rule, however it opens. Nor is the closing under R2.`;

/** g15's checklist question for R7. */
const SUMMARY_STAYS_WITH_WHAT_IT_SUMS_UP_CHECK =
	"does any topic start at a subtopic that only sums up the subtopics before it, perhaps saying what comes next, and teaches nothing new (the closing under R2 excepted)? If so, make that subtopic the last one of the topic before, and start the topic at the subtopic after it.";

/**
 * g14's R6. On lectures 4 and 5 the user's ruled topics hold together because
 * they answer one question the lecture poses, with answers of different kinds,
 * so every run that found them named them as a list — and the runs that split
 * them were obeying R6. The exception is written inside R6's own sentence, with
 * a guard against a question broad enough to swallow the neighbouring topics.
 */
const LIST_IS_NOT_A_REASON_UNLESS_ONE_QUESTION = `${LIST_IS_NOT_A_REASON.replace(
	"you must divide them.",
	"you must divide them, unless the kinds are the lecture's own answers to a single question it poses for this stretch; then that question is what they share, and the `groupedBecause` should state it. The question must be one the lecture asks of these subtopics alone, not one broad enough to take in the neighbouring topics too.",
)}`;

/** g14's checklist question for R6. */
const LIST_IS_NOT_A_REASON_UNLESS_ONE_QUESTION_CHECK =
	"is any `groupedBecause` written as a list of kinds? If so, split that topic — unless the kinds answer one question the lecture poses for that stretch alone.";

/**
 * g13's addition to Method step 1, as agreed with the user: the model may use
 * what it knows of the subject to see where topics divide. Stated with no
 * direction — a clause saying knowledge must not ADD divisions was dropped as
 * one-sided, since it restrained splitting and never joining.
 */
const USE_SUBJECT_KNOWLEDGE =
	" Use your knowledge of the subject to judge which subtopics belong together: how the field itself relates this material is evidence of where one topic ends and the next begins.";

/**
 * The task, what the model is given, and what a topic is: the opening every
 * structured version shares, g6 onwards.
 *
 * @param topicDefinition - The version's definition of a topic.
 * @returns The opening sections.
 */
const STRUCTURED_HEAD = (topicDefinition: string): string => `# Task

You are given the subtopics of a university lecture, in order, each with its full text. Group them into TOPICS.

## What you are given

- The subtopics are **fixed**: ${SUBTOPICS_UNTOUCHABLE}
- They are in lecture order, and each carries an \`id\`.

## What a topic is

${topicDefinition}`;

/** g16's look forward: the model chooses how far the stretch after N runs. */
const LOOK_FORWARD_AS_FAR_AS_IT_BEARS =
	"Look forward: say what N is doing. Then choose the stretch of subtopics after N that bears on the same question, as long or as short as the lecture makes it, and say what that stretch is doing.";

/** g16's description of the `lookingForward` field. */
const LOOKING_FORWARD_FIELD_AS_FAR_AS_IT_BEARS = "what this subtopic is doing, and what the stretch after it is doing";

/**
 * g17's look forward. In two of g16's three lecture 4 runs, the forward stretch
 * chosen at one boundary ran ten subtopics on and framed them as one survey,
 * and every boundary inside it was then rated as continuing that survey. The
 * stretch now stops where the subtopics after N stop carrying on what N does.
 */
const LOOK_FORWARD_TO_THE_NEXT_TURN =
	"Look forward: say what N is doing. Then say what the subtopics after N are doing, going only as far as they carry on the same thing N does, and stopping before the first one that turns to something else. Do not look past that point: what the lecture goes on to do after it has no bearing on this boundary.";

/** g17's description of the `lookingForward` field. */
const LOOKING_FORWARD_FIELD_TO_THE_NEXT_TURN =
	"what this subtopic is doing, and what the subtopics after it are doing, up to the first that turns to something else";

/** g16's `continues` rating. */
const CONTINUES_CARRIES_IT_FURTHER =
	"N plainly belongs with the stretch before it: it carries that stretch further, with a further point, example, consequence or complication of it, or a summary of it that teaches nothing new, even if it also says what is coming next.";

/**
 * g18's `continues` rating, as agreed with the user. Every wrong g17 run on
 * lecture 4 rated the boundaries inside a long survey "continues" because the
 * next subtopic carried on the survey, naming what the stretch before was about
 * far more broadly than its own subtopics. The rating now names that thing as
 * narrowly as the stretch allows, and rules out being the next item in a
 * wider sequence as a reason on its own.
 */
const CONTINUES_THE_SAME_NARROW_THING =
	"N plainly belongs with the stretch before it. First name what the stretch before is about, as narrowly as its own subtopics allow. N continues it when N is about that same thing: another case of it, a further point about it, a consequence or complication of it, or a summary of it that teaches nothing new, even if it also says what is coming next. Carrying on a wider sequence the lecture is working through — one case after another, one kind after another — is not carrying on the stretch before. If the only reason you can give for `continues` is that N is the next item in such a sequence, the boundary is not `continues`; rate it `start` or `unsure`.";

/** g16's step 2 items 2 and 3: the stretch after runs to the next cut. */
const STRETCH_AFTER_TO_THE_NEXT_CUT = `2. The stretch after is the subtopics from N+1 up to the one before the nearest cut after N. It may be empty.
3. Say what N shares with the stretch before, and what it shares with the stretch after.`;

/** g16's stretch lines in an `unsureDecided` entry. */
const UNSURE_ENTRY_STRETCHES = `      "stretchBefore": [3, 4],
      "stretchAfter": [6, 7],`;

/**
 * g19's step 2 items 2 and 3. In g18's lecture 4 runs, unsure boundaries did
 * not end the stretch after, so boundary 9 was weighed against a short, coherent
 * stretch before (7–8) and a long, mixed one after (10–17), and joined the
 * stretch before every time; what each stretch shared was named as broadly as in
 * g17's step 1. The stretch after now stops at the first boundary not rated
 * `continues`, and both stretches are named narrowly before the comparison.
 */
const STRETCH_AFTER_TO_THE_NEXT_TURN_NAMED_NARROWLY = `2. The stretch after is N+1, followed by each subtopic after it whose boundary step 1 rated \`continues\`, stopping at the first that is not. If the boundary before N+1 is itself a cut, the stretch after is empty.
3. Name what the stretch before is about and what the stretch after is about, each as narrowly as its own subtopics allow. Then say what N shares with each. A wider sequence the lecture is working through, which both stretches belong to, is not something N shares with either.`;

/** g19's stretch lines in an `unsureDecided` entry: each stretch named before the comparison. */
const UNSURE_ENTRY_STRETCHES_NAMED = `      "stretchBefore": [3, 4],
      "stretchBeforeIsAbout": "what the stretch before is about, named narrowly",
      "stretchAfter": [6, 7],
      "stretchAfterIsAbout": "what the stretch after is about, named narrowly",`;

/**
 * What decides whether a topic starts at a subtopic, as g20 states it; shared
 * with the judge prompts that compare arrangements of a stretch.
 */
export const WHAT_DECIDES_A_BORDER = `## What decides a border

- A topic starts where the lecture takes up a question the subtopics before were not asking. Being the next item in a wider sequence the lecture is working through is not, on its own, a reason for two subtopics to share a topic.
- A subtopic that sums up the subtopics before it and teaches nothing new of its own, even if it also says what is coming next, belongs with what it sums up: a topic does not start at it.
- A topic of one subtopic is right when that subtopic takes up a question neither neighbouring topic is asking.
- The opening and the closing are their own topics. ${OPENING_BODY} ${CLOSING_BODY}`;

/**
 * g21's second call, as drafted with the user. The first pass is a skim: the
 * boundaries g18's step 1 rated start are settled, and those it rated unsure
 * are open. Every mark is a provisional cut, so each unsure mark is judged
 * between its neighbouring marks and no decision can widen another's segments.
 */
const MARK_RESOLVE_PROMPT = (): string => `# Task

You are given the subtopics of a university lecture, in order, each with its full text and an \`id\`. Another reader has skimmed the lecture and marked the places where a new TOPIC might start. Some marks they were sure of: those are settled, and you do not revisit them. The rest they were unsure of and did not try to resolve. Your job is to resolve each unsure mark: does a topic start there or not?

## What a topic is

${TOPIC_IS_ONE_OF_A_HANDFUL}

## What the marks are worth

The reader skimmed. An unsure mark means only that the place needs a carefully considered decision: it may be a genuine topic start, or it may not. The mark is not evidence either way: deciding that a topic starts and deciding that it does not are equal outcomes, and each needs its own evidence from the transcript.

## How to resolve each unsure mark

Treat every mark, settled and unsure, as a place where the lecture is cut into segments. For the unsure mark before subtopic N:

1. The segment before runs from the previous mark up to N−1. The segment after runs from N up to the subtopic before the next mark.
2. Name what each segment is about, as narrowly as its own subtopics allow.
3. Make the case for a topic starting at N, and the case against.
4. Decide: start, or no start.

Judge each unsure mark on its own two segments, as if every other mark were still in place. Do not let your decision on one mark settle another.

${WHAT_DECIDES_A_BORDER}

## Then write the topics

Topics start at subtopic 1, at every settled mark, and at every unsure mark you decided is a start. For each topic, write a label that describes what its subtopics have in common and a \`groupedBecause\`: one sentence saying what makes its subtopics one thing.

## Reply format

Reply with a single JSON object and nothing else, in this exact shape:

{
  "unsureMarks": [
    {
      "subtopicId": "the id of the subtopic the mark is before",
      "segmentBefore": ["its first subtopic id", "its last subtopic id"],
      "segmentBeforeIsAbout": "what the segment before is about, named narrowly",
      "segmentAfter": ["its first subtopic id", "its last subtopic id"],
      "segmentAfterIsAbout": "what the segment after is about, named narrowly",
      "caseForStart": "the case for a topic starting here",
      "caseAgainst": "the case against",
      "decision": "start | no start"
    }
  ],
  "topics": [
    {
      "label": "what these subtopics have in common",
      "groupedBecause": "one sentence on what makes these subtopics one topic",
      "firstSubtopicId": "the id of the topic's first subtopic"
    }
  ]
}

Every id is written as a number.`;

/**
 * g20's second call, as drafted with the user. In g16 to g19 no later step of a
 * reply ever overturned an earlier one — step 2 chose "before" in all 42 of its
 * decisions — so the checking moves to its own call, which reads a g15 run's
 * grouping as another reader's draft. g15's wrong runs fail every way (l4
 * merges, l1 adds a topic, l6 and l3 place a border one or two subtopics early),
 * so every border may be kept, moved by one or two, or removed, and every topic
 * divided; each choice is argued both ways before it is made.
 */
const BORDER_EDIT_PROMPT = (): string => `# Task

You are given the subtopics of a university lecture, in order, each with its full text and an \`id\`. You are also given a proposed grouping of those subtopics into TOPICS, made by another reader: where each topic starts, its label, and the reason given for grouping it. Your job is to check every border in that grouping and correct the ones that are wrong.

## What a topic is

${TOPIC_IS_ONE_OF_A_HANDFUL}

## What you may change

- **Keep** a border where it is.
- **Remove** a border, joining two topics into one.
- **Move** a border to a different subtopic, so that one or more subtopics change topic.
- **Add** a border inside a topic, dividing it in two.

The subtopics themselves are fixed: ${SUBTOPICS_UNTOUCHABLE}

The proposed grouping is a draft, not a default. Keeping a border and changing it need the same kind of evidence: what the subtopics on each side are actually about.

## Step 1 — Check every border

For each border in the proposed grouping, in order, the border before subtopic N:

1. Name what the subtopics just before N are about, and what N and the subtopics just after it are about, each as narrowly as their own subtopics allow.
2. Make the case for keeping the border at N.
3. Make the case for moving it: would it sit better one or two subtopics earlier or later? Say which, and why.
4. Make the case for removing it: are the two topics really one thing?
5. Then decide: keep, move, or remove.

## Step 2 — Check inside every topic

For each topic of two or more subtopics in the proposed grouping:

1. Find the place inside it where it would divide best, if it divided anywhere.
2. Make the case for dividing it there, and the case for keeping it whole.
3. Then decide: divide there, or keep it whole.

A reason that has to list different kinds of thing to say what a topic's subtopics share is a sign the topic divides; look for where.

${WHAT_DECIDES_A_BORDER}

## Step 3 — Write the corrected topics

Apply your decisions, then write every topic of the corrected grouping with a label that describes what its subtopics have in common and a \`groupedBecause\`: one sentence saying what makes its subtopics one thing.

## Reply format

Reply with a single JSON object and nothing else, in this exact shape:

{
  "borders": [
    {
      "subtopicId": "the id of the subtopic the border is before",
      "before": "what the subtopics just before are about",
      "after": "what this subtopic and those just after are about",
      "caseForKeeping": "the case for keeping the border here",
      "caseForMoving": "the case for moving it one or two subtopics earlier or later",
      "caseForRemoving": "the case for joining the two topics",
      "decision": "keep | move | remove",
      "movedTo": "the id of the subtopic the border now comes before"
    }
  ],
  "insides": [
    {
      "topicStartsAt": "the id of the topic's first subtopic",
      "divideAt": "the id of the subtopic where it would divide best",
      "caseForDividing": "the case for dividing the topic here",
      "caseForKeepingWhole": "the case for keeping it whole",
      "decision": "divide | keep whole"
    }
  ],
  "topics": [
    {
      "label": "what these subtopics have in common",
      "groupedBecause": "one sentence on what makes these subtopics one topic",
      "firstSubtopicId": "the id of the topic's first subtopic"
    }
  ]
}

Every id is written as a number. \`movedTo\` appears only when the decision is \`move\`. \`topics\` is the corrected grouping, in the same form as the proposed one: topics in order, the first beginning at subtopic 1, each running to the subtopic before the next topic's first.`;

/**
 * g16, as drafted with the user: every boundary is weighed before any topic is
 * written. Step 1 looks back and forward from each boundary over stretches the
 * model chooses and rates it start, continues or unsure; step 2 decides each
 * unsure one by whether its subtopic belongs with the stretch before or after,
 * bounded by the cuts already made; step 3 revisits those decisions once;
 * step 4 writes the topics, sending a list-shaped reason back to the boundaries.
 * The working is written into the reply, reasoning before each rating.
 */
const BOUNDARY_PROMPT = ({
	labelsShown,
	lookForward = LOOK_FORWARD_AS_FAR_AS_IT_BEARS,
	lookingForwardField = LOOKING_FORWARD_FIELD_AS_FAR_AS_IT_BEARS,
	continuesRating = CONTINUES_CARRIES_IT_FURTHER,
	stretchAfterAndShares = STRETCH_AFTER_TO_THE_NEXT_CUT,
	unsureEntryStretches = UNSURE_ENTRY_STRETCHES,
}: {
	readonly labelsShown: boolean;
	/** Step 2's items 2 and 3: the stretch after and the comparison; g16's when absent. */
	readonly stretchAfterAndShares?: string;
	/** The stretch lines of an `unsureDecided` entry in the reply format; g16's when absent. */
	readonly unsureEntryStretches?: string;
	/** What earns step 1's `continues` rating; g16's when absent. */
	readonly continuesRating?: string;
	/** Step 1's look-forward instruction; g16's when absent. */
	readonly lookForward?: string;
	/** The `lookingForward` field's description in the reply format; g16's when absent. */
	readonly lookingForwardField?: string;
}): string => `${STRUCTURED_HEAD(TOPIC_IS_ONE_OF_A_HANDFUL)}

## Boundaries

Between every two neighbouring subtopics there is a boundary. The boundary before subtopic N is where a topic could start at N. Your work is to decide, for every boundary, whether a topic starts there. Do not decide in advance how many topics there should be; the number is whatever the boundaries turn out to give. You work in four steps, and you write out steps 1 to 3 in your reply before the topics.

## Step 1 — Look at every boundary

Go through the boundaries in order, from the one before subtopic 2 to the one before the last subtopic. At each one:

1. Look back: choose the stretch of subtopics before N that bears on whether a topic starts at N, as long or as short as the lecture makes it, and say what that stretch is doing.
2. ${lookForward}
3. Give your reason for whether a topic starts at N.
4. Then rate the boundary:
   - \`start\` — N plainly belongs with the stretch after it and not with the stretch before: it takes up a question the stretch before was not asking.
   - \`continues\` — ${continuesRating}
   - \`unsure\` — N could live with the stretch before or with the stretch after. If you are in doubt, the boundary is \`unsure\`.

The opening and the closing are always their own topics. ${OPENING_BODY} ${CLOSING_BODY} The boundary after the opening and the boundary before the closing are always \`start\`.

## Step 2 — Decide the unsure boundaries

The \`start\` boundaries from step 1 are cuts. Go through the \`unsure\` boundaries in order. At the one before N:

1. The stretch before is the subtopics from the nearest cut before N up to N−1.
${stretchAfterAndShares}
4. Decide which N belongs with. If it belongs with the stretch after, a topic starts at N. If it belongs with the stretch before, no topic starts there.

When the stretch after is empty, N either joins the stretch before or stands alone as a topic of one subtopic. It stands alone only when it takes up a question neither neighbour is asking.

Each boundary you decide as a start becomes a cut for the boundaries after it.

## Step 3 — Check the decisions against each other

When every unsure boundary is decided, go back over them once. A later decision may have changed the stretches an earlier one was weighed against. Where it has, weigh that boundary again with the stretches as they now stand, and change the decision if the answer changes.

## Step 4 — Write the topics

The topics start at subtopic 1 and at every boundary that is now a start. For each topic, write:

- a \`label\`. ${NAMING_BODY(labelsShown)}
- a \`groupedBecause\`: one sentence saying what makes its subtopics one thing.

If a \`groupedBecause\` can only be written as a list — this kind, and that kind, and the other kind — the topic is not one thing. Go back to the boundaries inside it, find the one where it divides, make it a start, and write the topics again.

## Reply format

Reply with a single JSON object and nothing else, in this exact shape:

{
  "boundaries": [
    {
      "subtopicId": 2,
      "stretchBack": [1, 1],
      "lookingBack": "what that stretch before is doing",
      "lookingForward": "${lookingForwardField}",
      "stretchForward": [3, 5],
      "reason": "why a topic does or does not start here",
      "rating": "start | continues | unsure"
    }
  ],
  "unsureDecided": [
    {
      "subtopicId": 5,
${unsureEntryStretches}
      "sharesWithBefore": "what this subtopic shares with the stretch before",
      "sharesWithAfter": "what this subtopic shares with the stretch after",
      "belongsWith": "before | after"
    }
  ],
  "revisited": [
    {
      "subtopicId": 5,
      "whatChanged": "which later decision changed its stretches",
      "belongsWith": "before | after"
    }
  ],
  "topics": [
    {
      "label": "what these subtopics have in common",
      "groupedBecause": "one sentence on what makes these subtopics one topic",
      "firstSubtopicId": 1
    }
  ]
}

\`boundaries\` has one entry for every boundary. \`unsureDecided\` has one for every boundary rated \`unsure\`. \`revisited\` has one only for each decision you changed in step 3; leave it empty if none changed. \`firstSubtopicId\` is the id of the first subtopic in the topic. Each topic runs to the subtopic before the next topic's first.`;

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
	subjectKnowledge = "",
	r6 = LIST_IS_NOT_A_REASON,
	r6Check = LIST_IS_NOT_A_REASON_CHECK,
	r7 = "",
	r7Check = "",
}: {
	readonly labelsShown: boolean;
	readonly r4: string;
	readonly topicDefinition?: string;
	readonly r2?: string;
	readonly r2Check?: string;
	readonly r5?: string;
	readonly r5Check?: string;
	/** Appended to Method step 1; empty for every version before g13. */
	readonly subjectKnowledge?: string;
	readonly r6?: string;
	readonly r6Check?: string;
	/** A whole R7 section, heading included; empty for every version before g15. */
	readonly r7?: string;
	/** R7's checklist question; empty for every version before g15. */
	readonly r7Check?: string;
}): string => `${STRUCTURED_HEAD(topicDefinition)}

## Method

1. Read all the subtopic content and analyse which subtopics should live together under a topic, and which should live apart in separate topics. The goal is the optimum arrangement of subtopics under topics.${subjectKnowledge}
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

${r6}
${r7 === "" ? "" : `\n${r7}\n`}
## Check before replying

- **R2**: ${r2Check}
- **R3**: does every label describe only what its own subtopics carry?
- **R5**: ${r5Check}
- **R6**: ${r6Check}${r7Check === "" ? "" : `\n- **R7**: ${r7Check}`}

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
const G8_PROMPT = ({ labelsShown }: { readonly labelsShown: boolean }): string => `${STRUCTURED_HEAD(TOPIC_IS_A_LOGICAL_GROUPING)}

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
	{
		id: "g13",
		summary: "g12 with the model told to use its knowledge of the subject to judge where topics divide.",
		changed:
			"Method step 1 only: one sentence asking the model to use how the field relates the material as evidence of where one topic ends and the next begins. Aimed at lecture 5, whose last substantive topic g12 starts at the multi-step model in 11 of 18 runs and at hereditary predisposition in 7. Everything else is g12 byte for byte.",
		build: ({ labelsShown }) =>
			STRUCTURED_PROMPT({
				labelsShown,
				r4: R4_STATES_WHY,
				r2: OPENING_AND_CLOSING_RULE,
				r2Check: OPENING_AND_CLOSING_RULE_CHECK,
				r5: SPLIT_UNLESS_IT_STRANDS_A_CONTINUATION_BAR_R2,
				r5Check: SPLIT_UNLESS_IT_STRANDS_A_CONTINUATION_BAR_R2_CHECK,
				subjectKnowledge: USE_SUBJECT_KNOWLEDGE,
			}),
	},
	{
		id: "g14",
		summary: "g12 with R6 excepting a topic whose kinds are the lecture's answers to one question it poses for that stretch.",
		changed:
			"R6 and its checklist question only. A list-shaped groupedBecause no longer forces a split when the kinds answer a single question the lecture asks of those subtopics alone, and the groupedBecause should then state the question; a question broad enough to take in the neighbouring topics does not count. On lectures 4 and 5 every run that made the ruled topic named it as a list, and the runs that split it were obeying R6. Everything else is g12 byte for byte.",
		build: ({ labelsShown }) =>
			STRUCTURED_PROMPT({
				labelsShown,
				r4: R4_STATES_WHY,
				r2: OPENING_AND_CLOSING_RULE,
				r2Check: OPENING_AND_CLOSING_RULE_CHECK,
				r5: SPLIT_UNLESS_IT_STRANDS_A_CONTINUATION_BAR_R2,
				r5Check: SPLIT_UNLESS_IT_STRANDS_A_CONTINUATION_BAR_R2_CHECK,
				r6: LIST_IS_NOT_A_REASON_UNLESS_ONE_QUESTION,
				r6Check: LIST_IS_NOT_A_REASON_UNLESS_ONE_QUESTION_CHECK,
			}),
	},
	{
		id: "g15",
		summary: "g12 with R7: a subtopic that only sums up what came before, teaching nothing new, ends the topic it sums up.",
		changed:
			"A new rule R7 and its checklist question only. A subtopic that sums up the subtopics just before it and teaches nothing new — at most also saying what comes next — belongs to the topic it sums up, so no topic starts at it; a subtopic that goes on to teach new material, and the closing under R2, are not covered. On lecture 6 the subtopic summing up the growth hallmarks and announcing the rest opens the metabolism topic in 15 of 18 g12 runs; the user wants it to end the growth-hallmarks topic. Everything else is g12 byte for byte.",
		build: ({ labelsShown }) =>
			STRUCTURED_PROMPT({
				labelsShown,
				r4: R4_STATES_WHY,
				r2: OPENING_AND_CLOSING_RULE,
				r2Check: OPENING_AND_CLOSING_RULE_CHECK,
				r5: SPLIT_UNLESS_IT_STRANDS_A_CONTINUATION_BAR_R2,
				r5Check: SPLIT_UNLESS_IT_STRANDS_A_CONTINUATION_BAR_R2_CHECK,
				r7: SUMMARY_STAYS_WITH_WHAT_IT_SUMS_UP,
				r7Check: SUMMARY_STAYS_WITH_WHAT_IT_SUMS_UP_CHECK,
			}),
	},
	{
		id: "g16",
		summary: "A process in place of g15's rules: weigh every boundary, decide the unsure ones against the stretches either side, then write the topics.",
		changed:
			"The Method and the rules are replaced by four steps, with steps 1 to 3 written into the reply. Step 1 looks back and forward from every boundary over stretches the model chooses, gives a reason, and rates it start, continues or unsure. Step 2 decides each unsure boundary by whether its subtopic belongs with the stretch before or after, bounded by the nearest cuts. Step 3 revisits those decisions once. Step 4 writes the topics; a groupedBecause that is a list sends the model back to the boundaries inside the topic. g15's R1, R5's limit and R7 are folded into the step 1 ratings and step 2; R2, R3 and R4 carry over; R5's split-for-better-reasons is dropped. At high effort a g15 run on lecture 4 merged three ruled topics under a reason written as a list, breaking R6 without noticing; the user wants the model given a process that reaches the grouping rather than rules for checking one.",
		build: BOUNDARY_PROMPT,
	},
	{
		id: "g17",
		summary: "g16 with the forward look in step 1 stopped at the first subtopic that turns to something else.",
		changed:
			"Step 1's look-forward instruction and the lookingForward field's description only. The model no longer chooses how far forward to look: it goes only as far as the subtopics after N carry on what N does, and ignores what the lecture does after that. In two of g16's three high-effort runs on lecture 4, the forward stretch chosen at boundary 7 ran to subtopic 17 and was framed as one survey of carcinogenic agents; boundaries 9 and 14 were then rated as continuing that survey, never unsure, and the ruled topics starting there were lost. Everything else is g16 byte for byte.",
		build: ({ labelsShown }) =>
			BOUNDARY_PROMPT({
				labelsShown,
				lookForward: LOOK_FORWARD_TO_THE_NEXT_TURN,
				lookingForwardField: LOOKING_FORWARD_FIELD_TO_THE_NEXT_TURN,
			}),
	},
	{
		id: "g18",
		summary: "g17 with the continues rating tied to what the stretch before is about, named narrowly, and a wider sequence ruled out as a reason.",
		changed:
			"Step 1's `continues` rating only. The model first names what the stretch before is about as narrowly as its own subtopics allow; N continues it when N is another case of that thing, a further point about it, a consequence or complication of it, or a summary of it. Being the next item in a wider sequence the lecture works through is not continuing, and a boundary whose only reason is that must be rated start or unsure. In all three g17 runs on lecture 4 the start at boundary 7 was described as a systematic examination of specific carcinogenic agents, and boundary 9 was rated continues as the next step in that examination although each run named the turn from pathogens to dietary chemicals. Everything else is g17 byte for byte.",
		build: ({ labelsShown }) =>
			BOUNDARY_PROMPT({
				labelsShown,
				lookForward: LOOK_FORWARD_TO_THE_NEXT_TURN,
				lookingForwardField: LOOKING_FORWARD_FIELD_TO_THE_NEXT_TURN,
				continuesRating: CONTINUES_THE_SAME_NARROW_THING,
			}),
	},
	{
		id: "g19",
		summary: "g18 with step 2's stretch after stopped at the next boundary not rated continues, and both stretches named narrowly before the comparison.",
		changed:
			"Step 2's items 2 and 3 and the stretch lines of an unsureDecided entry only. The stretch after is N+1 and each following subtopic whose boundary was rated continues, so an unsure boundary now ends it as a cut does; each stretch is named as narrowly as its own subtopics allow, in the reply, before what N shares with it; a wider sequence both stretches belong to does not count as shared. In all three g18 runs on lecture 4, step 1 rated 9 and 14 unsure but step 2 weighed 9 against 7–8 before and 10–17 after, named what they shared broadly, and put 9 and then 14 with the stretch before. Two changes bundled, one per cause, at the user's choice. Everything else is g18 byte for byte.",
		build: ({ labelsShown }) =>
			BOUNDARY_PROMPT({
				labelsShown,
				lookForward: LOOK_FORWARD_TO_THE_NEXT_TURN,
				lookingForwardField: LOOKING_FORWARD_FIELD_TO_THE_NEXT_TURN,
				continuesRating: CONTINUES_THE_SAME_NARROW_THING,
				stretchAfterAndShares: STRETCH_AFTER_TO_THE_NEXT_TURN_NAMED_NARROWLY,
				unsureEntryStretches: UNSURE_ENTRY_STRETCHES_NAMED,
			}),
	},
];

/** Every second-call prompt that edits an earlier version's grouping, oldest first. */
export const EDIT_PROMPTS: readonly EditPromptVersion[] = [
	{
		id: "g20",
		firstPass: "g15",
		summary: "Two calls: g15 groups, then a second call checks every border of that grouping and keeps, moves, removes or adds borders.",
		changed:
			"A second call after g15, not a change to g15. It gets the full subtopic text and a g15 run's topics (starts, labels and reasons) as another reader's draft. For each border it names both sides narrowly and argues keeping, moving by one or two subtopics, and removing before deciding; for each topic of two or more subtopics it finds the best place to divide and argues both ways; then it writes the corrected topics. In g16 to g19 no later step of a reply overturned an earlier one, and g15's wrong runs fail every way — l4 merges, l1 adds a topic, l6 and l3 place a border early — so the checking is its own call and may make every kind of edit. Single-subtopic topics are allowed on R5's terms without its reluctance.",
		build: BORDER_EDIT_PROMPT,
		proposal: ({ firstPassReply }) => ({ proposedGrouping: firstPassReply }),
	},
	{
		id: "g21",
		firstPass: "g18",
		summary: "Two calls: g18's step 1 skims and marks boundaries start or unsure, then a second call resolves each unsure mark between the marks either side.",
		changed:
			"A second call after g18's step 1 (identical in g19), not a change to either. It gets the full subtopic text, the boundaries step 1 rated start as settled marks not to be revisited, and those it rated unsure as marks a skimming reader could not resolve, stated to be neither evidence for nor against a start. Every mark cuts the lecture into segments; each unsure mark is decided on the segments either side of it, named narrowly, with the case for and against, as if every other mark were still in place. g20, shown a grouping as a draft, kept all of it in 18 calls; step 2 of g18 and g19, deciding unsure boundaries in order within the same reply, chose no start in all 42 decisions, and deciding 9 first widened the stretch 14 was weighed against. Step 1 in those six runs never rated a ruled lecture 4 start continues.",
		build: MARK_RESOLVE_PROMPT,
		proposal: ({ firstPassReply }) => {
			const boundaries = (firstPassReply as { readonly boundaries: readonly { readonly subtopicId: number; readonly rating: string }[] })
				.boundaries;
			const marked = (rating: string): readonly number[] =>
				boundaries.filter((boundary) => boundary.rating === rating).map((boundary) => boundary.subtopicId);
			return { settledMarks: marked("start"), unsureMarks: marked("unsure") };
		},
	},
];

/**
 * Look up a grouping prompt version by id, single-call or edit.
 *
 * @param options - Options object.
 * @param options.id - The version id, such as "g3".
 * @returns The version; an edit version carries the `firstPass` it edits.
 * @throws Error when no version carries that id.
 */
export function groupPromptVersion({
	id,
}: {
	readonly id: string;
}): GroupPromptVersion | EditPromptVersion {
	const everyVersion: readonly (GroupPromptVersion | EditPromptVersion)[] = [...GROUP_PROMPTS, ...EDIT_PROMPTS];
	const found = everyVersion.find((version) => version.id === id);
	if (found === undefined) {
		throw new Error(
			`No grouping prompt "${id}". Known versions: ${everyVersion.map((v) => v.id).join(", ")}`,
		);
	}
	return found;
}
