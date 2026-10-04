# 17 — A failed stage logs no cost

**What to build:** nothing; closed as a known limitation.

**Blocked by:** None

**Status:** wontfix

What happens now: when a stage that calls a model fails, its run-log entry records no cost. The calls made before the failure, the failed call's own resends and refusals, and in a panel the runs that finished, appear nowhere, although TD §4.6 calls the run logs a complete financial audit trail including failed attempts.

## Comments

2026-10-04, found while triaging ticket 15. The fix considered was a tally of every billed send kept beside each stage run's send gate and written to the run log on failure, with an error carrying no cost counted as zero. The user ruled it an edge case not worth the added code. Recorded as a known limitation in TD §7, "Two-Level Tracking".
