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
const MAY_HOLD_BODY = `"This is one step" is a real answer and you should give it whenever it is true. Do not manufacture a cut to justify the section having been sent. If you have read the passage and the lecturer does not finish with one thing and take up another anywhere inside it, say so and return no cuts.`;

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
const WHY_SENT_BODY_NEUTRAL = `This section reached you because its length was measured, and for no other reason. Nothing about its contents has been judged, by anyone, and its arrival is not evidence that it divides. Plenty of single steps are long: a lecturer may spend a great many words on one thing, and that is not a fault to be corrected. Read the passage and decide from the passage alone.`;

/** Referring to a thing is not taking it up. */
const MENTION_BODY = `Mentioning something is not taking it up. A lecturer constantly names neighbouring things in passing — to contrast with the thing under discussion, to set it up, to say what it is not, to recall something covered earlier. A boundary needs the lecturer to LEAVE the first thing behind and begin working on the second. A name in passing, however different the thing named, is not a boundary.`;

/** The working state and the broken one are the same thing. */
const WORKING_FAILING_BODY = `A thing shown working and then shown failing is one step. A lecture commonly explains how something operates and then what happens when it does not — the intact process and its breakdown, the rule and the exception, the normal case and the case that goes wrong. That is one thing examined from two sides, not two things. The move from the first to the second is not a boundary.`;

/** Multiplicity, but only once dividing has been established. */
const EVERY_PLACE_BODY_CONDITIONAL = `If — and only if — you have established that this section holds more than one step, then find every place it divides, not only the first. Work through from beginning to end. This rule tells you how thoroughly to look once you know there is something to find; it is not a reason to think there is.`;

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
const WORKING_FAILING_BODY_NAMED = `${WORKING_FAILING_BODY}
This holds however the second half is named. When the lecturer describes what happens if a process is absent, blocked or broken, that is still the same process — even when what happens instead carries a name of its own, and even when that name is introduced as though it were a separate thing.`;

/** A run of items serving one point is one step, however many items there are. */
/**
 * The single example, which neither of the other two rules about examples covers.
 *
 * {@link CASES_BODY_WITH_SCOPE} governs a RUN of instances and
 * {@link PARALLEL_BODY} a SET of items; one example worked through to show what
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
const SINGLE_EXAMPLE_BODY = `A single example worked through to show what a claim means belongs with that claim. When the lecturer states something and then takes one instance of it and follows that instance through in enough detail to show why the claim holds, the statement and the worked example are one step. This is the case of ONE example. Where the lecturer instead runs through several instances of a point, {{cases}} decides them.`;

const PARALLEL_BODY = `When the lecturer works through a set of things to make one point about all of them — ordering them, contrasting them, ranking them by some property — the whole run is one step. The point being made is the thing; the items are how it is made. Do not put a boundary between one item of such a run and the next, however different the items are from each other.`;

const SIGNAL_RULE_WITH_PIVOTS: NamedRule = {
	key: "signal",
	checked: true,
	heading: "Read the subject, not the speaker's words",
	body: SIGNAL_BODY_WITH_PIVOTS,
	check:
		"is any cut you propose at a pivot — a turn to the difficult, failing or exceptional case — rather than at a change of subject?",
};

const WORKING_FAILING_RULE_NAMED: NamedRule = {
	key: "working-failing",
	checked: true,
	heading: "Working and failing are one thing",
	body: WORKING_FAILING_BODY_NAMED,
	check:
		"is any cut you propose between a thing operating and the same thing breaking down, including where the breakdown is given a name of its own? If so, drop it.",
};

const SINGLE_EXAMPLE_RULE: NamedRule = {
	key: "single-example",
	checked: true,
	heading: "One worked example belongs with the claim it explains",
	body: SINGLE_EXAMPLE_BODY,
	check:
		"does any cut you propose separate a claim from the single example the lecturer works through to explain it? If so, drop it.",
};

const PARALLEL_RULE: NamedRule = {
	key: "parallel",
	checked: true,
	heading: "A run of items serving one point is one step",
	body: PARALLEL_BODY,
	check:
		"does any cut you propose fall between two items of a set the lecturer is working through to make a single point? If so, drop it.",
};

const WHY_SENT_RULE_NEUTRAL: NamedRule = {
	key: "why-sent",
	checked: false,
	heading: "Why this section reached you",
	body: WHY_SENT_BODY_NEUTRAL,
};

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

const EVERY_PLACE_RULE_CONDITIONAL: NamedRule = {
	key: "every-place",
	checked: true,
	heading: "If it divides, find every place",
	body: EVERY_PLACE_BODY_CONDITIONAL,
	check:
		"having decided the section divides, did you read to the end of it, or stop at the first boundary?",
};

const MAY_HOLD_RULE_FIRST: NamedRule = {
	key: "may-hold",
	checked: true,
	heading: "One long step is the answer whenever it is true",
	body: MAY_HOLD_BODY,
	check:
		"can you say, for each cut, what the lecturer finishes with and what they take up? If you cannot say both, drop that cut.",
};

const DEEPEN_METHOD: readonly string[] = [
	"Read the whole section before proposing anything.",
	"Work through it from beginning to end, noting each place the lecturer finishes with one thing and takes up another.",
	"Check every place you noted against the rules below, by name, and drop the ones that do not hold.",
	"If nothing survives, return no cuts and say the section is one step.",
];

const DEEPEN_REPLY = `You are not reproducing the passage. Each cut carries only its position:
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

When the section is one step, reply instead with:

{
  "verdict": "one step",
  "cuts": [],
  "heldBecause": "one sentence on what makes the whole section one thing"
}`;

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
const DEEPEN_METHOD_DECIDE_FIRST: readonly string[] = [
	"Read the whole section.",
	"Ask first whether the lecturer anywhere inside it finishes with one thing and takes up another. If not, the section is one step and you are done — reply with no cuts.",
	"Only if it does: work through the section from beginning to end and note every place where that happens.",
	"Check each place you noted against the rules below, by name, and drop the ones that do not hold.",
	"If nothing survives, reply with no cuts.",
];

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
const DEEPEN_RULES_V4: readonly NamedRule[] = [
	WHY_SENT_RULE_NEUTRAL,
	SIGNAL_RULE,
	HOLDS_RULE_OWN_MECHANISM,
	WORKING_FAILING_RULE_NAMED,
	SINGLE_EXAMPLE_RULE,
	PARALLEL_RULE,
	MENTION_RULE,
	STARTS_RULE_PRECEDENCE,
	CASES_RULE_WITH_SCOPE,
	MAY_HOLD_RULE_FIRST,
	EVERY_PLACE_RULE_CONDITIONAL,
	INSIDE_ONLY_RULE,
];

const DEEPEN_PROMPT_V4 = ruleDocument({
	role: ROLE_DEEPEN,
	definition: SUBTOPIC_DEFINITION_FLAT,
	method: DEEPEN_METHOD_DECIDE_FIRST,
	rules: DEEPEN_RULES_V4,
	replyFormat: DEEPEN_REPLY,
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
