/**
 * Prompts for retitling a subtopic whose title was written for a larger piece.
 *
 * When deepening cuts a subtopic, the first piece keeps the whole subtopic's
 * title, so the title can promise material the later pieces now hold. A
 * retitle call gives that first piece a title of its own. Each version is kept
 * as it was run; a change is a new version, never an edit.
 */

/** One retitle prompt, as registered. */
export type RetitlePromptVersion = {
	readonly id: string;
	readonly summary: string;
	readonly changed: string;
	readonly prompt: string;
};

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

/** r3's rule: the title covers the subtopic as a whole and tells it apart from its neighbours. */
const TITLE_THE_WHOLE_RULE = `

### R4 — Title the whole subtopic

The title must say what the subtopic as a whole is about — the point it develops, not only how it opens or one example in it — and be specific enough that a reader could tell it apart from the subtopics either side.`;

/** r3's checklist question for R4. */
const TITLE_THE_WHOLE_CHECK = `
- **R4**: does the title say what the whole subtopic develops, rather than how it opens or one example in it, and could a reader tell it apart from the subtopics either side?`;

/**
 * A retitle prompt: the splitters' own title rule, a rule keeping the
 * neighbours' material out, and any further rules with their checks.
 *
 * @param options - Options object.
 * @param options.method - A method section before the rules; empty before r3.
 * @param options.extraRules - Rule sections appended after R2; empty for r1.
 * @param options.extraChecks - Checklist lines appended after R2's; empty for r1.
 * @returns The prompt.
 */
const RETITLE_PROMPT = ({
	method = "",
	extraRules = "",
	extraChecks = "",
}: {
	readonly method?: string;
	readonly extraRules?: string;
	readonly extraChecks?: string;
}): string => `# Task

You are given one subtopic of a university lecture: its full text, and the titles of the subtopics immediately before and after it. Give it a title.${method}

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

{
  "title": "what this subtopic is about"
}`;

export const RETITLE_PROMPTS: readonly RetitlePromptVersion[] = [
	{
		id: "r1",
		summary: "The splitters' title rule, plus a rule keeping the neighbouring subtopics' material out of the title.",
		changed: "First version.",
		prompt: RETITLE_PROMPT({}),
	},
	{
		id: "r2",
		summary: "r1 with R3: every title in sentence case.",
		changed:
			"A new rule R3 and its checklist question only: sentence case, capitalising the first word and words always capitalised. r1's 30 titles on the chosen d13 divisions mixed title case, sentence case and a lower-case start. Everything else is r1 byte for byte.",
		prompt: RETITLE_PROMPT({ extraRules: SENTENCE_CASE_RULE, extraChecks: SENTENCE_CASE_CHECK }),
	},
	{
		id: "r3",
		summary: "r2 with a method step to read the whole subtopic first, and R4: the title covers the whole subtopic and tells it apart from its neighbours.",
		changed:
			"A Method section (read the whole subtopic, to its last sentence, before choosing a title) and a new rule R4 with its checklist question: the title says what the subtopic as a whole develops, not only its opening or one example, and is specific enough to tell it apart from the subtopics either side. The user found some of r2's titles not ideal. Everything else is r2 byte for byte.",
		prompt: RETITLE_PROMPT({
			method: READ_TO_THE_END_METHOD,
			extraRules: `${SENTENCE_CASE_RULE}${TITLE_THE_WHOLE_RULE}`,
			extraChecks: `${SENTENCE_CASE_CHECK}${TITLE_THE_WHOLE_CHECK}`,
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
