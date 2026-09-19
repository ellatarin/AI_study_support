/**
 * The deepening prompts — pass 1.5 — versioned.
 *
 * Pass one divides the whole transcript; this pass is shown ONE section of that
 * division and asked where, if anywhere, it divides further. It never sees the
 * sections that were not sent, and it can only add cuts inside the passage it
 * was given, so it cannot lose a boundary pass one already made.
 *
 * Which sections are sent is not decided here. The harness measures every
 * section and sends only those over its gate, because a word count is something
 * code can do exactly and a model can only estimate. That gate is the external
 * standard an earlier reviewer pass lacked: it was shown everything and asked
 * whether the rules were satisfied, and since every division satisfies the
 * rules, it ratified whatever it was handed.
 *
 * Same discipline as `split-prompts.mts` and `group-prompts.mts`: one entry per
 * version that has been RUN, and a version is never edited once it has results
 * against it. The rules about what a subtopic is come from the splitting
 * registry rather than being restated, so tuning one of them moves both passes.
 */

import {
	CASES_RULE_WITH_SCOPE,
	HOLDS_RULE_OWN_MECHANISM,
	type NamedRule,
	ruleDocument,
	SIGNAL_BODY_FLAT,
	SIGNAL_RULE,
	STARTS_RULE_PRECEDENCE,
	SUBTOPIC_DEFINITION_FLAT,
} from "./split-prompts.mts";

/** A deepening prompt version, with the record of what it changed and why. */
export type DeepenPromptVersion = {
	/** Short id used on the command line and in every run file. */
	readonly id: string;
	/** What this version is, in one line. */
	readonly summary: string;
	/** What changed from the previous version. */
	readonly changed: string;
	/** Builds the system prompt for this version. */
	readonly build: () => string;
};

const ROLE_DEEPEN = `You are being shown one section of a university lecture transcript that has already been divided into subtopics. Your job is to say where, if anywhere, this one section divides further.`;

/**
 * What the document calls the thing a section divides into.
 *
 * The rules imported from the splitting registry say "subtopic". The rules
 * written here for this pass said "step", following the definition line that
 * glosses one as the other — so d1 to d4 use both names for one thing in the
 * same document. Every body and heading that names it is written once here and
 * built in whichever wording the version carries, so the two can never drift
 * into saying different things as well as different words.
 */
type Unit = {
	/** Singular, as a rule says it: "one step", "one subtopic". */
	readonly one: string;
	/** Plural: "plenty of single steps are long". */
	readonly many: string;
};

/** What d1 to d4 call it. */
const STEP: Unit = { one: "step", many: "steps" };

/** What d5 onward call it, matching the rules the splitting registry supplies. */
const SUBTOPIC: Unit = { one: "subtopic", many: "subtopics" };

/**
 * Why this passage arrived, and what that does and does not settle.
 *
 * The measurement is the reason to look hard; it is not the answer. Some steps
 * really are long, and a version that treated arrival as proof would break the
 * divisions it is meant to repair.
 */
const WHY_SENT_BODY = `This section reached you for one reason: it was measured and found longer than a single step usually runs. Nothing else about it has been judged. A long section often holds two or more steps that were run together, which is why you are being asked — but some steps genuinely are long, and length by itself settles nothing. Read the passage and decide from the passage.`;

/** Every place, not the first — a long passage may have swallowed several. */
const EVERY_PLACE_BODY = `Find EVERY place in this section where one step finishes and the next begins, not only the first. A section this long may have run two boundaries together, or three. Work through the passage from beginning to end and propose a cut at each one you find.`;

/** Returning nothing is a first-class answer, and must stay one. */
const mayHoldBody = (unit: Unit): string =>
	`"This is one ${unit.one}" is a real answer and you should give it whenever it is true. Do not manufacture a cut to justify the section having been sent. If you have read the passage and the lecturer does not finish with one thing and take up another anywhere inside it, say so and return no cuts.`;

const MAY_HOLD_BODY = mayHoldBody(STEP);

/** The cuts belong inside this passage, and are quoted from it. */
const INSIDE_ONLY_BODY = `Every cut you propose must fall INSIDE this section. The section's own first words are not a cut — that boundary already exists. Quote only from the text you were given, and do not propose a cut at its very end.`;

/**
 * Why this passage arrived, said without leaning on the answer.
 *
 * d1's version told the model a long section "often holds two or more steps"
 * and it duly found them: 103 unwanted cuts over sixteen runs, and only 31% of
 * sections came back whole. The measurement is a reason to look, and this says
 * only that.
 */
const whySentNeutralBody = (unit: Unit): string =>
	`This section reached you because its length was measured, and for no other reason. Nothing about its contents has been judged, by anyone, and its arrival is not evidence that it divides. Plenty of single ${unit.many} are long: a lecturer may spend a great many words on one thing, and that is not a fault to be corrected. Read the passage and decide from the passage alone.`;

/** Referring to a thing is not taking it up. */
const MENTION_BODY = `Mentioning something is not taking it up. A lecturer constantly names neighbouring things in passing — to contrast with the thing under discussion, to set it up, to say what it is not, to recall something covered earlier. A boundary needs the lecturer to LEAVE the first thing behind and begin working on the second. A name in passing, however different the thing named, is not a boundary.`;

/** The working state and the broken one are the same thing. */
const workingFailingBody = (unit: Unit): string =>
	`A thing shown working and then shown failing is one ${unit.one}. A lecture commonly explains how something operates and then what happens when it does not — the intact process and its breakdown, the rule and the exception, the normal case and the case that goes wrong. That is one thing examined from two sides, not two things. The move from the first to the second is not a boundary.`;

const WORKING_FAILING_BODY = workingFailingBody(STEP);

/** Multiplicity, but only once dividing has been established. */
const everyPlaceConditionalBody = (unit: Unit): string =>
	`If — and only if — you have established that this section holds more than one ${unit.one}, then find every place it divides, not only the first. Work through from beginning to end. This rule tells you how thoroughly to look once you know there is something to find; it is not a reason to think there is.`;

const WHY_SENT_RULE: NamedRule = {
	key: "why-sent",
	checked: false,
	heading: "Why this section reached you",
	body: WHY_SENT_BODY,
};

const EVERY_PLACE_RULE: NamedRule = {
	key: "every-place",
	checked: true,
	heading: "Find every place, not the first",
	body: EVERY_PLACE_BODY,
	check:
		"did you read to the end of the section, or stop at the first boundary you found? A long section may hold several.",
};

const MAY_HOLD_RULE: NamedRule = {
	key: "may-hold",
	checked: true,
	heading: "One long step is a real answer",
	body: MAY_HOLD_BODY,
	check:
		"is any cut you propose there because the lecturer moves on, rather than because this section was sent to you? Drop any that is not.",
};

const INSIDE_ONLY_RULE: NamedRule = {
	key: "inside-only",
	checked: true,
	heading: "Cut inside this section only",
	body: INSIDE_ONLY_BODY,
	check: "does every `startsWith` appear inside the section you were given, and none at its very start?",
};

/**
 * The signal rule, extended to pivots that sound like turns and are not.
 *
 * The shared rule warns about markers that are obviously empty. What the d2
 * runs cut on were pivots carrying apparent meaning — the lecturer turning from
 * the straightforward case to the awkward one — which the rule as written says
 * nothing about. The shared half is composed rather than restated.
 */
const SIGNAL_BODY_WITH_PIVOTS = `${SIGNAL_BODY_FLAT}
A pivot that sounds like a turn is not always a turn. When the lecturer announces difficulty, exception or failure — asking what happens when the thing just described does not hold, or turning from the straightforward case to the awkward one — that marks the second half of one explanation, not a new subject. Read what is being talked about on either side before treating a pivot as a boundary.`;

/**
 * Working-and-failing, closed against the fallback having a name of its own.
 *
 * The rule caught one boundary completely and another only a third of the time.
 * Where it failed, what happens when the process breaks down has its own name,
 * so the model classified it as a different mechanism and the rule never fired.
 */
const workingFailingNamedBody = (unit: Unit): string => `${workingFailingBody(unit)}
This holds however the second half is named. When the lecturer describes what happens if a process is absent, blocked or broken, that is still the same process — even when what happens instead carries a name of its own, and even when that name is introduced as though it were a separate thing.`;

/**
 * The single example, which neither of the other two rules about examples covers.
 *
 * {@link CASES_BODY_WITH_SCOPE} governs a RUN of instances and
 * {@link parallelBody} a SET of items; one example worked through to show what
 * a claim means is neither, and the d3 runs cut in front of it. The user's
 * distinction: a single example that directly explains a point is part of the
 * explanation, not an illustration hanging off it.
 *
 * Says only that the instance is followed through in enough detail to show why
 * the claim holds. An earlier draft said "naming the parts, saying what happens
 * to them", which carries none of the lecture's nouns but is still the shape of
 * the one passage it came from — a worked example in another discipline has no
 * parts for things to happen to.
 */
const singleExampleBody = (unit: Unit): string =>
	`A single example worked through to show what a claim means belongs with that claim. When the lecturer states something and then takes one instance of it and follows that instance through in enough detail to show why the claim holds, the statement and the worked example are one ${unit.one}. This is the case of ONE example. Where the lecturer instead runs through several instances of a point, {{cases}} decides them.`;

/** A run of items serving one point is one subtopic, however many items there are. */
const parallelBody = (unit: Unit): string =>
	`When the lecturer works through a set of things to make one point about all of them — ordering them, contrasting them, ranking them by some property — the whole run is one ${unit.one}. The point being made is the thing; the items are how it is made. Do not put a boundary between one item of such a run and the next, however different the items are from each other.`;

const SIGNAL_RULE_WITH_PIVOTS: NamedRule = {
	key: "signal",
	checked: true,
	heading: "Read the subject, not the speaker's words",
	body: SIGNAL_BODY_WITH_PIVOTS,
	check:
		"is any cut you propose at a pivot — a turn to the difficult, failing or exceptional case — rather than at a change of subject?",
};

const workingFailingRuleNamed = (unit: Unit): NamedRule => ({
	key: "working-failing",
	checked: true,
	heading: "Working and failing are one thing",
	body: workingFailingNamedBody(unit),
	check:
		"is any cut you propose between a thing operating and the same thing breaking down, including where the breakdown is given a name of its own? If so, drop it.",
});

const WORKING_FAILING_RULE_NAMED = workingFailingRuleNamed(STEP);

const singleExampleRule = (unit: Unit): NamedRule => ({
	key: "single-example",
	checked: true,
	heading: "One worked example belongs with the claim it explains",
	body: singleExampleBody(unit),
	check:
		"does any cut you propose separate a claim from the single example the lecturer works through to explain it? If so, drop it.",
});

const parallelRule = (unit: Unit): NamedRule => ({
	key: "parallel",
	checked: true,
	heading: `A run of items serving one point is one ${unit.one}`,
	body: parallelBody(unit),
	check:
		"does any cut you propose fall between two items of a set the lecturer is working through to make a single point? If so, drop it.",
});

const PARALLEL_RULE = parallelRule(STEP);

/**
 * Showing a thing is not leaving it.
 *
 * Every boundary the user rejected on lecture 3 is the same move: the lecturer
 * states something and then puts it in front of the room — the histology of the
 * tissue she has just described, the slides of the polyps she has just said we
 * study, the test for the state she has just said you want to catch — and the
 * model reads going to the exhibit as taking up a new subject. It names the
 * looking ("histological examination of…") and a named activity is a thing.
 *
 * The rule cannot simply forbid turning to an exhibit, because three of the
 * boundaries the user KEPT do exactly that. What separates them is what is
 * shown: the thing just described, or a different one. The last sentence is the
 * other keeper — where the lecturer stops using a means of showing and starts
 * discussing it, the means has become the subject.
 *
 * {@link CASES_BODY_WITH_SCOPE} governs a run of instances and
 * {@link singleExampleBody} one instance worked through. This is neither: it is
 * the thing itself, exhibited.
 */
const showingBody = (unit: Unit): string =>
	`Showing a thing is not leaving it. A lecturer will often say what something is and then put it in front of you — an image of it, a specimen, a recording, a document, a set of measurements — and go through it in detail, pointing out what can be seen. All of that belongs with the statement it demonstrates, however long the going-through runs and however much detail it reaches.
Ask what is being shown. If it is the thing just described, there is no boundary: the lecturer has not moved on, they are making good on what they said. A new ${unit.one} begins where what is shown is something they have not been discussing, or where the means of showing becomes the subject in its own right — how it works, what it costs, what it cannot tell you.`;

/**
 * Stages of one traced progression are one step.
 *
 * d6 left 54.0% untouched at 7 of 11 runs, and the runs say why in one voice:
 * "the lecturer moves from analyzing an invasive tumor to examining precursor
 * polyps". The model is not mistaking showing for a new subject there — it
 * believes the OBJECT changed, from the tumour to its precursors. They are
 * stages of the progression the lecturer announced she would trace, and nothing
 * in the prompt says that a stage is not a different thing.
 *
 * It answers the starts rule in the starts rule's own words — "taking up a
 * different thing" — rather than by citation. s6's precedence clause was stated
 * as a citation and never engaged: the model does not experience two rules
 * competing, so the refusal has to live inside the sentence that would
 * otherwise grant permission.
 *
 * The announcement is load-bearing, and deliberately so. Without it the rule
 * would swallow any passage that happens to move forward in time; with it, only
 * a traversal the lecturer set out on is protected.
 */
const progressionBody = (unit: Unit): string =>
	`When the lecturer sets out to follow something through a sequence — its stages, the steps of a process, how one state becomes the next — the whole traversal is one ${unit.one}. Moving from one stage to the next is not taking up a different thing, even though each stage carries a name of its own, looks quite different, and is shown with its own evidence.
Ask what the sequence is a sequence OF, and where the lecturer said they were going. Everything from the point they announce the traversal to the point they finish it belongs together, and the next ${unit.one} begins where the traversal ENDS, not at a stage inside it.`;

/**
 * The progression rule, scoped to one thing's stages rather than the lecture's.
 *
 * Isolated by removal on lecture 4, eleven runs each: the recap at 81.4% is made
 * by 8 of 11 runs under d4 and by 4 under d7, and d7 is d4 plus this rule and
 * nothing else. The lecturer stops there to gather up the mechanisms covered so
 * far, and a rule that protects a traversal from being cut up evidently reaches
 * far enough to hold that inside it.
 *
 * So the rule keeps its work and loses its overreach: the traversal it protects
 * is one THING passing through its stages, never the lecture passing through its
 * topics, and a passage that stops to take stock is not a stage of anything.
 */
const progressionBodyScoped = (unit: Unit): string => `${progressionBody(unit)}
This covers one thing passing through its stages, never the lecture passing through its subjects. ${TAKING_STOCK_SENTENCE}`;

/**
 * The half of d9's scoping that frees a recap, without the half that broke
 * lecture 3.
 *
 * d9 added two sentences at once and they did opposite things. Lecture 4 went
 * to the best score in the programme and lecture 5 recovered the boundary d7
 * had cost it — but lecture 3's 31.3% and 36.1% fell from 8 of 11 runs to 1,
 * because restating the rule as "one thing passing through its stages" invites
 * reading a tumour's local growth, invasion and metastasis as exactly that.
 * This is the other sentence, alone.
 */
const TAKING_STOCK_SENTENCE = `A passage where the lecturer stops to take stock — gathering up what has been covered, saying where things now stand — is not a stage of anything, and this rule does not hold it to what came before.`;

const progressionBodyStockOnly = (unit: Unit): string =>
	`${progressionBody(unit)}\n${TAKING_STOCK_SENTENCE}`;

const progressionRule = (unit: Unit): NamedRule => ({
	key: "progression",
	checked: true,
	heading: `Stages of one progression are one ${unit.one}`,
	body: progressionBody(unit),
	check:
		"does any cut you propose fall between two stages of a sequence the lecturer set out to follow through? If so, drop it.",
});

/**
 * The showing rule with its permission clause taken out.
 *
 * d11 put the rule back and it did its job — lecture 3's 18.7% fell from 6 runs
 * of 18 to 1 — while a new unwanted cut appeared on lecture 4 at 46.1%, in 5 of
 * 18, splitting a case study between its history and its mechanism. That seam is
 * already forbidden in substance by the holds rule, and the progression rule had
 * been holding it: 46.1% is made by 3 of 11 d4 runs, none of d7's, and 1 of 18
 * of d9's.
 *
 * What brought it back is the sentence in which this rule says when a boundary
 * DOES begin. A permission in one rule defeating a prohibition in another is the
 * failure this programme has measured more than any other — s5's two rules where
 * the prohibition lost, s6's precedence clause that never engaged, d8's six
 * prohibitions filed under one permission. So the rule stops granting anything:
 * it withholds a boundary or it stands aside, and the case it used to license is
 * stated as the limit of its own scope instead, handing the decision back in the
 * words the starts rule uses.
 */
const showingBodyWithholdingOnly = (unit: Unit): string =>
	`Showing a thing is not leaving it. A lecturer will often say what something is and then put it in front of you — an image of it, a specimen, a recording, a document, a set of measurements — and go through it in detail, pointing out what can be seen. All of that belongs with the statement it demonstrates, however long the going-through runs and however much detail it reaches. Ask what is being shown: if it is the thing just described, there is no boundary, because the lecturer has not moved on, they are making good on what they said.
This rule only ever withholds a boundary. It never supplies a reason for one, and a passage it does not cover is not thereby a new ${unit.one}. Where the lecturer stops using a means of showing and begins discussing the means itself — how it works, what it costs, what it cannot tell you — this rule simply does not apply, and whether they have taken up a different thing is settled as it would be anywhere else.`;

const showingRuleWithholdingOnly = (unit: Unit): NamedRule => ({
	key: "showing",
	checked: true,
	heading: `Showing what was just described is not a new ${unit.one}`,
	body: showingBodyWithholdingOnly(unit),
	check:
		"does any cut you propose fall between a thing being described and that same thing being shown or gone through? If so, drop it.",
});

const showingRule = (unit: Unit): NamedRule => ({
	key: "showing",
	checked: true,
	heading: "Showing what was just described is not a new " + unit.one,
	body: showingBody(unit),
	check:
		"does any cut you propose fall between a thing being described and that same thing being shown or gone through? If so, drop it.",
});

/**
 * The whole boundary decision as one rule: the trigger, then what only looks
 * like the trigger.
 *
 * Seven rules in d7 bear on the one question, and every failure this programme
 * has measured is one of them granting permission before the ones that would
 * refuse were consulted — s5's two rules where "the prohibition beats the
 * permission", s6's precedence clause that never engaged, d6's showing rule
 * that left 54.0% exactly where it found it. The one rule that worked first
 * time, d7's, worked by putting the refusal INSIDE the sentence that would
 * otherwise grant permission, in that sentence's own words. This is that
 * shape applied to the whole decision.
 *
 * Nothing is added and nothing dropped: the six exceptions are d7's holds,
 * working-and-failing, single-example, run-of-items, progression and mention
 * rules, carrying their own words. It keeps the `starts` key because the cases
 * rule cites it, and because it is still what decides where one begins.
 *
 * The merge forces one thing that is NOT neutral: d7 says "subtopic" in the
 * rules it imports and "step" in the rules written here, and a single body
 * cannot do both. It says {@link STEP}'s word, which is what four of the six
 * exceptions already said — see d5 for what the other choice does to the grain.
 */
const boundaryBody = (unit: Unit): string =>
	`A ${unit.one} is one thing together with what the lecturer brings to bear on it: that thing's own mechanism, what it in turn causes, the conclusion it is used to support. A new ${unit.one} begins where they leave that thing behind and take up a different one — another mechanism, another agent. Each new one begins its own ${unit.one}, however many the lecturer works through, and that holds even when they all serve the same overall point and all explain the same larger process.

Six things look like a different thing and are not. **None of them is a boundary:**

1. **A thing and its own workings.** Moving from a thing to that thing's own mechanism, from a cause to its effect, from a claim to the evidence for it.
2. **A thing working and the same thing failing.** A lecture commonly explains how something operates and then what happens when it does not — the intact process and its breakdown, the rule and the exception, the normal case and the case that goes wrong. That is one thing examined from two sides. It holds however the second half is named: what happens when a process is absent, blocked or broken is still that process, even when what happens instead carries a name of its own and is introduced as though it were a separate thing.
3. **A claim and the single example that explains it.** When the lecturer states something, takes one instance of it, and follows that instance through in enough detail to show why the claim holds, the statement and the worked example are one ${unit.one}. This is the case of ONE example; where they run through several instances of a point, {{cases}} decides them.
4. **One item of a set and the next.** When the lecturer works through a set of things to make one point about all of them — ordering them, contrasting them, ranking them by some property — the whole run is one ${unit.one}. The point being made is the thing; the items are how it is made, however different the items are from each other.
5. **One stage of a progression and the next.** When the lecturer sets out to follow something through a sequence — its stages, the steps of a process, how one state becomes the next — the whole traversal is one ${unit.one}. Each stage carries a name of its own, looks quite different, and is shown with its own evidence, and none of that makes it a different thing. Everything from the point they announce the traversal to the point they finish it belongs together, and the next ${unit.one} begins where the traversal ENDS, not at a stage inside it.
6. **Something named in passing.** A lecturer constantly names neighbouring things — to contrast with what is under discussion, to set it up, to say what it is not, to recall something covered earlier. A boundary needs them to LEAVE the first thing behind and begin working on the second. A name in passing, however different the thing named, is not a boundary.`;

const boundaryRule = (unit: Unit): NamedRule => ({
	key: "starts",
	checked: true,
	heading: `When a new ${unit.one} begins, and when it only looks as though one does`,
	body: boundaryBody(unit),
	check:
		"take each cut in turn and ask whether it falls at any of the six. Does it separate a thing from its own mechanism, a cause from its effect, or a claim from its evidence? A thing working from the same thing failing? A claim from the single example that explains it? One item of a set from the next? One stage of an announced sequence from the next? Or does it sit where the lecturer only names something in passing? Drop every cut that falls at any of them.",
});

const whySentRuleNeutral = (unit: Unit): NamedRule => ({
	key: "why-sent",
	checked: false,
	heading: "Why this section reached you",
	body: whySentNeutralBody(unit),
});

const WHY_SENT_RULE_NEUTRAL = whySentRuleNeutral(STEP);

const MENTION_RULE: NamedRule = {
	key: "mention",
	checked: true,
	heading: "Mentioning is not taking up",
	body: MENTION_BODY,
	check:
		"is any cut you propose at a place where the lecturer only names something in passing, rather than leaving one thing and starting on another?",
};

const WORKING_FAILING_RULE: NamedRule = {
	key: "working-failing",
	checked: true,
	heading: "Working and failing are one thing",
	body: WORKING_FAILING_BODY,
	check:
		"is any cut you propose between a thing operating and the same thing breaking down? If so, drop it — that is one step.",
};

const everyPlaceRuleConditional = (unit: Unit): NamedRule => ({
	key: "every-place",
	checked: true,
	heading: "If it divides, find every place",
	body: everyPlaceConditionalBody(unit),
	check:
		"having decided the section divides, did you read to the end of it, or stop at the first boundary?",
});

const EVERY_PLACE_RULE_CONDITIONAL = everyPlaceRuleConditional(STEP);

const mayHoldRuleFirst = (unit: Unit): NamedRule => ({
	key: "may-hold",
	checked: true,
	heading: `One long ${unit.one} is the answer whenever it is true`,
	body: mayHoldBody(unit),
	check:
		"can you say, for each cut, what the lecturer finishes with and what they take up? If you cannot say both, drop that cut.",
});

const MAY_HOLD_RULE_FIRST = mayHoldRuleFirst(STEP);

const DEEPEN_METHOD: readonly string[] = [
	"Read the whole section before proposing anything.",
	"Work through it from beginning to end, noting each place the lecturer finishes with one thing and takes up another.",
	"Check every place you noted against the rules below, by name, and drop the ones that do not hold.",
	"If nothing survives, return no cuts and say the section is one step.",
];

const deepenReply = (unit: Unit): string => `You are not reproducing the passage. Each cut carries only its position:
- "startsWith" must be the first EIGHT to TWELVE words of the new subtopic, copied from the section exactly as they appear. Do not tidy them, do not drop a leading "So" or "Right", do not change capitalisation, do not paraphrase. It is used to locate the cut, so it must match character for character.
- Cuts appear in the order they occur in the section.

Reply with a single JSON object and nothing else, in this exact shape:

{
  "verdict": "divides",
  "cuts": [
    {
      "label": "what the new subtopic is about",
      "groupedBecause": "one sentence on what makes it one thing",
      "startsWith": "the first eight to twelve words, verbatim"
    }
  ]
}

When the section is one ${unit.one}, reply instead with:

{
  "verdict": "one ${unit.one}",
  "cuts": [],
  "heldBecause": "one sentence on what makes the whole section one thing"
}`;

const DEEPEN_REPLY = deepenReply(STEP);

/**
 * d1 — the rules that decide a boundary, plus the four that this pass needs.
 *
 * The four rules about what a subtopic is and where one ends come from the
 * splitting registry unchanged, so the two passes cannot drift apart on the
 * question they are both answering. What is added is only what is true of this
 * pass and not of pass one: why the passage arrived, that there may be several
 * boundaries in it, that finding none is allowed, and that the cuts belong
 * inside the passage.
 */
const DEEPEN_RULES_V1: readonly NamedRule[] = [
	WHY_SENT_RULE,
	SIGNAL_RULE,
	HOLDS_RULE_OWN_MECHANISM,
	STARTS_RULE_PRECEDENCE,
	CASES_RULE_WITH_SCOPE,
	EVERY_PLACE_RULE,
	MAY_HOLD_RULE,
	INSIDE_ONLY_RULE,
];

const DEEPEN_PROMPT_V1 = ruleDocument({
	role: ROLE_DEEPEN,
	definition: SUBTOPIC_DEFINITION_FLAT,
	method: DEEPEN_METHOD,
	rules: DEEPEN_RULES_V1,
	replyFormat: DEEPEN_REPLY,
});

/**
 * d2's method. The order is the change: d1 had the model note boundaries at
 * step 2 and only reach "there are none" at step 4, so by the time the rules
 * were consulted it had already committed to a list.
 */
const deepenMethodDecideFirst = (unit: Unit): readonly string[] => [
	"Read the whole section.",
	`Ask first whether the lecturer anywhere inside it finishes with one thing and takes up another. If not, the section is one ${unit.one} and you are done — reply with no cuts.`,
	"Only if it does: work through the section from beginning to end and note every place where that happens.",
	"Check each place you noted against the rules below, by name, and drop the ones that do not hold.",
	"If nothing survives, reply with no cuts.",
];

const DEEPEN_METHOD_DECIDE_FIRST = deepenMethodDecideFirst(STEP);

/**
 * d2 — the same rules, with what pushed d1 toward cutting taken out.
 *
 * Three pressures, all removed: the section's arrival was described as evidence
 * that it divides, the thoroughness rule was stated unconditionally, and the
 * method reached a list of boundaries before it reached the question of whether
 * there were any. Two rules are added for the cases the runs got wrong — both
 * already forbidden in substance by the holds rule, and both cut anyway.
 */
const DEEPEN_RULES_V2: readonly NamedRule[] = [
	WHY_SENT_RULE_NEUTRAL,
	SIGNAL_RULE,
	HOLDS_RULE_OWN_MECHANISM,
	WORKING_FAILING_RULE,
	MENTION_RULE,
	STARTS_RULE_PRECEDENCE,
	CASES_RULE_WITH_SCOPE,
	MAY_HOLD_RULE_FIRST,
	EVERY_PLACE_RULE_CONDITIONAL,
	INSIDE_ONLY_RULE,
];

const DEEPEN_PROMPT_V2 = ruleDocument({
	role: ROLE_DEEPEN,
	definition: SUBTOPIC_DEFINITION_FLAT,
	method: DEEPEN_METHOD_DECIDE_FIRST,
	rules: DEEPEN_RULES_V2,
	replyFormat: DEEPEN_REPLY,
});

/**
 * d3 — d2 with the three wording changes its unwanted cuts asked for.
 *
 * Every one is a rule about what holds a passage together, and none is a
 * threshold: the numbers separating the wanted cuts from the unwanted ones in
 * this lecture are 149 against 175 words, which is a gap far too narrow to be
 * anything but this lecture.
 */
const DEEPEN_RULES_V3: readonly NamedRule[] = [
	WHY_SENT_RULE_NEUTRAL,
	SIGNAL_RULE_WITH_PIVOTS,
	HOLDS_RULE_OWN_MECHANISM,
	WORKING_FAILING_RULE_NAMED,
	PARALLEL_RULE,
	MENTION_RULE,
	STARTS_RULE_PRECEDENCE,
	CASES_RULE_WITH_SCOPE,
	MAY_HOLD_RULE_FIRST,
	EVERY_PLACE_RULE_CONDITIONAL,
	INSIDE_ONLY_RULE,
];

const DEEPEN_PROMPT_V3 = ruleDocument({
	role: ROLE_DEEPEN,
	definition: SUBTOPIC_DEFINITION_FLAT,
	method: DEEPEN_METHOD_DECIDE_FIRST,
	rules: DEEPEN_RULES_V3,
	replyFormat: DEEPEN_REPLY,
});

/**
 * d4 — the single-example rule added, and the pivot extension taken out.
 *
 * The pivot extension existed to suppress one boundary; the user has since
 * ruled that boundary correct, so the rule was working against the target. It
 * had also bought nothing else measurable. The signal rule reverts to the
 * shared constant, which is what pass one carries.
 */
const deepenRulesV4 = (unit: Unit): readonly NamedRule[] => [
	whySentRuleNeutral(unit),
	SIGNAL_RULE,
	HOLDS_RULE_OWN_MECHANISM,
	workingFailingRuleNamed(unit),
	singleExampleRule(unit),
	parallelRule(unit),
	MENTION_RULE,
	STARTS_RULE_PRECEDENCE,
	CASES_RULE_WITH_SCOPE,
	mayHoldRuleFirst(unit),
	everyPlaceRuleConditional(unit),
	INSIDE_ONLY_RULE,
];

const DEEPEN_PROMPT_V4 = ruleDocument({
	role: ROLE_DEEPEN,
	definition: SUBTOPIC_DEFINITION_FLAT,
	method: DEEPEN_METHOD_DECIDE_FIRST,
	rules: deepenRulesV4(STEP),
	replyFormat: DEEPEN_REPLY,
});

/**
 * d5 — d4 in one vocabulary, with nothing else touched.
 *
 * d1 to d4 name the thing a section divides into twice over: the four rules
 * imported from the splitting registry call it a subtopic, and the rules
 * written here call it a step, after the definition line that glosses one as
 * the other. Two names for one thing invite the model to read them as two
 * things. "Subtopic" wins because it is the word the document defines, the word
 * the reply's `label` and `startsWith` describe, and the word pass one uses.
 *
 * The definition line keeps "step" — there it explains the term rather than
 * competing with it, and it is the splitting registry's constant, so changing
 * it would change every version of pass one as well.
 */
/**
 * A version that adds one rule, expressed as the insertion it is.
 *
 * Re-listing the whole set per version lets two lists drift apart in ways no
 * one intended; this way the version IS its change, and a rule that moves or is
 * renamed fails loudly rather than landing somewhere arbitrary.
 *
 * @param options - Options object.
 * @param options.rules - The version being built on.
 * @param options.after - Key of the rule the new one is to follow.
 * @param options.rule - The rule to insert.
 * @returns The rules, with the new one in place.
 * @throws Error when no rule carries the key it is to follow.
 */
function withRuleAfter({
	rules,
	after,
	rule,
}: {
	readonly rules: readonly NamedRule[];
	readonly after: string;
	readonly rule: NamedRule;
}): readonly NamedRule[] {
	const at = rules.findIndex((existing) => existing.key === after);
	if (at < 0) {
		throw new Error(`"${rule.key}" is to follow "${after}", which this version does not carry`);
	}
	return [...rules.slice(0, at + 1), rule, ...rules.slice(at + 1)];
}

/**
 * d6's rules: d4's, with the showing rule beside the other two that say what
 * belongs with a claim.
 */
const deepenRulesV6 = (unit: Unit): readonly NamedRule[] =>
	withRuleAfter({ rules: deepenRulesV4(unit), after: "single-example", rule: showingRule(unit) });

/**
 * d7's rules: d4's, with the progression rule beside the run-of-items rule.
 *
 * Both govern a set of things the lecturer works through; the difference is
 * that a progression's members are ordered by becoming one another, which is
 * what the run-of-items rule does not say and what the 54.0% boundary turns on.
 */
const deepenRulesV7 = (unit: Unit): readonly NamedRule[] =>
	withRuleAfter({ rules: deepenRulesV4(unit), after: "parallel", rule: progressionRule(unit) });

/** d9's rules: d7's, with the progression rule scoped to one thing's stages. */
const deepenRulesV9 = (unit: Unit): readonly NamedRule[] =>
	withRuleAfter({ rules: deepenRulesV4(unit), after: "parallel", rule: progressionRuleScoped(unit) });

/**
 * The tail both scoped versions' checks carry. Their openings differ because
 * their bodies do: d9 narrows the traversal to ONE THING and its check says so,
 * d10 does not carry that sentence and so must not claim it.
 */
const TAKING_STOCK_CHECK =
	" If so, drop it — but a passage that stops to take stock of what has been covered is not a stage, and may be cut from what precedes it.";

/**
 * The progression rule with a different body and check.
 *
 * Spelled out rather than spread over {@link progressionRule}: `NamedRule` is a
 * discriminated union on `checked`, and spreading one loses the discriminant, so
 * `check` is no longer known to belong. Naming the key and heading once here is
 * what the two scoped versions share.
 */
const scopedProgressionRule = ({
	unit,
	body,
	check,
}: {
	readonly unit: Unit;
	readonly body: string;
	readonly check: string;
}): NamedRule => ({
	key: "progression",
	checked: true,
	heading: `Stages of one progression are one ${unit.one}`,
	body,
	check,
});

const progressionRuleScoped = (unit: Unit): NamedRule =>
	scopedProgressionRule({
		unit,
		body: progressionBodyScoped(unit),
		check: `does any cut you propose fall between two stages of a sequence the lecturer set out to follow one thing through?${TAKING_STOCK_CHECK}`,
	});

const progressionRuleStockOnly = (unit: Unit): NamedRule =>
	scopedProgressionRule({
		unit,
		body: progressionBodyStockOnly(unit),
		check: `does any cut you propose fall between two stages of a sequence the lecturer set out to follow through?${TAKING_STOCK_CHECK}`,
	});

/**
 * d11's rules: d9's, with d6's showing rule put back.
 *
 * The rule was measured in d6 and set aside for one reason: it took lecture 3's
 * 31.3% and 36.1% from 10 runs of 11 down to 4 and 3. Both of those are now
 * `dontCare` in the ruling — the user read the division d9 produces and accepted
 * the single section that runs across them — so the rule's only measured cost is
 * in a currency the score no longer counts.
 *
 * What it is aimed at: 18.7%, made by 6 of 18 d9 runs, which is what floors the
 * vote bar at 33%. d6 took that boundary from 6 of 11 to 1. The runs that make it
 * name the method as the subject — "using histology to examine tissue
 * architecture" — which is exactly what the rule addresses.
 */
const deepenRulesV11 = (unit: Unit): readonly NamedRule[] =>
	withRuleAfter({
		rules: deepenRulesV9(unit),
		after: "single-example",
		rule: showingRule(unit),
	});

/** d12's rules: d11's, with the showing rule no longer granting a boundary. */
const deepenRulesV12 = (unit: Unit): readonly NamedRule[] =>
	withRuleAfter({
		rules: deepenRulesV9(unit),
		after: "single-example",
		rule: showingRuleWithholdingOnly(unit),
	});

/** d10's rules: d7's, with only the taking-stock sentence added to the progression rule. */
const deepenRulesV10 = (unit: Unit): readonly NamedRule[] =>
	withRuleAfter({
		rules: deepenRulesV4(unit),
		after: "parallel",
		rule: progressionRuleStockOnly(unit),
	});

const DEEPEN_PROMPT_V6 = ruleDocument({
	role: ROLE_DEEPEN,
	definition: SUBTOPIC_DEFINITION_FLAT,
	method: DEEPEN_METHOD_DECIDE_FIRST,
	rules: deepenRulesV6(STEP),
	replyFormat: DEEPEN_REPLY,
});

/**
 * d8's rules: d7's seven boundary rules said as one, the rest untouched.
 *
 * Thirteen rules become seven. What went in is exactly what came out — the
 * merged rule carries all six prohibitions in their own words, and the cases
 * rule still decides the case it always decided, cited from inside the merge.
 */
const deepenRulesV8 = (unit: Unit): readonly NamedRule[] => [
	whySentRuleNeutral(unit),
	SIGNAL_RULE,
	boundaryRule(unit),
	CASES_RULE_WITH_SCOPE,
	mayHoldRuleFirst(unit),
	everyPlaceRuleConditional(unit),
	INSIDE_ONLY_RULE,
];

const DEEPEN_PROMPT_V12 = ruleDocument({
	role: ROLE_DEEPEN,
	definition: SUBTOPIC_DEFINITION_FLAT,
	method: DEEPEN_METHOD_DECIDE_FIRST,
	rules: deepenRulesV12(STEP),
	replyFormat: DEEPEN_REPLY,
});

const DEEPEN_PROMPT_V11 = ruleDocument({
	role: ROLE_DEEPEN,
	definition: SUBTOPIC_DEFINITION_FLAT,
	method: DEEPEN_METHOD_DECIDE_FIRST,
	rules: deepenRulesV11(STEP),
	replyFormat: DEEPEN_REPLY,
});

const DEEPEN_PROMPT_V10 = ruleDocument({
	role: ROLE_DEEPEN,
	definition: SUBTOPIC_DEFINITION_FLAT,
	method: DEEPEN_METHOD_DECIDE_FIRST,
	rules: deepenRulesV10(STEP),
	replyFormat: DEEPEN_REPLY,
});

const DEEPEN_PROMPT_V9 = ruleDocument({
	role: ROLE_DEEPEN,
	definition: SUBTOPIC_DEFINITION_FLAT,
	method: DEEPEN_METHOD_DECIDE_FIRST,
	rules: deepenRulesV9(STEP),
	replyFormat: DEEPEN_REPLY,
});

const DEEPEN_PROMPT_V8 = ruleDocument({
	role: ROLE_DEEPEN,
	definition: SUBTOPIC_DEFINITION_FLAT,
	method: DEEPEN_METHOD_DECIDE_FIRST,
	rules: deepenRulesV8(STEP),
	replyFormat: DEEPEN_REPLY,
});

const DEEPEN_PROMPT_V7 = ruleDocument({
	role: ROLE_DEEPEN,
	definition: SUBTOPIC_DEFINITION_FLAT,
	method: DEEPEN_METHOD_DECIDE_FIRST,
	rules: deepenRulesV7(STEP),
	replyFormat: DEEPEN_REPLY,
});

const DEEPEN_PROMPT_V5 = ruleDocument({
	role: ROLE_DEEPEN,
	definition: SUBTOPIC_DEFINITION_FLAT,
	method: deepenMethodDecideFirst(SUBTOPIC),
	rules: deepenRulesV4(SUBTOPIC),
	replyFormat: deepenReply(SUBTOPIC),
});

/** Every deepening prompt that has been run, oldest first. */
export const DEEPEN_PROMPTS: readonly DeepenPromptVersion[] = [
	{
		id: "d1",
		summary:
			"The first deepening prompt: pass one's boundary rules, plus the four this pass needs — why the section arrived, find every place, one long step is allowed, cut inside only.",
		changed:
			"First version in this registry. The four rules that decide where a boundary falls are s7's and s8's constants imported unchanged, so the two passes answer the same question the same way and tuning one moves both. Everything else is specific to being handed one measured section: the measurement is stated as a reason to look rather than as a verdict, the search is required to run to the end of the passage rather than stop at the first boundary, 'one step' is given as an explicit reply shape so that returning nothing is a first-class answer rather than a failure, and cuts are confined to the interior so this pass can never move or lose a boundary pass one made.",
		build: () => DEEPEN_PROMPT_V1,
	},
	{
		id: "d2",
		summary:
			"d1 with what pushed it toward cutting removed, and two rules added for the boundaries its runs got wrong.",
		changed:
			"d1 cut almost everything it was shown: 103 unwanted cuts over sixteen runs, and only 31% of sections came back whole. Three pressures are removed. The arrival rule no longer says a long section 'often holds two or more steps' — arrival is now stated as a measurement that judges nothing, alongside the fact that plenty of single steps are long. The thoroughness rule is made conditional: find every place ONLY once it is established that the section divides at all, and it explicitly says it is not a reason to think it does. And the method is reordered to decide before it searches — d1 had the model listing boundaries at step 2 and only reaching 'there are none' at step 4, so the rules were consulted against a list it had already committed to. Two rules are added, both for boundaries the user rejected that d1 made in all sixteen runs, and both already forbidden in substance by the holds rule it was carrying: a thing shown working and then shown failing is one step, and naming something in passing is not taking it up. The hold rules now also stand before the split rules. Gate unchanged at the harness's discretion; calls are still one per section.",
		build: () => DEEPEN_PROMPT_V2,
	},
	{
		id: "d3",
		summary:
			"d2 with three wording changes, each aimed at one of the boundaries its runs kept cutting that the user rejected.",
		changed:
			"Three rule bodies, no thresholds. First, the signal rule is extended: it warned only about markers that are obviously empty, and what d2 cut on were pivots carrying apparent meaning — the lecturer turning from the straightforward case to the awkward one, or asking what happens when the thing just described does not hold. It now says those mark the second half of one explanation. Second, working-and-failing is closed against the fallback having a name: where the rule failed, what happens when a process breaks down had a name of its own, and having a name let the model classify it as a different mechanism so the rule never fired. Third, a new rule for a run of items serving one point — ordering, contrasting or ranking a set to make a single claim about all of them is one step, and a boundary does not go between one item and the next. A minimum-piece threshold was measured and REJECTED: the wanted and unwanted cuts here are separated by 149 words against 175, a gap narrow enough that any threshold would be fitted to this lecture alone.",
		build: () => DEEPEN_PROMPT_V3,
	},
	{
		id: "d4",
		summary:
			"d3 with a rule for the single worked example, and the pivot extension removed after the boundary it suppressed was ruled correct.",
		changed:
			"One rule added and one removed, both on evidence from d3's runs. Added: a single example worked through to show what a claim means belongs with that claim. Neither existing rule covered it — one governs a run of instances and the other a set of items — and it hands the several-instances case to the cases rule by reference so the two cannot overlap. Removed: the pivot extension to the signal rule, which was written to suppress the boundary at 57.3%; the user has since ruled that boundary correct, so the rule was pushing against the target, and it had bought nothing else measurable (the boundary went from 15 of 16 runs to 13, and nothing else moved). The signal rule reverts to the shared constant pass one carries. d3's other two changes stay: working-and-failing closed against the fallback having its own name, which removed its boundary completely, and the parallel-items rule, which has yet to show an effect.",
		build: () => DEEPEN_PROMPT_V4,
	},
	{
		id: "d5",
		summary:
			"d4 in one vocabulary: everything the document calls a step it now calls a subtopic. No rule changes what it says.",
		changed:
			"Wording only, and deliberately nothing else, so that what it costs or buys can be read off against d4 before any rule is added on top. d1 to d4 carry two names for the thing a section divides into: the four rules imported from the splitting registry say subtopic, the six written here say step, and the reply's verdict is the string \"one step\". The model is therefore told, in one document, that it is finding subtopics and that it is finding steps. Subtopic wins because it is the term the document defines, the term the reply's label and startsWith describe, and the term pass one uses; the harness never reads the verdict string, so renaming it is inert. Every body and heading that names the unit is now written once and built in whichever wording the version carries, and d1 to d4 were proved byte-identical after that refactor. The definition line still glosses a subtopic as 'a distinct step in the lecture' — there the word explains the term rather than competing with it, and it belongs to the splitting registry, so changing it would change every version of pass one too.",
		build: () => DEEPEN_PROMPT_V5,
	},
	{
		id: "d6",
		summary:
			"d4 plus one rule: showing what has just been described — the image of it, the specimen, the measurements — belongs with the description.",
		changed:
			"Built on d4, not on d5, because d5 was measured and its vocabulary makes the model merge more than lecture 3 can afford: it removed all four rejected boundaries and took three wanted ones with it (31.3% and 36.1% both fell from 10 of 11 runs to 4), and it narrowed the vote band lecture 5 tolerates from 82% to 73%. One rule is added. Every boundary the user rejected on lecture 3 is the same move — the lecturer states something and then puts it in front of the room, and the model reads going to the exhibit as taking up a new subject, because it names the looking and a named activity reads as a thing. The rule cannot forbid turning to an exhibit outright: three of the boundaries the user KEPT do exactly that, at 36.1%, 78.8% and 86.0%. What separates them is WHAT is shown — the thing just described, or a different one — so the rule turns on that, and closes with the other keeper: where the lecturer stops using a means of showing and starts discussing the means itself, that is a new step, which is what 24.0% is. Nothing else changes: same rule order but for the insertion, same method, same reply format, same wording for the unit.",
		build: () => DEEPEN_PROMPT_V6,
	},
	{
		id: "d7",
		summary:
			"d4 plus one rule: when the lecturer sets out to follow something through its stages, moving to the next stage is not taking up a different thing.",
		changed:
			"Built on d4, not on d6, so that it is one change from the measured baseline. d6's showing rule removed three of lecture 3's four rejected boundaries and left the only one that matters exactly where it was — 54.0%, in 7 runs of 11 under both d4 and d6 — while costing two wanted boundaries. The runs say plainly why it survived: every one of them reports moving 'from analyzing an invasive tumor to examining precursor polyps', so the model is not mistaking an exhibit for a new subject there, it believes the object itself changed. It has not: the precursors are stages of the progression the lecturer announced she would trace, and no rule in the prompt says a stage is not a different thing. The new rule says it, and says it in the starts rule's own words — 'taking up a different thing' — because a precedence clause stated as a citation was tried in s6 and never engaged. The announcement is load-bearing: only a traversal the lecturer sets out on is protected, so the rule cannot swallow any passage that merely moves forward in time. Placed next to the run-of-items rule, which governs the unordered case. The showing rule is not carried; it is held for a combined version once this is measured.",
		build: () => DEEPEN_PROMPT_V7,
	},
	{
		id: "d8",
		summary:
			"d7's seven boundary rules said as one: the trigger for a new step, then the six things that look like the trigger and are not.",
		changed:
			"Structure, not content. d7 spreads the one decision across seven rules — what a subtopic holds, working and failing, the single example, the run of items, the progression, the mention, and what starts a new subtopic — and every failure this programme has measured is one of them granting permission before the ones that would refuse were ever consulted: s5's pair where the prohibition beat the permission, s6's precedence clause that never engaged, d6's showing rule that left 54.0% exactly where it found it. The one rule that worked first time, d7's progression rule, worked by putting the refusal inside the sentence that would otherwise grant permission, in that sentence's own words. d8 applies that shape to the whole decision: one rule states when a new step begins and then lists, as six numbered cases in their own original wording, what only looks like a different thing. Nothing is added and nothing is dropped, the cases rule still decides illustrating cases and is still cited from inside the merge, and the checklist keeps all six questions under one bullet. Thirteen rules become seven. One thing the merge forces and which d5 showed is not free: d7 says 'subtopic' in the rules it imports from pass one and 'step' in the rules written for this pass, and a single body cannot say both — it says 'step', which is what four of the six exceptions already said.",
		build: () => DEEPEN_PROMPT_V8,
	},
	{
		id: "d9",
		summary:
			"d7 with the progression rule scoped: it protects one thing passing through its stages, not the lecture passing through its subjects, and a passage that stops to take stock is not a stage.",
		changed:
			"Two sentences added to one rule; d8's merge is not carried, having been measured a clear regression. The target was isolated by removal rather than guessed at: d7 is d4 plus the progression rule and nothing else, and on lecture 4 over eleven runs each the recap at 81.4% — the weakest wanted boundary in the programme, and the one that caps the vote bar at 36% — is made by 8 of 11 runs under d4 and by 4 under d7. The rule reaches too far: the lecturer stops there to gather up the mechanisms covered so far, and a rule that protects a traversal from being cut up holds that inside it. It keeps its work and loses its overreach — the traversal protected is one thing passing through its stages, never the lecture passing through its subjects, and a passage that stops to take stock is not a stage of anything. What must not move: lecture 3's 54.0%, which this rule took from 7 of 11 runs to none, and lecture 4's 46.1%, which it took from 3 to none.",
		build: () => DEEPEN_PROMPT_V9,
	},
	{
		id: "d10",
		summary:
			"d9's taking-stock sentence without d9's other one: the progression rule no longer holds a passage that stops to gather up what has been covered.",
		changed:
			"d9 added two sentences at once and they pulled in opposite directions. Lecture 4 reached the best score the programme has produced — 0.36 errors a run, exactly right in 73% of them, its weakest wanted boundary at 10 of 11 — and lecture 5 recovered the 57.3% boundary that d7 had cost it, from 6 of 11 back to 9. But lecture 3's 31.3% and 36.1% fell from 8 of 11 runs to 1, because restating the rule as 'one thing passing through its stages' invites reading a tumour's local growth, then invasion, then metastasis as exactly that, and the whole passage is held together. This version keeps only the other sentence — that a passage where the lecturer stops to take stock is not a stage of anything — so the recap is freed without the stages framing being restated and strengthened. Everything else is d7.",
		build: () => DEEPEN_PROMPT_V10,
	},
	{
		id: "d11",
		summary:
			"d9 with d6's showing rule put back, now that the only thing it cost is a pair of boundaries the ruling sets aside.",
		changed:
			"One rule, restored rather than written. d9 is the chosen baseline — nine runs keeping what five propose gives lectures 4 and 5 their division in every panel and lecture 3 its division in 77% of them — and its remaining error on lecture 3 is 18.7%, made by 6 of 18 runs, which is what floors the usable vote bar at 33%. That boundary was diagnosed rather than guessed at: pass one proposes it once in eighteen, so it is the deepening pass, and the runs that make it name the method as the subject ('using histology to examine tissue architecture and basement membrane invasion'), which is exactly the failure d6's showing rule was written for. d6 took the boundary from 6 of 11 runs to 1. It was set aside because it also took lecture 3's 31.3% and 36.1% from 10 of 11 down to 4 and 3 — and both of those are now dontCare, the user having read the division d9 produces and accepted the single section running across them. So the rule's only measured cost is in a currency the score no longer counts. Nothing else changes; the gate stays at 600.",
		build: () => DEEPEN_PROMPT_V11,
	},
	{
		id: "d12",
		summary:
			"d11 with the showing rule no longer granting a boundary: it withholds one or it stands aside, and never supplies a reason for one.",
		changed:
			"One sentence removed from one rule, and the case it licensed restated as the limit of that rule's scope. d11 did what it was built for — lecture 3's 18.7% fell from 6 runs of 18 to 1 — but bought an unwanted cut on lecture 4 at 46.1%, made by 5 of 18, splitting a case study between its history and its mechanism. That seam is forbidden in substance by the holds rule and had been held by the progression rule: 46.1% is made by 3 of 11 d4 runs, none of d7's and 1 of 18 of d9's, and it returns only when the showing rule does. What brings it back is the sentence in which the showing rule says when a boundary DOES begin — 'a new step begins where what is shown is something they have not been discussing'. A permission in one rule defeating a prohibition in another is the failure this programme has measured more than any other: s5's two rules where the prohibition lost, s6's precedence clause that never engaged, d8's six prohibitions filed under one permission. So the rule now only ever withholds, and says so; the means-becomes-the-subject case is stated as what the rule does not cover, handing the decision back in the words the starts rule uses rather than issuing a licence of its own. Nothing else changes. What must not move: 18.7% at 1 of 18, and lecture 3's 24.0%, which the means-becomes-the-subject case exists to protect and which every run currently makes.",
		build: () => DEEPEN_PROMPT_V12,
	},
];

/**
 * Look up a deepening prompt version by id.
 *
 * @param options - Options object.
 * @param options.id - The version id, such as "d1".
 * @returns The version.
 * @throws Error when no version carries that id.
 */
export function deepenPromptVersion({ id }: { readonly id: string }): DeepenPromptVersion {
	const found = DEEPEN_PROMPTS.find((version) => version.id === id);
	if (found === undefined) {
		throw new Error(
			`No deepening prompt "${id}". Known versions: ${DEEPEN_PROMPTS.map((v) => v.id).join(", ")}`,
		);
	}
	return found;
}
