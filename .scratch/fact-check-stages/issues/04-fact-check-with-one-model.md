# 04 — The fact check with one model

**What to build:** The stage `check-facts` after `rewrite-subtopics`. It sends the whole rewrite of the lecture to the primary model in one call. The call uses prompt f2 and gets no transcript. The stage writes the model's factual errors. The user can run it on lecture 4 and read them.

**Blocked by:** 02 — Remove rounds and attempt numbers

**Status:** ready-for-agent

- [x] The technical design, the plan and the requirements describe the stage before the build.
- [x] The config entry of the stage has `models`, a list of model entries. Each entry has the usual model settings and a `role`: `primary`, `secondary` or `disabled`.
- [x] The list must have exactly one primary model and no more than one secondary model. Otherwise the config loader stops with an error that names the rule.
- [x] Prompt f2 is copied word for word from the prototype. The stage records `factCheckPromptVersion`.
- [x] The stage joins the rewritten subtopics in lecture order, each under its subtopic id and title from the structured transcript.
- [x] The stage writes the reply of the model to `Fact checks/<model>.json`, named by the model and not by its role.
- [x] The stage writes `Fact checks/factual-errors.json`. Each factual error has `subtopicId`, `passage`, `problem`, `correctStatement`, `severity`, `foundBy` and `wordsFound`. The model's word "correction" stops at the reply.
- [x] Sometimes the words of a factual error are not exactly in its subtopic. The stage keeps the error with `wordsFound` false. The terminal shows a message that names the subtopic.
- [x] A reply that names a subtopic id not in the lecture is an unusable reply.
- [x] The run summary shows the stage's row with its model.
- [ ] A live run on lecture 4 by the user.

## Comments

2026-10-14: built unwired in `src/pipeline/stages/check-facts/`.

Done and tested:
- the `models` list check (`readFactCheckModels` in `config.ts`)
- prompt f2 word for word, and the joined rewrite
- the two kinds of file
- `wordsFound`, with a notice
- the resend on an unknown subtopic.

Waiting for the wiring ticket: the config loader call, the terminal notice, the run summary row and the live run.

User decisions: the fact check sends the current lecture title. A subtopic number written as digits, such as "3", is read as a number.

**2026-10-15, box check:** The design box is done in 1536425d, before the build in 7f21a8c3. The `models` list box is done in 7f21a8c3 and dcc00e5c. The role count box is done in 7f21a8c3. The config tests name each rule. The prompt f2 box is done in 7f21a8c3. The stage text is the same as f2 of the prototype. The box of the joined rewrite is done in 7f21a8c3. The box of the file of each model is done in 7f21a8c3. The box of `factual-errors.json` is done in 7f21a8c3. The `wordsFound` box is done in 7f21a8c3 and 45604014. 45604014 shows the notice in the terminal. The box of the unknown subtopic id is done in 7f21a8c3. The run summary box is done in 46274db3.
