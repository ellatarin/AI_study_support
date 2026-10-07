# Documentation work — start here

All documentation work was parked on 2026-10-07, while the user builds features. This file lists each part of the work, its state and where it is. Read it first when the work starts again.

The work happens on `main`, in the main folder. The separate worktree for the comment rewrite was removed on 2026-10-07.

## 1. The rewrite of the technical design (this folder)

- `spec.md` — the goal, the method and every rule a sentence must follow.
- `outline-proposal.md` — the proposed sections of the TD, with the cost of each change.
- `issues/` — the tickets, in the order of the work:

| Ticket | What | Status | Blocked by |
|---|---|---|---|
| 01 | The user rules on the outline | ready-for-human | — |
| 02 | Build the programs that check the TD | ready-for-agent | — |
| 03 | Restructure the TD to the agreed outline | needs-triage | 01, 02 |
| 04 | Pilot: rewrite §4.3 with the user | needs-triage | 03 |
| 05 | Rewrite each other section | needs-triage | 04 |
| 06 | Decide where the facts in the plan's test descriptions go | needs-triage | — |

Tickets 01 and 02 can start in any order. Ticket 06 is free of the others.

Before the work starts again, compare the TD with the code that the features changed. A feature changes the code, and the rewrite starts from the code.

## 2. What is left of the comment rewrite (`.scratch/comment-rewrite/`)

- **The user's review of tickets 04 to 13.** Each ticket is one commit. The user reviews each diff on GitHub and leaves comments. Then the tickets are marked resolved. The commits:

| Ticket | Area | Commit |
|---|---|---|
| 04 | The runner and the manifest | `f853fbe3` |
| 05 | Layout and config | `2ab69252` |
| 06 | The reports and the OpenRouter client | `c7acf2d4` |
| 07 | The shared test fixtures | `5e1412ae` |
| 08 | The shared stage machinery | `f9c2bf68` |
| 09 | The division stages | `eb0ed119` |
| 10 | The intake stages | `a65f4ae4` |
| 11 | The transcript stages | `ca3c8d24` |
| 12 | The utilities | `23890fda` |
| 13 | The CLI and the entry point | `ea0d28e1` |
| (03 follow-up) | Openings with How or What in `src/types/pipeline.ts` | `1d69f6f4` |

- **`rulings.md`** — a ruling for each divergence that tickets 04 to 13 found. The code fixes are done. The "Fix the design", "Fix the plan" and "Fix the glossary" rows are not done. They go into the TD rewrite (ticket 05 here). The glossary row (D06-6) can be done at any time.
- **`carry-over/`** — reasons that were cut from comments when the comments were made shorter. Each one names the TD section that must hold it. They go into the TD rewrite.
- **Ticket 14** — review every commit message. This rewrites history, so the user must approve a force-push. Status: ready-for-human.
- **Ticket 15** — review the lint-exception comments. Status: needs-triage.

## 3. Not part of this work

- The requirements, and the rest of the implementation plan, apart from ticket 06.
- The pipeline redesign (the 20-stage design in the README). It will change the TD sections of the stages not yet built.
