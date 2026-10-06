# 02 — Rename everything to the glossary

**What to build:** every name in the code and in the files the pipeline writes uses `CONTEXT.md` terms. The ticket audits the names, the user rules on each proposed rename, and the ticket then makes every rename. It comes before the comment rewording, because comments quote names in backticks. See `../spec.md`.

**Blocked by:** 01

**Status:** ready-for-agent

The ticket covers two kinds of name:

- **Code names:** types, functions, variables, constants, test names and file names in `src/`. Renaming one changes no behaviour, so the type checker is its guard and it needs no new test.
- **Stored names:** keys in the manifest, run logs, saved runs, stage records and the config file; stage ids; command-line flags; folder and file names on disk. The user ruled on 2026-10-05 that these are renamed too, and the existing lectures' files are then fixed by hand. A manifest with renamed keys can stop a workspace being recognised as a lecture, so each fix is done before the next pipeline run.

- [ ] Every code name and stored name that uses a word `CONTEXT.md` avoids, or names a domain concept in an invented way, is listed with its proposed new name and where it is used. Each stored name also lists the existing files that carry it.
- [ ] The user has ruled on each proposal, and the rulings are recorded in this ticket's comments.
- [ ] Every code name is renamed as ruled, in commits of related names.
- [ ] Every stored name is renamed test first: a test that the written file carries the new name fails, then the rename makes it pass.
- [ ] After each stored-name rename, the user is given the list of existing files to fix and how, and confirms the fix before the next stored-name rename lands.
- [ ] Docs that name a renamed thing (technical design, implementation plan, README, config example) use the new name.
- [ ] The commit gate passes after every commit.

## Comments

2026-10-05, the audit. A script listed every declared name in `src/` (about 7,000, with test titles). Five agents checked them against `CONTEXT.md`. A sixth listed every stored name and found the existing files that carry each. Proposals are in four groups: A, the glossary already decides (no ruling); B, a choice for the user; C, a new name the glossary does not decide (yes or no); S, stored names. Code renames in A also rename the matching test titles.

### A — the glossary decides

| # | Current names (examples) | Glossary term | New names |
|---|---|---|---|
| A1 | `video`, `videos`, `videoName`, `videoDir`, `VIDEO_SUBDIR` (constant), `sourceVideo`, `locateSourceVideo`, `writeSourceVideo`, `renderFixtureVideo`, `videoIsos` | Recording | `recording(s)`, `recordingName`, `recordingsDir`, `locateRecording`, … |
| A2 | `slide`, `slides`, `slideName`, `slideDir`, `SLIDE_SUBDIR` (constant), `slideNameByIso` | Slide deck | `slideDeck(s)`, `slideDeckName`, `slideDecksDir`, … |
| A3 | `PairedSources`, `matchedPairs`, `pairs`, `pair` | Source pair | `SourcePair`, `sourcePairs` |
| A4 | `iso` (a lecture date), `presentIsos`, `duplicateIsos`, `datedIsos` | Lecture date | `lectureDate`, `presentDates`, `duplicateDates`, … |
| A5 | `anomalies`, `anomaliesFor`, state `"anomalies"`, `checkSources`, `SourceCheck`, describe "validation errors" | Source rule | `brokenRules`, `brokenRulesFor`, state `"rules-broken"`, `checkSourceRules`, `SourceRuleCheck` |
| A6 | `undateable` | Source rule (_Avoid_: undateable) | `undated` |
| A7 | `orphan(s)`, `findOrphans`, `deleteOrphan`, `resolveOrphans`, `OrphanOutcome`, `OrphanContext`, `orphanPrompt`, `orphanedFolders` | Orphaned workspace | `orphanedWorkspace(s)`, `findOrphanedWorkspaces`, `OrphanedWorkspaceOutcome`, … |
| A8 | `folderName`, `lectureFolderName`, `LectureNameParts`, `LECTURE_FOLDER`, `RENAMED_FOLDER`; "canonical name" in test titles | Base name | `baseName`, `BaseNameParts`, `LECTURE_BASE_NAME`, … |
| A9 | `mutateLecture`, `applyMutation`, `MutationCommand`, `MutationTarget` | Identity change | `changeLectureIdentity`, `applyIdentityChange`, `IdentityChangeCommand`, `IdentityChangeTarget` |
| A10 | `refused`, `refusal`, `refusalWarning`, `CompletionRejectedError`, `rejectionMessage`, `mockCompletionRejectedByProvider` | Provider error | `hasProviderError`, `providerError`, `ProviderError`, `providerErrorDescription` (`providerErrorMessage` is taken), … |
| A11 | `CostResolution`, `resolved` (of a cost) | Unknown cost | `KnownOrUnknownCost`, `knownCost` (the stored key is S3) |
| A12 | `settleTitle`, `settledTitleOutcome`, `SETTLED_IDENTITY`, `makeSettlingStage` (of a title or identity) | Decided | `decideTitle`, `decidedTitleOutcome`, `DECIDED_IDENTITY`, `makeDecidingStage` |
| A13 | `isComplete`, `isStageComplete`, `FINISHED_STATUSES`, `finishedEntry` (output is on disk) | Settled | `isSettled`, `isStageSettled`, `SETTLED_STATUSES`, `settledEntry`. Status values `complete`/`skipped` stay. |
| A14 | `finding(s)`, `findingCount`, `isFindingsReport`, `QaFindingsReport`, `renderFinding(s)`, `verificationFinding` | Deficiency | `deficiency`, `deficiencyCount`, `isCheckerReport`, `QaCheckerReport`, `renderDeficiency`, … |
| A15 | `renderConsidered`, `verificationCleared` | Consideration | `renderConsiderations`, `verificationConsideration` (the stored key is B1) |
| A16 | `RunManifest`, `isRunManifest`, `runManifest` | Manifest | `Manifest`, `isManifest`, `manifest` |
| A17 | `ManifestStageEntry`, `QaManifestStageEntry` | Stage entry | `StageEntry`, `QaStageEntry` |
| A18 | `StageParams` | Tuning | `StageTuning` |
| A19 | `BatchRunOptions` | Batch | `BatchOptions` |
| A20 | `classifyRunType`, `classificationOf` | Run type | `decideRunType`, `runTypeOf` |
| A21 | `record` (alone), `recorders`, `StageWithRecord`, `writeStageOutputWithRecord`, `writeDivisionWithRecord` | Stage record | `stageRecord`, `StageWithStageRecord`, `writeStageOutputWithStageRecord`, … |
| A22 | `quote(s)`, `secondQuote`, `opening`, `SECOND_START`, `transcriptSecondOpening` | Subtopic start | `subtopicStart(s)`, `SECOND_SUBTOPIC_START`, … |
| A23 | `initialRun(s)`, `seedInitialRuns`, `seedDeepenedRuns`, `deepenRun(s)`, `RunUnderDeepening` | Splitting run (before deepening) | `splittingRunsBeforeDeepening`, `seedSplittingRuns`, `deepenSplittingRun(s)`, `SplittingRunUnderDeepening` |
| A24 | `runFiles`, `panelRunFiles`, `panelRunPath`, `readPanelRun`, `seedPanelRun(s)`, `NumberedRun`, `earlierLaunchRun` | Saved run | `savedRunFiles`, `savedRunPath`, `readSavedRun`, `seedSavedRun(s)`, … |
| A25 | `RunOptions`, `DEFAULT_RUN_OPTIONS`, `RunTrigger`, `RunEvent`, `RunReporter`, `createRunReporter`, `RunStageOutcome`, `StageRunConfig`, `toRunOptions` | Pipeline run (bare "run" is qualified, ruling 01) | `PipelineRunOptions`, `PipelineRunTrigger`, `PipelineRunEvent`, `PipelineRunReporter`, … |
| A26 | `logFile`, `logs`, `logPath`, `createRootLogger` | Debug log | `debugLogFile`, `debugLogPath`, `createDebugLogger` |
| A27 | `runId` where it names the invocation (`debugLogPath`, `run-cli`) | Invocation | `invocationId` |
| A28 | `renderVerificationReport`, `writesIntoAndRenders`, `renderers`, `notARenderer` | Readable view | `renderReadableView`, `writesIntoWithReadableView`, `viewWriters`, … |
| A29 | `MALFORMED_REPLIES`; test title "rejecting a reply that is not…" | Unusable reply | `UNUSABLE_REPLIES`; "treating as unusable…" |
| A30 | `SubtopicNaming`, `NamedReplyPart`, `isNamedReplyPart`, `replyNaming`, `named` | Title (_Avoid_: name) | `TitleAndReason`, `TitledReplyPart`, `isTitledReplyPart`, `replyTitleAndReason`, `titled` |
| A31 | `userChosenTitle` | User title | `userTitle` |
| A32 | `verdict(meaningful)` test helper | Title judgement | `titleJudgement` |
| A33 | `outputFile` (the PDF), `FINAL_OUTPUT_DIR` (constant), `finalOutput`, `finalOutputDir`, `discoverFinalOutput` | Notes | `finalOutputFile`; the folder names stay (see the A24–A33 rulings) |
| A34 | `recordingStage`, `runRecordingStage`, `contextRecordingOutput` ("recording" meaning noting down) | Recording is the source file | `orderLoggingStage`, `runObservedStage`, `contextCapturingOutput` |
| A35 | `renameLectureFiles` | Item | `renameItems` |
| A36 | `SUBJECT` (holds a title) in `date.test.ts` | Module (_Avoid_: subject) | `TITLE` |
| A37 | Test titles only: "launch" → invocation; "gate" alone → size gate; "lecture run", "a previous run", "end-of-run summary" → pipeline run, invocation, run summary; "run logger" → debug logger | as named | as named |

Left as they are, under ruling 01: bare `run`/`runs` inside the generic panel code (`chosenRun`, `cutsPerRun`, `earliestRunIndex`), where "panel" fixes the meaning; `runLog`, `runType`, `runSummary`, which are glossary compounds; `sendGate`.

### B — choices

- **B1. Keys the prompts ask for.** Prompts are carried over word for word, and these keys are in them: `suggestedTitle`, `structuredMarkdown` (structuring); `considered`, `whyNotRaised` (checker); `label`, `groupedBecause` (grouping); `verdict`, `heldBecause` (deepening); `startsWith` (splitting). Splitting already translates its reply into glossary names (`title`, `why`) before saving. Grouping saves its reply as it came, so `label` and `groupedBecause` reach 72 saved runs; the checker's report will too. Options: (a) keep prompt words only in the reply types and translate at that seam, including before the grouping saved runs and checker report are written; (b) as (a), but keep saved runs and the checker report exactly as the model replied; (c) change the prompts (a new prompt version each). Recommend (a).
- **B2. Deficiency type or category.** One concept, two words: `type` (stored key, `QaDeficiencyType`) and `category` (`CATEGORY_PRESENTATION`, `renderCategoryCounts`, `PROSE_CATEGORIES`). Recommend `type` everywhere, `PROSE_FAULT_TYPES`, and a glossary entry **Deficiency type**.
- **B3. A deficiency's source passage.** `QaSourceAnchor`/`isSourceAnchor` vs `NO_SOURCE_PASSAGE`. The glossary says "passage". Recommend `QaSourcePassage`.
- **B4. Stage id `define-topics`.** The glossary calls the stage "grouping into topics". Sibling ids are verb-first (`deepen-subtopic-splitting`, `choose-division`, `retitle-subtopics`). Options: `group-into-topics` or `group-topics`. The code names follow (`DefineTopicsError` → `GroupIntoTopicsError`, …). Stored: see S1.
- **B5. `completionMaxRetries`** (config key). It is the OpenRouter client's own retry limit, beneath the stage's three sends. Options: rename to `completionMaxResends` (mixes the two layers), or keep it and add a glossary entry for the client's retries. Recommend the glossary entry.
- **B6. Config section `output`** (`language`, `pandocEngine`). One agent: it is about the notes, so `notes`. Another: the language applies to every prose stage, not only the notes. Options: `notes`, or leave it.
- **B7. Config section `division`** (`panelSize`, `bar`, `sizeGateWords`). It sets up the splitting panel; a division is what a splitting run makes. Options: `splitting`, or leave it.

### C — new names, yes or no

| # | Current | Problem | Proposed |
|---|---|---|---|
| C1 | `StageRunRecord` (cost plus files written) | Collides with stage record | `StageCostAndFiles` |
| C2 | `StageWorkspace`, `STAGE_WORKSPACE`, `StageWorkspaceWithFile`, `StageWorkspaceWithView` | A workspace is one per lecture, not per stage | `StageLayout`, … |
| C3 | `StageRecorder`, `createStageRecorder`, `recorder` (writes the stage entry) | Collides with stage record | `StageEntryWriter`, `createStageEntryWriter`, `entryWriter` |
| C4 | `bar` (progress bar) | Collides with Bar | `progressBar` |
| C5 | `TextSpan`, `DateSpan`, `TimeSpan`, `testRunSpan`, `cutSiteSpans` | Collide with Span | `TextMatch`, `DateMatch`, `TimePeriod`, `testPipelineRunPeriod`, `cutSiteExtents` |
| C6 | `items`/`item` in `concurrency.ts` | Collides with Item | `tasks`/`task` |
| C7 | `position` in retitling (`POSITION_KEY`, the `changes.json` key) | Collides with Position; the prompt calls it `id`, grouping says `firstSubtopicId` | `subtopicId` (stored: S7) |
| C8 | `datedFileDirs`, `findDatedFile`, `removeDatedFile`, `DatedFileQuery` | No term; the glossary says "source file" | `sourceFileDirs`, `findSourceFile`, … |
| C9 | `verificationReportPath`, `REPORT_LOCATION` | No glossary term for the checker's JSON output | add **Verification report** to the glossary; names stay |
| C10 | `modulePrefixes` | No term; "prefix" is on Base name's _Avoid_ list | add **Module prefix** to the glossary; names stay |
| C11 | `processingDir` | No term for the folder that holds the workspaces | leave, or add a term |

### S — stored names

Real data: `pipeline-config.json` at the repo root; module Biology of Disease has 8 lecture workspaces, each run to `define-topics`; Biochemistry and Molecular Biology has empty folders. No workspace has reached transcript structuring or verification.

| # | Stored name | Where | New name | Existing files that carry it |
|---|---|---|---|---|
2026-10-06: this table is redone to match every ruling below. The rulings of 2026-10-05 on the stored list use older numbers: their S14 and S15 are S12 and S13 here, and their S16, S17 and S18 are S14, S15 and S16. The token counts were ruled but had no row; they are S17.

| # | Stored name | Where | New name | Existing files that carry it |
|---|---|---|---|---|
| S1 | `define-topics` | stage id: manifest `stages` key, run logs, config `stages` key, `--from-stage`/`--to-stage` value; with B4 | `group-into-topics` | 8 manifests, their run logs, `pipeline-config.json` |
| S2 | `workspaceFolderName` | manifest key | `baseName` | 8 manifests |
| S3 | `costResolutionError` | stage entry cost key | `unknownCostReason` | 16 stage entries across the 8 manifests |
| S4 | `runId` | run log key | `pipelineRunId` | 80 run logs |
| S5 | workspace folder `runs/` | holds run logs | `Run logs/` | 8 folders, 80 files |
| S6 | project-root `runs/` | holds debug logs only | `debug-logs/` | 1 folder, 58 files |
| S7 | `changed[].position` in `changes.json` | retitling stage record | `subtopicId` | 8 files, 141 entries |
| S8 | module folders `Video files`, `Lecture slides` | the user's module tree | `Video recordings`, `Slide decks` (`Final output` stays) | 2 module trees (BOD: 8 video recordings, 8 slide decks) |
| S9 | subtopic `why` | division output and splitting saved runs | `reason`; drop `titleInherited` from the saved runs | 16 `subtopics.json`, 288 splitting saved runs |
| S10 | topic `groupedBecause` | `topics.json`, grouping saved runs | **stays** | — |
| S11 | topic `label` in grouping saved runs | grouping saved runs | `title` | 72 grouping saved runs |
| S12 | checker report `considered`, `whyNotRaised` | verification report | **stays** | — |
| S13 | `Transcript verification/verification-report.md` | the verification report Markdown | **stays** | — |
| S14 | temp suffix `.stage0-tmp` | exists only mid-rename | `.normalisation-tmp` | none |
| S15 | config `output`, `division`, `completionMaxRetries` | config file | `finalOutput`, `subtopicSplitting`, `completionMaxResends` | `pipeline-config.json`, the example config |
| S16 | debug-log keys and messages | debug logs | follow the code names; old debug logs are left as history | none fixed |
| S17 | `promptTokens`, `completionTokens` | stored token counts | `sentTokens`, `replyTokens` | 8 manifests |

The table as first written, before the rulings:

| # | Stored name | Where | New name | Existing files that carry it |
|---|---|---|---|---|
| S1 | `define-topics` | stage id: manifest `stages` key, run logs, config `stages` key, `--from-stage`/`--to-stage` value | per B4 | 8 manifests, their run logs, `pipeline-config.json` |
| S2 | `workspaceFolderName` | manifest key | `baseName` | 8 manifests |
| S3 | `costResolutionError` | stage entry cost key | `unknownCostReason` | 16 stage entries across the 8 manifests |
| S4 | `runId` | run log key | `pipelineRunId` | 80 run logs |
| S5 | workspace folder `runs/` | holds run logs | `Run logs/` (or `run-logs/`) | 8 folders, 80 files |
| S6 | project-root `runs/` | holds debug logs only | `debug-logs/` | 1 folder, 58 files |
| S7 | `changed[].position` in `changes.json` | retitling stage record | `subtopicId` (C7) | 8 files, 141 entries |
| S8 | module folders `Video files`, `Lecture slides`, `Final output` | the user's module tree | `Recordings`, `Slide decks`, `Notes` | 2 module trees (BOD: 8 recordings, 8 slide decks; Final output empty) |
| S9 | subtopic `why` | division output and splitting saved runs | `reason` | 16 `subtopics.json`, 288 splitting saved runs |
| S10 | topic `groupedBecause` | `topics.json`; grouping saved runs (B1) | `reason` | 8 `topics.json`; 72 grouping saved runs under B1(a) |
| S11 | topic `label` in grouping saved runs | B1 | `title` | 72 grouping saved runs under B1(a) |
| S12 | checker report `considered`, `whyNotRaised` | B1 | `considerations`, `reason` | none yet |
| S13 | `Transcript verification/verification-report.md` | the readable view | `readable-view.md` | none yet |
| S14 | temp suffix `.stage0-tmp` | exists only mid-rename | `.normalisation-tmp` | none |
| S15 | config `output`, `division`, `completionMaxRetries` | per B5–B7 | per ruling | `pipeline-config.json`, the example config |
| S16 | debug-log keys `findings`, `anomalies`, `orphans`, `videos`, `sourceVideoPath`, `folder`; message "Lecture run started" | debug logs | follow the code names | old debug logs: propose leaving them as history, not fixing them |

Also found: every splitting saved run carries `titleInherited`, which nothing reads. Fixing those files for S9 could drop it.

Two things any folder or file rename must also fix: each manifest's `filesWritten` holds workspace-relative paths, and stage ids sit in three places (manifests, run logs, config).

2026-10-05, the user's rulings:

- A stands, with one change: A1 becomes **video recording**, not recording. The glossary now has a **Video recording** entry, and its other uses of "recording" say "video recording". Names: `videoRecording(s)`, `locateVideoRecording`, and so on.
- B1: translate. Prompt words stay only in the reply types. Each reply is translated into glossary names where it is read, also before a grouping saved run or the verification report is written.
- B2: `type` everywhere. New glossary entry **Deficiency type**.
- B3: `QaSourcePassage`.
- B4: the stage id becomes `group-into-topics`.
- B5: `completionMaxResends`.
- B6: the config section `output` becomes `lectureNotes`.
- B7: the config section `division` becomes `subtopicSplitting`.
- C1 `StageCostAndFiles`; C2 `StageFiles`; C3 `StageStatusWriter` (the user's name); C4 `progressBar`; C5 `TextMatch`, `DateMatch`, `TimePeriod`; C6 `tasks`; C7 `subtopicId`; C8 `sourceFile`. C9–C11: new glossary entries **Verification report**, **Module prefix**, **Processing folder**. The names stay.
- S: the stored list is redone with the names above, for one ruling.

2026-10-05, the user's rulings on the stored list, which change three earlier ones:

- B6 is reversed. The config section `output` becomes `finalOutput`, not `lectureNotes`. The module folder `Final output` keeps its name, and so do the code names for it (`FINAL_OUTPUT_DIR`, `finalOutputDir`, `discoverFinalOutput`). New glossary entry **Final output folder**.
- A topic's reason stays `groupedBecause`, in code and on disk ("better than reason"). A subtopic's `why` still becomes `reason`.
- S14 and S15 stay as they are: the verification report keeps `considered` and `whyNotRaised`, and the readable view stays `verification-report.md`.
- Every other stored rename is agreed: S1–S9, S11, S13, S16, S17 (with `finalOutput`), S18 (old debug logs are left as history). `titleInherited` is dropped from the splitting saved runs when they are fixed.

2026-10-05, the user's rulings on method:

- Where a model's reply is translated into glossary names, a short comment at the translation says that the code chose the new name for readability and left the prompt unchanged.
- Code renames use a script that drives TypeScript's own rename, one group of related names per commit. A pass by hand then picks up what the script missed: test titles, comments, strings and file names.
- Each rename group also changes the old word to the new one in the comments of the files it touches, in the same commit, so that comments and names agree. Style is still left to the rewording tickets. Prompt text is not touched.
- Say "deficiency type", never "type" alone, in names, comments and test titles: a bare "type" reads as the code construct. The glossary entry now avoids it. The stored key `type` stays.
- Provider error messages say the model "returned an error", not "rejected the request": the error can arrive inside an accepted reply.
- "Readable view" becomes **verification report Markdown** (glossary entry renamed). Its visible text says deficiencies and deficiency type.
- Stored token counts: `promptTokens` → `sentTokens` and `completionTokens` → `replyTokens` (option c). Done in the stored-name stage.
- "Completion" is the provider library's word. The pipeline's own names say model call, send or reply instead; `createCompletion` and the library's own fields keep it. Done as its own group.

2026-10-05, the user's ruling on A13, which reverses it:

- `isComplete` and `isStageComplete` stay. In plain English they give the right answer: a skipped stage is complete, and a stage whose files were deleted, or whose panel failed, is not.
- "Settled" and "finished" are dropped for this idea. The names become `CompletedStageEntry` (was `SettledStageEntry`), `isCompletedEntry` (was `hasSettledOutput`), `completedEntry` (was `finishedEntry`) and `COMPLETED_STATUSES` (was `FINISHED_STATUSES`).
- The glossary entry **Settled** becomes **Completed stage**, with "settled" on its _Avoid_ list.

2026-10-05, the user's ruling on A22, which changes it:

- The words a model returns to mark where a subtopic starts are **start words**, not "subtopic start". `subtopicStarts` would sit beside a subtopic's numeric `start` and read as positions. Names: `startWords`, `secondStartWords`, `transcriptSecondStartWords`; the number `SECOND_START` becomes `SECOND_SUBTOPIC_START`, since it is a position. The glossary entry is renamed to match.
- The file names `choice.json` and `changes.json` stay.

2026-10-05, the user's rulings on A24 to A33:

- A24: the test fixture that reads a saved run back is `readSavedRunJson`. Production already has a private `readSavedRun`, which also checks the run. The list of saved run paths is `savedRunPaths`. The fixture run from an earlier invocation is `earlierSavedRun`. `NumberedRun` stays.
- Test titles say "in the manifest as the stage's recorded files", not "as written". A run is saved to disk when it finishes. The manifest lists it only when the stage completes.
- A25: `RunStageOutcome` becomes `PipelineStageOutcome`. `StageRunConfig` becomes `StageConfigUsed`, to match the stored key `configUsed`. `RunSummary` becomes `PipelineRunSummary`. `BatchSummary` and `BatchOptions` stay, because "batch" needs no qualifier.
- A25: the comment pass changes only the comments of the renamed names. The general rewording of a bare "run" is left to tickets 04 to 13.
- A31: the fixture `userChosenTitle` becomes `testUserTitle`, to match the other `test…` fixtures. The ticket's `userTitle` is the manifest field.
- A33: the fixture `outputFile` becomes `finalOutputFile`, beside `videoRecordingFile` and `slideDeckFile`. The final output folder names stay, as ruled for B6.

2026-10-05, the user's rulings on A34 to A36:

- Every naming choice is explained, and agreed, before it is made. A name says plainly what the thing does, in STE terms.
- A34: `recordingStage` becomes `stubThatListsDates`, because it is a stub and not a stage. Its list `ran` becomes `datesInRunOrder`. `runRecordingStage` becomes `runStageAndReturnWhatItReceived`. `contextRecordingOutput` becomes `contextAfterStageCompletes`.
- A35: `renameLectureFiles` stays. It is close enough.
- A36: `SUBJECT` becomes `LECTURE_TITLE`.

2026-10-05, the user's rulings on C1 to C5:

- C1 `StageCostAndFiles`, C3 `StageStatusWriter` (with `createStageStatusWriter` and `statusWriter`), and C4 `progressBar` are done as ruled. C2 was done earlier.
- C5: `TextMatch`, `DateMatch` and `TimePeriod` as ruled. `testRunSpan` becomes `testTimePeriod`, because batch summaries use it too. `cutSiteSpans` becomes `cutSites`.
- C5: the two digit date helpers merge into one, `digitDateMatches`, which takes a list of formats. The patterns are named by digit count: `EIGHT_DIGIT_DATE`, `SIX_DIGIT_DATE`, with `fromEightDigits` and `fromSixDigits`. Each pattern and its reader is a `DigitDateFormat`. `parseDateSpans` becomes `chronoDateMatches`.
- C6: the glossary entry **Item** becomes **Lecture file**, to match `renameLectureFiles`. "Item" goes on its _Avoid_ list, and comments, test titles and the technical design say "lecture file". So `items` in the concurrency helper clashes with nothing and stays. Its comments say "run", not "task in flight". `groupBy` in the reports module takes `members`, because `rows` there already means formatted table rows.

2026-10-06, the user's rulings on C7 and C8:

- C7: `POSITION_KEY` becomes `SUBTOPIC_ID_KEY`. Its value `"id"` is the prompt's word and stays. The retitling comments and test titles say "subtopic id", not "position". New glossary entry **Subtopic id**, with "position" on its _Avoid_ list. The stored key `changed[].position` is renamed in S7, not here.
- C8: the name `sourceFile` is not correct. These helpers also act on the final output folder, and a notes PDF is not a source file. The names are `findLectureFileByDate`, `removeLectureFileByDate`, `LectureFileQuery` and `sharedLectureFileDirs`. "ByDate" says how the file is found: by the last date in its name, not by the whole name. The `DatedFile` type in source normalisation stays, because it is only ever a source file.

2026-10-06, the user's rulings on B4 and B1:

- B4 is done together with stored rename S1: the stage id, the folder and file names, the report label "Group into topics", and the code names (`GroupIntoTopicsError`, `createGroupIntoTopicsStage`, `GroupIntoTopicsOutput`, `groupIntoTopics`). If the code names changed first, the code and the stage id would disagree until S1.
- B1, code part: only the grouping comment changes. Splitting already translates its reply. Deepening's `verdict` and `heldBecause` are not read. The checker keeps `considered` and `whyNotRaised`, as ruled. Grouping's saved runs change `label` to `title` in S11. A topic's `groupedBecause` stays.
- B1: transcript structuring is not translated now. The user expects that stage to change greatly, so work on it now is premature.

2026-10-06, the user's rulings on S5 and S8:

- S5: the workspace folder `runs/` becomes `Run logs/`, to match the other workspace folders.
- S8: `Video files` becomes `Video recordings` and `Lecture slides` becomes `Slide decks`, to match the glossary. `Final output` stays.
