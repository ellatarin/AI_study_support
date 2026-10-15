# 13 — Wire the new stages into the pipeline

**What to build:** The pipeline runs the four new stages after `rewrite-subtopics`: `check-facts`, `correct-factual-errors`, `relocate-slides` and `build-notes-page`. A user who runs a lecture gets the notes page in `Final output/<base name>/`. The commands for one stage, reset, rename, change-date, delete and the cost report know the four stages.

**Blocked by:** 04, 05, 06, 09 and 10. The four stages are built and tested. No stage list names them.

**Status:** ready-for-agent

## The stage list and the files

- [x] The stage list names the four stages in this order, after `rewrite-subtopics`: `check-facts`, `correct-factual-errors`, `relocate-slides`, `build-notes-page`.
- [x] The folder names "Fact checks", "Fact corrections" and "Slide relocations" move from the stage modules to the layout module. The folder names of the other stages are there.
- [x] `relocate-slides` reads the fact-corrected subtopics from `Fact corrections/`. It does not read the rewrites. The reader of `fact-corrected-subtopics.json` is new.
- [x] `correct-factual-errors` and `relocate-slides` work on each subtopic. They run through the same path as the other subtopic stages.
- [x] The four stages were built before the stage list named them. So that they could run in tests, the build added helpers that make a stage's folder and run a stage outside the stage list. These helpers, their fixtures and the word "unlisted" in their names are deleted. The word gets no glossary entry.
- [x] The input-file type no longer lists `check-facts` and `relocate-slides` as special cases.

## The config

- [x] The config loader reads the entries of the four stages. The reader of the fact-check model list exists already.
- [x] The example config and the user's config get these entries:
  - `correct-factual-errors`: `anthropic/claude-sonnet-5.5`, `concurrency` 10, `sendGapSeconds` 0.25.
  - `relocate-slides`: `google/gemini-3.8-flash`, `concurrency` 10, `sendGapSeconds` 0.25.
  - `check-facts`: one model, `anthropic/claude-opus-5.5`, with the role `primary`. The list has no secondary model at first (user, 2026-10-14).
- [x] The OpenRouter send takes a model entry from the config. The runner gives this send to each stage that sends to a model.

## The runner and the terminal

- [x] The run log records the cost of each model of a stage. `check-facts` can have two models.
- [x] A stage can return messages for the user, such as a factual error whose words are not in its subtopic. The terminal shows each message.
- [x] `check-facts` reports the files that it writes, as the other stages do.
- [x] The run summary shows a row for each model of each new stage.

## The final output folder

- [x] `build-notes-page` fails when a subtopic has no entry in `slide-relocations.json`. The error names the subtopic.
- [x] A placed slide that is in no subtopic's entry of `slide-relocations.json` does not stop the stage. The terminal shows a warning that names the slide (user, 2026-10-14). Two causes exist: the slide has no reading, or `place-slides` gave it a subtopic that is not in the lecture.
- [x] `relocate-slides` reads the slide placements and the slide readings, as now. A missing file stops the stage with an error that names the file.
- [x] A reset of `build-notes-page` deletes only this lecture's folder in `Final output/`.
- [x] Rename, change-date and normalisation give the lecture's folder in `Final output/` the new base name. Its contents stay. Today these commands rename one file, `<base name>.pdf`, and they do not find a folder.
- [x] The delete command deletes the lecture's folder in `Final output/`. Today it deletes one file, `<base name>.pdf`.
- [x] The delete of an orphaned workspace deletes the lecture's folder in `Final output/`.
- [x] The test lecture fixture names a folder for the final output, not a `.pdf` file.

## The documents

- [x] The technical design, the plan and the requirements describe the wired pipeline. When the build finds a divergence, the document changes to match the code.
- [x] The suite version goes up last.

## After this ticket

Ticket 07, the user's live run on lecture 4, can start.

## Comments

### Hand-off 2026-10-14

The user approved ten test points in this order. Each step below is committed on `main`, and the commit gate passed on each one.

1. Stage list and layout: 1308c77f.
2. Config, with the `models` list of `check-facts`: dcc00e5c. The reader of `fact-corrected-subtopics.json` is eb7a5d92. Ticket 12 shares it.
3. `correct-factual-errors` through the stage factory: da5deb2d. The new definer `defineSubtopicAndLectureFileStage` writes the subtopic files and then the lecture file.
4. `relocate-slides` through the stage factory: 8f040e7b. It reads the fact-corrected subtopics, the slide placements and the slide readings.
5. `check-facts` through the stage factory: 5a5dcd48. `callModel` takes the model and its tuning (`stageConfig`). The user rejected a thin wrapper that dodged two lint rules. The word "unlisted" is gone from `src/`.
6. Stage notices: 45604014. The line is `⚠ <Stage> — <notice>`. The user has not yet seen this wording. The cost and the config of each model: 2020c872. The runner owns the tally of each model and gives it to each stage run.
7. One row for each model in the run summary and in the first section of the cost report: 46274db3. The error recovery section and the experiment section still show one line with "—" for `check-facts`. The user has not yet answered whether they want one row for each model there.

Not done:

- Step 9, next: the lecture's folder in `Final output/`. Rename, change-date, normalisation (two passes) and `judge-lecture-title` give the folder the new base name. Delete and the delete of an orphaned workspace delete the folder. The fixture `testLecture.finalOutputFile` becomes a folder. A trap: `renameToBase` keeps the extension, and a folder name with "Dr. Smith" has an extension by `extname`. The code reads the final output folder in `lecture-files.ts`, `source-normalisation.ts` (`discoverFinalOutput`, files only), `source-renames.ts` and `orphaned-workspaces.ts`. The tests are in `lecture-files.integration.test.ts`, `lecture-identity.integration.test.ts`, `runner.integration.test.ts`, `judge-lecture-title.integration.test.ts`, `source-normalisation.integration.test.ts` and `source-renames.test.ts`.
- Step 10: the CLI builds a stage for each entry in the stage list.
- Step 8, after the merge of ticket 12: `build-notes-page` through the stage factory. A subtopic with no relocation entry fails the stage. A placed slide in no entry gives a warning, not a failure (user). A reset deletes only this lecture's folder. The stage is skipped when the folder under the current base name holds `notes.html` (user's choice A).
- The user's `pipeline-config.json` gets the three entries. It is git-ignored.
- The documents, then the suite version, once, after the merge of ticket 12.
- A question for the user: the parameter `sendToModel` of the test helper `itReadsSavedSubtopicFiles` now holds the stubbed completion call. Propose a rename table.

**2026-10-15, later:** the technical design part of the documents box is written, but it is not committed. It is in the working tree of `main`, in `docs/technical-design.md`. It also holds the docs of the run flags (`.scratch/run-flags/issues/01`) and of the Safari note box. The plan and the requirements are not written yet. Then the suite version goes up once, from 1.97-draft. The commit gate refuses every commit while the fast version of the notes PDF is in the working tree (`.scratch/notes-pdf/issues/01`).

**2026-10-15, box check:** The stage list box is done in 1308c77f. The folder name box is done in 1308c77f. The box of the fact-corrected input of `relocate-slides` is done in 8f040e7b and eb7a5d92. The box of the subtopic stage path is done in da5deb2d and 8f040e7b. The "unlisted" box is done in 5a5dcd48. No file of `src/` or `CONTEXT.md` on `main` holds the word. The input-file type box is done in eb7a5d92. The config loader box is done in dcc00e5c. `build-notes-page` has no stage entry. Its switches are in `finalOutput`, from c2e4da77 and caeb91cc. The box of the cost of each model is done in 2020c872. The stage notice box is done in 45604014. The box of the files of `check-facts` is done in 5a5dcd48. The box of a row for each model is done in 46274db3. The box of a subtopic with no relocation entry is done in 6694633d. The box of the warning for a placed slide is done in 6694633d. The box of the missing input of `relocate-slides` is done in 8f040e7b. The reset box is done in 6694633d. The rename box is done in 11520b83. The delete box is done in 11520b83. The orphaned workspace box is done in 11520b83. The fixture box is done in 11520b83.

**2026-10-15, docs:** The documents box is done in cfc02116. The technical design, the plan (Phase 26) and the requirements (FR-3.6, FR-3.7, FR-4.5) describe the wired pipeline. The suite version went up last, from 1.97-draft to 1.98-draft, in fd137ca7. Two config boxes are still open: the example config entries, and the OpenRouter send that takes a model entry.

**2026-10-15, config boxes:** Both boxes were already done in the code. The example config entries are done in 8f040e7b, with the values above. The user's config has the three stages, with the models that the user chose later. The send box is done in 5a5dcd48. `callModel` takes the model and its tuning as one config entry. Each stage with one model looks up its entry in the config on each call. `check-facts` sends each model of its list with that model's entry. The CLI gives each stage the one client of the invocation. The runner gives each stage run its send gate and its cost tally. The runner records the entry from the same config, after the run flags.
