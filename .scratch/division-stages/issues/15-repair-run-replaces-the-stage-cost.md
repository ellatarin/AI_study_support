# 15 — A panel stage re-run records only the repair's cost

**What to build:** a panel stage's recorded cost is the money spent on it across launches. A failed panel records what it spent before failing, and a relaunch that reuses saved runs adds its own spend to the earlier entry's cost.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

What happens now: a panel stage (the two splitting stages; grouping when built) saves each run to its own file, and a relaunch reads back the runs already saved and pays only for the missing ones. The stage's manifest entry is then written with the cost of this launch alone. The cost of the reused runs is gone from the manifest, so the cost report under-states what the stage cost. Three ways to get there:

- one run file is deleted, and the next run re-makes just that run;
- a panel is topped up by marking the stage failed and relaunching — how the eight lectures' splitting panels went from 9 runs to 18, so their manifests account for runs 10–18 only;
- a run fails partway through a panel: the panel's error loses the cost of the runs already made, and a failed entry records no cost at all.

The run logs are not affected: each records what that run paid, which is correct.

- [ ] A panel that fails records in its failed entry the cost of every call it made before failing, the failed run's included.
- [ ] A relaunch that reuses at least one saved run records the earlier entry's cost plus this launch's.
- [ ] A relaunch that reuses no saved run records this launch's cost alone; an earlier entry's cost is not carried forward.
- [ ] A re-made run whose file was deleted is counted again: the cost is money spent, not the cost of the runs now on disk.
- [ ] An earlier entry with no cost (`null`) — as the eight already topped-up lectures have — is read as nothing to carry forward, and does not fail the stage.
- [ ] Found 2026-09-30 while checking ticket 14's fix; the user asked for a ticket.

## Comments

2026-10-04, triage: the user ruled the stage's cost means money spent, not the cost of the runs on disk. This rules out keeping a cost per run file: it could never count a run that failed, and it would under-state spend when a deleted run is re-made. The eight lectures already topped up are not backfilled; they keep the cost of runs 10–18 only.
