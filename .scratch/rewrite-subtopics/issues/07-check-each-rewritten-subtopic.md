# 07 — Check each rewritten subtopic, with up to three rewrite attempts

**What to build:** `rewrite-subtopics` gets its third step, the checker. The checker compares each rewritten subtopic with the verbatim text, and judges each correction. A fault starts a new rewrite attempt. A subtopic that fails three rewrite attempts makes the stage fail.

**Blocked by:** 06 — Rewrite each subtopic from its corrected text

**Status:** ready-for-agent

- [ ] Before the build, show the prompt to the user, and propose two models with the price of each from OpenRouter.
- [ ] Before the build, propose the names of the fields of the check result to the user in one table.
- [ ] The checker gets the verbatim text of the subtopic, the corrections with their reasons, and the rewritten subtopic. It gets no slide text.
- [ ] The checker looks for omissions, distortions and unsourced additions. It does not look for underexplained facts or prose faults.
- [ ] The checker judges from its own knowledge that each correction improves a term only, and adds or removes no fact.
- [ ] The checker prompt holds the same list of details to keep as the writer prompt, as numbered rules. A missing or changed item is an omission or a distortion, and the fault names the rule.
- [ ] The checker accepts a figure mark in place of a pointer at a slide. It does not report dropped filler, jokes or course arrangements as omissions.
- [ ] One fault of any kind fails the rewrite attempt.
- [ ] After a failed rewrite attempt, the subtopic gets a new one, with term correction and the rewrite again. Term correction gets the faults about corrections. The writer gets the faults about the rewrite.
- [ ] A subtopic gets at most three rewrite attempts. After the third failure, the stage fails and names the subtopic and the faults of the last attempt.
- [ ] Each rewrite attempt file also holds the result of the check.
- [ ] Only a rewritten subtopic that passed the check goes in `Rewritten subtopics/rewritten-subtopics.json`.
- [ ] A new run does not pay again for a subtopic that already passed.
