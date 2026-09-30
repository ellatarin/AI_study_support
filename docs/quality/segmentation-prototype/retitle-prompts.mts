/**
 * Prompts for retitling a subtopic whose title was written for a larger piece.
 *
 * When deepening cuts a subtopic, the first piece keeps the whole subtopic's
 * title, so the title can promise material the later pieces now hold. A
 * retitle call gives that first piece a title of its own. Each version is kept
 * as it was run; a change is a new version, never an edit.
 */

/**
 * One retitle prompt, as registered. A `subtopic` prompt is sent one subtopic
 * per call with its neighbours' titles; a `lecture` prompt is sent every
 * subtopic at once and titles them all.
 */
export type RetitlePromptVersion = {
	readonly id: string;
	readonly summary: string;
	readonly changed: string;
	readonly scope: "subtopic" | "lecture";
	readonly prompt: string;
};

/** r1–r3's task: one subtopic and its neighbours' titles. */
const ONE_SUBTOPIC_TASK =
	"You are given one subtopic of a university lecture: its full text, and the titles of the subtopics immediately before and after it. Give it a title.";

/** r1–r3's reply: one title. */
const ONE_TITLE_REPLY = `{
  "title": "what this subtopic is about"
}`;

/** r4's task: every subtopic of the lecture, titled in one reply. */
const WHOLE_LECTURE_TASK =
	"You are given a university lecture divided into subtopics, in order: each subtopic's id and full text. Give every subtopic a title. The rules below apply to each title.";

/** r4's reply: one title per subtopic, in order. */
const ONE_TITLE_PER_SUBTOPIC_REPLY = `{
  "titles": [
    { "id": <subtopic id>, "title": "what this subtopic is about" }
  ]
}

Give one entry for every subtopic, in the order the subtopics are given.`;

/** r2's rule: every title in the same case, whichever run or call wrote it. */
const SENTENCE_CASE_RULE = `

### R3 — Sentence case

Write the title in sentence case: capitalise its first word and any word that is always capitalised, such as a name, an acronym or a gene symbol, and nothing else.`;

/** r2's checklist question for R3. */
const SENTENCE_CASE_CHECK = `
- **R3**: is the title in sentence case, with only its first word and words that are always capitalised starting with a capital?`;

/** r3's method: the whole subtopic is read before any title is chosen. */
const READ_TO_THE_END_METHOD = `

## Method

Read the whole subtopic, to its last sentence, before choosing a title.`;

/**
 * R4: the title covers the subtopic as a whole and tells it apart from its neighbours.
 *
 * @param options - Options object.
 * @param options.point - What the subtopic develops: "the point" from r3, "the point or points" from r6.
 * @returns The rule section.
 */
const titleTheWholeRule = ({ point }: { readonly point: string }): string => `

### R4 — Title the whole subtopic

The title must say what the subtopic as a whole is about — ${point} it develops, not only how it opens or one example in it — and be specific enough that a reader could tell it apart from the subtopics either side.`;

/** r3's R4, one point per subtopic. */
const TITLE_THE_WHOLE_RULE = titleTheWholeRule({ point: "the point" });

/** r3's checklist question for R4. */
const TITLE_THE_WHOLE_CHECK = `
- **R4**: does the title say what the whole subtopic develops, rather than how it opens or one example in it, and could a reader tell it apart from the subtopics either side?`;

/**
 * A retitle prompt: the splitters' own title rule, a rule keeping the
 * neighbours' material out, and any further rules with their checks.
 *
 * @param options - Options object.
 * @param options.task - What the model is given and asked for; one subtopic before r4.
 * @param options.method - A method section before the rules; empty before r3.
 * @param options.extraRules - Rule sections appended after R2; empty for r1.
 * @param options.extraChecks - Checklist lines appended after R2's; empty for r1.
 * @param options.replyFormat - The JSON shape to reply in; one title before r4.
 * @returns The prompt.
 */
const RETITLE_PROMPT = ({
	task = ONE_SUBTOPIC_TASK,
	method = "",
	extraRules = "",
	extraChecks = "",
	replyFormat = ONE_TITLE_REPLY,
}: {
	readonly task?: string;
	readonly method?: string;
	readonly extraRules?: string;
	readonly extraChecks?: string;
	readonly replyFormat?: string;
}): string => `# Task

${task}${method}

## Rules

### R1 — Title it from its own text

Give the subtopic a short descriptive title taken from what the transcript actually says in it.

### R2 — Only what it covers

The title must describe only this subtopic's own text. Material the lecturer covers in the subtopics before or after it does not belong in its title, even where this subtopic mentions it in passing.${extraRules}

## Check before replying

- **R1**: does the title say what the transcript actually says here?
- **R2**: does the title name anything covered in the subtopic before or after, rather than in this one?${extraChecks}

## Reply format

Reply with a single JSON object and nothing else, in this exact shape:

${replyFormat}`;

/** r5's rule: the title leads with the main point, then only the subjects a student must learn. */
const MAIN_POINT_FIRST_RULE = `

### R5 — Main point first

Lead the title with the main point the subtopic develops. Then name the subjects it covers that a student would need to learn, such as a named mechanism, process or substance the lecturer explains rather than only mentions, as far as the title stays short.`;

/** r5's checklist question for R5. */
const MAIN_POINT_FIRST_CHECK = `
- **R5**: does the title lead with the main point, and does it name only the subjects a student must learn, without becoming a list?`;

/** r6's R5: r5's R5 without the subjects sentence, and allowing more than one point. */
const MAIN_POINTS_FIRST_RULE = `

### R5 — Main points first

Lead the title with the main point or points the subtopic develops.`;

/** r6's checklist question for R5. */
const MAIN_POINTS_FIRST_CHECK = `
- **R5**: does the title lead with the main point or points the subtopic develops?`;

/** R5's aim from r7 on: the best short description of the subject matter for a science undergraduate. */
const BEST_SHORT_DESCRIPTION = "the best short description of the subtopic's subject matter for a science undergraduate";

/**
 * R5 from r7 on, with any addition to its rule and its check.
 *
 * @param options - Options object.
 * @param options.ruleEnd - Appended to the rule sentence before its full stop; empty for r7.
 * @param options.checkEnd - Appended to the check question before its question mark; empty for r7.
 * @returns The rule section and its checklist line.
 */
const bestShortDescription = ({
	ruleEnd = "",
	checkEnd = "",
}: {
	readonly ruleEnd?: string;
	readonly checkEnd?: string;
}): { readonly rule: string; readonly check: string } => ({
	rule: `

### R5 — Best short description

Make the title ${BEST_SHORT_DESCRIPTION}${ruleEnd}.`,
	check: `
- **R5**: is the title ${BEST_SHORT_DESCRIPTION}${checkEnd}?`,
});

/** r7's R5. */
const { rule: BEST_SHORT_DESCRIPTION_RULE, check: BEST_SHORT_DESCRIPTION_CHECK } = bestShortDescription({});

/** r9's R5: r7's, asking for the most precise words. */
const { rule: PRECISE_DESCRIPTION_RULE, check: PRECISE_DESCRIPTION_CHECK } = bestShortDescription({
	ruleEnd: ", using the most precise words for it",
	checkEnd: ", and is each word the most precise one for it",
});

/** r8's rule: a recap is titled as a summary, and the lecture's closing part as its summary or close. */
const NAME_SUMMARIES_RULE = `

### R6 — Name summaries

Where a subtopic recaps material the lecture has already covered, begin its title with "Summary of". Where it is the lecture's closing summary or closing remarks, begin its title with "Lecture summary:" or "Lecture close:".`;

/** r8's checklist question for R6. */
const NAME_SUMMARIES_CHECK = `
- **R6**: if the subtopic recaps earlier material, does its title begin "Summary of"; if it closes the lecture, does its title begin "Lecture summary:" or "Lecture close:"?`;

/** r4's method: the subtopics are titled one at a time, each read to its end first. */
const ONE_AT_A_TIME_METHOD = `

## Method

Work through the subtopics one at a time, in order. For each, read it to its last sentence, then choose its title, following the rules below, before moving on to the next.`;

/** r3's method, rules and checks; r4 keeps the rules and checks byte for byte. */
const R3_SECTIONS = {
	method: READ_TO_THE_END_METHOD,
	extraRules: `${SENTENCE_CASE_RULE}${TITLE_THE_WHOLE_RULE}`,
	extraChecks: `${SENTENCE_CASE_CHECK}${TITLE_THE_WHOLE_CHECK}`,
};

/** r4's whole-lecture task, method and reply around r3's rules and checks, which r5 builds on. */
const R4_SECTIONS = {
	...R3_SECTIONS,
	task: WHOLE_LECTURE_TASK,
	method: ONE_AT_A_TIME_METHOD,
	replyFormat: ONE_TITLE_PER_SUBTOPIC_REPLY,
};

/** r7's sections: r4's with R5 as the best short description for a science undergraduate; r8 builds on them. */
const R7_SECTIONS = {
	...R4_SECTIONS,
	extraRules: `${R4_SECTIONS.extraRules}${BEST_SHORT_DESCRIPTION_RULE}`,
	extraChecks: `${R4_SECTIONS.extraChecks}${BEST_SHORT_DESCRIPTION_CHECK}`,
};

export const RETITLE_PROMPTS: readonly RetitlePromptVersion[] = [
	{
		id: "r1",
		summary: "The splitters' title rule, plus a rule keeping the neighbouring subtopics' material out of the title.",
		changed: "First version.",
		scope: "subtopic",
		prompt: RETITLE_PROMPT({}),
	},
	{
		id: "r2",
		summary: "r1 with R3: every title in sentence case.",
		changed:
			"A new rule R3 and its checklist question only: sentence case, capitalising the first word and words always capitalised. r1's 30 titles on the chosen d13 divisions mixed title case, sentence case and a lower-case start. Everything else is r1 byte for byte.",
		scope: "subtopic",
		prompt: RETITLE_PROMPT({ extraRules: SENTENCE_CASE_RULE, extraChecks: SENTENCE_CASE_CHECK }),
	},
	{
		id: "r3",
		summary: "r2 with a method step to read the whole subtopic first, and R4: the title covers the whole subtopic and tells it apart from its neighbours.",
		changed:
			"A Method section (read the whole subtopic, to its last sentence, before choosing a title) and a new rule R4 with its checklist question: the title says what the subtopic as a whole develops, not only its opening or one example, and is specific enough to tell it apart from the subtopics either side. The user found some of r2's titles not ideal. Everything else is r2 byte for byte.",
		scope: "subtopic",
		prompt: RETITLE_PROMPT(R3_SECTIONS),
	},
	{
		id: "r4",
		summary: "r3's rules, but every subtopic of the lecture is sent in one call and titled one at a time in one reply.",
		changed:
			"The task, method and reply format only: the model is given the whole lecture as its subtopics, in order, each with its id and full text and no title; it works through them one at a time, reading each to its last sentence and titling it by the rules before the next; and it replies with one title per subtopic. The user asked whether titling all subtopics at once does better than one call each. Rules and checks are r3 byte for byte.",
		scope: "lecture",
		prompt: RETITLE_PROMPT(R4_SECTIONS),
	},
	{
		id: "r5",
		summary: "r4 with R5: the title leads with the main point, then names only the subjects a student must learn.",
		changed:
			"A new rule R5 and its checklist question only: lead with the main point the subtopic develops, then name the subjects a student would need to learn, as far as the title stays short. Four r4 runs on l4 agreed on 13 of 22 titles; the rest foregrounded a different mechanism each run, and some titles read as lists. No word limit, by the user's choice. Everything else is r4 byte for byte.",
		scope: "lecture",
		prompt: RETITLE_PROMPT({
			...R4_SECTIONS,
			extraRules: `${R4_SECTIONS.extraRules}${MAIN_POINT_FIRST_RULE}`,
			extraChecks: `${R4_SECTIONS.extraChecks}${MAIN_POINT_FIRST_CHECK}`,
		}),
	},
	{
		id: "r6",
		summary: "r4 with R5 as \"lead with the main point or points\" only, and R4 allowing more than one point.",
		changed:
			"From r5: R5 loses its sentence on naming the subjects a student must learn, and says \"main point or points\"; its check matches. R4 says \"the point or points it develops\" instead of \"the point it develops\". r5's four l4 runs agreed on the main point far more often than r4's but titles grew to 9.1 words on average; the user asked whether dropping the subjects sentence and allowing several points does as well. Everything else is r5 byte for byte.",
		scope: "lecture",
		prompt: RETITLE_PROMPT({
			...R4_SECTIONS,
			extraRules: `${SENTENCE_CASE_RULE}${titleTheWholeRule({ point: "the point or points" })}${MAIN_POINTS_FIRST_RULE}`,
			extraChecks: `${R4_SECTIONS.extraChecks}${MAIN_POINTS_FIRST_CHECK}`,
		}),
	},
	{
		id: "r7",
		summary: "r4 with R5: the title is the best short description of the subject matter for a science undergraduate.",
		changed:
			"From r5: R5 and its check are replaced by \"make the title the best short description of the subtopic's subject matter for a science undergraduate\". r5 kept the l4 runs agreeing but titles averaged 9.1 words; r6 (main point or points, no subjects sentence) lost the agreement. The user asked for a title aimed at a science undergraduate. Everything else is r5 byte for byte.",
		scope: "lecture",
		prompt: RETITLE_PROMPT(R7_SECTIONS),
	},
	{
		id: "r8",
		summary: "r7 with R6: a recap is titled \"Summary of…\", and the lecture's closing part \"Lecture summary:\" or \"Lecture close:\".",
		changed:
			"A new rule R6 and its checklist question only. The user judged r7's titles on GPT-6.1 Sol Pro good throughout, except that recaps were not always named as summaries (l4 17 in 3 of 4 high-effort runs) and the lecture's closing part never was (l4 22, 0 of 8 runs). Everything else is r7 byte for byte.",
		scope: "lecture",
		prompt: RETITLE_PROMPT({
			...R7_SECTIONS,
			extraRules: `${R7_SECTIONS.extraRules}${NAME_SUMMARIES_RULE}`,
			extraChecks: `${R7_SECTIONS.extraChecks}${NAME_SUMMARIES_CHECK}`,
		}),
	},
	{
		id: "r9",
		summary: "r8 with R5 asking for the most precise words.",
		changed:
			"R5 and its check only: the rule adds \"using the most precise words for it\", the check adds \"and is each word the most precise one for it\". The user judged r8's titles good and asked for the words to be as precise as possible. Everything else is r8 byte for byte.",
		scope: "lecture",
		prompt: RETITLE_PROMPT({
			...R4_SECTIONS,
			extraRules: `${R4_SECTIONS.extraRules}${PRECISE_DESCRIPTION_RULE}${NAME_SUMMARIES_RULE}`,
			extraChecks: `${R4_SECTIONS.extraChecks}${PRECISE_DESCRIPTION_CHECK}${NAME_SUMMARIES_CHECK}`,
		}),
	},
];

/**
 * Look up a retitle prompt version by id.
 *
 * @param options - Options object.
 * @param options.id - The version id, such as "r1".
 * @returns The version.
 * @throws Error when no version carries that id.
 */
export function retitlePromptVersion({ id }: { readonly id: string }): RetitlePromptVersion {
	const found = RETITLE_PROMPTS.find((version) => version.id === id);
	if (found === undefined) {
		throw new Error(`No retitle prompt "${id}". Known versions: ${RETITLE_PROMPTS.map((v) => v.id).join(", ")}`);
	}
	return found;
}
