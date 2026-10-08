# 07 — Correct misheard terms before each rewrite attempt

**What to build:** Term correction runs at the start of each rewrite attempt for each subtopic that has a placed slide. The writer then reads the corrected text, and the checker judges each correction.

**Blocked by:** 04 — Change `place-slides` to read the structured transcript, and 06 — Check each rewritten subtopic. Term correction needs the placed slides of each subtopic, and its faults come from the checker.

**Status:** ready-for-agent

- [ ] Before the build, show the prompt to the user, and propose two models with the price of each from OpenRouter.
- [ ] Term correction makes one call for each subtopic that has at least one placed slide. It gets the subtopic text and the reading of each slide placed in that subtopic. A subtopic with no placed slide gets no call.
- [ ] Each correction has a wrong form, a right form and a reason. The prompt says that each form has one to four words.
- [ ] Code ignores a correction in each of these cases. The rewrite attempt records each ignored correction.
  - a form has more than four words
  - the right form is not in the reading of a slide placed in that subtopic
  - the wrong form is not in the subtopic text.
- [ ] Code keeps the other corrections.
- [ ] Code changes each occurrence of the wrong form in the subtopic, and records the number of occurrences that it changed.
- [ ] The writer gets the corrected text. The stage never changes the file of an earlier stage.
- [ ] The checker gets the verbatim text, the corrections with their reasons, and the rewritten subtopic. It judges from its own knowledge that each correction improves a term only, and adds or removes no fact.
- [ ] After a failed rewrite attempt, term correction gets the faults about corrections, and the writer gets the faults about the rewrite.
- [ ] Each rewrite attempt file holds the corrections, the ignored corrections, the rewritten subtopic and the result of the check.
- [ ] `Rewritten subtopics/rewritten-subtopics.json` holds the corrections that each rewritten subtopic uses.
