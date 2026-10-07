# Phase 2 rulings for divergences D04-1 to D13-8

Each divergence is in `divergences/NN.md`. This file gives one ruling for each open divergence.

The rulings have these kinds:

- **Close.** The old comment was wrong. The new comment already describes the code. Nothing more to do.
- **Fix the docs.** The code is right. The technical design (TD), the plan or `CONTEXT.md` is out of date, or contradicts itself.
- **Fix the code.** A rule in `CLAUDE.md`, a rule in the TD, or the user's standing rule decides that the code is wrong. Each fix is a TDD cycle and a commit of its own.
- **The user decides.** No document decides. The choice changes what the user sees.

The column "Who ruled" says "Claude" when Claude ruled from the evidence. The user can overrule any of these rulings.

| ID | Divergence | Ruling | Action | Who ruled |
|---|---|---|---|---|
| D04-1 | The manifest header says "accumulated cost" | Close | None. TD §4.5 agrees with the code. | Claude |
| D04-2 | Only its own test calls `workspacePath` | Fix the code | Delete `workspacePath` and its test. The last production caller went in `c650b81b` (2026-08-14). Fix TD §4.4 and the plan. Standing rule: delete dead code. Done in `15d301b2`. | User, 2026-10-06 |
| D04-3 | One context for every stage of a run | Close | None. TD §4.7 agrees with the code. | Claude |
| D04-4 | The runner walks `lectureStages`, not `STAGE_IDS` | Fix the docs | TD §4.7: say that `lectureStages` is the pipeline order. `STAGE_IDS` gives the order only for `--from-stage` and `--to-stage`. The user ruled earlier that `lectureStages` is the pipeline order. | Claude |
| D05-1 | Six stages have no output file, not four | Close | None. TD §3.3 names all six. | Claude |
| D05-2 | The model list is not cached | Close | None. TD §6 agrees with the code. | Claude |
| D05-3 | Two files build `run-NN.json` | Fix the code | Declare the saved-run file name once in `layout.ts`. `panel-runs.ts` uses it. The fixture writes the name out on purpose, so that the tests check it. TD §3.3 decides. Done in `4e269b78`. | User, 2026-10-06 |
| D05-4 | TD §3.3 shows `runs/` and old `ModuleDirs` fields | Fix the docs | TD §3.3: change the tree to `Run logs/`. Change `ModuleDirs` to the fields in the code. Ticket 02 decides. | Claude |
| D05-5 | The loader accepts an entry with only a model ID | Close | None. The new comment describes the code. | Claude |
| D06-1 | Nothing branches on `ContextLengthError` | Close | None. TD §8 agrees with the code. | Claude |
| D06-2 | Not every `callModel` error names the model and the stage | Close | None. TD §8 makes no claim about every error. | Claude |
| D06-3 | TD gives `callModel` an optional client with a shared default | Fix the docs | TD §6, `callModel`: give `client` as a required `OpenRouterClient`. Delete "defaults to the shared instance". TD §6 contradicts itself. | Claude |
| D06-4 | Old comments name totals that the reports do not have | Close | None. TD §7 agrees with the code (NFR-2.2). | Claude |
| D06-5 | The error recovery section chooses by status too | Close | None. TD §7 agrees with the code. | Claude |
| D06-6 | A failed send with no cost is recorded at zero | Fix the docs | `CONTEXT.md`, Send: delete "Every send is billed", or add the exception. TD §6 agrees with the code. | Claude |
| D07-1 | A lint reason names a file-wide disable that does not exist | Close | None. | Claude |
| D07-2 | `makeConfig` counts nine stages, the example has eleven | Close | None. The new comment gives no count. | Claude |
| D07-3 | A link to `openRouterAddress`, which does not exist | Close | None. | Claude |
| D08-1 | A JSON call to a model that cannot give JSON fails | Close | None. TD §6 agrees with the code. | Claude |
| D08-2 | A cut can move back onto the previous cut, which gives an empty subtopic | Known limitation | None. The case needs two near-identical sets of start words from the model. No saved subtopic of 4,664 is empty (2026-10-06). The fix `1cfd8d2f` was reverted in `35cdfb4d`. | User, 2026-10-06 |
| D08-3 | A failed run does not lose the runs in flight | Close | None. TD §5 agrees with the code. | Claude |
| D08-4 | `readPanel` reads only splitting panels | Close | None. TD §5 agrees with the code. | Claude |
| D08-5 | TD puts two readers under `stage-output.ts` | Fix the docs | TD §5: move both readers under `stage-input.ts`. | Claude |
| D08-6 | The plan names `isDivision`, the code has `readDivision` | Fix the docs | Plan: change `isDivision` to `readDivision`. TD §5 agrees with the code. | Claude |
| D09-1 | An unreadable deepened run raises `SavedRunUnreadableError` | Close | None. TD §5 agrees with the code. | Claude |
| D09-2 | TD names the config section `division` | Fix the docs | TD §5: change `division` to `subtopicSplitting`. Ticket 02 (B7, S15) decides. Check that the `splittingPanel` comment no longer says `division`. | Claude |
| D10-1 | `source-normalisation` logs number, date and matches at `debug`, not `info` | Fix the docs | TD §5: these lines go to the debug log only. The terminal shows the counts, the renames and the manifest writes. | User, 2026-10-06 |
| D10-2 | `source-normalisation` can throw after it finished an interrupted rename | Fix the docs | TD §5, `source-normalisation`: the stage first finishes the renames of an interrupted earlier run. After that, it makes no filesystem change when it throws. TD §5 contradicts itself. | Claude |
| D10-3 | A new manifest has no cost | Close | None. TD §5 agrees with the code. | Claude |
| D10-4 | The numbering is in `lecture-resolution.ts` | Fix the docs | TD §5, "Where the rules live": numbering is in `lecture-resolution.ts`. Manifest seeding stays in the stage. TD §5 contradicts itself. | Claude |
| D11-1 | TD builds `transcript-structuring` from a logger only | Close | None. The transcript stages will be deleted, so their TD sections go with them. | User, 2026-10-06 |
| D11-2 | Nothing reads `deficiencyCount` | Close | None. The transcript stages will be deleted. | User, 2026-10-06 |
| D11-3 | TD names the renderer `renderVerificationReport` | Close | None. The transcript stages will be deleted, so their TD sections go with them. | User, 2026-10-06 |
| D11-4 | The jscpd markers say the transcript stages will be deleted | Close | None. The markers are right. The transcript stages will be deleted. | User, 2026-10-06 |
| D12-1 | TD gives `accumulateCost` no `null` running total | Fix the docs | TD §7: `current: StageCost \| null`. | Claude |
| D12-2 | Two JSON formats: one with a newline at the end, one without | Fix the code | `writeJsonAtomic` uses `jsonFileContent`, so every JSON file has one format. Rule Zero decides. Manifests and run logs on disk get a newline at the end. Readers do not change. Done in `12627808`. | User, 2026-10-06 |
| D12-3 | `readSavedRun` does not skip a file it cannot read | Fix the docs | TD §4.3: name three callers. Say that `readSavedRun` throws a named error. TD §5 agrees with the code. | Claude |
| D12-4 | No caller of `filenameSafe` falls back when the title is empty | Fix the docs | TD §4.4: the caller throws its own named error. Each caller does this now. | Claude |
| D12-5 | The progress bars write to stderr, TD says stdout | Fix the docs | TD §10, "Output Streams": stderr. Stdout stays free for the output the user asked for. | Claude |
| D12-6 | No caller of `pathExists` asks about a lecture PDF | Close | None. | Claude |
| D12-7 | `isRecord` has more callers than four | Close | None. | Claude |
| D12-8 | The first date in a filename is not always the lecture date | Close | None. TD §4.7 agrees with the code. | Claude |
| D12-9 | A test cites a test that does not exist | Close | None. | Claude |
| D12-10 | An example throws `StageError`, which does not exist | Close | None. | Claude |
| D12-11 | An example names the key `output.language` | Close | None. | Claude |
| D12-12 | More than two callers look up a stage's configuration | Close | None. | Claude |
| D13-1 | No blank line between two cost reports | Fix the code | `reportCosts` writes a blank line after each report, as the run summary does. The old comment gives the intent. Done in `0f70c079`. | User, 2026-10-06 |
| D13-2 | `openLecture` throws named manifest errors | Close | None. TD §8 agrees with the code. | Claude |
| D13-3 | The suites write exit codes as `0` and `1` | Fix the code | The CLI suites import `EXIT_SUCCESS` and `EXIT_FAILURE`. TD §4.7 and Rule Zero decide. Done in `082209a0`. | User, 2026-10-06 |
| D13-4 | The reset count for `run` costs no scan | Close | None. TD §4.7 agrees with the code. | Claude |
| D13-5 | A test names `files.test.ts` for the wrong comment | Close | None. | Claude |
| D13-6 | TD's `CliDeps` has `gbpPerUsd` | Fix the docs | TD §4.7: give `formatMoney` and `debugLogPath`. Delete `gbpPerUsd`. | Claude |
| D13-7 | TD's `batch` command has no `concurrency` | Fix the docs | TD §4.7: add `concurrency: number \| null`. TD §4.7 contradicts itself. | Claude |
| D13-8 | TD counts five runner operations, the code has six | Fix the docs | TD §4.7: "the six operations above". TD §4.7 contradicts itself. | Claude |

## Questions for the user

1. **D10-1.** For each lecture, `source-normalisation` logs its number, date, source pair and provisional title. These lines go to the debug log file only. The terminal does not show them. TD §5 says that they go to the terminal (`info`). Claude recommends: keep them in the debug log, and fix the TD. The terminal already shows the file counts, the renames and the manifest writes.
2. **D11-2 and D11-4.** The jscpd markers in `transcript-verification` say "until the stage is deleted". The TD gives no plan to delete the stage. Nothing reads `deficiencyCount`. Both depend on one question: will the transcript stages go away? If they go, keep both as they are. If they stay, delete `deficiencyCount`, delete the duplicate code under the markers, and delete the markers.
