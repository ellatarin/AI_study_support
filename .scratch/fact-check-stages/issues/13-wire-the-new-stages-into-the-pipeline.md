# 13 — Wire the new stages into the pipeline

**What to build:** The pipeline runs the four new stages after `rewrite-subtopics`: `check-facts`, `correct-factual-errors`, `relocate-slides` and `build-notes-page`. A user who runs a lecture gets the notes page in `Final output/<base name>/`. The commands for one stage, reset, rename, change-date, delete and the cost report know the four stages.

**Blocked by:** 04, 05, 06, 09 and 10. The four stages are built and tested. No stage list names them.

**Status:** ready-for-agent

## The stage list and the files

- [ ] The stage list names the four stages in this order, after `rewrite-subtopics`: `check-facts`, `correct-factual-errors`, `relocate-slides`, `build-notes-page`.
- [ ] The folder names "Fact checks", "Fact corrections" and "Slide relocations" move from the stage modules to the layout module. The folder names of the other stages are there.
- [ ] `relocate-slides` reads the fact-corrected subtopics from `Fact corrections/`. It does not read the rewrites. The reader of `fact-corrected-subtopics.json` is new.
- [ ] `correct-factual-errors` and `relocate-slides` work on each subtopic. They run through the same path as the other subtopic stages.
- [ ] The four stages were built before the stage list named them. So that they could run in tests, the build added helpers that make a stage's folder and run a stage outside the stage list. These helpers, their fixtures and the word "unlisted" in their names are deleted. The word gets no glossary entry.
- [ ] The input-file type no longer lists `check-facts` and `relocate-slides` as special cases.

## The config

- [ ] The config loader reads the entries of the four stages. The reader of the fact-check model list exists already.
- [ ] The example config and the user's config get these entries:
  - `correct-factual-errors`: `anthropic/claude-sonnet-5.5`, `concurrency` 10, `sendGapSeconds` 0.25.
  - `relocate-slides`: `google/gemini-3.8-flash`, `concurrency` 10, `sendGapSeconds` 0.25.
  - `check-facts`: one model, `anthropic/claude-opus-5.5`, with the role `primary`. The list has no secondary model at first (user, 2026-10-14).
- [ ] The OpenRouter send takes a model entry from the config. The runner gives this send to each stage that sends to a model.

## The runner and the terminal

- [ ] The run log records the cost of each model of a stage. `check-facts` can have two models.
- [ ] A stage can return messages for the user, such as a factual error whose words are not in its subtopic. The terminal shows each message.
- [ ] `check-facts` reports the files that it writes, as the other stages do.
- [ ] The run summary shows a row for each model of each new stage.

## The final output folder

- [ ] `build-notes-page` fails when a subtopic has no entry in `slide-relocations.json`. The error names the subtopic.
- [ ] A placed slide that is in no subtopic's entry of `slide-relocations.json` does not stop the stage. The terminal shows a warning that names the slide (user, 2026-10-14). Two causes exist: the slide has no reading, or `place-slides` gave it a subtopic that is not in the lecture.
- [ ] `relocate-slides` reads the slide placements and the slide readings, as now. A missing file stops the stage with an error that names the file.
- [ ] A reset of `build-notes-page` deletes only this lecture's folder in `Final output/`.
- [ ] Rename, change-date and normalisation give the lecture's folder in `Final output/` the new base name. Its contents stay. Today these commands rename one file, `<base name>.pdf`, and they do not find a folder.
- [ ] The delete command deletes the lecture's folder in `Final output/`. Today it deletes one file, `<base name>.pdf`.
- [ ] The delete of an orphaned workspace deletes the lecture's folder in `Final output/`.
- [ ] The test lecture fixture names a folder for the final output, not a `.pdf` file.

## The documents

- [ ] The technical design, the plan and the requirements describe the wired pipeline. When the build finds a divergence, the document changes to match the code.
- [ ] The suite version goes up last.

## After this ticket

Ticket 07, the user's live run on lecture 4, can start.

## Comments
