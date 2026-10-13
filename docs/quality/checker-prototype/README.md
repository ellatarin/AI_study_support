# Checker prototype

The prototype runs checker prompts against saved rewrites, outside the pipeline. It reads a lecture's structured transcript, its term corrections and one rewrites folder. It never writes to the lecture. The checker gets the same material as in the pipeline, and the model call is the pipeline's own.

Run each command from the project root.

## Run a check

```
pnpm exec tsx docs/quality/checker-prototype/check-trial.mts \
  --lecture 2026-03-04 --rewrites "Rewrites (sonnet-5.5, w1)" \
  --prompts c3 --models google/gemini-3.8-flash,openai/gpt-5.6-sol-pro
```

- `--prompts` and `--models` each take one value or a list with commas. The script runs each model with each prompt version and each run number, all at the same time.
- Each pair of model and version writes to `runs/<lecture>/<rewrites folder>/<model> <version>/`. The folder holds one `subtopic-<id>.json` for each subtopic and a `run.json`. The `run.json` records each command with its cost, its time and each unusable reply with its text.
- `--runs` gives the run numbers, such as `2,3`, and is 1 when it is not given. A repeat run writes to its own folder, such as `<model> <version> run 2/`, so that the variation from run to run can be measured.
- `--unit paragraph` sends one part of a subtopic at a time, in place of the whole subtopic. The parts come from the cuts file `splits/<lecture>/<rewrites folder>.json`, which gives for each part its rewrite paragraphs and the words where it starts in the text. The results of a subtopic's parts are saved together in one file, and the run folder adds "by paragraph", such as `<model> <version> by paragraph run 2/`.
- `--effort low`, `medium` or `high` asks the model for that reasoning effort, through OpenRouter's `reasoning` field. The pipeline's model call has no such setting, so the script adds the field to each request. The run folder adds "effort" and the effort, such as `<model> <version> effort high run 2/`.
- A subtopic with a saved result is not sent again. To finish a run that failed part of the way, give the same command again.

## Compare the checks

```
pnpm exec tsx docs/quality/checker-prototype/compare-checks.mts \
  --lecture 2026-03-04 --rewrites "Rewrites (sonnet-5.5, w1)"
```

The script compares each run of the rewrites folder with the answer key. It also compares each saved "Checks (…)" folder of the same rewrites in the lecture. It prints the summary and the table of the faults that matter. It writes the full comparison to `comparison.md` in the runs folder, with each fault outside the key for marking.

A checker's fault matches a fault of the key when both are in one subtopic. Their source passages or their rewrite passages must also share four words in a row (`fault-matching.mts`). The comparison shows both descriptions, so that a wrong match can be seen.

## Score the faults with Jev

```
pnpm exec tsx docs/quality/checker-prototype/judge-faults.mts \
  --lecture 2026-03-04 --rewrites "Rewrites (sonnet-5.5, w1)" \
  --runs "gemini-3.8-flash c20,gemini-3.8-flash c20 run 2"
```

Jev is the decision model of TypeSafe. It gives each fault of each run a score from 0 to 1. The score is the probability that a student learns something wrong, or misses something that the lecturer taught. The script writes the scores to `jev-scores.json` in each run folder. It needs `TYPESAFE_API_KEY` in `.env`. The score for the same input can change by a few hundredths from call to call. So a fault near the bar can fall on either side of it.

## Count a panel

```
pnpm exec tsx docs/quality/checker-prototype/panel-checks.mts \
  --lecture 2026-03-04 --rewrites "Rewrites (sonnet-5.5, w1)" \
  --runs "gemini-3.8-flash c20,gemini-3.8-flash c20 run 2,…" \
  --jev-bar 0.6 --votes 2
```

A run keeps each fault with a Jev score at or above `--jev-bar`. The panel keeps a fault that at least `--votes` runs keep. For each run and for the panel, the script prints the real faults and the false faults by their key names. A kept fault outside the answer key counts as false and is printed as not marked. Two faults outside the key are the same fault when they match by the rule of the answer key. `--json` prints the count as JSON. The baseline is five Flash runs of c20, `--jev-bar 0.6` and `--votes 2`.

## Add a prompt version

Add the version to `checker-prompts.mts`, with a note of what changed. Never edit a version that has runs. When a version goes into the pipeline, `checker-prompts.test.mts` checks that the pipeline's prompt is the same word for word.

## Add an answer key

Add the review file of the lecture and rewrites folder to `ANSWER_KEYS` in `check-results.mts`.
