# 07 — `choose-division`

**What to build:** the deepened runs vote on where the transcript divides, and the run nearest the vote is handed on whole as the lecture's division, so its subtopics, titles and reasons all come from one run. The stage makes no model call, so re-running it costs nothing. Built to TD §5, `choose-division`, and plan Phase 12.

**Blocked by:** 06, 13

**Status:** ready-for-agent

- [ ] All deepened runs' cuts are pooled, sorted, and grouped into cut sites: a cut joins the current site when it lies within 1% of the transcript's length of that site's **first** cut, otherwise it opens a new one. The 1% is fixed in code.
- [ ] A run cuts at a cut site when any of its cuts lies between the site's first and last cut, widened by half a percent of the transcript's length each way — the prototype's rule (`division_support.py`, `cut_sites_with_runs`), copied exactly. A site's support is the number of runs that cut at it, and a run's division is the set of sites it cuts at.
- [ ] The vote is the set of cut sites whose support reaches `bar` (9 of 18), from the `division` settings section. It is never written out as a division.
- [ ] Each run's distance from the vote is the number of cut sites where one of the two cuts and the other does not. The run with the smallest distance is chosen; a tie goes to the tied run with the smallest summed distance to every other run, then to the earliest run.
- [ ] The vote, and a run's distance from it, are their own piece, given runs as sets of positions and a bar, and tested on their own: `define-topics` (ticket 08) breaks its ties with them. The chooser itself is not shared.
- [ ] `Chosen division/subtopics.json` holds the chosen run's subtopics unchanged: span, title and reason.
- [ ] The manifest entry records the chosen run (counting from 1), its distance from the vote and the panel size, and keeps that record when the stage is later skipped. The mechanism for a stage recording its own facts is built here, for `retitle-subtopics` and `define-topics` to use.
- [ ] The stage fails when fewer than `panelSize` deepened runs are present.
- [ ] **Replay against the prototype:** a one-off script runs the new choice on each lecture's 18 `d13` runs at a bar of nine, and on every panel of nine drawn from them at a bar of five, and checks it picks the same run as `division_support.py`'s `closest_to_vote_run`. Any difference is explained or fixed.
- [ ] **Live run:** the stage runs on the live deepened runs of all eight lectures; which run each chose and its distance from the vote are reported.
- [ ] The replay script and results stay in the prototype folder.

## Comments

2026-09-29, redesigned before any build: the user switched from keeping the voted cut sites to keeping the whole run nearest the vote, for one run's consistent reading of the lecture. On the prototype's `d13` runs it is as steady (3.34 against 3.26 cut sites two panels of nine disagree on, across the eight lectures) and as accurate (3.09 against 3.03 errors a panel against the user's rulings) as the vote. Renamed from `vote-cut-sites`. The user chose: the chosen run's own titles only, no alternatives carried; the manifest records the chosen run and its distance from the vote.

2026-09-29, second redesign before any build: the chooser is shared with `define-topics`, which now chooses its grouping the same way (the user: "we can always split apart the chooser if anything changes"), and the chosen division carries each subtopic's inherited-title mark for `retitle-subtopics` (ticket 11). Now blocked by 10 as well.

2026-09-29: the splitting panel is now 18 runs with a bar of 9 (the user's choice, for steadier divisions; TD §5, "Dividing the transcript", Configuration). The live runs are topped up from 9 to 18 before this ticket's live run, by marking both splitting stages failed in each manifest so a normal relaunch makes only the missing runs.

2026-09-30, third redesign before any build (grill, TD 374a543): grouping now has its own chooser — most identical runs first — so the two stages share only the vote and the distance from it. Inherited-title marks are gone (ticket 13), so the chosen division carries none; now blocked by 13 instead of 10.

2026-09-30, before building: checked against `division_support.py`, the design had left out how a run is credited with a cut site — any cut within the site's span widened by half a percent each way, not only the cuts pooled into it. The user chose to copy the prototype's rule exactly; TD §5, `choose-division`, "The vote", now states it.
