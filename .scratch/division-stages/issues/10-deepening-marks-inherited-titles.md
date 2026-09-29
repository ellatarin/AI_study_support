# 10 — Deepening marks inherited titles

**What to build:** every subtopic records whether its title is **inherited** (CONTEXT.md, "Inherited title") — written for the larger subtopic deepening cut it from. Code sets the mark as it cuts; the `d13` prompt and what the model is asked are unchanged. Built to TD §5, `deepen-subtopic-splitting`, "Inherited titles are marked".

**Blocked by:** 09

**Status:** ready-for-agent

- [ ] Every subtopic of an initial run is unmarked.
- [ ] When deepening cuts a subtopic, the first piece is marked and the new pieces are not.
- [ ] A subtopic deepening leaves whole keeps its mark as it was.
- [ ] A second-round cut marks its first piece, whether the subtopic cut had an inherited title or one of its own; a marked piece cut again stays marked.
- [ ] A saved run whose subtopics lack the mark does not read as a division.
- [ ] **Remake:** all eight lectures' initial and deepened runs are made again with the new code, so every live run carries titles and marks (about $6.50; the cost is stated first). The user runs it.

## Comments

2026-09-29: the user asked whether the old live files could be converted instead, deriving marks from the initial runs as the prototype did. It cannot see one case — a second-round cut of a piece that already had its own title — because run files keep only the final subtopics, not the rounds. The user chose to remake.
