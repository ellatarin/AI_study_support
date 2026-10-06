# 01 — Mark the stages after `--to-stage` as "not requested"

**What to build:** the run log gives a stage the action `not-reached` in two situations:

- An earlier stage failed, and the pipeline run stopped.
- The user gave `--to-stage`, and the stage comes after the named stage.

The action does not say which situation it was. A reader of the run log must find the reason from the `toStage` field and the other entries.

Give the second situation its own action, `not-requested`. Keep `not-reached` for the first situation only.

- [ ] A stage after the `--to-stage` stage gets the action `not-requested` in the run log.
- [ ] A stage after a failure that stopped the pipeline run gets the action `not-reached`.
- [ ] When both are true, the stage gets `not-reached`. The failure stopped the pipeline run first.
- [ ] A stage with `not-requested` counts as "nothing failed", as `not-reached` and `skipped` do.
- [ ] An old run log that holds `not-reached` for a stage after the `--to-stage` stage still reads without an error.
- [ ] technical-design.md §4.2, §4.6 and §4.7 and `CONTEXT.md` (Bounded run) say what each action means.

**Blocked by:** None

**Status:** ready-for-agent

## Comments

2026-10-06, the user, during comment-rewrite ticket 03: "the same status for two situations does not sound great", and named the new action "stage not requested". Found as `.scratch/comment-rewrite/divergences.md`, D6.
