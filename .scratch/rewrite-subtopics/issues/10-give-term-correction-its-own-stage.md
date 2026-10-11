# 10 — Give term correction its own stage, and give each stage entry a round

**What to build:** Term correction, now the first step of `rewrite-subtopics`, becomes the stage `correct-terms`. Each stage entry gets `round`. A one-time migration brings the existing lectures to the new form (TD §4.5, TD §5 `correct-terms`, ADR 0002).

**Blocked by:** none

**Status:** ready-for-agent

- [ ] `correct-terms` has its own entry in `STAGE_IDS`, `STAGE_FILES`, the cost-report labels and the config. It comes after `place-slides`. Its folder is `Term corrections/`, and its files are `subtopic-<id>-attempt-<n>.json`.
- [ ] `correct-terms` keeps the behaviour and the tests of ticket 05. Only its stage id, its folder and its config entry change.
- [ ] `rewrite-subtopics` has no code until ticket 06. It stays in `STAGE_IDS` after `correct-terms`.
- [ ] Each stage entry that the runner writes has `round`. Outside the rewrite loop, `round` is always 1.
- [ ] The manifest reader requires `round` on each stage entry that is not `pending`.
- [ ] Each run log entry of a stage that ran has `rounds`. Outside the rewrite loop, `rounds` is always 1.
- [ ] A one-time migration script sets `round` to 1 in each stage entry of each manifest in each configured module. The user runs it, or tells the agent to run it.
- [ ] The same script moves the term corrections of each lecture that ran them. It renames the stage entry `rewrite-subtopics` to `correct-terms`, the folder `Rewrite attempts/` to `Term corrections/`, and each path in `filesWritten`. It renames the stage id in each run log, so the cost report keeps the cost of term correction.
- [ ] The script changes nothing in a lecture that is already in the new form, so a second run of it is safe.
- [ ] After the migration, a plain `run` on lectures 3 and 4 skips `correct-terms`.
