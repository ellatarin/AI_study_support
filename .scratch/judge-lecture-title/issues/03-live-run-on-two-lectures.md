# 03 — Live run on two lectures

**What to build:** Run `judge-lecture-title` on two real lectures. One lecture has a meaningful provisional title, and one has a title that is not meaningful. The user reads each judgement and its reason, and decides if the prompt is good enough. The estimated cost is about $0.12. State the cost before the run.

**Blocked by:** 02 — Rename the lecture, and remove the title judgement from `transcript-structuring`

**Status:** resolved

- [x] The cost estimate is stated, and the user agrees to it before the run.
- [x] The lecture with a meaningful title keeps its title, and no file moves.
- [x] The lecture with a title that is not meaningful gets an AI-derived title, and its files move once.
- [x] The measured cost of one call is recorded, so that TD §5 can replace the $0.06 estimate.
- [x] The user reads both judgements and their reasons, and records a ruling on the prompt.

## Comments

The runs were on Biology of Disease, on 2026-10-07. The cost was stated before each run. The user made the first run before reading that statement.

The first run used the stored provisional titles. Each one ended in " on", because the manifests were made before `e4b3e537`. Three lectures also kept the AI-derived names that the old `transcript-structuring` stage gave them. A data fix removed the " on" and put back the provisional titles. `b3439e0f` changed `kept-provisional`, so that it now puts back the provisional title itself.

With the provisional titles, the model judged all eight titles meaningful and kept them. No file moved.

For the case that is not meaningful, 2026-03-06 got an empty provisional title, as a filename with only a date and a lecture number gives. The model proposed "Causes and Mechanisms of Cancer Development". The video, the slide and the workspace moved to the new base name, and the judgement was written before the move. Then the original title "Causes of Cancer" was put back.

Nine calls cost $0.038 to $0.061 each, and $0.051 on average. TD §5 now gives these figures.

The user ruled that the prompt is fine.
