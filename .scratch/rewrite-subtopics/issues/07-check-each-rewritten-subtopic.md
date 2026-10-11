# 07 — Check each rewrite attempt

**What to build:** The stage `check-rewrite-attempts`. The checker compares each rewritten subtopic with the verbatim text. At the end of each round, the stage writes the result file that the runner reads (TD §5, `check-rewrite-attempts`). Ticket 12 adds the loop that acts on the result.

**Blocked by:** 06 — Rewrite each subtopic from its corrected text

**Status:** ready-for-agent

- [x] Before the build, show the prompt to the user. The user approved prompt `c1` on 2026-10-11.
- [x] Before the build, propose two models to the user, with the price of each from OpenRouter. The user chose `openai/gpt-5.6-sol-pro` on 2026-10-11, from a different company from the writer.
- [x] Before the build, propose the names of the fields of the file of each check to the user in one table. The user approved them on 2026-10-11. They are in TD §5, `check-rewrite-attempts`.
- [x] The model goes in the stage's own entry, in the example config and in the user's config. The user set `concurrency` 10 and `sendGapSeconds` 0.25 on 2026-10-11.
- [x] The checker gets the verbatim text of the subtopic, the kept corrections with their reasons, and the rewritten subtopic. The corrections and the rewrite are of the same round. It gets no slide text.
- [x] The checker looks for omissions, distortions and unsourced additions. It does not look for underexplained facts, a change of the lecturer's order or prose faults.
- [x] The checker treats each correction as right, and does not judge it. The user ruled this on 2026-10-11. A model that judges the corrections makes more errors than the slides hold.
- [x] The checker prompt holds the writer's rules R2 to R9. The two prompts take them from one place. Each deficiency names the rule.
- [x] The checker lists its considerations. They help to debug a check.
- [x] The checker accepts a figure mark in place of a pointer at a slide. It does not report dropped filler, jokes or course arrangements as omissions.
- [x] One fault of any kind fails the rewrite attempt.
- [x] The stage writes `Checks/subtopic-<id>-attempt-<n>.json` for each subtopic of the round.
- [x] At the end of the round, the stage writes `Checks/round-<n>.json` with `round` and `failedSubtopicIds`. An empty list means that each subtopic passed. The file is on disk before the stage returns.
- [x] A stage that starts again makes no call for a subtopic with a saved check. The user asked on 2026-10-11 for a test of a partly completed stage. The test has two cases: one check is missing, or each check is saved and the round file is missing.
- [ ] Live run: the user runs the stage on one lecture and judges the faults that the checker found and missed.
