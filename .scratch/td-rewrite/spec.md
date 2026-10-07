# Rewrite of the technical design

Agreed in outline 2026-10-06 and 2026-10-07. Parked on 2026-10-07 until the user has built more features.

## Goal

`docs/technical-design.md` (the TD) describes the code as it is, and it is well written. Each fact in it is true of the code. Each sentence follows the rules below.

## Method

The method is the method of the comment rewrite (`.scratch/comment-rewrite/brief.md`). The old text of a section is a claim to test. It is not a draft.

1. The writer reads the code that the section describes.
2. The writer writes the section again, to say what the code does and why.
3. When the code and the old text disagree, the writer records a divergence. The user rules on it. Nobody changes the code or the TD to settle a divergence before the ruling.
4. The writer puts these inputs into the section:
   - each "Fix the design" ruling in `.scratch/comment-rewrite/rulings.md` for that section
   - each reason in `.scratch/comment-rewrite/carry-over/` that names that section
   - the requirements and `docs/adr/` where they apply.
5. The programs in ticket 02 check the section.
6. A second agent reads the section against the code and against this file. It gets the criteria, not a verdict to prove.
7. The writer fixes what the second agent found.
8. One commit holds one section. The user reviews the diff on GitHub in split view.

`CONTEXT.md` gives the words to use. It is not evidence of what the code does, because it was written from the code.

## Sections that get no full rewrite

- **`transcript-structuring` and `transcript-verification`.** The user ruled on 2026-10-06 that both stages will be deleted. Their sections go with them.
- **The stages not yet built:** `slide-conversion`, `image-extraction`, `synthesis`, `qa-loop` and `pdf-generation`. No code exists to check them against. The pipeline redesign will change them. The user decides in ticket 01 whether they get the writing rules only, or no change.

## Rules for each sentence

1. **STE.** Short sentences, with one fact in each. Common words. No semicolons. No phrasal verbs. Use one word for one thing in the whole document.
2. **Current state only.** No sentence describes an earlier state of the code. Words that show it include "used to", "no longer", "now", "was changed to", "previously", "an earlier design" and "rather than the old".
3. **Subject first.** No sentence or list item opens with What, How, Why, Where, Whether, "Thrown when" or a participle with no subject. Write "The timer that keeps a stage's sends apart", not "What spaces a stage's sends in time".
4. **No vagueness.** Use "it", "this", "that" or "the result" only when the reader can see at once what the word refers to. If the reader must work it out, name the thing.
5. **Glossary words.** Use the terms in `CONTEXT.md`. Do not use a word that `CONTEXT.md` lists to avoid.
6. **No hollow sentences.** A sentence that sounds like analysis but names nothing concrete is deleted.

## Rules for the document

These are the user's earlier rulings on the TD.

1. The TD gives no bug reports. It says what the system does and why.
2. A passage that explains a choice that a reader would question stays.
3. Each fact has one home. Signatures and behaviour go in the TD. Build order and test names go in the plan.
4. The TD does not repeat a rule from `CLAUDE.md`.
5. A placeholder model ID that describes a capability, such as `<REASONING_MODEL>`, stays in the config example. A real model ID is used in an example that only shows a shape.
6. Section numbers and headings do not change during the rewrite. Ticket 03 makes every structural change, once. A writer who finds a reason to change a number or a heading records it for the user to rule on.
7. The suite version in the header is changed last, after all other fixes. The requirements and the plan carry the same number, so all three change together.
