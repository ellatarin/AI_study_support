# 11 — `retitle-subtopics`

**What to build:** after grouping, each subtopic of the chosen division whose title is inherited is given a title of its own, from its own text, with the prototype's `r3` prompt word for word (CONTEXT.md, "Retitling"). Only titles change; no cut moves. Built to TD §5, `retitle-subtopics`, and plan Phase 14.

**Blocked by:** 08 — the stage sits straight after `define-topics` in the stage order. It needs the marks (10) and the chosen division (07), both of which 08 already waits on.

**Status:** ready-for-agent

- [ ] Only marked subtopics are sent, one call each; there is no panel.
- [ ] Each call sends the subtopic's trimmed text and the titles of the subtopics either side as the chosen run wrote them — a neighbour that is itself marked is sent with its inherited title — and no title where there is no neighbour.
- [ ] Calls are sent together, as many at once as the stage's `callConcurrency` allows. `callConcurrency` is accepted on this stage as well as `deepen-subtopic-splitting`, and is still a config error on any other.
- [ ] A reply that is empty, not JSON, or not an object with a non-empty `title` is resent (ticket 04's retries); a subtopic failing its third send fails the stage.
- [ ] `Retitled subtopics/subtopics.json` holds the whole chosen division with each marked subtopic's title replaced and everything else, marks included, as it was.
- [ ] With no subtopic marked, no call is made and the division is written unchanged.
- [ ] The manifest entry records how many subtopics were retitled, and keeps it when the stage is later skipped.
- [ ] The stage's entry is in the example config (model placeholder, `callConcurrency` 10) and the user's own (`google/gemini-3.7-flash`).
- [ ] **Side by side with the prototype:** a one-off script lists, per lecture, the subtopics the prototype retitled (`retitle-r3-closest-d13-*`) beside those a live chosen division marks, for the user to read. The prototype's divisions carry no marks, so this is a view, not a replay.
- [ ] **Live run:** on one lecture, the new titles beside the inherited ones. The cost is stated first.

## Comments

2026-09-29: retitling was first placed before grouping. Grouping g15 × 18 on the retitled divisions broke lecture 4 — its promotion topic start fell from 15/18 to 7/18 and the chosen grouping went wrong — because inherited titles mark where the splitter saw a larger unit begin (`analysis-2026-09-29/rt3_vs_d13.py`). The user moved it after grouping. No check step follows it: titles are unchecked throughout the pipeline, and the user accepted that.
