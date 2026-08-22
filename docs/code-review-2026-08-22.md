# Code review — whole tree at `a134389` (2026-08-22)

Two-axis review (`/code-review`): **Standards** (conformance to `CLAUDE.md`) and **Spec** (fidelity to
`requirements.md` / `technical-design.md`). Run over the entire tree rather than a diff — 8,101
production lines across 29 files, plus 6,578 lines of tests.

Findings are **not** merged or reranked across the two axes; that separation is the point of running
them apart. Anything Biome, ESLint, `tsc` or jscpd already enforces was excluded from scope.

Three Spec defects were verified against the code and filed as GitHub issues #1, #2 and #3. Everything
else below is unfiled.

---

## Standards

### CLI — `src/cli/*`

**Hard violations**

- **Rule Zero, duplicated type** — `type MatchQuery = { readonly matches: readonly LectureMatch[] }`
  written twice with near-identical TSDoc: `commands.ts:31` and `prompts.ts:24`. `CliDeps.selectMatch`
  (`commands.ts:51`) then restates `selectLectureMatch`'s signature (`prompts.ts:96`) a third time.
- **Rule Zero, same expression twice in one file** — `updatedAt: new Date().toISOString()` at
  `lecture-identity.ts:107` and `:229`, inside two otherwise-identical `writeManifest` shapes.
- **Rule Zero** — `(text: string) => void` unnamed across eight sites (`commands.ts:55`,
  `run-cli.ts:33,35,52,127,131,136,137`). Wants one `WriteText` type.
- **Rule Zero, repeated lookup** — `COMMAND_SPECS[command]` read at `args.ts:402` (narrowed) and again
  at `:342` where the narrowing is gone and is recovered by `as CommandSpec`.
- **Testing, `beforeEach`** — shared arrange restated at `lecture-identity.integration.test.ts:164,173`.
- **Testing, `test.each`** — identical structure differing only by input at
  `lecture-identity.integration.test.ts:133/141/148/155` and `:80/87/93`.
- **Rule Zero, test helper bypassed** — `commands.integration.test.ts` defines `invoke()` at `:134`
  then calls `executeCommand` inline at `:209,305,318,327,340`. The cost-report command literal is
  restated at `:376,387,401` while sibling describes use a named const.
- **Rule Zero** — `args.test.ts:41` hardcodes the six command names already in `COMMAND_SPECS`.
- **Rule Zero** — `prompts.test.ts:43` and `commands.integration.test.ts:142` both re-derive what
  `baseNameForLecture` owns, **and disagree with each other**.

**Judgement calls**

- **Repeated Switches** — the `command` discriminant is cascaded three times: `args.ts:346-375`,
  `commands.ts:437-446`, `commands.ts:379-395`. `COMMAND_SPECS` is already the map.
- **Primitive Obsession, sentinels** — `prompts.ts:18-19` `ALL_MATCHES = -1` / `CANCEL = -2` share a
  value space with array indices, forcing `matches[index] as LectureMatch` at `:81`, `:101`. A
  discriminated union is `CLAUDE.md`'s own stated preference.
- **Primitive Obsession, dates** — `lectureDate: string` throughout (`args.ts:30`, `commands.ts:119`,
  `lecture-identity.ts:152`); `isCalendarDate` validates then returns a bare `string`, so nothing
  downstream distinguishes a validated date from any string.
- **Weak keying** — `COMMAND_SPECS: Readonly<Record<string, CommandSpec>>` (`args.ts:263`) is keyed by
  `string`, so TS cannot check every `CliCommand` variant has a spec. That is the cast at `:342`.
- **Speculative / no-op** — `command satisfies RunnableCliCommand` (`run-cli.ts:147`) asserts what the
  `=== "help"` guard already narrowed; `moduleRoots = undefined` default (`commands.ts:122`) is
  redundant against the `??` at `:130`.
- **Mysterious / shadowed name** — `commands.integration.test.ts:111` declares a local
  `otherModuleRoot()` while `fixtures.ts:413` exports `otherModuleRoot` with a different value.

### Pipeline core and stages — `src/pipeline/*`

**Hard violations**

- **Rule Zero** — `runner.ts:489` `cost: { totalCostUsd: null, callCount: 0 }` is exactly
  `runLogCost(null)`, defined 90 lines above at `runner.ts:396`. Recurs at `run-status.test.ts:24` and
  `cli/commands.integration.test.ts:241`.
- **Rule Zero** — `runner.ts:332` `JSON.stringify(value, null, 2)` vs `manifest.ts:20` `JSON_INDENT = 2`.
  Two homes for persisted-JSON indentation.
- **Rule Zero** — `config.ts:324-330` `providerPrefixOf` splits a model ID on `/`;
  `transcription.ts:71,138-139` re-declares `PROVIDER_SEPARATOR` and splits the same ID the other way.
  One fact, two modules, opposite halves.
- **Rule Zero** — stage-output directory preparation triplicated verbatim:
  `audio-extraction.ts:138-141`, `transcription.ts:264-270`, `transcript-structuring.ts:151-155`
  (`stageOutputPath` → `dirname` → `mkdir recursive` → `cleanTmpFiles`). No such helper exists in
  `utils/files.ts`. This is the shape `pipeline-stage.ts` should own, since every stage is built
  through `createPipelineStage`.
- **Rule Zero** — `source-normalisation.ts:126-148`, four loop pairs in `collectAnomalies` differing
  only by `video`/`slide`.
- **Rule Zero** — `runner.ts:145-151` `readJsonFile` duplicates `manifest.ts:61-71` `readManifestSafe`;
  both are "parse JSON, `null` on failure" with a bare catch.
- **File Organisation** — `lecture-files.ts:22` imports `lectureBaseName` from
  `stages/source-normalisation.ts`. A shared pipeline module depends on a stage, and the file's own
  header (`:11-13`) argues for the opposite direction. `lectureBaseName` has three consumers and
  belongs in `lecture-files.ts` or `utils/naming.ts`.
- **One level of abstraction** — `runner.ts:412-494` `runStage` mixes orchestration with manifest
  patching, workspace relocation, logging, error mapping and run-log construction across ~80 lines,
  around a mutable `nextContext` closure.

**Judgement calls**

- **Middle Man / Duplicated Code** — `runner.ts:558-566`, `overallStatus` and `aggregateStatus` are the
  same one-line `summariseOverallStatus` wrapper at two levels; `overallStatus` also shadows the
  property it fills (`:696`).
- **Primitive Obsession + Data Clump** — `lectureDate` / `iso` as bare `YYYY-MM-DD` strings through
  `runner.ts:216-269`, `lecture-files.ts:40-82`, `source-normalisation.ts:40-59`; the trio
  `{workspaceRoot, moduleRoot, lectureDate}` travels together at `runner.ts:249-256` and `:432-437`.
  A `LectureIdentity` type wanting to be born (note the name already exists twice — see utils below).
- **Casts defeating `noUncheckedIndexedAccess`** — `runner.ts:188` (`as string` ×2 after a filter that
  already proved it), `source-normalisation.ts:205,216,356`, `runner.ts:319`.
- **Divergent Change** — `PipelineRunner` both orchestrates and writes to `process.stdout`
  (`runner.ts:851-870`). Presentation inside the orchestrator.
- **Two seams for one problem** — module-level mutable caches solved differently: `config.ts:24` plus an
  exported `clearModelIdCache`, vs `openrouter.ts:87` plus an optional `client?: OpenAI` param
  (`openrouter.ts:218`), which also brushes the rule against optional fields that select runtime
  behaviour.
- **Duplicated Code** — `config.ts:37-59`, `requireRecord` / `requireString` / `requireNumber` are three
  copies of "typeof check, throw `${label} must be a X`".

**Clean:** `layout.ts` (the branded `StageDirectoryName` is well-judged), `run-status.ts`,
`manifest.ts`, `pipeline-stage.ts`, `transcript-structuring.prompt.ts`.

### Pipeline test suites

From an exhaustive audit of all 14 co-located suites. (A parallel sampling pass called these suites
"well-factored"; the exhaustive read below supersedes it.)

- `runner.integration.test.ts` — `{ output: undefined, cost: null, filesWritten: [] }` 8× (`:67,195,279,320,348,681,807,847`);
  the `vi.fn` wrapper verbatim 3× (`:276-283,317-324,345-352`); cost literal 3× (`:158,309,631`);
  `"audio extraction failed"` 5× (`:205,222,233,343,693`); the complete-entry shape 3×
  (`:266-272,444-450,723-729`) **while `fixtures.ts:386 stageCompletedAt` sits unused**; local
  `writeManifest`/`readManifest` (`:71-83`) re-implementing `manifest.ts`; `makeRunner(...)` restated
  across four tests (`:818,854,862,872`) with no `beforeEach`.
- `source-normalisation.integration.test.ts` — `CELL_INJURY` declared at `:19` then restated as a
  literal 6× (`:138,165,229,307,323,355`); `writeLecture(CELL_INJURY_VIDEO, CELL_INJURY_SLIDE)` in 9
  tests (`:133,146,181,212,221,297,315,338,348`); Vaccination pair duplicated `:112`/`:316`; Immunity
  pair `:318`/`:491`; a third copy of `writeManifest`/`readManifest` at `:53-55`.
- `config.integration.test.ts` — `makeValidConfig` → `writeConfig` → `mockModelsResponse` repeated at
  `:166,191,237,255,277`; `"/openrouter/v1"` hardcoded at `:57` and `:179` **while `:201` derives it**.
- `audio-extraction.test.ts` — `writeSourceVideo` + `stubFfmpeg(succeed)` in 6 tests
  (`:201,211,220,233,248,263`).
- `transcription.test.ts` — `interceptTranscription(...)` in 12 tests; `:41` carries a comment
  rationalising a `test.each` breach rather than fixing it.
- `openrouter.integration.test.ts` — mock pair restated 7× (`:182,200,217,230,241,271,281`) despite the
  helper at `:96`.
- **Cross-suite** — `TRANSCRIPT_TEXT` is one fact with three different values
  (`transcription.test.ts:37`, `transcription.integration.test.ts:22`, `transcript-structuring.test.ts:38`);
  the OpenRouter `"test-key"` env stub in two suites; the nock arm/disarm block 3×
  (`config.integration.test.ts:135`, `openrouter.integration.test.ts:102`,
  `transcript-structuring.integration.test.ts:54`); the ffmpeg `sine=frequency=440` + `FIXTURE_SECONDS`
  pair in two suites.
- **Missing `test.each`** — `runner.integration.test.ts:219-237` vs `:239-257`, and `:502-513` vs
  `:515-523`; `runner.test.ts:29-33` vs `:35-39`; `transcription.test.ts:174-181` vs `:183-189`;
  `transcript-structuring.test.ts:199-205` vs `:207-213`; `openrouter.integration.test.ts:140/146`,
  `152/158`, `164` vs `174`; `config.integration.test.ts:298-303` vs `:305-312`.
- **AAA breaches** — `runner.integration.test.ts:368-382` interleaves arrange and act twice;
  `source-normalisation.integration.test.ts:120-125` hides the Act inside `expectNormalisationToAbort`,
  invoked in assert position at `:280`, `:478`.
- **Positional params against the options-object rule** — `source-normalisation.integration.test.ts:97`
  `writeLecture(video, slide)`; `runner.integration.test.ts:112` `outcome(stageId, entry)`.
- **Mysterious names** — `runner.integration.test.ts` `outcome`, `logged`, `existence`, `output`
  (`:112,125,422,757`); `config.integration.test.ts:88` `stageModelIds` returns the whole stages record.
- **Test naming** — clean. Every `it` fits "should … when …" across all 14 suites.

### Utils, types, fixtures

**Hard violations**

- **Snapshot tests on behaviour** — `cost.test.ts:349,506,588` use `toMatchSnapshot()` on rendered
  report text, backed by `src/utils/__snapshots__/cost.test.ts.snap`. `CLAUDE.md`: "NEVER use snapshot
  tests for UI or behaviour — use them only for serialisation format regression."
  **Contested:** all three snapshot *formatting* functions whose whole job is a fixed text layout, so
  there is a real argument they are serialisation-format regression tests. Owner's call.
- **Untested exported functions** — `files.ts:15,59,70,124` (`readDirSafe`, `listFileNames`,
  `listSubdirectoryNames`, `produceFileAtomic`) have no unit tests, against "MUST write unit tests for
  all new functions and modules".
- **Stale TSDoc from the British-date rewrite** — `date.ts:335-338` still says a date is "accepted only
  when chrono is certain of both the day and the month", now false since numeric spans set
  `confident: true` at `:248` without chrono. `:354-357` likewise.
- **Rule Zero** — `cost.ts:307-323` and `:343-355` inline column widths twice each (`24,26,7` and
  `26,22,8`) plus hand-computed rule widths `57`/`67`, `56`/`66`, **while sections 4 and 5 do it
  correctly** with `RUN_SUMMARY_WIDTHS:419` and `BATCH_SUMMARY_WIDTHS:553`. `.padEnd(26)` at `:369` is a
  third copy; `?? "—"` at `:242,244,369` a third copy of the placeholder.
- **Rule Zero** — `cost.ts:568-570` `basename(resolve(workspaceRoot, "..", ".."))` re-implements
  `layout.ts:72-74` `moduleRootOf`, and the comment admits it.
- **Rule Zero** — `.replace(/\s+/g, " ").trim()` three times: `date.ts:373`, `naming.ts:131`, `:160`.
- **Rule Zero** — `fixtures.ts:136-144` constructs `new URL(exampleConfig.openRouter.baseUrl)` five
  times; `:528-530` vs `:337-339` rebuild `${folderName}.mp4`/`.pdf` despite `TestLecture.videoFile` /
  `slideFile` / `outputFile`; `:487` vs `:522-523` repeat
  `join(moduleDirs({moduleRoot}).processing, folderName)`.
- **Optional fields implying different runtime behaviour** — `StageParams:66-71` (`concurrency?` and
  `maxIterations?` each apply to exactly one stage); `RunOptions:536-553` (`continueOnError?` flips
  failure handling, `concurrency?` is batch-only per its own comment).
- **`cost.test.ts`** — four tests of identical structure differing only by input at `:82-149`
  (needs `test.each`); identical call setup repeated 5× at `:415,429,443,465,505` and again `:561-588`
  (needs `beforeEach`); `{promptTokens:100,completionTokens:50,callCount:1}` ×4 and `{200,80,2}` ×5
  restated despite `resolved():152`; `0.74` restated at `:323,327` after `GBP_PER_USD:40`.
- **`files.ts:246-249`** — `@param` text duplicates `ManifestPathQuery:234-238` verbatim.
- **`progress.test.ts`** — duplicated structure at `:12-24` (needs `test.each`);
  `createParallelWorkBar` + `start()` restated 5× at `:47,57,69,81,97`; `24` six times.
- **`files.integration.test.ts:16-22` vs `logger.integration.test.ts:28-34`** — identical temp-dir
  `beforeEach`/`afterEach` pair differing only by prefix.

**Judgement calls**

- `naming.ts:44` — `/\bBOD[_ ]+/g` hardcodes one module's prefix inside a general utility. Belongs in
  config.
- `naming.ts:172` `LectureIdentity` collides with `pipeline.ts:278` `LectureIdentity` under the same
  name with different fields.
- `naming.ts:166` throws a bare `Error` where `errors.ts:7` `NamedError` exists.
- `RunLogCost:472-475` is a second, weaker representation of `StageCost:56-63`, dropping
  `costResolutionError`.
- `RunSummary:577` carries no lecture or module identity, which is what forces the path surgery at
  `cost.ts:568` — Feature Envy.
- `cost.ts:366-381` `experimentSection` hand-builds padded lines instead of using `renderCostTable`.
- `cost.ts:253-259` `manifestStageMeta` only reshapes `manifestStageOutput` and has one caller.
- `cost.ts:210` `stageId: string` from `Object.entries` loses `StageId`, so `:344` prints a raw id where
  `:308` prints a label.
- `cost.ts:80` exported `stageLabel` is bypassed by its own file (`:308`, `:525` index `STAGE_LABELS`
  directly).
- `cost.ts:269-277` `PresentedAt` / `ManifestReport` generics wrap a single field.
- `cost.ts:520-531`, `:336`, `:611` mutate an accumulator inside `.map`/loops.
- `progress.ts:85` inlines an upload format while `:11` names the parallel one; `:47`
  `formatUploadValue` is exported only for its test.
- `files.ts:185` uses `(error as {code?: unknown}).code` rather than `in` narrowing; `:42`
  `readEntryNames` is the file's only undocumented private function.
- `date.ts` — `match[N] as string` at `:263,268,326`; `:321-327` hand-rolls the span construction
  `claimedSpans:244-249` already does.

---

## Spec

### Filed as GitHub issues

1. **#1 — Skipped stages downgrade the manifest status, re-billing every third run.** Verified.
2. **#2 — `--from-stage` deletes the module-wide `Final output/`, taking every lecture's PDF.** Verified,
   latent until Stage 8 ships.
3. **#3 — `currentPipelineCost` survives `--from-stage`, over-reporting deleted work.** Verified.

### Unfiled

- **Stages 1–3 do no logging at all.** TD §10 requires `logger.child({ stage: stageId })` per stage and
  a debug-log line for every LLM call (model, prompt token count, latency ms). Only Stage 0 takes a
  logger (`source-normalisation.ts:582-588`). `createPipelineStage` has no logger parameter and neither
  does `makeCompletionCall`'s documented signature — so the required logging has **no home in the
  designed API**, not merely no implementation. Settle before Stage 4 adds a fourth stage with the same
  gap.
- **Stage 0 logs less than specified — partial.** TD §5 (line 679) asks for every action at `info`:
  files discovered, dates extracted, numbers assigned, matches. `source-normalisation.ts:594-597` logs
  counts only. Renames (`:626-628`), reconciliation (`:630-642`) and deletions (`:432-441`) are present.
- **Stage 3 cleans `.tmp` after the billable call.** TD §4.3 (line 290): "At the start of every stage
  run". `transcript-structuring.ts:331` makes the LLM call first; cleanup runs inside
  `writeStructuredTranscript` at `:342`. Stages 1 (`audio-extraction.ts:141`) and 2
  (`transcription.ts:270`) do it correctly, before ffmpeg and before upload.
- **`cost-report` does not aggregate — partial.** TD §7: "aggregates all run logs across the configured
  `moduleRoots`… With no flags, aggregates across everything." `runner.ts:851-870` prints a separate
  three-section report per lecture; `formatCostReport` (`cost.ts:395`) takes a single manifest and
  cannot aggregate. No cross-lecture or cross-module total exists.
- **Error-recovery section misses the original failure.** `cost.ts:337` filters `runType:
  "error-recovery"` only, but TD §7's Run Classification table types the first failed run as `normal` —
  so "Wasted on failures" reads £0.000 in exactly TD's own worked example.
- **Debug log lands in the CWD, not the workspace.** TD §10: written "alongside the structured run log";
  §3.3 puts `runs/` inside the lecture workspace. `run-cli.ts:56-59` passes the bare string `"runs"`, so
  it lands in the process working directory. `commands.ts:213` then tells the user to look "under
  `runs/`".
- **`classifyRunType` adds unspecified cases.** TD §7's table covers `failed`/`running` →
  `error-recovery` and `complete` → `experiment`. `runner.ts:106` also treats `skipped` as `experiment`
  and `pending`/absent as `error-recovery`; neither is specified.
- **Undocumented export.** TD §4.7 (lines 582-591) declares `lecture-files.ts` as exactly `findDatedFile`
  and `renameLectureFiles`. `lecture-files.ts:40` also exports `baseNameForLecture`, consumed by Stage 3
  (`transcript-structuring.ts:197`). Real and useful — the doc should list it.

**No scope creep was found in the four built stages.**

### Documentation to reconcile (code is right, docs are stale)

- **The `QA checked/` rename landed in three of six places.** §3.3 (lines 170-178) and `layout.ts:199`
  say `QA checked/`; §5 Stage 7 (line 939), §5 Stage 8 (line 976) and the §4.5 manifest example
  (line 430) still say `Output/notes.md`. Both Spec agents found this independently. Fix before Stage 7
  is built.
- **TD §5 Stage 0 step 1** (line 663) still says parse dates "using `chrono-node`", contradicting §3.2
  (line 87). Code follows §3.2.
- **TD §10 Output Streams** lists unmatched source files as a stderr *warning*, contradicting §5
  (line 658), which makes an unmatched video or slide a stop-the-run error. Code follows §5
  (`source-normalisation.ts:139-148`).
- **TD §4.2** describes `isComplete()` as checking that "the manifest marks the stage `'complete'`",
  while the status table at lines 282-286 defines `skipped` as output that already existed from a prior
  run. Those two sentences together are what produced issue #1. See that issue for the resolution.

---

## Method notes

- The whole-tree scope needed five area-scoped agents rather than the skill's two. One agent per 8k
  lines returns shallow findings.
- Sub-agents mis-report their own coverage. The pipeline Standards agent claimed its delegated test
  audit "never returned" and characterised the suites as well-factored from a sample, while that audit
  had in fact returned an exhaustive list of duplication. Prefer the exhaustive child over the sampling
  parent.
- Three Spec findings were re-verified by hand against the code before filing. That was worth doing:
  one of them (#2) lands on a deliberate design decision and needed its framing corrected before it
  could be filed honestly.
