# 06 — Fact correction

**What to build:** The stage `correct-factual-errors` after `check-facts`. It sends each subtopic that has factual errors to the model with its errors, one call for each subtopic. It writes a fact-corrected subtopic for every subtopic, and one file for the whole lecture.

**Blocked by:** 03 — Try prompt k3 on lecture 4, and 04 — The fact check with one model

**Status:** ready-for-agent

- [x] The technical design, the plan and the requirements describe the stage before the build.
- [x] The prompt is the one that the user chose in ticket 03, copied word for word. The stage records `factCorrectionPromptVersion`.
- [ ] The config entry has the model `anthropic/claude-sonnet-5.5`, `concurrency` 10 and `sendGapSeconds` 0.25, in the example config and in the user's config.
- [x] The stage writes `Fact corrections/subtopic-<id>.json` for each subtopic, with `subtopicId`, `factCorrectionPromptVersion`, `factualErrors`, `factCorrectedSubtopic`, `changes`, `checkedBy`, `paragraphCountBefore` and `paragraphCountAfter`.
- [x] A subtopic with no factual errors gets no call. Its file holds its rewrite unchanged, an empty `factualErrors` list and the full `checkedBy` list.
- [x] A reply with a different number of paragraphs is kept. The two counts show the change. The terminal shows no message.
- [ ] If prompt k2 is chosen, the stage removes paragraph labels such as "[1]" from the reply.
- [x] At the end, the stage writes `Fact corrections/fact-corrected-subtopics.json`, with the entries of each subtopic in lecture order.
- [x] A stage that starts again makes no call for a subtopic with a saved file.
- [x] The run summary shows the stage's row.

## Comments

**2026-10-15, box check:** The design box is done in 1536425d, before the build in d65d9b94. The prompt box is done in d65d9b94. The stage text is the same as k3 of the prototype, and the plan records that the user chose k3. The box of the subtopic file fields is done in d65d9b94. The box of the subtopic with no factual errors is done in d65d9b94. The box of the different paragraph count is done in d65d9b94. The box of `fact-corrected-subtopics.json` is done in d65d9b94. The box of the stage that starts again is done in d65d9b94 and da5deb2d. The run summary box is done in 1308c77f and 20e6974e. 1308c77f gives the stage its label in the summary. 20e6974e runs the stage in the pipeline.
