# 04 — The fact check with one model

**What to build:** The stage `check-facts` after `rewrite-subtopics`. It sends the whole rewrite of the lecture to the primary model in one call. The call uses prompt f2 and gets no transcript. The stage writes the model's factual errors. The user can run it on lecture 4 and read them.

**Blocked by:** 02 — Remove rounds and attempt numbers

**Status:** ready-for-agent

- [ ] The technical design, the plan and the requirements describe the stage before the build.
- [ ] The config entry of the stage has `models`, a list of model entries. Each entry has the usual model settings and a `role`: `primary`, `secondary` or `disabled`.
- [ ] The list must have exactly one primary model and no more than one secondary model. Otherwise the config loader stops with an error that names the rule.
- [ ] Prompt f2 is copied word for word from the prototype. The stage records `factCheckPromptVersion`.
- [ ] The stage joins the rewritten subtopics in lecture order, each under its subtopic id and title from the structured transcript.
- [ ] The stage writes the reply of the model to `Fact checks/<model>.json`, named by the model and not by its role.
- [ ] The stage writes `Fact checks/factual-errors.json`. Each factual error has `subtopicId`, `passage`, `problem`, `correctStatement`, `severity`, `foundBy` and `wordsFound`. The model's word "correction" stops at the reply.
- [ ] Sometimes the words of a factual error are not exactly in its subtopic. The stage keeps the error with `wordsFound` false. The terminal shows a message that names the subtopic.
- [ ] A reply that names a subtopic id not in the lecture is an unusable reply.
- [ ] The run summary shows the stage's row with its model.
- [ ] A live run on lecture 4 by the user.

## Comments

2026-10-14: built unwired in `src/pipeline/stages/check-facts/`. Done and tested: the `models` list check (`readFactCheckModels` in `config.ts`), prompt f2 word for word, the joined rewrite, the two kinds of file, `wordsFound` with a notice, and the resend on an unknown subtopic. Waiting for the wiring ticket: the config loader call, the terminal notice, the run summary row and the live run. User decisions: the fact check sends the current lecture title, and a subtopic number written as digits, such as "3", is read as a number.
