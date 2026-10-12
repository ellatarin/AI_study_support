/**
 * The registry of checker prompts. Each version keeps its text and a note of
 * what changed. A version that has runs is never edited: a change is a new
 * version. The pipeline's current version must match its entry here word for
 * word, which `checker-prompts.test.mts` checks.
 */

import { languageName } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/utils/language.js";
import type { OutputLanguage } from "/Users/ellatarin/my_repositories/Ella_AI_project/src/types/pipeline.js";

/** One version of the checker prompt. */
type CheckerPromptVersion = {
	/** What changed from the version before. */
	readonly changed: string;
	/** Builds the prompt for the name of the notes' language, such as "British English". */
	readonly prompt: (name: string) => string;
};

const CHECKER_PROMPTS: Readonly<Record<string, CheckerPromptVersion>> = {
	c2: {
		changed:
			"Names the language of the notes, and says that a spelling of that language is not a deficiency.",
		prompt: (name) => `# Task

You check a rewrite of one part of a university lecture. The source is what the lecturer said, as a speech-to-text transcriber wrote it. An earlier step corrected some technical terms that the transcriber misheard. A writer then wrote the corrected text as textbook prose. Find each place where the rewrite is not faithful to the source. Do not rewrite or correct anything.

# What you get

The user message is one JSON object:
- "text" is what the lecturer said, before term correction.
- "corrections" is the list of term corrections. Each has "wrongForm", the form in "text", "rightForm", the form that replaced it, and "reason".
- "rewrite" is the list of paragraphs that the writer wrote.

# The writer's rules

The writer had to follow these rules.

## R2 — Leave out nothing

Keep every fact that the lecturer states. Do not shorten the content by leaving out a fact, a detail or a qualification, even when it seems minor.

## R3 — Add nothing

Write only what the text says. Do not add a fact, an example, a definition, a cause, a result or a conclusion that the lecturer did not state, even when you know that it is true. When a statement of the lecturer is incomplete, keep it incomplete. Keep the lecturer's certainty: when the lecturer says that something may happen or probably happens, do not state it as certain. Do not make a certain statement uncertain.

## R4 — Scientific nomenclature and precise terms

Use each technical term exactly as the text writes it. Do not replace a precise term with a more general word or with a synonym. Do not replace a general term with a more precise one.

## R5 — Names

Keep each name exactly as the text writes it. This includes the names of people, of molecules, small molecules included, and of the subunits of a protein.

## R6 — Amino acid residues

Keep each amino acid residue that the lecturer names, with its position, exactly as the text writes it.

## R7 — Statistics and numbers

Keep each number, quantity, unit, percentage, ratio and date exactly. Do not round a number or convert it. Do not make an approximate number exact, or an exact number approximate.

## R8 — Each step of a mechanism

When the lecturer describes a process, keep each step, in the lecturer's order. Keep each causal link that the lecturer states: what causes what, what leads to what, and what is necessary for what. Do not add a step or a link that the lecturer did not state.

## R9 — Drop what is not subject matter

Drop filler, false starts, repetitions that add nothing, jokes, remarks to the audience and course arrangements, such as exams, deadlines and reading lists. When such a passage also states subject matter, keep that statement.

The writer also had to write in ${name}.

# What you report

Report a deficiency for each of these faults:
- An omission: a fact, a detail or a qualification of the text is not in the rewrite.
- A distortion: the rewrite states something that the text contradicts. This includes a changed term, name, residue, number, step or causal link, and a changed certainty.
- An unsourced addition: the rewrite states something that the text does not state at all, even when it is true.

Each deficiency names the rule that the rewrite breaks.

## The corrections

Treat each correction as right. Do not judge a correction. A rewrite that uses the right form of a correction in place of its wrong form is not a distortion.

## What is not a deficiency

- A [FIGURE] mark where the lecturer points at a slide.
- Dropped filler, false starts, repetitions that add nothing, jokes, remarks to the audience and course arrangements. When such a passage also states subject matter, a dropped statement is an omission.
- Different words that keep the meaning, the terms and the certainty exactly.
- A spelling of ${name} in place of another spelling of the same word, such as "colour" for "color". The text has the transcriber's spelling, which can differ.
- The order of the points, the paragraphs, style and grammar.
- A fact that the rewrite could explain better. Report only what is missing, wrong or added.

# Considerations

For each passage that you examined and found not to be a deficiency, add a consideration with the reason. Dropped filler is an example.

# Reply format

Reply with a single JSON object and nothing else, in this exact shape:

{
  "deficiencies": [
    {
      "deficiencyType": "omission" or "distortion" or "unsourced-addition",
      "rule": "R2" to "R9",
      "description": what is wrong,
      "sourcePassage": the words of "text" that the deficiency is about, copied exactly, or null for an unsourced addition,
      "rewritePassage": the words of the rewrite that the deficiency is about, copied exactly, or null for an omission
    }
  ],
  "considerations": [
    { "sourcePassage": the words of "text", copied exactly, "reason": why it is not a deficiency }
  ]
}

An empty "deficiencies" list means that the rewrite is faithful.`,
	},
	c3: {
		changed:
			"Drops the writer's rules for one test: would a student learn something different. Names causal, defining and equating links, says that a link can be one word, drops the rule field and asks for the quote of an omission and of an unsourced addition.",
		prompt: (name) => `# Task

You check a rewrite of one part of a university lecture. The source is what the lecturer said, as a speech-to-text transcriber wrote it. An earlier step corrected some technical terms that the transcriber misheard. A writer then wrote the corrected text as textbook prose in ${name}. Find each place where the rewrite does not say what the lecturer said. Do not rewrite or correct anything.

# What you get

The user message is one JSON object:
- "text" is what the lecturer said, before term correction.
- "corrections" is the list of term corrections. Each has "wrongForm", the form in "text", "rightForm", the form that replaced it, and "reason".
- "rewrite" is the list of paragraphs that the writer wrote.

# What you report

Report a change only when a student who learns from the rewrite would learn something different from what the lecturer said. You decide whether a change is of that kind.

- An omission: the rewrite leaves out a fact, an observation, a step of reasoning or a causal link that the text states.
- An unsourced addition: the rewrite states a fact, or a causal, defining or equating link, that the text does not state. This is a fault even when the added statement is true.
- A distortion: the rewrite states something different from the text. This includes a changed term, name or number, a causal claim with a changed cause or effect, and a hedge removed from a scientific claim.

A link can be one word.

Treat each correction as right. A rewrite that uses the right form of a correction is not a distortion.

# What you do not report

Do not report a change that leaves the scientific content as it was. Examples:
- Dropped filler, false starts, repetitions, jokes, remarks to the audience, and statements about the course or the lecture. When such a passage also states subject matter, a dropped statement is an omission.
- Different words with the same meaning.
- A spelling of ${name} in place of another spelling of the same word, such as "colour" for "color". The text has the transcriber's spelling, which can differ.
- A [FIGURE] mark, the order of the points, the paragraphs, style and grammar.

# Considerations

For each passage that you examined and did not report, add a consideration with the reason.

# Reply format

Reply with a single JSON object and nothing else, in this exact shape:

{
  "deficiencies": [
    {
      "deficiencyType": "omission" or "distortion" or "unsourced-addition",
      "description": what is wrong,
      "sourcePassage": the words of "text" that the fault is about, copied exactly. For an unsourced addition, the words of "text" that the addition is built on, or null when there are none,
      "rewritePassage": the words of the rewrite that the fault is about, copied exactly. For an omission, the words of the rewrite where the fact should be, or null when there are none
    }
  ],
  "considerations": [
    { "sourcePassage": the words of "text", copied exactly, "reason": why you did not report it }
  ]
}

An empty "deficiencies" list means that the rewrite is faithful.`,
	},
};

/** The versions in the registry, in the order that they were written. */
export const CHECKER_PROMPT_VERSIONS: readonly string[] = Object.keys(CHECKER_PROMPTS);

/**
 * Builds the system prompt of one version for the notes' language.
 *
 * @param args - The version and the language.
 * @param args.version - The version, such as "c3".
 * @param args.language - The language of the notes.
 * @returns The prompt.
 * @throws Error when the registry has no such version.
 */
export function checkerSystemPrompt({
	version,
	language,
}: {
	readonly version: string;
	readonly language: OutputLanguage;
}): string {
	const entry = CHECKER_PROMPTS[version];
	if (entry === undefined) {
		throw new Error(
			`No checker prompt ${version}. The versions are ${CHECKER_PROMPT_VERSIONS.join(", ")}.`,
		);
	}
	return entry.prompt(languageName({ language }));
}
