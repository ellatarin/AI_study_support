# 01 — Test a partly completed stage in each stage that makes several calls

**What to build:** a test of a partial run in each stage that makes several model calls and saves a file for each one. The test runs the stage again after the partial run. The rerun makes a call only for each missing file, and it keeps each saved file unchanged.

**Blocked by:** None — can start immediately

**Status:** needs-triage

## Why

The user asked for this on 2026-10-11, during ticket 07 of `rewrite-subtopics`. The tests of `correct-terms` and `rewrite-subtopics` run the stage again only after a complete run. A complete rerun makes no call, so it cannot show that the stage makes the missing calls and only those.

`check-rewrite-attempts` (ticket 07) has the model for these tests. It is one table-driven test with two cases:

- One subtopic has no saved check. The rerun makes one call, for that subtopic.
- Each subtopic has a saved check, but the result file of the round is missing. The rerun makes no call and writes the result file.

## Criteria

- [ ] A list of each stage that makes several calls and saves a file for each one. Find them with `vera search` before the first test. Examples are `correct-terms`, `rewrite-subtopics`, `read-slides` and the panel stages.
- [ ] For each stage on the list, a test removes one saved file after a run. The test then runs the stage again and finds one call, for the removed file.
- [ ] Some stages also write a file after their calls. For each such stage, a case in which each call file is saved and that file is missing.
- [ ] Each new test fails first when the stage makes a call for a saved file. Record the check in this ticket.
