# 06 — Fact correction

**What to build:** The stage `correct-factual-errors` after `check-facts`. It sends each subtopic that has factual errors to the model with its errors, one call for each subtopic. It writes a fact-corrected subtopic for every subtopic, and one file for the whole lecture.

**Blocked by:** 03 — Try prompt k3 on lecture 4, and 04 — The fact check with one model

**Status:** ready-for-agent

- [ ] The technical design, the plan and the requirements describe the stage before the build.
- [ ] The prompt is the one that the user chose in ticket 03, copied word for word. The stage records `factCorrectionPromptVersion`.
- [ ] The config entry has the model `anthropic/claude-sonnet-5.5`, `concurrency` 10 and `sendGapSeconds` 0.25, in the example config and in the user's config.
- [ ] The stage writes `Fact corrections/subtopic-<id>.json` for each subtopic, with `subtopicId`, `factCorrectionPromptVersion`, `factualErrors`, `factCorrectedSubtopic`, `changes`, `checkedBy`, `paragraphCountBefore` and `paragraphCountAfter`.
- [ ] A subtopic with no factual errors gets no call. Its file holds its rewrite unchanged, an empty `factualErrors` list and the full `checkedBy` list.
- [ ] A reply with a different number of paragraphs is kept. The two counts show the change. The terminal shows no message.
- [ ] If prompt k2 is chosen, the stage removes paragraph labels such as "[1]" from the reply.
- [ ] At the end, the stage writes `Fact corrections/fact-corrected-subtopics.json`, with the entries of each subtopic in lecture order.
- [ ] A stage that starts again makes no call for a subtopic with a saved file.
- [ ] The run summary shows the stage's row.

## Comments
