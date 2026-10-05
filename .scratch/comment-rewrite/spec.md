# Comment rewrite

Reword the comments throughout `src/`, tests and TSDoc included, so that every comment:

- uses the domain terms in `CONTEXT.md` in preference to invented ones;
- is concise and clear;
- reads in a plain, ASD-STE100-like style: short sentences, one instruction or fact each, common words. The STE dictionary need not be followed strictly. No mannered prose;
- is valuable: it helps a reader understand something the code does not already say;
- describes the current code only, never how things used to be;
- names its subject first. No fragment that makes the reader supply the subject, such as "What spaces a stage's sends in time." Write "The timer that keeps a stage's sends apart."

Agreed 2026-10-04. About 8,800 comment lines, split into tickets by area, each ticket covering an area's source and its tests together.

## Criteria every rewording ticket shares

- [ ] Every comment in scope uses `CONTEXT.md` terms and the rulings ticket 01 recorded.
- [ ] Every comment in scope follows the rules ticket 01 added to `CLAUDE.md`.
- [ ] No comment describes an earlier state of the code ("used to", "no longer", "now", "was changed to", "rather than the old …").
- [ ] No comment or TSDoc summary opens with a subjectless fragment ("What…", "How…", "Why…", "Where…", "Said of…"). Each names its subject first. The STE linter does not catch this, so every comment is read for it.
- [ ] A comment that only restates the code is deleted, unless the strict TSDoc lint requires it; then it is cut to what the lint requires.
- [ ] References to sections of the technical design, the plan and the requirements are kept.
- [ ] Lint-disable comments keep their justification, reworded if needed.
- [ ] Prompt text is not touched: prompts are carried over word for word.
- [ ] No code changes: ticket 02 made every rename. The commit gate passes.
