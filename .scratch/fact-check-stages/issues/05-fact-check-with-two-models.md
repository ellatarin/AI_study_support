# 05 — The fact check with two models

**What to build:** `check-facts` also calls a secondary model and merges the factual errors of the two models. Each merged factual error that both models report takes the primary model's text.

**Blocked by:** 04 — The fact check with one model

**Status:** ready-for-agent

- [x] The two models are called at the same time.
- [x] Two factual errors of different models become one merged factual error under two conditions. They are in the same subtopic, and their passages share a run of three words. The prototype merge uses the same rule.
- [x] A merged factual error takes the primary model's text, and `foundBy` lists both model ids.
- [x] A factual error that only one model reports goes into the file with that model's text.
- [x] A disabled model is not called.
- [x] When one model fails each send, the stage fails and keeps the reply of the other model. The next run calls only the model with no saved reply.
- [x] A saved reply of a model that is now disabled is not used.
- [x] The run summary has one row for each model of the stage, with its calls, tokens and cost.
- [ ] A live run on lecture 4 by the user, with Sol Pro as primary and Opus 5.5 as secondary.

## Comments

2026-10-14: built unwired with ticket 04.

Done and tested:
- the calls at the same time
- the merge, with the count rule that the user chose. The primary error with the most shared three-word runs takes the secondary error. A tie goes to the earlier primary error
- the disabled model
- the failure that keeps the other file, and the next run that calls only the missing model
- each model's cost after a failure (`createCostTallyByModel`).

Waiting for the wiring ticket: the run summary rows, the runner that adds each model's cost to its earlier runs, and the live run.

**2026-10-15, box check:** The box of the calls at the same time is done in 7f21a8c3. The merge rule box is done in 7f21a8c3. The stage ranks a pair by the count of shared runs. The prototype ranks it by a share. The technical design records this difference. The box of the primary model's text is done in 7f21a8c3. The box of an error from one model is done in 7f21a8c3. The box of the disabled model is done in 7f21a8c3. The box of the failed model is done in 7f21a8c3. The box of the saved reply of a disabled model is done in 7f21a8c3. The run summary box is done in 46274db3.
