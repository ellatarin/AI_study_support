# 01 — Show the total cost of a lecture and of a batch

**Status:** needs-triage

**Blocked by:** none

**The problem:** after a run, the terminal shows the cost of each stage, but no total. Requirement NFR-2.2 says that "the system totals them nowhere", because the stage figures are there to compare the models of one stage. On 2026-10-14 the user asked for a total, after a batch of the two Genomics of Disease lectures. The two lectures cost £2.15 and £1.99, £4.14 in all, summed by hand from the stage costs in each manifest.

**What the user agreed (2026-10-14):** a total, in this form:

- At the end of the run of each lecture, one line, such as "Total — £1.42".
- At the end of a batch, one total for the whole batch.
- When a stage cost is unknown, the line says "at least £1.42 (one stage cost unknown)". So an unknown cost never reads as nothing.

**Decided (2026-10-14):** `cost-report` also shows the total of each lecture. The user said that the lecture total is the most important figure.

- [ ] NFR-2.2 and the technical design say what the total is, and when a cost is unknown.
- [ ] The run of a lecture ends with its total.
- [ ] A batch ends with the total of all its lectures.
- [ ] A total over an unknown stage cost says "at least" and names how many stage costs are unknown.

## Comments

**2026-10-15:** the run log of GD lecture 2 records the cost of the bypassed `correct-factual-errors` as `costUsd: null` with `callCount: 0`. `build-notes-page` records the same. A stage with no calls cost nothing, so the total must count it as zero, not as an unknown cost. Otherwise each bypassed or free stage makes the total say "at least".
