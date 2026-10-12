# 01 — Run the checker baseline on any lecture

**What to build:** Two scripts in the checker prototype, so that the baseline can run on a lecture other than lecture 3. Then a run of the baseline on the next lecture, scored against the user's marks.

**Blocked by:** None

**Status:** ready-for-agent

## The baseline

The user agreed the baseline on 2026-10-12, on the Sonnet rewrites of lecture 3:

1. Flash (`google/gemini-3.8-flash`) checks the rewrites five times with checker prompt c20.
2. Jev (TypeSafe, model `jev-latest`) gives each reported fault a score. A fault with a score below 0.6 is dropped.
3. The panel keeps a fault when at least 2 of the 5 runs report it.

On lecture 3, all 126 panels of 5 from 9 runs kept 2.1, 4.A and 11.A, and 121 kept 7.1. No panel kept 2.2, 3.4 or 15.1. The false faults were 12.1 in every panel and 7.2 in 35 panels.

## Where the work is now

The Jev check and the panel exist only as trial scripts in `.scratch/checker-jev/`. That folder is in `.git/info/exclude`, so git does not track it. The Jev script has the lecture 3 folder and the lecture 3 answer key written into it. The panel count was typed in for each run. The trial scripts and their scores stay where they are, as a record of the trials.

## What to build

- `docs/quality/checker-prototype/judge-faults.mts` sends each fault of one or more runs to Jev. It takes the lecture, the rewrites folder and the runs as inputs. It writes `jev-scores.json` in each run folder, with one score for each fault.
- `docs/quality/checker-prototype/panel-checks.mts` takes the runs of a panel, the Jev bar and the number of votes needed. For the panel and for each run, it gives the real faults and the false faults that are kept, each listed by name. It reads the answer key of the lecture from `ANSWER_KEYS` in `compare-checks.mts`.
- A fault that is not in the answer key counts as false, and the output lists it as not marked.

Facts from the trials:

- The Jev request is `POST https://api.typesafe.ai/v1/systemone` with the key `TYPESAFE_API_KEY` from `.env`. The question and its criteria are in `.scratch/checker-jev/jev-judge-link.mts`. Jev gives the same score each time for the same input.
- A script that loads `dotenv/config` must run from the project root, or it does not find `.env`.

## Steps

- [ ] `judge-faults.mts` and `panel-checks.mts` are built test first, with the lecture and the answer key as inputs.
- [ ] On lecture 3, the two scripts give the same panel result as the trials.
- [ ] The user runs the pipeline rewrite on the next lecture.
- [ ] Sol Pro finds all the potential faults in the new rewrites.
- [ ] The user marks each fault, and the marks become the answer key of that lecture.
- [ ] The baseline runs on the new lecture.
- [ ] The result gives the real and false faults by name, for each run and for the panel.

## Comments
