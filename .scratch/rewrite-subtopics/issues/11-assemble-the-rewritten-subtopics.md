# 11 — Assemble the rewritten subtopics in one file

**What to build:** The stage `assemble-rewrites`. It makes no model call. It writes `Rewritten subtopics/rewritten-subtopics.json` from the rewrite attempt of each subtopic that passed the check (TD §5, `assemble-rewrites`).

**Blocked by:** 07 — Check each rewrite attempt

**Status:** wontfix

- [ ] The stage has its own entry in `STAGE_IDS` and `STAGE_FILES`, after `check-rewrite-attempts`.
- [ ] For each subtopic, the stage takes its last rewrite attempt, which is the attempt that passed.
- [ ] The file holds `rewrittenSubtopics`, with one entry for each subtopic in lecture order. Each entry holds `subtopicId`, `attemptNumber`, `rewrittenSubtopic` and `corrections`, the kept corrections of that attempt.
- [ ] The entries have no titles.
- [ ] The stage fails when a subtopic has no rewrite attempt that passed. The error names the subtopic.

## Comments

2026-10-11: a rewrite can now be empty, when a subtopic holds only filler (TD §5, `rewrite-subtopics`). Decide at the seams step whether the stage keeps such a subtopic as an entry with an empty `rewrittenSubtopic`, or leaves it out.

2026-10-14: wontfix. ADR 0003 removes the transcript check and the rounds, so no stage chooses a rewrite attempt that passed. `check-facts` reads the rewrite of each subtopic.
