# Panel risk, from the saved runs

## 1. Lecture 4: how often a panel chooses each outcome for 18–21

100,000 random panels per row, drawn from the pool's saved runs; each panel chosen by `chooseGrouping` at bar 3. "Single runs" is the share of the pool's own runs, for comparison. A panel of 10 is drawn only from pools of more than 10 runs.

| Pool | Runs | Panel | Split at 19 (bad) | Split at 20 | 18–21 together |
|---|---|---|---|---|---|
| Prototype's titles, caching on | 20 | single runs | 15.0% | 0.0% | 85.0% |
| | | panel of 5 | 0.9% | 0.0% | 99.1% |
| | | panel of 10 | 0.0% | 0.0% | 100.0% |
| Prototype's titles, caching off | 10 | single runs | 40.0% | 0.0% | 60.0% |
| | | panel of 5 | 26.2% | 0.0% | 73.8% |
| Prototype's titles, all | 30 | single runs | 23.3% | 0.0% | 76.7% |
| | | panel of 5 | 6.8% | 0.0% | 93.2% |
| | | panel of 10 | 2.5% | 0.0% | 97.5% |
| Live titles, prototype, caching on | 10 | single runs | 10.0% | 40.0% | 50.0% |
| | | panel of 5 | 0.0% | 50.1% | 49.9% |
| Live titles, prototype, caching off | 10 | single runs | 0.0% | 20.0% | 80.0% |
| | | panel of 5 | 0.0% | 0.0% | 100.0% |
| Live titles, live stage | 15 | single runs | 6.7% | 60.0% | 33.3% |
| | | panel of 5 | 0.0% | 83.3% | 16.7% |
| | | panel of 10 | 0.0% | 95.8% | 4.2% |
| Live titles, all | 35 | single runs | 5.7% | 42.9% | 51.4% |
| | | panel of 5 | 1.0% | 46.1% | 52.9% |
| | | panel of 10 | 0.0% | 45.5% | 54.5% |

## 2. Every lecture: the 30 September panels

Runs 1–5 of `g23` on Sol Pro, 30 September. "Judged" means a grouping the user judged acceptable (made by one of runs 1–4); run 5 was never judged. Panels of 4 leave out one run each.

| Lecture | Groupings (runs that made each) | Panel of 5 chooses | Panels of 4 choose | Any panel picks an unjudged grouping |
|---|---|---|---|---|
| l1 | A: 1,2,3,4,5 | A | A ×5 | no |
| l2 | A: 1,3,4,5; B: 2 | A | A ×5 | no |
| l3 | A: 1,3,4,5; B: 2 | A | A ×5 | no |
| l4 | A: 1,2,3,4,5 | A | A ×5 | no |
| l5 | A: 1; B: 2,3,5; C: 4 | B | B ×5 | no |
| l6 | A: 1,2,3,4,5 | A | A ×5 | no |
| l7 | A: 1,3,5; B: 2,4 | A | B ×3, A ×2 | no |
| l8 | A: 1,3,5; B: 2; C: 4 | A | A ×5 | no |

Each grouping's topic starts:

- l2: A = 1,2,3,4,9,12,13,14,15; B = 1,2,5,9,12,13,14,15
- l3: A = 1,2,3,5,8,10,11,12,14,17; B = 1,2,3,5,10,11,12,14,17
- l5: A = 1,2,4,5,8,12,14,15,16,17; B = 1,2,4,5,8,12,14,15,17; C = 1,2,4,5,8,12,15,17
- l7: A = 1,2,4,7,9,10,11,12; B = 1,2,3,4,7,9,10,11,12
- l8: A = 1,2,3,4,5,7,8,10,13,15,16,18,20,21,22; B = 1,2,3,4,5,7,8,10,13,15,18,20,21,22,23; C = 1,2,3,4,5,7,8,10,13,15,18,20,21,22
