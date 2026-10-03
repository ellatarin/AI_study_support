# Replay: the stage's grouping choice against `choose_panel.py`

Runs 1–4 of `g23` with `openai/gpt-6.1-sol-pro` on each lecture's `r9`-retitled division; the stage chooses at bar 3.
Topic starts count from subtopic 1. "Same" means the same topic starts handed on from the same run.

| Lecture | Runs | Groupings | Stage starts | Stage run | Support | Decided by | Prototype starts | Prototype runs | Prototype rule | Result |
|---|---|---|---|---|---|---|---|---|---|---|
| l1 | 4 | 1 | 1,2,5,7,9,11,12,13,14,16 | 1 | 4 | most-runs | 1,2,5,7,9,11,12,13,14,16 | 1,2,3,4 | most runs (4 of 4) | same |
| l2 | 4 | 2 | 1,2,3,4,9,12,13,14,15 | 1 | 3 | most-runs | 1,2,3,4,9,12,13,14,15 | 1,3,4 | most runs (3 of 4) | same |
| l3 | 4 | 2 | 1,2,3,5,8,10,11,12,14,17 | 1 | 3 | most-runs | 1,2,3,5,8,10,11,12,14,17 | 1,3,4 | most runs (3 of 4) | same |
| l4 | 4 | 1 | 1,2,4,7,9,14,16,18,22 | 1 | 4 | most-runs | 1,2,4,7,9,14,16,18,22 | 1,2,3,4 | most runs (4 of 4) | same |
| l5 | 4 | 3 | 1,2,4,5,8,12,14,15,17 | 2 | 2 | most-runs | 1,2,4,5,8,12,14,15,17 | 2,3 | most runs (2 of 4) | same |
| l6 | 4 | 1 | 1,2,5,7,8,10,12,15,16,19 | 1 | 4 | most-runs | 1,2,5,7,8,10,12,15,16,19 | 1,2,3,4 | most runs (4 of 4) | same |
| l7 | 4 | 2 | 1,2,3,4,7,9,10,11,12 | 2 | 2 | more-topics | 1,2,3,4,7,9,10,11,12 | 2,4 | tie on 2 runs; most topics (9) | same |
| l8 | 4 | 3 | 1,2,3,4,5,7,8,10,13,15,16,18,20,21,22 | 1 | 2 | most-runs | 1,2,3,4,5,7,8,10,13,15,16,18,20,21,22 | 1,3 | most runs (2 of 4) | same |

0 of 8 lectures differ.
