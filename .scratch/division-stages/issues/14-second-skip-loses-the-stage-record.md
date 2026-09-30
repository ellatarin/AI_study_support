# 14 — A second skip loses a stage's record

**What to build:** a stage skipped on any later run keeps what its completion recorded — when it completed, the settings it ran with, what it cost, and the files it wrote — however many runs skip it, so a deleted output is still noticed and its stage run again.

**Blocked by:** None — can start immediately

**Status:** resolved

What happens now: the first run that skips a completed stage writes a `skipped` entry copying the completion's record. The next run that skips it finds a `skipped` entry rather than a `complete` one, copies nothing, and writes a `skipped` entry with no cost, no settings, no files, and the new run's time as the completion time. From then on:

- the stage's cost is gone from the manifest, so reports show nothing for it;
- the stage lists no files, so the check that re-runs a stage whose output was deleted has nothing to check: the stage counts as done even with its output gone.

The existing "three runs" test stops at the third run, which is the first to read the emptied entry's predecessor, so it does not see this.

- [x] A `skipped` entry replacing a `skipped` entry keeps its completion time, settings, cost and files.
- [x] After any number of skips, deleting a file the stage wrote makes the next run run the stage again.
- [x] Found while building ticket 07 (2026-09-30); the user asked for it to be filed rather than fixed there.

## Comments

2026-09-30, resolved. A skip now copies the earlier record whenever that record says the stage's output is on disk — completed or skipped — using the same check that decides whether a stage is done. Two runner tests drive one lecture three times and read the manifest back. A manifest that had already lost its record before this fix stays empty: there is nothing left to copy. While checking that the fix overwrites nothing, the user found that a panel stage re-run to replace one missing run file records only that repair's cost; filed as ticket 15.
