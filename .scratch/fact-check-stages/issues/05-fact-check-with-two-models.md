# 05 — The fact check with two models

**What to build:** `check-facts` also calls a secondary model and merges the factual errors of the two models. Each merged factual error that both models report takes the primary model's text.

**Blocked by:** 04 — The fact check with one model

**Status:** ready-for-agent

- [ ] The two models are called at the same time.
- [ ] Two factual errors of different models become one merged factual error under two conditions. They are in the same subtopic, and their passages share a run of three words. The prototype merge uses the same rule.
- [ ] A merged factual error takes the primary model's text, and `foundBy` lists both model ids.
- [ ] A factual error that only one model reports goes into the file with that model's text.
- [ ] A disabled model is not called.
- [ ] When one model fails each send, the stage fails and keeps the reply of the other model. The next run calls only the model with no saved reply.
- [ ] A saved reply of a model that is now disabled is not used.
- [ ] The run summary has one row for each model of the stage, with its calls, tokens and cost.
- [ ] A live run on lecture 4 by the user, with Sol Pro as primary and Opus 5.5 as secondary.

## Comments
