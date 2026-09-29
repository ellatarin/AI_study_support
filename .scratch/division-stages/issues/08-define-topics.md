# 08 — `define-topics` (grouping)

**What to build:** the chosen division's subtopics are grouped into topics by a panel of grouping runs, and the run nearest the panel's vote becomes the lecture's topics, taken whole (CONTEXT.md, "Chosen grouping"). Built to TD §5, `define-topics`, and plan Phase 13, then compared against the prototype. Judging the lecture title is not part of this ticket. Grouping sees the chosen run's titles as written, inherited ones included; retitling comes after (ticket 11).

**Blocked by:** 07

**Status:** ready-for-agent

- [ ] Each grouping run sends the chosen division's subtopics, each with its id, title and full text, with the prototype's `g15` prompt in its titled form, byte-identical.
- [ ] A reply is valid when its topics start at subtopic 1, ascend, stay in range, and no topic is empty; anything else is a failed send (ticket 04's retries, then the stage fails).
- [ ] `panelSize` (18) and `bar` (9) come from a new required `grouping` settings section, added to the settings, the example file and the user's own file; the bar may not exceed the panel size. The stage's model is set per stage, `google/gemini-3.7-flash` in the user's file.
- [ ] Each run is read as the subtopics it starts a topic at, the first excepted, and the grouping is chosen with ticket 07's shared chooser at `bar`: runs with the same starts are the same grouping, whatever they named their topics.
- [ ] Each run is saved in `Grouping runs/run-NN.json` with the model's full reply; `Topics/topics.json` holds each topic's title from the chosen run and the subtopic it starts at, without `groupedBecause`.
- [ ] The manifest entry records the chosen run, its distance from the vote and the panel size, as `choose-division`'s does, and keeps that record when the stage is later skipped.
- [ ] **Replay against the prototype:** a one-off script feeds the prototype's 18 saved `g15` runs per lecture, on each lecture's closest-run `d13` division, through the new choice at bar 9; for each lecture it chooses the same grouping as `analysis-2026-09-29/g12_vs_g15.py` does from those runs.
- [ ] **Live run:** the stage runs for real on one lecture (cost stated first); its topic count and topic starts fall within the range the prototype's `g15` runs showed on that lecture.
- [ ] The replay script and results stay in the prototype folder.

## Comments

2026-09-29, redesigned before any build (grill rounds 1–2, TD 9eb37fb): `g12` → `g15` (adds a rule that a subtopic only looking back ends the topic before); the modal grouping → the run nearest a 9-of-18 vote, chosen with `choose-division`'s chooser; panel 9 → 18; the manifest records chosen run and distance instead of "modal, 5 of 9"; `label` → title. On each lecture's chosen division, `g15`'s chosen grouping matched the user's rulings on all five ruled lectures.
