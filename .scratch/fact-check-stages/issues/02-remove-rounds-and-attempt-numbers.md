# 02 — Remove rounds and attempt numbers

**What to build:** Each stage runs once, so nothing records a round or an attempt (ADR 0003). A stage entry has no `round`. The files of term correction and the rewrite are named `subtopic-<id>.json` and hold no `attemptNumber`.

**Blocked by:** 01 — Remove the transcript check

**Status:** ready-for-agent

- [x] The stage entry has no `round`, and the runner has no rule about rounds.
- [x] `Term corrections/subtopic-<id>.json` and `Rewrites/subtopic-<id>.json` replace the `-attempt-<n>` names.
- [x] The two files hold no `attemptNumber`.
- [x] Some names in the code, the tests and the comments still speak of a round or an attempt. Each one is renamed or removed. The renames go to the user in a table first (global CLAUDE.md, "Names in code").
- [x] The technical design, the implementation plan and the requirements match. The suite version is bumped last.
- [x] The dry-run script of ticket 01 also changes the data of lecture 3 and lecture 4 on disk. It renames the files and removes `attemptNumber` from them. It removes `round` from each stage entry, and renames each path in `filesWritten`. The user runs it with `!`.
- [x] After the user applies the script, a pipeline run on lecture 4 makes no call and reports each stage as completed.

## Comments
