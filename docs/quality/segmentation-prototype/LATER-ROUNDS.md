# Deepening's second round: re-ask every long subtopic, or only cut pieces

Deepening sends each subtopic over the size gate (600 words) with `d9`, and may
go round a second time. Two choices for what the second round sends
(`LaterRounds` in `deepen-division.mts`):

- **every-long-subtopic** — every subtopic still over the gate, including one
  the model already called one step. What every `d9` run recorded before
  2026-09-29 did: `runs/deepen-d9-600-split-s6-*`.
- **cut-pieces** — only a piece cut in the first round that is still over the
  gate. Run 2026-09-29 on the same 144 `s6` runs (8 lectures × 18), same
  prompt, model `google/gemini-3.7-flash`: `runs/deepen-d9-600-pieces-split-s6-*`.

**Decision: every-long-subtopic.** It is the more stable of the two, at about a
fifth more cost.

## Stability of the voted division

Cut sites that two panels of nine disagree on when each votes at 5 of 9,
averaged over every split of a lecture's 18 runs into two panels
(`report-consistency.py --by-bar`). Lower is more stable.

| lecture | every-long-subtopic | cut-pieces |
|---|---|---|
| l1 | 0.7 | 1.3 |
| l2 | 0.1 | 1.1 |
| l3 | 0.5 | 0.4 |
| l4 | 0.0 | 0.0 |
| l5 | 0.0 | 0.0 |
| l6 | 1.3 | 4.3 |
| l7 | 1.0 | 0.6 |
| l8 | 0.4 | 1.4 |
| all 8 | 3.9 | 9.2 |
| lectures where the two panels match exactly (expected) | 4.4 of 8 | 3.1 of 8 |

Subtopics per run (fewest, median, most) are the same or within one on every
lecture, so cut-pieces does not cut less, only less consistently. The likely
reason: a second ask gives a cut the model half-believes in a second chance,
which moves such sites away from the bar rather than leaving them on it.

## Cost

| | every-long-subtopic | cut-pieces |
|---|---|---|
| calls, 144 runs | 1,499 | 1,138 |
| tokens in | 4,851,466 | 3,712,473 |
| tokens out | 1,462,741 | 1,273,132 |

All 144 cut-pieces runs divided exactly, with no retries and no unplaced quote.
