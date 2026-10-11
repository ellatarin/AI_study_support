/**
 * The writer's rules R2 to R9, which `rewrite-subtopics` follows and
 * `check-rewrite-attempts` checks (technical-design.md §5, `rewrite-subtopics`
 * and `check-rewrite-attempts`). Both prompts state them in these words.
 */
export const CHECKED_WRITER_RULES = `## R2 — Leave out nothing

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

Drop filler, false starts, repetitions that add nothing, jokes, remarks to the audience and course arrangements, such as exams, deadlines and reading lists. When such a passage also states subject matter, keep that statement.`;

/** The number of each rule in {@link CHECKED_WRITER_RULES}, such as `R2`, taken from its heading. */
export const CHECKED_RULE_NUMBERS: readonly string[] = [
	...CHECKED_WRITER_RULES.matchAll(/^## (R\d+) /gm),
].map(([, ruleNumber]) => ruleNumber ?? "");
