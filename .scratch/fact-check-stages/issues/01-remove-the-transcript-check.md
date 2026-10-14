# 01 — Remove the transcript check

**What to build:** The pipeline ends at `rewrite-subtopics`. The stage `check-rewrite-attempts` goes, with its code, its prompt, its config entry and its tests (ADR 0003). A pipeline run on lecture 4 completes with no check.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [x] `check-rewrite-attempts` is not in the stage list, the config, the example config or the user's config.
- [x] The code, the prompt and the tests of the stage are removed. Shared code that only the check used is removed too.
- [x] The technical design, the implementation plan and the requirements do not describe the check. The suite version is bumped last.
- [x] Tickets 07, 11 and 12 of `rewrite-subtopics` have the status `wontfix`, with a comment that names ADR 0003.
- [x] A dry-run script removes the `check-rewrite-attempts` entry from the manifests of lectures 3 and 4. It prints each change and changes nothing without `--apply`. The user runs it with `!`.
- [x] The script does not touch any `Checks` folder.
- [x] After the user applies the script, a pipeline run on lecture 4 makes no call and reports each stage as completed.

## Comments
