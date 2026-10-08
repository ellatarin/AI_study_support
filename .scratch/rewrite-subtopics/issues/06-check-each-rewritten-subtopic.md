# 06 — Check each rewritten subtopic, with up to three rewrite attempts

**What to build:** The checker compares each rewritten subtopic with the verbatim text of its subtopic. A fault starts a new rewrite attempt. A subtopic that fails three rewrite attempts makes the stage fail.

**Blocked by:** 05 — Rewrite each subtopic

**Status:** ready-for-agent

- [ ] Before the build, show the prompt to the user, and propose two models with the price of each from OpenRouter.
- [ ] The checker gets the verbatim text of the subtopic and the rewritten subtopic. It gets no slide text.
- [ ] The checker looks for omissions, distortions and unsourced additions. It does not look for underexplained facts or prose faults.
- [ ] The checker prompt holds the same list of details to keep as the writer prompt, as numbered rules. A missing or changed item is an omission or a distortion, and the fault names the rule.
- [ ] The checker accepts a figure mark in place of a pointer at a slide. It does not report dropped filler, jokes or course arrangements as omissions.
- [ ] One fault of any kind fails the rewrite attempt.
- [ ] After a failed rewrite attempt, the subtopic gets a new one. The writer gets the faults of the last attempt.
- [ ] A subtopic gets at most three rewrite attempts. After the third failure, the stage fails and names the subtopic and the faults of the last attempt.
- [ ] The stage saves each rewrite attempt as `Rewrite attempts/subtopic-<id>-attempt-<n>.json`, with the rewritten subtopic and the result of the check.
- [ ] A new run does not pay again for a subtopic that already passed.
