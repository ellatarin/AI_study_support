# Combining a panel of deepened runs: vote, most common, or central

Three ways a panel of nine deepened runs becomes one division, compared on the
recorded `d9` runs (`runs/deepen-d9-600-split-s6-*`, 18 per lecture) by
`report-aggregation.py`, 2026-09-29:

- **vote** — keep each cut site at least 5 of the 9 runs cut at.
- **most common** — take whole the division the most runs made; a tie goes to
  the division closest to the other runs, as grouping's panel does.
- **central** — take whole the run whose division is closest to the other eight.

Two runs make the same division when they cut at the same cut sites, matched
within 1% of the transcript. The distance between two runs is the number of cut
sites one cuts at and the other does not.

**Decision: keep the vote.**

| lecture | stability: vote | stability: most common | stability: central | errors: vote | errors: most common | errors: central | runs making the most common division |
|---|---|---|---|---|---|---|---|
| l1 | 0.67 | 1.13 | 0.67 | 0.32 | 0.39 | 0.31 | 2.5 of 9 |
| l2 | 0.13 | 0.29 | 0.13 | 0.93 | 1.04 | 0.95 | 2.6 of 9 |
| l3 | 0.47 | 0.67 | 0.47 | 0.17 | 0.10 | 0.16 | 2.9 of 9 |
| l4 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 6.0 of 9 |
| l5 | 0.03 | 0.14 | 0.03 | 0.01 | 0.07 | 0.01 | 4.1 of 9 |
| l6 | 1.29 | 0.81 | 1.24 | 3.35 | 3.26 | 3.30 | 2.2 of 9 |
| l7 | 1.00 | 0.42 | 1.00 | 0.00 | 0.00 | 0.00 | 4.6 of 9 |
| l8 | 0.36 | 0.99 | 0.48 | 0.18 | 0.50 | 0.24 | 1.9 of 9 |
| all 8 | 3.95 | 4.46 | 4.02 | 4.97 | 5.36 | 4.98 | |

Stability: cut sites two panels of nine disagree on, averaged over every split
of the 18 runs into two panels. Errors: wanted cut sites missed plus unwanted
ones cut, against `runs/divisions.json`, averaged over every panel of nine.

- **Most common is worse overall.** On most lectures its division is made by
  only two or three of the nine runs: a division has 11 to 26 cuts, so whole
  divisions rarely repeat, and the most common one is often a coincidence
  between two runs. A grouping has a handful of topic starts and repeats far
  more often, which is why most common suits grouping and not division.
- **Central is the vote in all but name.** Within 0.1 everywhere except l8,
  where it is slightly worse. It gains nothing in stability or errors.
- **Lecture 6 is wrong under every method**, about 3.3 errors a panel, so no
  panel is right on all 8 lectures at once. That is a question for the l6
  ruling or for deepening on l6, not for how the runs are combined.

The vote's stability total matches `report-consistency.py --by-bar` at 5 of 9
(3.9 in `LATER-ROUNDS.md`).
