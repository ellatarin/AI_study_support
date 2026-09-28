# 01 — Design docs for the four division stages

**What to build:** the design documents describe the four new stages completely before any code is written, so every later ticket builds to a written contract. The technical design gains a `define-topics` section beside the existing "Dividing the transcript" section. The implementation plan gains an entry for each of the four stages and for the two groundwork tickets. The glossary changes made while grilling are committed.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] The technical design places the four stages after transcription, in the order `initial-subtopic-splitting` → `deepen-subtopic-splitting` → `vote-cut-sites` → `define-topics`, with every existing stage kept and unchanged. Nothing reads the new stages' output yet; the move to the full 20-stage pipeline is later work.
- [x] `vote-cut-sites` is recorded as the confirmed name.
- [x] A `define-topics` section states, as behaviour:
  - Input: the voted subtopics. Prompt: the prototype's `g12`, word for word, in its no-labels form only (the labels switch is not carried over). Model: `google/gemini-3.7-flash`, set per stage like every other.
  - A grouping panel of `panelSize` runs (default 9) from a required `grouping` section of the settings.
  - A run's reply is valid when its topics start at subtopic 1, ascend, stay in range, and no topic is empty. Failure handling and relaunch are the same as the division stages: up to 3 sends per run, then the stage fails; never a partial panel; a relaunch makes only the missing runs.
  - The result is the **modal grouping**. Two runs made the same grouping when their topics start at the same subtopics, whatever they named them. On a tie, the tied run with the smallest total disagreement with every other run wins; disagreement between two runs is the number of subtopics where one starts a topic and the other does not. If that also ties, the earliest run wins. When no grouping repeats, the same tie-break applies.
  - Outputs: each run in `Grouping runs/run-NN.json`, keeping the model's reply including each topic's `groupedBecause`. `Topics/topics.json` holds each topic's name, taken from the winning run, and the subtopic it starts at — no `groupedBecause`.
  - The manifest entry records how the grouping was chosen (modal, or the tie-break) and how many runs made it, e.g. "5 of 9", and keeps that record when the stage is later skipped.
  - Deferred to later tickets: choosing each subtopic's label from the vote's candidates, and judging the lecture title.
- [x] The design records that the four stages are exempt from the rule that every model step gets a check step, and why: losslessness is guaranteed by code, the panel vote and the modal grouping are what check the model's judgement, and no calibrated checker exists for either.
- [x] The design states the new source layout: each stage owns a folder holding its code, prompt(s) and tests, and the shared division code has one home the three division stages reach.
- [x] The design states the panel-run behaviour shared by all four stages (ticket 04).
- [x] The `division` and `grouping` settings sections are described as required sections, like every existing one.
- [x] Rulings, rubrics and scoring are named as prototype-only and appear nowhere in the pipeline design.
- [x] README's stage list and status table agree with the design.
- [x] The glossary changes from grilling are committed with the docs.
- [x] The technical design, the implementation plan and the user test plan refer to every stage by its current code id, never by number. Phase numbers stay. Code is ticket 02.
