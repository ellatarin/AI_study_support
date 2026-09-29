# 01 — One source of stage order

**What to build:** the runner runs stages in the order of the stage-name list, and refuses a set of stages handed to it in any other order.

**Status:** ready-for-agent

## The problem

Pipeline order is written in two places, and nothing checks they agree:

- The stage-name list (`STAGE_IDS`) decides everything that reasons about order: `--from-stage` resets a stage and every stage after it, `--to-stage` stops a run at a stage, and the manifest and cost report list stages in that order.
- The stage objects the CLI hands the runner decide the order stages actually run in. The runner walks that list top to bottom.

The two lists exist because the runner takes its stages from outside so tests can pass stand-ins, and the order came along with the list. A comment in the runner says order comes from the stage-name list; the loop that runs stages does not follow it.

If the CLI listed a stage out of place, it would run out of place, while `--from-stage` and `--to-stage` would reset or stop at positions that no longer match what ran. No check would fail.

## Acceptance

- [ ] Constructing the runner with lecture stages out of stage-name-list order fails with a named error naming the stage out of place.
- [ ] A subset of stages in order (as runner tests pass stand-ins) is accepted.
- [ ] The real CLI wiring passes the check.
- [ ] Refuse rather than re-sort: a mis-ordered list is a mistake worth seeing.
- [ ] Technical design §4.7 says the stage-name list is the only source of order.

## Comments

Raised 2026-09-29 while registering `deepen-subtopic-splitting`, which had to be added to the stage-name list and to the CLI's stage list separately. The memory records an earlier ruling that "the list of stages handed to the runner is pipeline order"; this keeps that and adds the check.
