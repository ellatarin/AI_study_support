# 12 — Repeat the rewrite loop in the runner

**What to build:** The runner repeats `correct-terms`, `rewrite-subtopics` and `check-rewrite-attempts` while the check sends subtopics back (TD §4.7, "The rewrite loop", and ADR 0002). Term correction and the writer get the faults of the round before.

**Blocked by:** 11 — Assemble the rewritten subtopics in one file

**Status:** wontfix

- [ ] The config has `rewriting.maxRounds`. The example config sets it to 3.
- [ ] The stage status `sent-back` exists. Only `check-rewrite-attempts` gets it.
- [ ] The runner finds the current round from the manifest. After a `sent-back` check, it is one more than the round of the check. If not, it is the highest round of a loop stage.
- [ ] A loop stage is completed only when its round is the current round.
- [ ] The stage context carries the round. In a later round, each loop stage works only on the subtopics in the result file of the round before. One shared function gives this list.
- [ ] After the check, the runner reads `Checks/round-<n>.json`. No failed subtopic: the check is `complete`, and the runner goes on. Failed subtopics: the check is `sent-back`, and the runner goes back to `correct-terms` in the next round.
- [ ] In round `rewriting.maxRounds`, a failed subtopic makes `check-rewrite-attempts` fail. The error names each failed subtopic and its faults. (Moved from ticket 07 on 2026-10-11, because ticket 07 runs only round 1.)
- [ ] In a later round, `rewrite-subtopics` gets the faults about its rewrite. The prompt says how it uses them. The user sees the prompt change before the build.
- [ ] Decide with the user what `correct-terms` does in a later round. The check does not judge the corrections (user ruling, 2026-10-11), so it gets no faults. With the same input, a new call would give the same kind of reply.
- [ ] A crash after the result file and before the stage entry is safe. The next run runs the check again for that round, with no call.
- [ ] `--from-stage` on any loop stage resets from `correct-terms`.
- [ ] `--to-stage` on a loop stage stops the run there. The next run continues the loop.
- [ ] A loop stage that ran in several rounds of one pipeline run has one run log entry. `rounds` gives the number of rounds. The cost and the call count are the totals of the rounds.
- [ ] The `cost` of a loop stage in the manifest is the total of its rounds since its last reset.
- [ ] The run summary has one row for each loop stage, with the total of its rounds.
- [ ] A stage notice in round 2 or later names the round.
- [ ] The tests of the runner use stub stages.

## Comments

2026-10-14: wontfix. ADR 0003 removes the transcript check and the rewrite loop. Each stage runs once.
