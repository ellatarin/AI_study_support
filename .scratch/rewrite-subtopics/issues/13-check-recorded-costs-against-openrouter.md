# 13 — Check the recorded costs against OpenRouter on Lecture 4

**What to build:** Nothing. The user runs Lecture 4 to `check-rewrite-attempts`, and the agent compares the recorded costs with what OpenRouter billed. The run checks commit 1755aaf8, which made the cost tally the only record of what a stage spends (TD §7, "A stage that fails").

**Blocked by:** None

**Status:** ready-for-human

The command is `lecture-notes run 2026-03-06 --to-stage check-rewrite-attempts`. The user writes down the start time, because the OpenRouter activity page lists calls by time.

- [ ] The ticket records the run summary that the command prints.
- [ ] The ticket records the `cost` of `rewrite-subtopics` and of `check-rewrite-attempts` from the lecture's `manifest.json`.
- [ ] The ticket records the calls and the cost on the OpenRouter activity page for the time of the run, for each of the two models.
- [ ] For each stage, the three figures agree: the run summary, the manifest and OpenRouter. Neither stage has an earlier run, so the manifest adds nothing to this run's spend.
- [ ] If the run fails, the ticket records the figures all the same. They include the calls made before the failure.
- [ ] Each figure that does not agree starts a new TDD cycle, with its own failing test.
- [ ] The user judges the rewrites and the checks of Lecture 4 as for ticket 08, and the ticket records the judgement.
