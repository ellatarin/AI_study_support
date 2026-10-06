# 03 — Pilot: reword the shared pipeline types

**What to build:** the comments on the shared pipeline types (stage contract, stage result, cost, manifest and run-log shapes) reworded to `../spec.md`. These types hold the core vocabulary, so this ticket calibrates the style before the other areas start. About 580 comment lines.

**Blocked by:** 02

**Status:** resolved

- [x] Every criterion in `../spec.md`, "Criteria every rewording ticket shares".
- [x] The user has reviewed the result, and any style corrections are recorded in this ticket's comments and, where they are rules, in `../style-sheet.md`.

## Comments

2026-10-06, the user's rulings at the start of the pilot:

- The test for each comment is whether it is truly useful to a reader of the code. A comment is not cut only because the technical design says the same thing.
- Comments are written again from the code and the reasons behind it, not reworded. The old comment is a claim to test.
- Where the code and a statement of intent disagree, nobody edits the design or the code to match. The disagreement goes in `../divergences.md`, and the user decides which one is wrong. A statement of intent is the technical design, the plan, the requirements, an ADR, `CONTEXT.md` or an old comment.
- The lint directives get their own ticket, 15. The area tickets reword a directive's reason only.

2026-10-06, measured before rewording: the STE linter finds 75 hard breaches in the comments of `src/types/pipeline.ts`.

2026-10-06, the pilot:

- The comments were written again from the code in `9bc7b506`. The rewrite found 15 divergences, D1 to D15, in `../divergences.md`. D13 was withdrawn. D6 became `.scratch/run-outcomes/issues/01`. D14 and D15 became `.scratch/qa-loop/issues/01` and `02`.
- The user: the comments "are generally really good, however there are so many of them that the code is difficult to read". The user ruled a length rule. It is in `../style-sheet.md`. The comments were shortened in `4cca3a75`, from 487 to 194 comment lines.
- The user: "that looks better to me".
- The style rules go in `../style-sheet.md`, not in `CLAUDE.md`, because `CLAUDE.md` is already big.
- The user reviews each ticket as a commit diff on GitHub. Each ticket's rewording is its own commit.
