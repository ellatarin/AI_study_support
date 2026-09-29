# 10 — Deepening marks inherited titles

**What to build:** every subtopic records whether its title is **inherited** (CONTEXT.md, "Inherited title") — written for the larger subtopic deepening cut it from. Code sets the mark as it cuts; the `d13` prompt and what the model is asked are unchanged. Built to TD §5, `deepen-subtopic-splitting`, "Inherited titles are marked".

**Blocked by:** 09

**Status:** resolved

- [x] Every subtopic of an initial run is unmarked.
- [x] When deepening cuts a subtopic, the first piece is marked and the new pieces are not.
- [x] A subtopic deepening leaves whole keeps its mark as it was.
- [x] A second-round cut marks its first piece, whether the subtopic cut had an inherited title or one of its own; a marked piece cut again stays marked.
- [x] A saved run whose subtopics lack the mark does not read as a division.
- [x] **Remake:** all eight lectures' initial and deepened runs are made again with the new code, so every live run carries titles and marks (about $6.50; the cost is stated first). The user runs it.

## Comments

2026-09-29: the user asked whether the old live files could be converted instead, deriving marks from the initial runs as the prototype did. It cannot see one case — a second-round cut of a piece that already had its own title — because run files keep only the final subtopics, not the rounds. The user chose to remake.

2026-09-29, resolved (c0ed385). Remade with `batch --from-stage initial-subtopic-splitting --to-stage deepen-subtopic-splitting --concurrency 4`, run from Claude's shell at the user's word; this deleted lectures 3–5's old `Structured transcript` and `Transcript verification` output, which the user chose not to back up. All 8 lectures succeeded; cost n/a (issue #10). Every initial run is unmarked and every deepened run carries titles and marks. Deepened subtopics per run against the prototype's `d13` range over 18 runs: l1 16–19 (15–18), l2 11–16 (12–16), l3 16–18 (16–18), l4 21–22 (20–24), l5 16–18 (16–20), l6 15–23 (15–22), l7 11–14 (11–13), l8 23–25 (20–26). Four lectures have one run one subtopic outside the prototype's range. Marked subtopics per run: 0–8, in line with the prototype's chosen divisions (1–7 per lecture).
