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
- A subtopic with a saved result is not sent again. To finish a run that failed part of the way, give the same command again.

## Compare the checks

```
pnpm exec tsx docs/quality/checker-prototype/compare-checks.mts \
  --lecture 2026-03-04 --rewrites "Rewrites (sonnet-5.5, w1)"
```

The script compares each run of the rewrites folder with the answer key. It also compares each saved "Checks (…)" folder of the same rewrites in the lecture. It prints the summary and the table of the faults that matter. It writes the full comparison to `comparison.md` in the runs folder, with each fault outside the key for marking.

A checker's fault matches a fault of the key when both are in one subtopic. Their source passages or their rewrite passages must also share four words in a row (`fault-matching.mts`). The comparison shows both descriptions, so that a wrong match can be seen.

## Add a prompt version

Add the version to `checker-prompts.mts`, with a note of what changed. Never edit a version that has runs. When a version goes into the pipeline, `checker-prompts.test.mts` checks that the pipeline's prompt is the same word for word.

## Add an answer key

Add the review file of the lecture and rewrites folder to `ANSWER_KEYS` in `compare-checks.mts`.
