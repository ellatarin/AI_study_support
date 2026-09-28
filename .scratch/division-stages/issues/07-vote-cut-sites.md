# 07 — `vote-cut-sites`

**What to build:** the deepened runs are combined into one voted division of the transcript, keeping only the cut sites enough runs agree on. The stage makes no model call, so re-running it costs nothing.

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] All deepened runs' cuts are pooled, sorted, and grouped into cut sites: a cut joins the current site when it lies within 1% of the transcript's length of that site's **first** cut, otherwise it opens a new one. The 1% is fixed in code.
- [ ] A cut site is kept when its support reaches `bar` (5), added to the `division` settings section.
- [ ] A kept site is cut at the position most of its runs chose, the earliest on a tie, so a voted cut always falls exactly where some run cut.
- [ ] Each voted subtopic carries its runs' labels with counts; the first subtopic takes every run's first label. No label is chosen.
- [ ] The voted subtopics joined in order equal the transcript character for character.
- [ ] The stage fails when fewer than `panelSize` deepened runs are present.
- [ ] **Replay against the prototype:** a one-off script feeds the prototype's deepened runs 1–9 for each of the 8 lectures through the new vote at bar 5, and the result matches the prototype's saved voted divisions exactly. Any difference is explained or fixed.
- [ ] **Live run:** the stage runs on the live deepened runs from ticket 06's lecture; its voted subtopic count and cut sites fall within the prototype's range on that lecture.
- [ ] The replay script and results stay in the prototype folder.
