# 11 — `retitle-subtopics`

**What to build:** every subtopic of the chosen division is given a new title from its own text, in one call over the whole lecture, with the prototype's `r9` prompt word for word (CONTEXT.md, "Retitling"). Only titles change; no cut moves. It runs straight after `choose-division` and before `define-topics`, which groups on the new titles. Built to TD §5, `retitle-subtopics`, and plan Phase 13.

**Blocked by:** 07, 12

**Status:** ready-for-agent

- [ ] One call per lecture sends every subtopic in order, each as its position (counting from 1) and its trimmed text, and no title.
- [ ] A reply is valid only when it holds exactly one non-blank title for every subtopic, in order, with no position missing, repeated or out of range. Anything else, and an empty or non-JSON reply, is resent (ticket 04's retries); the third failure fails the stage.
- [ ] `Retitled subtopics/subtopics.json` holds the whole chosen division with every title replaced and spans and reasons unchanged; `Chosen division/subtopics.json` is untouched.
- [ ] `Retitled subtopics/changes.json`, beside the division, records how many subtopics there are, how many titles changed, and each changed title as its position, old title and new — a title returned unchanged is not a change.
- [ ] The stage fails when the chosen division is missing or unreadable.
- [ ] The stage's entry is in the example config (model placeholder) and the user's own (`openai/gpt-6.1-sol-pro`); no reasoning-effort setting is sent.
- [ ] **Live run:** in ticket 08's joint live run, beside the prototype's `r9` titles.

## Comments

2026-09-29: retitling was first placed before grouping. Grouping g15 × 18 on the retitled divisions broke lecture 4 — its promotion topic start fell from 15/18 to 7/18 and the chosen grouping went wrong — because inherited titles mark where the splitter saw a larger unit begin (`analysis-2026-09-29/rt3_vs_d13.py`). The user moved it after grouping. No check step follows it: titles are unchecked throughout the pipeline, and the user accepted that.

2026-09-30, redesigned before any build (grill, TD 374a543): retitling is back before grouping. With `r9` titles on `openai/gpt-6.1-sol-pro`, grouping found every ruled start on lecture 4, and the user judged `r9` "really good and stable enough to rely on one run… should be built into the pipeline as is". `r3`, one call per marked subtopic with its neighbours' titles, and `callConcurrency` on this stage are dropped; every subtopic is retitled in one call. Now blocked by 07 and 12 (a refused Sol Pro call is resent).

2026-09-30: the record of how the result was reached moved from the manifest to a small file beside the output (the user's choice; TD §4.5, "How a result was reached is kept beside the result").
