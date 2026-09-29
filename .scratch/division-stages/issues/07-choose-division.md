# 07 — `choose-division`

**What to build:** the deepened runs vote on where the transcript divides, and the run nearest the vote is handed on whole as the lecture's division, so its subtopics, titles and reasons all come from one run. The stage makes no model call, so re-running it costs nothing.

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] All deepened runs' cuts are pooled, sorted, and grouped into cut sites: a cut joins the current site when it lies within 1% of the transcript's length of that site's **first** cut, otherwise it opens a new one. The 1% is fixed in code.
- [ ] The vote is the set of cut sites whose support reaches `bar` (5), from the `division` settings section. It is never written out as a division.
- [ ] Each run's distance from the vote is the number of cut sites where one of the two cuts and the other does not. The run with the smallest distance is chosen; a tie goes to the tied run with the smallest summed distance to every other run, then to the earliest run.
- [ ] `Chosen division/subtopics.json` holds the chosen run's subtopics unchanged: span, title and reason.
- [ ] The manifest entry records the chosen run (counting from 1) and its distance from the vote, and keeps that record when the stage is later skipped. The mechanism for a stage recording its own facts is built here, for `define-topics` to use in ticket 08.
- [ ] The stage fails when fewer than `panelSize` deepened runs are present.
- [ ] **Replay against the prototype:** a one-off script runs the new choice on every panel of nine drawn from each lecture's 18 `d13` runs, and checks it picks the same run as `division_support.py`'s `closest_to_vote_run`. Any difference is explained or fixed.
- [ ] **Live run:** the stage runs on the live deepened runs of all eight lectures; which run each chose and its distance from the vote are reported.
- [ ] The replay script and results stay in the prototype folder.

## Comments

2026-09-29, redesigned before any build: the user switched from keeping the voted cut sites to keeping the whole run nearest the vote, for one run's consistent reading of the lecture. On the prototype's `d13` runs it is as steady (3.34 against 3.26 cut sites two panels of nine disagree on, across the eight lectures) and as accurate (3.09 against 3.03 errors a panel against the user's rulings) as the vote. Renamed from `vote-cut-sites`. The user chose: the chosen run's own titles only, no alternatives carried; the manifest records the chosen run and its distance from the vote.
