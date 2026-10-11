# 11 — Assemble the rewritten subtopics in one file

**What to build:** The stage `assemble-rewrites`. It makes no model call. It writes `Rewritten subtopics/rewritten-subtopics.json` from the rewrite attempt of each subtopic that passed the check (TD §5, `assemble-rewrites`).

**Blocked by:** 07 — Check each rewrite attempt

**Status:** ready-for-agent

- [ ] The stage has its own entry in `STAGE_IDS` and `STAGE_FILES`, after `check-rewrite-attempts`.
- [ ] For each subtopic, the stage takes its last rewrite attempt, which is the attempt that passed.
- [ ] The file holds `rewrittenSubtopics`, with one entry for each subtopic in lecture order. Each entry holds `subtopicId`, `attemptNumber`, `rewrittenSubtopic` and `corrections`, the kept corrections of that attempt.
- [ ] The entries have no titles.
- [ ] The stage fails when a subtopic has no rewrite attempt that passed. The error names the subtopic.
