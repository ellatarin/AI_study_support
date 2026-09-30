# 15 — A panel stage re-run records only the repair's cost

**What to build:** when a panel stage runs again and reuses the run files already on disk, the stage's recorded cost still accounts for the runs it reused, not only the runs this launch made.

**Blocked by:** None — can start immediately

**Status:** needs-triage

What happens now: a panel stage (the two splitting stages; grouping when built) saves each run to its own file, and a relaunch reads back the runs already saved and pays only for the missing ones. The stage's manifest entry is then written with the cost of this launch alone. The cost of the reused runs is gone from the manifest, so the cost report under-states what the stage's output cost to make. Two ways to get there:

- one run file is deleted, and the next run re-makes just that run;
- a panel is topped up by marking the stage failed and relaunching — how the eight lectures' splitting panels went from 9 runs to 18, so their manifests account for runs 10–18 only.

The run logs are not affected: each records what that run paid, which is correct.

Open question for triage: what the entry should record — the earlier entry's cost plus the repair's, or a cost kept per run file and summed.

- [ ] A panel stage relaunched with some runs already saved records a cost covering every run in the panel.
- [ ] Found 2026-09-30 while checking ticket 14's fix; the user asked for a ticket.
