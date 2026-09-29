# 08 — `define-topics` (grouping)

**What to build:** the chosen division's subtopics are grouped into topics by a panel of grouping runs, and the modal grouping becomes the lecture's topics. Built to the `define-topics` section ticket 01 writes, then compared against the prototype. Judging the lecture title is not part of this ticket; subtopic titles come from the chosen division (ticket 07).

**Blocked by:** 07

**Status:** ready-for-agent

- [ ] Each grouping run sends the chosen division's subtopics, each with its full text and id and no label, with the prototype's `g12` prompt in its no-labels form, byte-identical.
- [ ] A reply is valid when its topics start at subtopic 1, ascend, stay in range, and no topic is empty; anything else is a failed send (ticket 04's retries, then the stage fails).
- [ ] `panelSize` (9) comes from a new required `grouping` settings section, added to the settings, the example file and the user's own file; the stage's model is set per stage, `google/gemini-3.7-flash` in the example.
- [ ] The modal grouping is chosen: runs with the same topic starts are the same grouping, whatever they named them; ties go to the tied run with the smallest total disagreement with all other runs (disagreement between two runs being the count of subtopics where one starts a topic and the other does not), then to the earliest run.
- [ ] Each run is saved in `Grouping runs/run-NN.json` with the model's full reply; `Topics/topics.json` holds each topic's name from the winning run and the subtopic it starts at.
- [ ] The manifest entry records how the grouping was chosen and how many runs made it, e.g. "modal, 5 of 9", and keeps that record when the stage is later skipped.
- [ ] **Replay against the prototype:** a one-off script feeds the prototype's saved `g12` Gemini 3.7 runs through the new choice of grouping, and for each lecture the chosen grouping matches the modal grouping recomputed from those same runs. The prototype's own picking script was lost, so the expected answer is recomputed, and that is stated in the results.
- [ ] **Live run:** the stage runs for real on one lecture (cost stated first); its topic count and topic starts fall within the range the prototype's `g12` runs showed on that lecture.
- [ ] The replay script and results stay in the prototype folder.
