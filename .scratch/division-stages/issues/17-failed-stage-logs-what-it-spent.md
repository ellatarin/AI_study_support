# 17 — A failed stage logs no cost

**What to build:** A stage that calls a model records what it spent in a run. It does this also when the run fails (TD §7, "Two-Level Tracking", "A stage that fails").

**Blocked by:** None

**Status:** resolved

What happened before: a failed stage that calls a model recorded no cost in its run-log entry. The calls before the failure appeared nowhere. So did the resends and refusals of the failed call, and in a panel the runs that finished. TD §4.6 calls the run logs a complete financial audit trail, failed attempts included.

- [x] A failed stage's run-log entry holds the spend of that run. The spend is the tokens, the calls and the cost of each reply received, unusable replies included.
- [x] A failed stage's manifest entry holds the same spend.
- [x] The manifest entry adds the spend of each run of the stage. A reset (`--from-stage`) starts the sum again from zero.
- [x] The run-log entry of each run holds the spend of that run only.

## Comments

2026-10-04, found while triaging ticket 15. The fix considered was a tally of every billed send, kept beside each stage run's send gate. The tally went to the run log on failure, and an error with no cost counted as zero. The user ruled it an edge case not worth the added code. It was recorded as a known limitation in TD §7, "Two-Level Tracking".

2026-10-11, reopened by the user after the live run of `rewrite-subtopics` on Lecture 3 failed. The run summary showed 0 calls and `n/a`, although the stage made about 20 calls. The user added that the manifest adds the spend of each run until the stage completes. This also closes ticket 15's case: a panel stage that starts again over saved runs now includes their cost.
