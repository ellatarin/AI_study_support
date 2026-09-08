/**
 * The splitting prompts — pass one — versioned.
 *
 * Pass one cuts the transcript into subtopics; `group-prompts.mts` holds the
 * prompts for pass two, which groups those subtopics into topics. This registry
 * is that one, and it follows the same discipline: one entry per version that
 * has been RUN, and a version is never edited once it has results against it.
 * The numbers in `GROUPING-RESULTS.md` and in the run files refer to this exact
 * text, so changing it would silently invalidate them. To try something new, add
 * the next version.
 *
 * Every rule body is a shared constant, so a version that restates a rule in a
 * different FORM cannot accidentally restate it in different WORDS. After any
 * refactor here, diff `split-versions.json` before and after to prove the older
 * versions are byte-identical.
 */

/** A splitting prompt version, with the record of what it changed and why. */
export type SplitPromptVersion = {
	/** Short id used on the command line and in every run file. */
	readonly id: string;
	/** What this version is, in one line. */
	readonly summary: string;
	/** What changed from the previous version. */
	readonly changed: string;
	/** Builds the system prompt for this version. */
	readonly build: () => string;
};

// ---------------------------------------------------------------------------
// The rule bodies. Each appears once and is composed into whichever versions
// carry it, in prose form or as a named markdown rule.
// ---------------------------------------------------------------------------

/** What the model is being asked to do. */
const ROLE = `You are dividing a university lecture transcript into topics, and each topic into subtopics.`;

/** The two levels, defined. */
const TOPIC_DEFINITION = `A TOPIC is a major division of the lecture — one of the handful of things the lecture is about.`;

const SUBTOPIC_DEFINITION = `A SUBTOPIC is a distinct step within a topic: a single claim developed, a mechanism explained, an example worked through.`;

/** Read the subject, not the speaker's discourse markers. */
const SIGNAL_BODY = `Decide where topics and subtopics change by reading what is being talked about. Do NOT rely on the speaker announcing a change. This lecturer says "So", "Right", and "Okay" constantly without changing subject, and several real changes of subject arrive with no announcement at all. The words are not the signal; the subject is.`;

/** Let the material set the number of divisions. */
const COUNT_BODY = `Do not decide in advance how many topics or subtopics there should be. Divide wherever the subject genuinely changes, and let the numbers be whatever they turn out to be. Every topic has at least one subtopic; a short topic may have exactly one.`;

/** The kind rule, scoped to subtopics — this is what makes version 3 version 3. */
const KIND_HEADING = `WITHIN A TOPIC, THINGS THAT DIFFER IN KIND DO NOT SHARE A SUBTOPIC.`;

const KIND_BODY = `Do not put under one SUBTOPIC things that differ in kind, even when the lecturer treats them one after another and for the same purpose. A biological agent and a chemical agent differ in kind. A physical agent such as radiation and a chemical one differ in kind. An experiment in living animals and one in cultured cells differ in kind. Serving the same argument does not make two things one subtopic, and neither does being adjacent in the lecture.
This does NOT apply to a thing and its own mechanism: an agent and the damage it causes, or a process and the molecular change it produces, are one subtopic and belong together.`;

/** The scope limit on the kind rule, which is the whole point of version 3. */
const TOPICS_EXEMPT_HEADING = `THIS RULE DOES NOT APPLY TO TOPICS.`;

const TOPICS_EXEMPT_BODY = `A topic is allowed — and often expected — to gather subtopics of different kinds, because what makes a topic is a shared line of argument rather than a shared kind. Chemical, physical and dietary agents may sit in one topic if the lecture treats them as one part of its argument; so may two different ways of testing for carcinogenicity. Do not split a topic merely because its subtopics differ in kind.`;

/** The lecture's framing is not yet its subject. */
const OPENING_HEADING = `THE OPENING IS ITS OWN DIVISION.`;

const OPENING_BODY = `A lecture opens with framing that is not yet its subject: welcome, learning outcomes, what the lecture will cover, how it relates to other lectures. That opening is its own division, separate from the first substantive topic. Do not fold it into the first thing the lecturer actually teaches.`;

/** The order of work: subtopics first, topics named from them. */
const BOTTOM_UP_LEAD = `Work from the bottom up. Find and label the subtopics first, from the transcript. Only then name each topic, and name it FROM ITS OWN SUBTOPICS:`;

/** What a topic's label may and may not say. Self-contained, so it stands alone as a rule. */
const NAMING_BULLETS = `- A topic's label must describe what its subtopics have in common, as a reader of those subtopic labels would summarise them.
- Do not introduce into a topic label any idea that none of its subtopics carries, and do not name a topic from what you expect a lecture on this subject to contain. If the subtopics do not support a tidy heading, give an untidy one that fits them.`;

/** What a subtopic's label is taken from. */
const SUBTOPIC_LABEL_BODY = `Give every subtopic a short descriptive label taken from what the transcript actually says there.`;

/** Each division states what makes its contents one thing. */
const WHY_HEADING = `SAY WHY EACH GROUPING HOLDS.`;

const WHY_BODY = `Every topic and every subtopic carries a "groupedBecause": one sentence saying what makes its contents one thing. Write it honestly. If the most you can say is that these were discussed together, or that they are all examples of something broad, then it is not one grouping and you must divide it.`;

/** The second pass over the model's own answer. */
const REREAD_HEADING = `THEN READ IT AGAIN.`;

const REREAD_BODY = `When you have divided the transcript, read each subtopic once more and ask whether the lecturer changes subject inside it. If so, split it. Do the same for each topic and its subtopics.`;

/** How a cut position is named, so the code can find it and slice the original. */
const POSITION_BODY = `You are not reproducing the transcript. Only subtopics carry a position, and a topic begins where its first subtopic begins:
- "startsWith" must be the first EIGHT to TWELVE words of the subtopic, copied from the transcript exactly as they appear. Do not tidy them, do not drop a leading "So" or "Right", do not change capitalisation, do not paraphrase. It is used to locate the cut, so it must match the transcript character for character.
- The first subtopic of the first topic begins at the very start of the transcript.
- Subtopics are contiguous and in order, and together they cover the whole transcript.`;

// ---------------------------------------------------------------------------
// The subtopic-only rule bodies, for versions that do not ask for a topic layer
// at all. Each is here because the two-level wording above names topics; the two
// that do not — the kind rule's body and the subtopic-label rule — are shared
// rather than restated.
// ---------------------------------------------------------------------------

/** What the model is being asked to do, with no topic layer. */
const ROLE_FLAT = `You are dividing a university lecture transcript into subtopics.`;

export const SUBTOPIC_DEFINITION_FLAT = `A SUBTOPIC is a distinct step in the lecture: a single claim developed, a mechanism explained, an example worked through.`;

export const SIGNAL_BODY_FLAT = `Decide where subtopics change by reading what is being talked about. Do NOT rely on the speaker announcing a change. This lecturer says "So", "Right", and "Okay" constantly without changing subject, and several real changes of subject arrive with no announcement at all. The words are not the signal; the subject is.`;

const COUNT_BODY_FLAT = `Do not decide in advance how many subtopics there should be. Divide wherever the subject genuinely changes, and let the number be whatever it turns out to be.`;

const OPENING_BODY_FLAT = `A lecture opens with framing that is not yet its subject: welcome, learning outcomes, what the lecture will cover, how it relates to other lectures. That opening is its own subtopic, separate from the first substantive one. Do not fold it into the first thing the lecturer actually teaches.`;

/** The closing counterpart of the opening rule — s4's one addition. */
const CLOSING_BODY_FLAT = `A lecture closes with housekeeping that is no longer its subject: thanks, administrative notices, recommended reading, what the next session will cover. That closing is its own subtopic, separate from the last substantive one. Do not fold it into the last thing the lecturer actually teaches.`;

const WHY_BODY_FLAT = `Every subtopic carries a "groupedBecause": one sentence saying what makes its contents one thing. Write it honestly. If the most you can say is that these were discussed together, or that they are all examples of something broad, then it is not one subtopic and you must divide it.`;

/**
 * The same rule with its "examples of something broad" clause removed.
 *
 * That clause forces a point apart from the cases illustrating it, which is
 * what {@link CASES_BODY_FLAT} exists to govern. A version carrying both would
 * hold two rules that contradict each other on the same passage, so a version
 * that takes the cases rule takes this in place of {@link WHY_BODY_FLAT}.
 */
const WHY_BODY_FLAT_TOGETHERNESS_ONLY = `Every subtopic carries a "groupedBecause": one sentence saying what makes its contents one thing. Write it honestly. If the most you can say is that these were discussed together, then it is not one subtopic and you must divide it.`;

/** What one subtopic contains, and what therefore never divides it. */
const HOLDS_BODY_FLAT = `A subtopic is one thing with some other elements that the lecturer brings to bear on it: the mechanism that explains it, what it in turn causes, the conclusion it is used to support.
Do not split a subtopic because the lecturer moves from a thing to its mechanism, from a cause to its effect, from a claim to the evidence for it.`;

/**
 * The same rule with "its mechanism" narrowed to "that thing's own mechanism".
 *
 * This is what s6 showed to be doing the damage. The precedence clause added
 * there never engaged, because the model never saw two rules competing: it read
 * a whole run of repair mechanisms as one thing plus its mechanisms and applied
 * this rule alone, naming three of them in its own reason while holding them
 * together. Narrowing the possessive is the other side of that fix.
 */
const HOLDS_BODY_OWN_MECHANISM = `A subtopic is one thing with some other elements that the lecturer brings to bear on it: that thing's own mechanism, what it in turn causes, the conclusion it is used to support.
Do not split a subtopic because the lecturer moves from a thing to that thing's own mechanism, from a cause to its effect, from a claim to the evidence for it.`;

/** What ends one subtopic and begins the next. */
const STARTS_BODY_FLAT = `Split when the lecturer takes up a different thing — a different mechanism, a different agent, a different case.`;

/**
 * The same rule, saying that it decides when it and the holds rule disagree.
 *
 * s5's runs merged every repair mechanism into one subtopic while their own
 * reasons named two of them, so both rules were in play and the prohibition beat
 * the permission. The last clause of the second sentence settles it without
 * citing the other rule: serving one larger explanation is not a reason to join.
 * The case trigger goes, so that cases are decided in one place only, and what
 * replaces it is a pointer rather than a second decision.
 */
const STARTS_BODY_PRECEDENCE = `Split when the lecturer takes up a different thing — another mechanism, another agent. Each new one begins its own subtopic, however many the lecturer works through, and that holds even when they all serve the same overall point and all explain the same larger process. This does not cover cases that illustrate a point; those are decided by {{cases}}.`;

/** When a point's illustrating cases become subtopics of their own, and when they do not. */
const CASES_BODY_FLAT = `Cases illustrating a point stay with that point, unless each of them would stand as a substantial passage on its own — roughly 350 words or more — in which case they each become their own subtopic. The decision covers all of them or none: it is not acceptable to give some of a point's cases their own subtopic and leave the others with the point.`;

/**
 * The same rule, saying which cases it governs and where the others are decided.
 *
 * s6 took the case trigger out of the starts rule so that cases had one home,
 * and the home then swallowed a case that was making a new claim rather than
 * illustrating the one before it: the closing case study went from missed in 11
 * runs of 16 to all 16. Cases still have one home; this is the clause that says
 * what the home covers.
 */
const CASES_BODY_WITH_SCOPE = `Cases illustrating a point stay with that point, unless each of them would stand as a substantial passage on its own — roughly 350 words or more — in which case they each become their own subtopic. The decision covers all of them or none: it is not acceptable to give some of a point's cases their own subtopic and leave the others with the point.
This covers only cases that illustrate a point. A case the lecturer takes up in its own right — one that makes a new claim of its own rather than illustrating the point before it — is a different thing, and {{starts}} decides it.`;

const REREAD_BODY_FLAT = `When you have divided the transcript, read each subtopic once more and ask whether the lecturer changes subject inside it. If so, split it.`;

/**
 * The size ceiling — the first rule in this series aimed at depth rather than
 * at subject matter.
 *
 * Every cut s7 still misses leaves an oversized subtopic behind: 1,192 words
 * where the repair-pathway boundary belongs, 992 at the closing case study,
 * 1,284 at the p53 boundary, against a typical subtopic of about 480. Measured
 * over s7's runs, a 700-word threshold covers 81% of the remaining misses while
 * flagging 30% of subtopics.
 *
 * It has to stay advisory. Three subtopics of the division being aimed at are
 * themselves over 700 words, so a rule that forced a split at the threshold
 * would break what it is meant to fix.
 */
const CEILING_BODY_FLAT = `A subtopic that runs much past 700 words of speech is usually more than one step, and it may be several. When one does, read that subtopic again and find every place in it where the lecturer finishes with one thing and takes up the next. Split at all of them, not only the first. Then look at the pieces: any piece still much past 700 words gets the same treatment again.
Length on its own is not a reason to split. Some steps genuinely are long, and a long subtopic you have read again and found no change of subject inside stays as it is.`;

const POSITION_BODY_FLAT = `You are not reproducing the transcript. Each subtopic carries only its position:
- "startsWith" must be the first EIGHT to TWELVE words of the subtopic, copied from the transcript exactly as they appear. Do not tidy them, do not drop a leading "So" or "Right", do not change capitalisation, do not paraphrase. It is used to locate the cut, so it must match the transcript character for character.
- The first subtopic begins at the very start of the transcript.
- Subtopics are contiguous and in order, and together they cover the whole transcript.`;

const REPLY_SHAPE_FLAT = `Reply with a single JSON object and nothing else, in this exact shape:

{
  "subtopics": [
    {
      "id": 1,
      "label": "what this subtopic is about",
      "groupedBecause": "one sentence on what makes this passage one subtopic",
      "startsWith": "the first eight to twelve words, verbatim"
    }
  ]
}

Ids count up from 1. Subtopics appear in transcript order.`;

/** The reply's exact shape. */
const REPLY_SHAPE = `Reply with a single JSON object and nothing else, in this exact shape:

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

// ---------------------------------------------------------------------------
// The subtopic-only rules, and the document they compose into. A version in
// this form is an ORDERING of these rules: the rule numbers and the checklist
// are derived from the order, so a version that adds or removes a rule cannot
// leave a stale number behind, and the difference between two such versions is
// visible as the difference between two lists.
// ---------------------------------------------------------------------------

/**
 * What every rule carries, whether or not it is checked.
 *
 * `key` is the rule's identity. Rule NUMBERS are derived from position, so a
 * rule that cited another by number would point at the wrong one the moment the
 * list is reordered; bodies cite `{{key}}` instead and
 * {@link subtopicsOnlyPrompt} fills in the number as it assembles the document.
 */
type RuleBase = {
	/** Stable id, unique within a version. What a cross-reference names. */
	readonly key: string;
	readonly heading: string;
	/** May cite another rule as `{{key}}`, resolved to its number at build time. */
	readonly body: string;
};

/**
 * One named rule of a markdown-form prompt.
 *
 * Whether a rule carries a checklist question is a difference in what the built
 * document contains, so it discriminates rather than being an optional field.
 */
export type NamedRule =
	| (RuleBase & { readonly checked: false })
	| (RuleBase & {
			readonly checked: true;
			/** The question the "Check before replying" list asks about this rule. */
			readonly check: string;
	  });

export const SIGNAL_RULE: NamedRule = {
	key: "signal",
	checked: false,
	heading: "Read the subject, not the speaker's words",
	body: SIGNAL_BODY_FLAT,
};

const COUNT_RULE: NamedRule = {
	key: "count",
	checked: false,
	heading: "Let the material set the number",
	body: COUNT_BODY_FLAT,
};

const KIND_RULE: NamedRule = {
	key: "kind",
	checked: true,
	heading: "Things that differ in kind do not share a subtopic",
	body: KIND_BODY,
	check: "does any subtopic hold things that differ in kind? If so, split it.",
};

const OPENING_RULE: NamedRule = {
	key: "opening",
	checked: true,
	heading: "The opening is its own subtopic",
	body: OPENING_BODY_FLAT,
	check: "is the opening framing its own subtopic, separate from the first substantive one?",
};

const CLOSING_RULE: NamedRule = {
	key: "closing",
	checked: true,
	heading: "The closing is its own subtopic",
	body: CLOSING_BODY_FLAT,
	check: "is the closing housekeeping its own subtopic, separate from the last substantive one?",
};

const SUBTOPIC_LABEL_RULE: NamedRule = {
	key: "label",
	checked: true,
	heading: "Label every subtopic from the transcript",
	body: SUBTOPIC_LABEL_BODY,
	check: "does every label say what the transcript actually says there?",
};

const WHY_RULE: NamedRule = {
	key: "why",
	checked: true,
	heading: "Say why each subtopic holds together",
	body: WHY_BODY_FLAT,
	check:
		'is any `groupedBecause` no more than "these were discussed together" or "these are all examples of something broad"? If so, divide that subtopic.',
};

const CEILING_RULE: NamedRule = {
	key: "ceiling",
	checked: true,
	heading: "Long subtopics get read again",
	body: CEILING_BODY_FLAT,
	check:
		"is any subtopic much past 700 words? If so, have you read it again and split at every place the lecturer moves on, including the pieces that are themselves still long?",
};

const REREAD_RULE: NamedRule = {
	checked: false,
	heading: "Then read it again",
	body: REREAD_BODY_FLAT,
};

const HOLDS_RULE: NamedRule = {
	key: "holds",
	checked: true,
	heading: "What one subtopic holds",
	body: HOLDS_BODY_FLAT,
	check:
		"does any subtopic break a thing from its mechanism, a cause from its effect, or a claim from the evidence for it? If so, join them.",
};

const STARTS_RULE: NamedRule = {
	key: "starts",
	checked: false,
	heading: "What starts a new subtopic",
	body: STARTS_BODY_FLAT,
};

export const HOLDS_RULE_OWN_MECHANISM: NamedRule = {
	key: "holds",
	checked: true,
	heading: "What one subtopic holds",
	body: HOLDS_BODY_OWN_MECHANISM,
	check:
		"does any subtopic break a thing from its own mechanism, a cause from its effect, or a claim from the evidence for it? If so, join them.",
};

export const CASES_RULE_WITH_SCOPE: NamedRule = {
	key: "cases",
	checked: true,
	heading: "Cases that illustrate a point",
	body: CASES_BODY_WITH_SCOPE,
	check:
		"have you given some of a point's illustrating cases their own subtopic while leaving the others with the point? All of them or none.",
};

export const STARTS_RULE_PRECEDENCE: NamedRule = {
	key: "starts",
	checked: false,
	heading: "What starts a new subtopic",
	body: STARTS_BODY_PRECEDENCE,
};

const CASES_RULE: NamedRule = {
	key: "cases",
	checked: true,
	heading: "Cases that illustrate a point",
	body: CASES_BODY_FLAT,
	check:
		"have you given some of a point's illustrating cases their own subtopic while leaving the others with the point? All of them or none.",
};

const WHY_RULE_TOGETHERNESS_ONLY: NamedRule = {
	key: "why",
	checked: true,
	heading: "Say why each subtopic holds together",
	body: WHY_BODY_FLAT_TOGETHERNESS_ONLY,
	check:
		'is any `groupedBecause` no more than "these were discussed together"? If so, divide that subtopic.',
};

/** s3's rules, in the order it states them. */
const SUBTOPIC_RULES: readonly NamedRule[] = [
	SIGNAL_RULE,
	COUNT_RULE,
	KIND_RULE,
	OPENING_RULE,
	SUBTOPIC_LABEL_RULE,
	WHY_RULE,
	REREAD_RULE,
];

/** s4's rules: s3's, with the closing rule standing beside the opening one. */
const SUBTOPIC_RULES_WITH_CLOSING: readonly NamedRule[] = [
	SIGNAL_RULE,
	COUNT_RULE,
	KIND_RULE,
	OPENING_RULE,
	CLOSING_RULE,
	SUBTOPIC_LABEL_RULE,
	WHY_RULE,
	REREAD_RULE,
];

/**
 * s5's rules: s4's, with the kind rule replaced by the three that say what one
 * subtopic holds, what starts the next, and what becomes of illustrative cases.
 * The groupedBecause rule changes with them, for the reason given on
 * {@link WHY_BODY_FLAT_TOGETHERNESS_ONLY}.
 */
const SUBTOPIC_RULES_ONE_THING: readonly NamedRule[] = [
	SIGNAL_RULE,
	COUNT_RULE,
	HOLDS_RULE,
	STARTS_RULE,
	CASES_RULE,
	OPENING_RULE,
	CLOSING_RULE,
	SUBTOPIC_LABEL_RULE,
	WHY_RULE_TOGETHERNESS_ONLY,
	REREAD_RULE,
];

/** s6's rules: s5's, with the starts rule saying it decides when the two clash. */
const SUBTOPIC_RULES_PRECEDENCE: readonly NamedRule[] = [
	SIGNAL_RULE,
	COUNT_RULE,
	HOLDS_RULE,
	STARTS_RULE_PRECEDENCE,
	CASES_RULE,
	OPENING_RULE,
	CLOSING_RULE,
	SUBTOPIC_LABEL_RULE,
	WHY_RULE_TOGETHERNESS_ONLY,
	REREAD_RULE,
];

/**
 * s7's rules: s6's, with the holds rule narrowed to a thing's own mechanism and
 * the cases rule saying which cases it governs. Both are answers to s6's runs.
 */
const SUBTOPIC_RULES_OWN_MECHANISM: readonly NamedRule[] = [
	SIGNAL_RULE,
	COUNT_RULE,
	HOLDS_RULE_OWN_MECHANISM,
	STARTS_RULE_PRECEDENCE,
	CASES_RULE_WITH_SCOPE,
	OPENING_RULE,
	CLOSING_RULE,
	SUBTOPIC_LABEL_RULE,
	WHY_RULE_TOGETHERNESS_ONLY,
	REREAD_RULE,
];

/** s8's rules: s7's, with the size ceiling standing before the re-read. */
const SUBTOPIC_RULES_WITH_CEILING: readonly NamedRule[] = [
	SIGNAL_RULE,
	COUNT_RULE,
	HOLDS_RULE_OWN_MECHANISM,
	STARTS_RULE_PRECEDENCE,
	CASES_RULE_WITH_SCOPE,
	OPENING_RULE,
	CLOSING_RULE,
	SUBTOPIC_LABEL_RULE,
	WHY_RULE_TOGETHERNESS_ONLY,
	CEILING_RULE,
	REREAD_RULE,
];

/**
 * Composes a subtopics-only prompt from an ordered list of rules.
 *
 * Everything outside the rules and the checklist is fixed, so two versions
 * built from this differ in exactly what their rule lists differ in.
 *
 * @param options - Options object.
 * @param options.rules - The rules, in the order the document states them.
 * @returns The system prompt.
 */
export function ruleDocument({
	role,
	definition,
	method,
	rules,
	replyFormat,
}: {
	/** The opening line: what the model is being asked to do. */
	readonly role: string;
	/** What a subtopic is — the same fact for every pass that divides one. */
	readonly definition: string;
	/** The numbered steps, one per line, without their numbers. */
	readonly method: readonly string[];
	/** The rules, in the order the document states them. */
	readonly rules: readonly NamedRule[];
	/** Everything under "Reply format". */
	readonly replyFormat: string;
}): string {
	const named = rules.map((rule, index) => ({ rule, name: `R${index + 1}` }));
	const numberOf = new Map(named.map(({ rule, name }) => [rule.key, name]));
	if (numberOf.size !== named.length) {
		throw new Error("two rules share a key, so a cross-reference to it is ambiguous");
	}
	const resolve = (text: string): string =>
		text.replace(/\{\{([^}]+)\}\}/gu, (_whole, key: string) => {
			const number = numberOf.get(key);
			if (number === undefined) {
				throw new Error(`rule cites "${key}", which this version does not carry`);
			}
			return number;
		});
	const sections = named.map(
		({ rule, name }) => `### ${name} — ${rule.heading}\n\n${resolve(rule.body)}`,
	);
	const checks = named.flatMap(({ rule, name }) =>
		rule.checked ? [`- **${name}**: ${resolve(rule.check)}`] : [],
	);
	const steps = method.map((step, index) => `${index + 1}. ${step}`);
	return `# Task

${role}

## What a subtopic is

${definition}

## Method

${steps.join("\n")}

## Rules

${sections.join("\n\n")}

## Check before replying

${checks.join("\n")}

## Reply format

${replyFormat}`;
}

/** The method steps every subtopics-only splitting version states. */
const SPLIT_METHOD: readonly string[] = [
	"Read the transcript and find where the subject changes. Divide it into subtopics.",
	"Label each subtopic.",
	"Write each subtopic's `groupedBecause`.",
	"Read your subtopics again and split any that change subject inside them.",
	"Check your answer against every rule below, by name, before replying.",
];

function subtopicsOnlyPrompt({ rules }: { readonly rules: readonly NamedRule[] }): string {
	return ruleDocument({
		role: ROLE_FLAT,
		definition: SUBTOPIC_DEFINITION_FLAT,
		method: SPLIT_METHOD,
		rules,
		replyFormat: `${POSITION_BODY_FLAT}\n\n${REPLY_SHAPE_FLAT}`,
	});
}

// ---------------------------------------------------------------------------
// The versions.
// ---------------------------------------------------------------------------

/**
 * s1 — the prose prompt, as it has been run since the two-pass split was
 * settled. Every `hierv3-*` run in `runs/` was produced by this exact text; it
 * is `HIER_PROMPT_V3` moved here unchanged, character for character.
 */
const PROSE_PROMPT = [
	ROLE,
	"",
	TOPIC_DEFINITION,
	SUBTOPIC_DEFINITION,
	"",
	SIGNAL_BODY,
	"",
	COUNT_BODY,
	"",
	KIND_HEADING,
	KIND_BODY,
	"",
	`${TOPICS_EXEMPT_HEADING} ${TOPICS_EXEMPT_BODY}`,
	"",
	OPENING_HEADING,
	OPENING_BODY,
	"",
	BOTTOM_UP_LEAD,
	NAMING_BULLETS,
	"",
	SUBTOPIC_LABEL_BODY,
	"",
	WHY_HEADING,
	WHY_BODY,
	"",
	REREAD_HEADING,
	REREAD_BODY,
	"",
	POSITION_BODY,
	"",
	REPLY_SHAPE,
].join("\n");

/**
 * s2 — s1's rules restated as a structured document.
 *
 * The same change g5 to g6 made to the grouping prompt, applied here: markdown
 * headings, a numbered method, and NAMED rules the model can check its answer
 * against. Not one rule is added, removed or reworded in substance — every rule
 * body above is the same constant s1 composes.
 */
const STRUCTURED_PROMPT = `# Task

${ROLE}

## Topics and subtopics

${TOPIC_DEFINITION}

${SUBTOPIC_DEFINITION}

## Method

1. Read the transcript and find where the subject changes. Divide it into subtopics.
2. Label each subtopic.
3. Group the subtopics into topics, and name each topic from its own subtopics.
4. Write each topic's and each subtopic's \`groupedBecause\`.
5. Read your divisions again and split any that change subject inside them.
6. Check your answer against every rule below, by name, before replying.

## Rules

### R1 — Read the subject, not the speaker's words

${SIGNAL_BODY}

### R2 — Let the material set the number

${COUNT_BODY}

### R3 — Within a topic, things that differ in kind do not share a subtopic

${KIND_BODY}

### R4 — R3 does not apply to topics

${TOPICS_EXEMPT_BODY}

### R5 — The opening is its own division

${OPENING_BODY}

### R6 — Name each topic from its own subtopics

${NAMING_BULLETS}

### R7 — Label every subtopic from the transcript

${SUBTOPIC_LABEL_BODY}

### R8 — Say why each grouping holds

${WHY_BODY}

### R9 — Then read it again

${REREAD_BODY}

## Check before replying

- **R3**: does any subtopic hold things that differ in kind? If so, split it.
- **R4**: have you split any topic merely because its subtopics differ in kind?
- **R5**: is the opening framing its own division, separate from the first substantive topic?
- **R6**: does every topic label describe only what its own subtopics carry?
- **R8**: is any \`groupedBecause\` no more than "these were discussed together" or "these are all examples of something broad"? If so, divide that grouping.

## Reply format

${POSITION_BODY}

${REPLY_SHAPE}`;

/**
 * s3 — the same structure as s2 with the topic layer removed entirely.
 *
 * Pass two regroups the subtopics from scratch and has never read pass one's
 * topics, so the topic half of this prompt was work whose only output was
 * discarded. Removing it is what makes s3 a different prompt rather than a
 * different presentation: every rule that survives is about subtopics, and every
 * rule that existed only to govern topics is gone.
 *
 * The kind rule's body and the subtopic-label rule are the two that never named
 * a topic, so they are the s2 constants unchanged; the rest are restated without
 * their topic clauses.
 */
const SUBTOPICS_ONLY_PROMPT = subtopicsOnlyPrompt({ rules: SUBTOPIC_RULES });

/**
 * s4 — s3 with one rule added: the closing is its own subtopic.
 *
 * s3 protects the opening and says nothing about the close, and over sixteen
 * runs on lecture 5 the boundary between the last substantive passage and the
 * lecturer's housekeeping was taken by only five of them. The merged runs name
 * the housekeeping in their own reason — "and concludes the lecture" — and keep
 * it anyway, so the rule states outright what the reasons already notice.
 */
const SUBTOPICS_ONLY_WITH_CLOSING_PROMPT = subtopicsOnlyPrompt({
	rules: SUBTOPIC_RULES_WITH_CLOSING,
});

/**
 * s5 — s4 with the kind rule replaced by the "one thing" principle.
 *
 * The kind rule asked which things differ; these ask what one thing is. A
 * subtopic is one thing together with the mechanism, the effect and the
 * conclusion the lecturer brings to bear on it, and it ends when a different
 * thing is taken up. Cases illustrating a point get their own rule, because the
 * answer there depends on how substantial each case is.
 */
const SUBTOPICS_ONLY_ONE_THING_PROMPT = subtopicsOnlyPrompt({
	rules: SUBTOPIC_RULES_ONE_THING,
});

/**
 * s6 — s5 with the starts rule given precedence over the holds rule.
 *
 * s5 answered the question it was asked and then kept going: it stopped making
 * the cuts that were not wanted, and stopped making four that were. The two
 * rules were both true at those boundaries and the one forbidding a split won.
 */
const SUBTOPICS_ONLY_PRECEDENCE_PROMPT = subtopicsOnlyPrompt({
	rules: SUBTOPIC_RULES_PRECEDENCE,
});

/**
 * s7 — s6 with the two things its runs showed to be wrong.
 *
 * s6 was the most reproducible version measured — fifteen of sixteen runs agreed
 * on the count — and it reproduced the wrong division. Both faults were in what
 * the rules said rather than in how consistently they were followed: "its
 * mechanism" was read as any mechanism serving the same discussion, and cases
 * given one home swallowed a case that was not illustrating anything.
 */
const SUBTOPICS_ONLY_OWN_MECHANISM_PROMPT = subtopicsOnlyPrompt({
	rules: SUBTOPIC_RULES_OWN_MECHANISM,
});

/**
 * s8 — s7 with the size ceiling.
 *
 * The first rule in the series that is about depth rather than about subject
 * matter. s5, s6 and s7 each fixed what they were aimed at and left the missed
 * cuts where they were, and every one of those misses leaves an oversized
 * subtopic — so this attacks the same error from the other side.
 */
const SUBTOPICS_ONLY_CEILING_PROMPT = subtopicsOnlyPrompt({
	rules: SUBTOPIC_RULES_WITH_CEILING,
});

/** Every splitting prompt that has been run, oldest first. */
export const SPLIT_PROMPTS: readonly SplitPromptVersion[] = [
	{
		id: "s1",
		summary:
			"The prose prompt: the kind rule scoped to subtopics, topics explicitly exempt, opening its own division, groupedBecause, and a re-read pass.",
		changed:
			"First version in this registry. It is HIER_PROMPT_V3 moved here character for character, so every archived hierv3 run is a run of s1.",
		build: () => PROSE_PROMPT,
	},
	{
		id: "s2",
		summary: "s1's rules restated as a structured document — markdown headings, a numbered method, and named rules R1 to R9.",
		changed:
			"Presentation only. Every rule of s1 is carried over unchanged in substance, from the same constants; they are now named and numbered so the model can check its answer against them by name. This is the g5-to-g6 change applied to pass one. CONFOUND, as it was there: markdown form, the numbered method and the checklist move together, so a difference cannot be attributed to any one of them.",
		build: () => STRUCTURED_PROMPT,
	},
	{
		id: "s3",
		summary: "s2 with the topic layer removed: pass one is asked for subtopics and nothing else.",
		changed:
			"Substantive, not presentational. The topic layer goes: the reply is a flat list of subtopics, and the rules that existed only to govern topics — the exemption from the kind rule, and naming a topic from its own subtopics — go with it. Every surviving rule is restated without its topic clauses. Pass two regroups from scratch and never read pass one's topics, so nothing downstream loses an input.",
		build: () => SUBTOPICS_ONLY_PROMPT,
	},
	{
		id: "s4",
		summary: "s3 with one rule added: the lecture's closing housekeeping is its own subtopic.",
		changed:
			"One rule, so the effect is attributable to it. R5 states the counterpart of the opening rule — thanks, notices, recommended reading and what the next session covers are their own subtopic, not part of the last substantive one — and the checklist gains the matching question; the later rules renumber accordingly. Nothing else moves: the same method, the same seven other rules from the same constants, the same reply format. It targets the seam sixteen s3 runs on lecture 5 took only five times, and it is also the calibration: a rule this crisp either makes that seam unanimous or shows that no rule will.",
		build: () => SUBTOPICS_ONLY_WITH_CLOSING_PROMPT,
	},
	{
		id: "s5",
		summary:
			"s4 with the kind rule replaced by the 'one thing' principle: a subtopic is one thing plus the mechanism, effect and conclusion brought to bear on it, and illustrative cases get a rule of their own.",
		changed:
			"Substantive, and the largest change since s3. The kind rule goes, and three rules take its place: what one subtopic holds (a thing with its mechanism, its effect and the conclusion it supports, never divided by moving between them), what starts a new one (a different mechanism, agent or case), and what becomes of cases illustrating a point (they stay with the point unless each would run to roughly 350 words, and the choice covers all of them or none). The groupedBecause rule is amended with them: its 'all examples of something broad' clause forced a point apart from its own cases, which the new cases rule forbids, so a version carrying both would contradict itself on that passage. NOT included: the general word floor discussed alongside these rules, which was never ruled on — so a short passage that only elaborates what precedes it is unprotected, and the replication-to-mitosis boundary the user asked to run on may still be cut.",
		build: () => SUBTOPICS_ONLY_ONE_THING_PROMPT,
	},
	{
		id: "s6",
		summary:
			"s5 with the starts rule given precedence over the holds rule, and the case trigger taken out of it so cases are decided in one place.",
		changed:
			"One rule's body. s5 stopped making the unwanted cuts and stopped making four wanted ones with them, because both rules were true at those boundaries and the one forbidding a split won: sixteen runs merged the repair mechanisms into a single subtopic while their own reasons named two of them. The starts rule now says a further mechanism or agent begins a subtopic however many there are, and that serving one overall point and one larger explanation is not a reason to join — stated as substance rather than as a citation, so nothing depends on rule order. Its case trigger goes: cases were named in two rules at once, and giving this one precedence would have repealed the cases rule and split a point from its own illustrations. What replaces the trigger is a pointer to the cases rule, resolved to its number at build time. NOT included, again: the word floor. So the replication-to-mitosis boundary, held in s5 only because nothing cut there, is now expected to be cut.",
		build: () => SUBTOPICS_ONLY_PRECEDENCE_PROMPT,
	},
	{
		id: "s7",
		summary:
			"s6 with the holds rule narrowed to a thing's own mechanism, and the cases rule saying which cases it governs.",
		changed:
			"Two rule bodies, both answering something s6's runs showed. First: the holds rule said 'from a thing to its mechanism', which was read as any mechanism serving the same discussion — s6's reasons named three repair mechanisms and held them in one subtopic, so the precedence clause added in s6 never engaged because no contest between rules was ever seen. It now says 'that thing's own mechanism', in both the definition and the prohibition. Second: s6 removed the case trigger so that cases had one home, and that home then swallowed a case making a new claim rather than illustrating the one before it — the closing case study went from missed in 11 runs to all 16. Cases keep one home; the cases rule now says what the home covers and hands the other kind to the starts rule by reference, resolved to its number at build time. NOT included, still: the word floor.",
		build: () => SUBTOPICS_ONLY_OWN_MECHANISM_PROMPT,
	},
	{
		id: "s8",
		summary:
			"s7 with a size ceiling: a subtopic much past 700 words is read again and split at every place the lecturer moves on.",
		changed:
			"One rule added, and the first in this series aimed at depth rather than at subject matter. s5, s6 and s7 each fixed what they were aimed at and left the missed cuts roughly where they were; every one of those misses leaves an oversized subtopic behind — 1,192 words where the repair-pathway boundary belongs, 992 at the closing case study, 1,284 at the p53 boundary, against a typical subtopic of about 480. Measured over s7's runs a 700-word threshold covers 81% of the remaining misses while flagging 30% of subtopics. The rule is deliberately advisory and deliberately plural: three subtopics of the division being aimed at are themselves over 700 words, so forcing a split at the threshold would break what it is meant to fix; and a block that has swallowed two boundaries needs two cuts, so it asks for every place the lecturer moves on and then re-examines the pieces. NOT included, still: the word floor.",
		build: () => SUBTOPICS_ONLY_CEILING_PROMPT,
	},
];

/**
 * Look up a splitting prompt version by id.
 *
 * @param options - Options object.
 * @param options.id - The version id, such as "s1".
 * @returns The version.
 * @throws Error when no version carries that id.
 */
export function splitPromptVersion({ id }: { readonly id: string }): SplitPromptVersion {
	const found = SPLIT_PROMPTS.find((version) => version.id === id);
	if (found === undefined) {
		throw new Error(
			`No splitting prompt "${id}". Known versions: ${SPLIT_PROMPTS.map((v) => v.id).join(", ")}`,
		);
	}
	return found;
}
