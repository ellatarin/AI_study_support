# 07 — Check each rewrite attempt

**What to build:** The stage `check-rewrite-attempts`. The checker compares each rewritten subtopic with the verbatim text, and judges each correction. At the end of each round, the stage writes the result file that the runner reads (TD §5, `check-rewrite-attempts`). Ticket 12 adds the loop that acts on the result.

**Blocked by:** 06 — Rewrite each subtopic from its corrected text

**Status:** ready-for-agent

- [ ] Before the build, show the prompt to the user.
- [x] Before the build, propose two models to the user, with the price of each from OpenRouter. The user chose `openai/gpt-5.6-sol-pro` on 2026-10-11, from a different company from the writer.
- [ ] Before the build, propose the names of the fields of the file of each check to the user in one table.
- [ ] The model goes in the stage's own entry, in the example config and in the user's config.
- [ ] The checker gets the verbatim text of the subtopic, the corrections with their reasons, and the rewritten subtopic. The corrections and the rewrite are of the same round. It gets no slide text.
- [ ] The checker looks for omissions, distortions and unsourced additions. It does not look for underexplained facts or prose faults.
- [ ] The checker judges from its own knowledge that each correction improves a term only, and adds or removes no fact.
- [ ] The checker prompt holds the same list of details to keep as the writer prompt, as numbered rules. The two prompts take the list from one place. A missing or changed item is an omission or a distortion, and the fault names the rule.
- [ ] The checker accepts a figure mark in place of a pointer at a slide. It does not report dropped filler, jokes or course arrangements as omissions.
- [ ] One fault of any kind fails the rewrite attempt.
- [ ] The stage writes `Checks/subtopic-<id>-attempt-<n>.json` for each subtopic of the round.
- [ ] At the end of the round, the stage writes `Checks/round-<n>.json` with `round` and `failedSubtopicIds`. An empty list means that each subtopic passed. The file is on disk before the stage returns.
- [ ] In round `rewriting.maxRounds`, a failed subtopic makes the stage fail. The error names each failed subtopic and its faults.
- [ ] A stage that starts again makes no call for a subtopic with a saved check.
- [ ] Live run: the user runs the stage on one lecture and judges the faults that the checker found and missed.
