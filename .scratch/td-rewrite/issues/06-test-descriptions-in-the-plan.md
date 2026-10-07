# 06 — Decide where the facts in the plan's test descriptions go

**Status:** needs-triage

**The question:** the user asked on 2026-10-07 if some test descriptions in `docs/implementation-plan.md` belong in the TD.

**What is known:**

- The plan holds 327 lines that give a test name.
- 86 of them add an explanation after a dash. An example: "`should place the invocation's debug log under the project root when an invocation is identified` — `debugLogPath`, anchored to the project rather than to any one workspace".
- An earlier ruling says that each fact has one home. Behaviour goes in the TD. Build order and test names go in the plan.
- So a test name stays in the plan. An explanation after the dash that states behaviour, or a reason, belongs in the TD. The plan then gives only the test name.

**What to decide:** agree to this split or change it. Then decide if this work joins the TD rewrite or comes after it. Nobody has yet checked each of the 86 lines.

**Blocked by:** none

## Comments
