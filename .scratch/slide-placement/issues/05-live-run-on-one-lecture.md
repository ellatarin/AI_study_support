# 05 — Live run on one lecture, with the test page

**What to build:** The three slide stages run on the lecture of 2026-03-06, "Causes of Cancer". A temporary script builds a private HTML page from the stored files, so that the user can judge the placements.

**Blocked by:** 04 — Place each subject-matter slide with a subtopic

**Status:** ready-for-agent

- [ ] The three stages run on 2026-03-06. The measured cost of each stage is quoted from the manifest.
- [ ] The script is in the scratch folder and is not committed.
- [ ] The page shows the topic and subtopic headings, the transcript text of each subtopic, and each placed slide with its caption.
- [ ] The page uses smaller JPEG copies of the slides and stays below 16 MB. The stored PNG images do not change.
- [ ] The page has a switch that shows the slides at the start or at the end of each subtopic.
- [ ] The page is published as a private artifact.
- [ ] This ticket records the user's judgement of the placements and the measured costs.
- [ ] This ticket lists each slide that the deck shows twice, and the user judges whether the page must show it once. Two references slides with the same title can be two different pages, so a repeat must be found by its image, not by its title.
- [ ] This ticket lists each run of slides in which each slide repeats the slide before it with a small change. The user judges whether the page must show each slide of the run or only the last one. Lecture 3 has such a run: slides 4, 5 and 6 are one diagram in three steps. A byte comparison does not find a run, because each image is different.
- [ ] If the user judges the placements of `google/gemini-3.8-flash` poor, the user chooses a stronger model for `place-slides`, and the stage runs again.
