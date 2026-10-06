# 03 — Pilot: reword the shared pipeline types

**What to build:** the comments on the shared pipeline types (stage contract, stage result, cost, manifest and run-log shapes) reworded to `../spec.md`. These types hold the core vocabulary, so this ticket calibrates the style before the other areas start. About 580 comment lines.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Every criterion in `../spec.md`, "Criteria every rewording ticket shares".
- [ ] The user has reviewed the result, and any style corrections are recorded in this ticket's comments and, where they are rules, in `CLAUDE.md`.

## Comments

2026-10-06, the user's rulings at the start of the pilot:

- The test for each comment is whether it is truly useful to a reader of the code. A comment is not cut only because the technical design says the same thing.
- Comments are written again from the code and the reasons behind it, not reworded. The old comment is a claim to test.
- Where the code and a statement of intent disagree, nobody edits the design or the code to match. The disagreement goes in `../divergences.md`, and the user decides which one is wrong. A statement of intent is the technical design, the plan, the requirements, an ADR, `CONTEXT.md` or an old comment.
- The lint directives get their own ticket, 15. The area tickets reword a directive's reason only.

2026-10-06, measured before rewording: the STE linter finds 75 hard breaches in the comments of `src/types/pipeline.ts`.
