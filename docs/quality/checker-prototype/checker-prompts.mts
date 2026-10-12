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

/** The section that says what the user message holds, the same in each version. */
const WHAT_YOU_GET = `# What you get

The user message is one JSON object:
- "text" is what the lecturer said, before term correction.
- "corrections" is the list of term corrections. Each has "wrongForm", the form in "text", "rightForm", the form that replaced it, and "reason".
- "rewrite" is the list of paragraphs that the writer wrote.`;

/**
 * Builds the line that allows a spelling of the notes' language, the same in each version.
 *
 * @param name - The name of the notes' language.
 * @returns The line.
 */
function spellingAllowance(name: string): string {
	return `- A spelling of ${name} in place of another spelling of the same word, such as "colour" for "color". The text has the transcriber's spelling, which can differ.`;
}

/**
 * Builds the task section of the versions from c3, which judge the rewrite
 * without the writer's rules.
 *
 * @param name - The name of the notes' language.
 * @returns The section.
 */
function lecturerTask(name: string): string {
	return `# Task

You check a rewrite of one part of a university lecture. The source is what the lecturer said, as a speech-to-text transcriber wrote it. An earlier step corrected some technical terms that the transcriber misheard. A writer then wrote the corrected text as textbook prose in ${name}. Find each place where the rewrite does not say what the lecturer said. Do not rewrite or correct anything.`;
}

/** The line of the versions from c3 that allows dropped material that is not subject matter. */
const NOT_SUBJECT_MATTER_ALLOWANCE =
	"- Dropped filler, false starts, repetitions, jokes, remarks to the audience, and statements about the course or the lecture. When such a passage also states subject matter, a dropped statement is an omission.";

/** The line of the versions from c3 that allows changes of form. */
const FORM_ALLOWANCE = "- A [FIGURE] mark, the order of the points, the paragraphs, style and grammar.";

/** The considerations and reply format sections of the versions from c3, which ask for both quotes and no rule. */
const QUOTED_REPLY = `# Considerations

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

An empty "deficiencies" list means that the rewrite is faithful.`;

/** The allowance of the versions from c5, which says what a remark to the audience is. */
const DEFINED_REMARK_ALLOWANCE =
	"- Dropped filler, false starts, repetitions, jokes, remarks to the audience, and statements about the course or the lecture. A remark to the audience says nothing about the subject, such as a greeting. A sentence that names a structure, a cell or a process, or that asks a question about the subject, is subject matter, even when the lecturer speaks to the students. When such a passage also states subject matter, a dropped statement is an omission.";

/** The forbidden omissions of c4 and c5. */
const C4_OMISSIONS = `- A fact, an observation, a step of reasoning or a causal link of the text is not in the rewrite.
- What the lecturer says that a figure shows is not in the rewrite. A statement of what a figure shows is subject matter, not a remark to the audience.`;

/** The forbidden omissions of c6, which add a statement that a general statement keeps in place of the missing one. */
const KEPT_GENERAL_OMISSIONS = `${C4_OMISSIONS}
- A statement of the text is missing from the rewrite, and the rewrite keeps only a related or more general statement. A general rule does not replace an example that the lecturer gives.`;

/**
 * Builds the prompt of the versions from c4, which compare one statement at a
 * time and list the forbidden and the allowed changes.
 *
 * @param args - The language, the forbidden omissions and the allowance for dropped material.
 * @param args.name - The name of the notes' language.
 * @param args.omissions - The lines of the forbidden omissions.
 * @param args.notSubjectMatterAllowance - The allowed-change line for dropped material that is not subject matter.
 * @returns The prompt.
 */
function forbiddenChangesPrompt({
	name,
	omissions,
	notSubjectMatterAllowance,
}: {
	readonly name: string;
	readonly omissions: string;
	readonly notSubjectMatterAllowance: string;
}): string {
	return `${lecturerTask(name)}

${WHAT_YOU_GET}

# Process

1. Read the text and the rewrite.
2. Take each statement of the text in turn. Find the statement in the rewrite. Compare the two.
3. Take each statement of the rewrite in turn. Find its source in the text. Compare the two.
4. For each difference, find it in "Forbidden changes" or in "Allowed changes".
5. Report each forbidden change. When you are not sure whether a change is forbidden, report it.

Do not judge a paragraph as a whole. A paragraph of the rewrite can keep the main points of the text and still change one statement. A student who reads that paragraph learns the changed statement.

# Forbidden changes

Report each of these changes, even when the changed statement is true.

## Omissions

${omissions}

## Unsourced additions

- The rewrite states a fact that the text does not state.
- The rewrite states a link between two statements, and the text does not state that link. A link can be a cause, a result, a definition, or a statement that two things are the same.
- One word can state a link. For example, "hence" states a cause, and "namely" states that two things are the same. A rewrite that adds such a word adds a link.
- When the text only puts two statements next to each other, the text does not state a link between them.
- The rewrite turns the lecturer's pointing words, such as "here" and "this", into a description that the lecturer did not give.

## Distortions

- A changed term, name or number.
- A causal claim with a changed cause or effect. A cause that becomes wider or narrower is a changed cause.
- A term that keeps its words but gets a different role in the sentence.
- A hedge removed from a scientific claim.
- An unclear or incomplete statement of the text that the rewrite makes clear or complete. The rewrite chose one reading, even when that reading is likely.

# Allowed changes

Do not report these changes:
${notSubjectMatterAllowance}
- Different words with exactly the same meaning.
${spellingAllowance(name)}
${FORM_ALLOWANCE}
- The right form of a term correction in place of its wrong form. Treat each correction as right.

${QUOTED_REPLY}`;
}

const CHECKER_PROMPTS: Readonly<Record<string, CheckerPromptVersion>> = {
	c2: {
		changed:
			"Names the language of the notes, and says that a spelling of that language is not a deficiency.",
		prompt: (name) => `# Task

You check a rewrite of one part of a university lecture. The source is what the lecturer said, as a speech-to-text transcriber wrote it. An earlier step corrected some technical terms that the transcriber misheard. A writer then wrote the corrected text as textbook prose. Find each place where the rewrite is not faithful to the source. Do not rewrite or correct anything.

${WHAT_YOU_GET}

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
${spellingAllowance(name)}
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
		prompt: (name) => `${lecturerTask(name)}

${WHAT_YOU_GET}

# What you report

Report a change only when a student who learns from the rewrite would learn something different from what the lecturer said. You decide whether a change is of that kind.

- An omission: the rewrite leaves out a fact, an observation, a step of reasoning or a causal link that the text states.
- An unsourced addition: the rewrite states a fact, or a causal, defining or equating link, that the text does not state. This is a fault even when the added statement is true.
- A distortion: the rewrite states something different from the text. This includes a changed term, name or number, a causal claim with a changed cause or effect, and a hedge removed from a scientific claim.

A link can be one word.

Treat each correction as right. A rewrite that uses the right form of a correction is not a distortion.

# What you do not report

Do not report a change that leaves the scientific content as it was. Examples:
${NOT_SUBJECT_MATTER_ALLOWANCE}
- Different words with the same meaning.
${spellingAllowance(name)}
${FORM_ALLOWANCE}

${QUOTED_REPLY}`,
	},
	c4: {
		changed:
			"Adds a Process section that compares one statement at a time and reports a change when in doubt. Splits the faults into Forbidden changes and Allowed changes. Names a link that the text only suggests, a cause that becomes wider or narrower, a term with a changed role, an unclear statement made clear, and what a figure shows. Gives two example words of a link. Asks for exactly the same meaning. Has no allowance for the repair of a misheard word.",
		prompt: (name) =>
			forbiddenChangesPrompt({
				name,
				omissions: C4_OMISSIONS,
				notSubjectMatterAllowance: NOT_SUBJECT_MATTER_ALLOWANCE,
			}),
	},
	c5: {
		changed:
			"Says what a remark to the audience is: a sentence that says nothing about the subject. A sentence that names a structure, a cell or a process, or asks a question about the subject, is subject matter.",
		prompt: (name) =>
			forbiddenChangesPrompt({
				name,
				omissions: C4_OMISSIONS,
				notSubjectMatterAllowance: DEFINED_REMARK_ALLOWANCE,
			}),
	},
	c6: {
		changed:
			"Starts again from c4, without the c5 line. Adds a forbidden omission: a missing statement when the rewrite keeps only a related or more general statement. A general rule does not replace an example that the lecturer gives.",
		prompt: (name) =>
			forbiddenChangesPrompt({
				name,
				omissions: KEPT_GENERAL_OMISSIONS,
				notSubjectMatterAllowance: NOT_SUBJECT_MATTER_ALLOWANCE,
			}),
	},
	c7: {
		changed:
			"The user's rewrite of c4. Reports only a difference that causes issues for a student's learning. Drops 'when not sure, report', 'do not judge a paragraph as a whole', 'even when the changed statement is true', the line on statements next to each other, the line on pointing words and the subject-matter exception of the filler allowance. Adds conflation as a link and the merging of two concerns as a distortion. Moves the process after the two lists.",
		prompt: (name) =>
			learningIssuePrompt({
				name,
				unsourcedAdditions: C7_ADDITIONS,
				formAllowance: FORM_ALLOWANCE,
				mergingDistortion: C7_MERGING,
				omissions: C7_OMISSIONS,
			}),
	},
	c8: {
		changed:
			"Adds to c7 the c4 line on pointing words that become a description, and reports it unless the text shows that the description is correct.",
		prompt: (name) =>
			learningIssuePrompt({
				name,
				unsourcedAdditions: CHECKED_DESCRIPTION_ADDITIONS,
				formAllowance: FORM_ALLOWANCE,
				mergingDistortion: C7_MERGING,
				omissions: C7_OMISSIONS,
			}),
	},
	c9: {
		changed:
			"Narrows the [FIGURE] allowance of c8: a sentence around the mark that says what the figure shows or illustrates is compared with the text, with an example from another subject.",
		prompt: (name) =>
			learningIssuePrompt({
				name,
				unsourcedAdditions: CHECKED_DESCRIPTION_ADDITIONS,
				formAllowance: FIGURE_SENTENCE_ALLOWANCE,
				mergingDistortion: C7_MERGING,
				omissions: C7_OMISSIONS,
			}),
	},
	c10: {
		changed:
			'Adds to the merging line of c9 an example from another subject: "prompting and artifacts" becomes "prompting artifacts".',
		prompt: (name) =>
			learningIssuePrompt({
				name,
				unsourcedAdditions: CHECKED_DESCRIPTION_ADDITIONS,
				formAllowance: FIGURE_SENTENCE_ALLOWANCE,
				mergingDistortion: MERGING_WITH_EXAMPLE,
				omissions: C7_OMISSIONS,
			}),
	},
	c11: {
		changed:
			"Adds to the omissions of c10 the things that the lecturer points out on a figure, dropped for the general rule, with an example from another subject.",
		prompt: (name) =>
			learningIssuePrompt({
				name,
				unsourcedAdditions: CHECKED_DESCRIPTION_ADDITIONS,
				formAllowance: FIGURE_SENTENCE_ALLOWANCE,
				mergingDistortion: MERGING_WITH_EXAMPLE,
				omissions: POINTED_OUT_OMISSIONS,
			}),
	},
	c12: {
		changed:
			"Starts again from c10, without the c11 line. Adds after the line on link words that a link which the lecturer's own words draw is in the text, with examples of 'so' that draws a conclusion and 'so' that only starts a sentence.",
		prompt: (name) =>
			learningIssuePrompt({
				name,
				unsourcedAdditions: DRAWN_LINK_ADDITIONS,
				formAllowance: FIGURE_SENTENCE_ALLOWANCE,
				mergingDistortion: MERGING_WITH_EXAMPLE,
				omissions: C7_OMISSIONS,
			}),
	},
};

/** The versions in the registry, in the order that they were written. */
export const CHECKER_PROMPT_VERSIONS: readonly string[] = Object.keys(CHECKER_PROMPTS);

/** The forbidden unsourced additions of c7. */
const C7_ADDITIONS = `- The rewrite states a fact that the text does not state.
- The rewrite states a link between two statements, and the text does not state that link. A link can be a cause, a result, a definition, a conflation, or a statement that two things are the same.
- One or two words can state a link. For example, "hence" states a cause, and "namely" states that two things are the same. A rewrite that adds such words adds a link.`;

/** The forbidden unsourced addition of c8 for a description from pointing words that the text does not show to be correct. */
const CHECKED_DESCRIPTION = `- The rewrite turns the lecturer's pointing words, such as "here" and "this", into a description that the lecturer did not give. Report it unless the text shows that the description is correct.`;

/** The forbidden unsourced additions of c8 to c11. */
const CHECKED_DESCRIPTION_ADDITIONS = `${C7_ADDITIONS}
${CHECKED_DESCRIPTION}`;

/** The forbidden unsourced additions of c12, which do not report a link that the lecturer's own words draw. */
const DRAWN_LINK_ADDITIONS = `${C7_ADDITIONS}
- A link is in the text when the lecturer's own words draw it. In speech, "so" sometimes draws a conclusion, as in "Sales fell. So prices were cut". But "so" often only starts a new sentence, as in "So, today we look at sales", and then it draws no link. Do not report a link that the lecturer's words draw. Report a link that the rewrite adds and the lecturer's words do not draw.
${CHECKED_DESCRIPTION}`;

/** The forbidden omissions of c7. */
const C7_OMISSIONS = `- A fact, an observation, a step of reasoning or a causal link of the text is not in the rewrite.
- What the lecturer says that a figure shows is not in the rewrite. A statement of what a figure shows is important subject matter, not a remark to the audience.`;

/** The forbidden omissions of c11, which add things pointed out on a figure that the rewrite drops for the general rule. */
const POINTED_OUT_OMISSIONS = `${C7_OMISSIONS}
- The lecturer points out particular things on a figure, and the rewrite keeps only the general rule. For example, a speaker points out two cracks in a photograph of a bridge, and the rewrite says only "Cracks form near the joints". Report it: the student needs to know what to look for on the figure.`;

/** The forbidden distortion of c7 for two concerns merged into one. */
const C7_MERGING = "- Merging or conflating of two separate concerns into one.";

/** The forbidden distortion of c10 for two concerns merged into one, with an example from another subject. */
const MERGING_WITH_EXAMPLE = `${C7_MERGING} For example, "prompting and artifacts" becomes "prompting artifacts".`;

/** The allowance for changes of form of c9, which keeps a sentence about a figure out of the [FIGURE] mark. */
const FIGURE_SENTENCE_ALLOWANCE = `${FORM_ALLOWANCE} A sentence around the [FIGURE] mark that says what the figure shows or illustrates is not part of the mark. Compare that sentence with the text, as any other statement. For example, when a speaker says only "Here is a chart", the rewrite "This chart illustrates the fall in sales" adds a link.`;

/**
 * Builds the prompt of the versions from c7, which report a difference only
 * when it causes issues for a student's learning.
 *
 * @param args - The language, the forbidden unsourced additions and the allowance for changes of form.
 * @param args.name - The name of the notes' language.
 * @param args.unsourcedAdditions - The lines of the forbidden unsourced additions.
 * @param args.formAllowance - The allowed-change line for the [FIGURE] mark, order, paragraphs, style and grammar.
 * @param args.mergingDistortion - The forbidden-distortion line for two concerns merged into one.
 * @param args.omissions - The lines of the forbidden omissions.
 * @returns The prompt.
 */
function learningIssuePrompt({
	name,
	unsourcedAdditions,
	formAllowance,
	mergingDistortion,
	omissions,
}: {
	readonly name: string;
	readonly omissions: string;
	readonly unsourcedAdditions: string;
	readonly formAllowance: string;
	readonly mergingDistortion: string;
}): string {
	return `# Task

You must check a stylistic rewrite of one part of a university lecture. The source is what the lecturer said, as a speech-to-text transcriber wrote it. An earlier step corrected some technical terms that the transcriber misheard. A writer then wrote the corrected text as textbook prose in ${name}. Your job is to find and report each place where the rewrite differs from the original in such a way that it causes issues for a student’s learning.

${WHAT_YOU_GET}

# Forbidden changes

The following changes are forbidden, and should be flagged when the process below is followed.

## Omissions

${omissions}

## Unsourced additions

${unsourcedAdditions}

## Distortions

- A changed term, name or number.
- A causal claim with a changed cause or effect. A cause that becomes wider or narrower is a changed cause.
- A term that keeps its words but gets a different role in the sentence.
- A hedge removed from a scientific claim.
- An unclear or incomplete statement of the text that the rewrite makes clear or complete. The rewrite chose one reading, even when that reading is likely.
${mergingDistortion}

# Allowed changes

Do not report these changes as deficiencies since they are not forbidden:

- Dropped filler, false starts, repetitions, jokes, remarks to the audience, and statements about the course or the lecture.
- Different words with exactly the same meaning.
${spellingAllowance(name)}
${formAllowance}
- The right form of a term correction in place of its wrong form. Treat each correction as right.



# The process you must follow

1. Read the text and the rewrite.
2. Take each statement or explanation of the text in turn. Find it in the rewrite if present and make a comparison using forbidden and allowed changes.
3. Take each statement or explanation of the rewrite in turn. Find its source in the text if present and make a comparison using forbidden and allowed changes.
4. For each difference, find it in "Forbidden changes" or in "Allowed changes".
5. Report each forbidden change.


${QUOTED_REPLY}`;
}

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
