# 05 — Live run on one lecture, with the test page

**What to build:** The three slide stages run on the lecture of 2026-03-06, "Causes of Cancer". A temporary script builds a private HTML page from the stored files, so that the user can judge the placements.

**Blocked by:** 04 — Place each subject-matter slide with a subtopic

**Status:** ready-for-agent

- [x] The three stages run on 2026-03-06. The measured cost of each stage is quoted from the manifest.
- [x] The script is in the scratch folder. The user asked on 2026-10-08 to keep it as the prototype of the HTML notes, so it is committed: `.scratch/slide-placement/test-page/build-test-page.mts`. The pages that it builds hold lecture content, so they are not committed.
- [ ] The page shows the topic and subtopic headings, the transcript text of each subtopic, and each placed slide with its caption.
- [ ] The page uses smaller JPEG copies of the slides and stays below 16 MB. The stored PNG images do not change.
- [ ] The page has a switch that shows the slides at the start or at the end of each subtopic.
- [x] The page is published as a private artifact.
- [x] This ticket records the user's judgement of the placements and the measured costs.
- [ ] This ticket lists each slide that the deck shows twice, and the user judges whether the page must show it once. Two references slides with the same title can be two different pages, so a repeat must be found by its image, not by its title.
- [ ] This ticket lists each run of slides in which each slide repeats the slide before it with a small change. The user judges whether the page must show each slide of the run or only the last one. Lecture 3 has such a run: slides 4, 5 and 6 are one diagram in three steps. A byte comparison does not find a run, because each image is different.
- [x] If the user judges the placements of `google/gemini-3.8-flash` poor, the user chooses a stronger model for `place-slides`, and the stage runs again.

## Comments

**User's judgement (2026-10-08):** the `p2` placements on the pages of lectures 3 and 4 are good. The user keeps `google/gemini-3.8-flash`. A rewrite can change the sentence at each placement point. So each placement must also describe the subject matter of its sentence. That change is a new ticket.

**Measured costs (USD, from the manifests):**

| Lecture | read-slides | place-slides `p1` | place-slides `p2` |
|---|---|---|---|
| Lecture 3, 2026-03-04 | 0.3422 | not run | 0.1612 |
| Lecture 4, 2026-03-06 | 0.2640 | 0.0749 | 0.1156 |

The `p2` call of lecture 3 used 22,616 input tokens and 38,475 output tokens. About 35,000 of the output tokens were reasoning. The `p2` reasoning is about three times the `p1` reasoning.
