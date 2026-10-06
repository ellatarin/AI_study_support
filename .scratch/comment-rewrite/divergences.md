# Divergences

Each entry is a place where the code and a statement of intent disagree. A statement of intent is the technical design, the plan, the requirements, an ADR, `CONTEXT.md` or an old comment. Nobody edits either side to make them agree. The user decides which side is wrong, and the fix gets its own ticket.

An entry has this shape:

```markdown
## D<n> — <one line that names the disagreement>

- **Where:** `<file>:<line>` (the declaration), found in ticket <nn>.
- **The code does:** <what the code does, with the lines that show it>.
- **The intent says:** <document and section, and a quote>.
- **Other sources:** <any other document that agrees with one side, or "none">.
- **Status:** open
```

A line number in `src/` refers to the code at the commit before the ticket that found the entry.

When the user rules, the status becomes `code wrong`, `intent wrong` or `both wrong`, with the date and the ticket that makes the fix.

## Entries

## D1 — `OverallStatus` says whether a pipeline run failed, not whether the work is done

- **Where:** `src/types/pipeline.ts:783`, found in ticket 03.
- **The code does:** `stageOutcomeStatus` and `summariseOverallStatus` in `src/pipeline/run-status.ts` give `failed` when any stage failed, and `success` otherwise. A `not-reached` or `skipped` stage counts as success. So a bounded run succeeds with later stages still pending.
- **The intent says:** the old comment: "every stage's output standing … (`success`)", and "The question a run answers is whether the work is done".
- **Other sources:** technical-design.md §4.7 (lines 821, 840) agrees with the code: "The question it answers is whether anything in this run failed". `CONTEXT.md`, Pipeline run, agrees with the code.
- **Status:** open

## D2 — A stage's `concurrency` bounds its runs in flight, not its API calls

- **Where:** `src/types/pipeline.ts:834` (`BatchOptions.concurrency`), found in ticket 03.
- **The code does:** `src/pipeline/stages/panel-runs.ts:291` passes the stage's `concurrency` to `runPanel` as the most runs in flight at once (parameter doc at :181). The calls inside one run are bounded by `callConcurrency` (`deepen-subtopic-splitting.ts:247`).
- **The intent says:** the old comment: "`StageConfig.concurrency`, which bounds the parallel API calls made *within* one stage".
- **Other sources:** technical-design.md §6, "Three settings say how much runs at once", agrees with the code. It says: "A stage's `concurrency` is how many of its runs, slides or images are in flight at once". Also, §4.5 (line 601) lists "concurrency" and "calls at once" as two settings.
- **Status:** open

## D3 — The config filename is named by the OpenRouter client, which is not a stage

- **Where:** `src/types/pipeline.ts:26` (`CONFIG_FILENAME`), found in ticket 03.
- **The code does:** the name appears in messages from `src/utils/stage-config.ts:49` (used by `transcription` and the OpenRouter client), `src/pipeline/openrouter.ts:263` (context length exceeded) and `src/pipeline/config.ts` (load and model-ID check).
- **The intent says:** the old comment: "two stages tell the user to edit it".
- **Other sources:** technical-design.md §6 (line 1642) agrees with the code: "`transcription` and the OpenRouter client both tell the user to edit it".
- **Status:** open

## D4 — `StageConfigUsed.modelId` allows `null`, and nothing writes it

- **Where:** `src/types/pipeline.ts:151`, found in ticket 03.
- **The code does:** `resolveStageRunConfig` (`src/pipeline/runner.ts:254–259`) writes `null` for the whole `configUsed` when the stage is not configured. Otherwise it copies the `StageConfig`, whose `modelId` is always a string. So `modelId: null` is never written. `stageCostRow` (`src/pipeline/reports.ts:338`) still checks for it.
- **The intent says:** the old comment: "`modelId` is `null` only for stages that make no LLM calls (in which case the whole `StageConfigUsed` is typically `null`)".
- **Other sources:** technical-design.md §4.5 (line 601) agrees with the code: `configUsed` is "`null` for stages that make no LLM calls".
- **Status:** open

## D5 — A run log records one pipeline run, not one invocation

- **Where:** `src/types/pipeline.ts:761` (`RunLog`), found in ticket 03.
- **The code does:** the runner writes one run log for each pipeline run, into the lecture's workspace (`src/pipeline/runner.ts:614`). A batch invocation writes one run log for each lecture.
- **The intent says:** the old comment: "the complete financial audit trail for one pipeline invocation". technical-design.md §4.6 (line 717): "Every pipeline invocation creates a new log file in `Run logs/`".
- **Other sources:** `CONTEXT.md`, Run log, agrees with the code: "The append-only record of one pipeline run". Ticket 01's comments record the same correction.
- **Status:** open

## D6 — `not-reached` also follows a `--to-stage` bound

- **Where:** `src/types/pipeline.ts:737` (`RunLogStageEntry`), found in ticket 03.
- **The code does:** a stage after the `--to-stage` bound is recorded `not-reached`, as a stage after a halt is.
- **The intent says:** the old comment: "`not-reached` means an upstream failure prevented it from being attempted". technical-design.md §4.2, after the status table (line 468): "`not-reached`, the run log action used when an upstream failure prevented a stage from being attempted at all".
- **Other sources:** technical-design.md §4.7 (line 848) and the old `RunLog.toStage` comment agree with the code.
- **Status:** code wrong, ruled by the user 2026-10-06. One action for two situations is not clear. Filed as `.scratch/run-outcomes/issues/01-mark-stages-after-to-stage-as-not-requested.md`.

## D7 — `QaSourcePassage.location` names a word the glossary avoids, and a set the prompt does not give

- **Where:** `src/types/pipeline.ts:628`, found in ticket 03.
- **The code does:** the checker prompt asks only for "the quote-fragment or locator for the passage in the transcript" (`transcript-verification.prompt.ts:76`). Nothing checks the form of `location`.
- **The intent says:** the old comment: "where that quote sits: topic block, slide number, or timestamp". "Topic block" is an _Avoid_ word in `CONTEXT.md` (Subtopic).
- **Other sources:** none.
- **Status:** open

## D8 — The technical design says a stage "settles" the title

- **Where:** technical-design.md §4.2 (line 391), found in ticket 03.
- **The code does:** not applicable. This is a disagreement between two statements of intent.
- **The intent says:** technical-design.md §4.2: "`transcript-structuring` settles the lecture's title … it reports what it settled".
- **Other sources:** `CONTEXT.md`, Completed stage: "A title or identity that a stage chooses is *decided*." Ticket 01, ruling B, says the same.
- **Status:** open

## D9 — Nothing treats a leftover `running` status as `failed`

- **Where:** `src/types/pipeline.ts:92` (`StageStatus`), found in ticket 03.
- **The code does:** nothing reads `running` back as `failed`. The next pipeline run does the stage again, because it is not a completed stage. `decideRunType` (`src/pipeline/runner.ts:111–136`) gives `error-recovery` for a `--from-stage` on it, as for `failed` and `pending`. The cost report (`stageCostRow`, `src/pipeline/reports.ts:334`) gives it no row, as for `pending`. A `failed` entry gets a row.
- **The intent says:** the old comment: "a crash therefore leaves `running` behind, which the next launch treats as `failed`". technical-design.md §4.2, status table (line 463): "Currently executing, or crashed mid-run — treated as `failed` on next launch". The runner's own comment (`runner.ts:367`) says the same.
- **Other sources:** none.
- **Status:** intent wrong, ruled by the user 2026-10-06. The next pipeline run does the stage again, and that is the right behaviour. The cost report can leave the crashed stage out, because the next run of the stage rebuilds its cost. Fix technical-design.md §4.2 and the comment at `runner.ts:367` in the design-doc rewording.

## D10 — `aiDerivedTitle` is also set when a user title keeps the lecture title

- **Where:** `src/types/pipeline.ts:450` (`Manifest.aiDerivedTitle`), found in ticket 03.
- **The code does:** `decideTitle` (`transcript-structuring.ts:240–266`) records `aiDerivedTitle` when the model judges the provisional title not meaningful. If the user has set a user title, only `aiDerivedTitle` changes: the lecture title and the lecture files stay as they are.
- **The intent says:** the old comment: "Set only when the provisional is judged not meaningful, in which case `lectureTitle` becomes this value and the source files, workspace folder, and any PDF are renamed accordingly."
- **Other sources:** the comment on `decideTitle` agrees with the code.
- **Status:** open

## D11 — Code reads the `null` source of a deficiency, and nothing ties it to the deficiency type

- **Where:** `src/types/pipeline.ts:643` (`QaDeficiency`), found in ticket 03.
- **The code does:** the verification report Markdown branches on `source === null` and writes a "no source passage" line (`transcript-verification.view.ts:134–135`). The reply check (`isDeficiency`, `transcript-verification.ts:179–190`) accepts `null` or a passage for every deficiency type.
- **The intent says:** the old comment: "Nothing branches on that `null`; which deficiency types have a source end is settled by `type`."
- **Other sources:** the checker prompt says an unsourced addition's source "is null" (`transcript-verification.prompt.ts:76`), but no code checks it.
- **Status:** open

## D12 — Nothing reads a run log's `callCount`

- **Where:** `src/types/pipeline.ts:716` (`RunLogCost`), found in ticket 03.
- **The code does:** the cost report reads only `cost.costUsd` from run logs (`src/pipeline/reports.ts:431`, `:476`). The run summary takes its call count from the manifest. No source file reads `RunLogCost.callCount`.
- **The intent says:** the old comment: "the cost report reads these two fields and nothing else".
- **Other sources:** none.
- **Status:** open

## D13 — The cost report does not narrow by date through `resolveLecturesByDate`

- **Where:** `src/types/pipeline.ts:850` (`ReportOptions.lectureDate`), found in ticket 03.
- **The code does:** `costReport` (`src/pipeline/runner.ts:923–931`) lists every lecture and keeps those whose manifest has the date. It does not call `resolveLecturesByDate`.
- **The intent says:** the old comment: "narrow the report to this date (via resolveLecturesByDate)".
- **Other sources:** none.
- **Status:** withdrawn 2026-10-06. This is not a divergence. The `cost-report` command finds the lectures through `resolveLecturesByDate` (`src/cli/commands.ts:465`) before it calls `costReport`. technical-design.md §4.7 (line 880) agrees.

## D14 — The `british-english` deficiency type assumes British English, and the output language can be American English

- **Where:** `src/types/pipeline.ts:613` (`QaDeficiencyType`), found in ticket 03.
- **The code does:** `OUTPUT_LANGUAGES` (`src/types/pipeline.ts:74`) lets `finalOutput.language` be `en-US`. The deficiency type for a spelling or idiom fault is named `british-english`.
- **The intent says:** the old comment: "spelling, punctuation, or idiom deviating from en-GB". technical-design.md §5, `qa-loop` (line 1558) names `british-english`.
- **Other sources:** technical-design.md §6 (line 1729): "every stage that writes prose obeys" `finalOutput.language`. `CONTEXT.md`, Deficiency type, names "British English".
- **Status:** filed 2026-10-06 as `.scratch/qa-loop/issues/01-spelling-check-follows-the-output-language.md`

## D15 — A QA iteration's cost cannot be unknown

- **Where:** `src/types/pipeline.ts:298` (`QaIterationSummary.costUsd`), found in ticket 03.
- **The code does:** `costUsd` is a `number`. The type has no way to hold an unknown cost. `qa-loop` is not built, so nothing writes it yet.
- **The intent says:** requirements.md NFR-2.2: the system "shall report a stage whose cost could not be established as unknown rather than as nothing". `CONTEXT.md`, Unknown cost: "An unknown cost is never zero and never blank."
- **Other sources:** `CostResolution` in the same file holds an unknown cost as `null` with a reason.
- **Status:** filed 2026-10-06 as `.scratch/qa-loop/issues/02-iteration-cost-can-be-unknown.md`
