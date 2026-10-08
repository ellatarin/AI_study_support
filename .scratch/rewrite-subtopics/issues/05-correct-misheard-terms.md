# 05 — Correct misheard terms in each subtopic

**What to build:** The new stage `rewrite-subtopics` starts with its first step, term correction. Each subtopic that has a placed slide gets its corrected text. Tickets 06 and 07 add the rewrite and the checker.

**Blocked by:** 04 — Change `place-slides` to read the structured transcript. Term correction needs the placed slides of each subtopic. Only the code of ticket 04 must be done. The tests use stored examples, not the user's new run.

**Status:** ready-for-agent

- [ ] Before the build, show the prompt to the user. Its rules use no nouns from the lectures that test it.
- [ ] Before the build, propose two models to the user, with the price of each from OpenRouter. The chosen model goes in the example config and in the user's config.
- [ ] Before the build, propose the names of the stored fields to the user in one table. The fields of a correction are examples.
- [ ] Term correction makes one call for each subtopic that has at least one placed slide. It gets the subtopic text and the reading of each slide placed in that subtopic. A subtopic with no placed slide gets no call, and keeps its text unchanged.
- [ ] The stage works on several subtopics at the same time, up to the concurrency in its config. Its sends are spaced by its `sendGapSeconds`. One gate serves all the lectures of a batch, as in the other stages.
- [ ] Each correction has a wrong form, a right form and a reason. The prompt says that each form has one to four words.
- [ ] Code ignores a correction in each of these cases. The stage records each ignored correction.
  - a form has more than four words
  - the right form is not in the reading of a slide placed in that subtopic
  - the wrong form is not in the subtopic text.
- [ ] Code keeps the other corrections.
- [ ] Code changes each occurrence of the wrong form in the subtopic, and records the number of occurrences that it changed.
- [ ] The stage saves the first rewrite attempt of each subtopic as `Rewrite attempts/subtopic-<id>-attempt-1.json`. In this ticket, the file holds the corrections, the ignored corrections and the corrected text.
- [ ] The stage never changes the file of an earlier stage.
- [ ] The stage resends an unusable reply, and fails after the third send.
- [ ] The stage fails without a model call when an input file is missing, unreadable or the wrong shape. The input files are the structured transcript, the slide placements and the slide readings. The error names the file.
