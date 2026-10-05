# Lecture Notes Generator — Implementation Plan

**Suite version:** 1.68-draft — shared across requirements, technical design, and implementation plan; any substantive edit to any of the three bumps this number in all three
**Date:** 2026-10-03
**Status:** For review

---

## Overview

The pipeline is built in twenty phases. Phases 1–3 establish the project scaffold and shared infrastructure before any stage code is written. Phases 4–7 implement the stages from `source-normalisation` to `transcript-verification`. Phases 8–14 divide the transcript: two groundwork phases, then the stages that split it, choose a division, retitle its subtopics and group them, all running after transcription with every existing stage unchanged. Phases 15–19 implement the remaining stages in pipeline order. Phase 20 validates the full pipeline end-to-end against a real lecture.

Testing is not a final phase — unit tests are written alongside each deliverable per the project conventions. Integration tests are noted explicitly where unit testing alone is insufficient.

Cross-references to the technical design are noted as **(TD §N)**.

**CLAUDE.md is the single source of truth for development conventions.** Every rule in `/CLAUDE.md` — TSDoc, `Promise<T>` return types, named exports, `type` aliases, typed catches, immutability, DRY, atomic commits, etc. — applies to every deliverable in this plan and MUST be applied during development, not left to the pre-commit checklist. Rules are not restated per phase.

**Tooling that belongs to no phase.** `scripts/audit-constants.mjs` is a maintenance scanner, not a pipeline deliverable. It lexes the tree and tallies repeated string and numeric literals so a value living in two places can be found and given one, which is a whole-tree question no phase can answer for itself. It was written mid-project, is run on demand as `pnpm audit:constants` rather than by the gate, and carries its own two suites — the first tests in this repo to live outside `src/`.

**Each fact has one home.** This plan owns build order, per-phase deliverables, acceptance criteria, and test intent. It does not restate design: stage behaviour, contracts, and data shapes live in the technical design (referenced as **(TD §N)**), and exact type definitions live in `src/types/*` once written — the TD references those too rather than reproducing them. A phase that needs a design detail links to it; it never copies it. Test names may echo the behaviour they verify: the executable spec follows the design, as it should.

---

## Phase 1 — Project Scaffolding

**Goal:** Establish the correct project structure before any feature code is written.

**Deliverables:**
- `tsconfig.json` — strict mode, `"types": ["node"]`, `moduleResolution: "bundler"`
- `biome.json` — formatting and standard linting rules, `noDefaultExport` enforced
- `eslint.config.js` — architectural rules (no cross-feature imports, restricted imports)
- `package.json` — all dependencies installed; scripts for `typecheck`, `lint`, `test`, `setup` (the last aliases `scripts/setup`)
- Directory skeleton: `src/types/`, `src/pipeline/stages/`, `src/utils/`, `docs/`, `bin/`, `scripts/`
- `pipeline-config.example.json` — the tracked template, carrying placeholder model IDs **(TD §6)**. The working `pipeline-config.json` is a copy of it that the user fills in, and is gitignored: it holds absolute paths to that user's module folders and the model IDs and rates they are actually paying for, none of which belongs to anybody else's clone
- `vitest.config.ts` — test discovery, and the coverage thresholds the gate enforces
- `.jscpd.json` and `.jscpd.tests.json` — the duplication gate, run as two passes because test code tolerates a lower token floor than production code
- `.secretlintrc.json` — the secret scan the gate runs before anything else
- `.npmrc` and `pnpm-workspace.yaml` — pnpm's install-time behaviour: no `packageManager` pin written on install, and the build approvals for the packages with native install steps
- `.gitignore` updated to include `.env`, `.claude/`, `CLAUDE.md`, `*.log`, test output folders (`.claude/` and `CLAUDE.md` per CLAUDE.md §Version Control)
- `bin/lecture-notes` — executable bash wrapper (`chmod +x`) that `cd`s to the repo root and `exec pnpm exec tsx src/index.ts "$@"`. Live TypeScript, no build step. Runs from any directory once the user's shell has the repo's `bin/` on `PATH`
- `scripts/setup` — executable bash script (`chmod +x`) that performs two idempotent installs:
  1. Appends a PATH export to the user's shell config (`.zshrc` / `.bashrc` / `config.fish`) so `lecture-notes` is on `PATH`. Marker-comment skip on re-run; read-then-append only (never overwrites)
  2. Merges the hook block from `scripts/claude-hooks.json` into **`.claude/settings.local.json` inside the repo** (Claude Code's per-user, per-repo settings file — gitignored by default via the existing `.claude/` rule; hooks fire only for Claude Code sessions in this project, never globally). Existing keys preserved (deep merge — e.g. any `permissions.allow` already present is untouched); re-runs strip every hook whose command is one the template installs before re-inserting the template entries, so a human hand-editing the file to add unrelated hooks isn't clobbered. Dedupe is on the **command string**, which is what survives a rewrite: Claude Code rewrites this file and drops keys it does not recognise, so a marker key of our own would be gone by the next run. Uses `node -e '<merge script>'` (jq is not a hard dependency)
  Prints what was touched and the reload command. Users invoke it once via `./scripts/setup` or `pnpm setup`
- `scripts/claude-hooks.json` — template describing this project's Claude Code hook configuration (committed to the repo — a normal file, not under `.claude/`, so unaffected by the gitignore rule). Five hooks, two that check and three that block:
  - **PostToolUse matcher `Edit|Write|MultiEdit`** → the hook command invokes `scripts/hooks/post-edit-biome`, which reads the tool-call JSON from stdin, extracts `.tool_input.file_path`, and runs `pnpm exec biome check --write <file>` on it. Fast fixup, no cross-file false positives (eslint deliberately omitted — its architectural rules only make sense against the whole tree)
  - **PreToolUse matcher `Bash`** → the hook command invokes `scripts/hooks/pre-commit-check`, which reads `.tool_input.command` from stdin, no-ops unless the command is a `git commit`, then runs the gate: `check:secrets`, `check:veraignore` (Vera reads `.veraignore` instead of `.gitignore`, so the first must repeat every pattern of the second or `.env` is indexed), `check:format`, `check:types`, `check:lint`, `check:duplication`, `check:duplication:tests` and the suite with coverage, the file-based ones narrowed to what changed. Any failure → the script exits `2`, which Claude Code treats as a block-with-feedback (stderr is fed back into the conversation). Whether a command *is* a commit is decided by lexing it rather than by matching the substring `git commit`, so `git -C . commit` cannot slip past. On a pass it prints one line — tests, test files and line coverage, read from the test run's own output by `scripts/hooks/lib/gate-summary.mjs` — as a `systemMessage` for the user and `additionalContext` for Claude, because Claude Code shows a passing hook nothing, and a silent pass cannot be told from a hook that never ran. It sets no permission decision, so the commit keeps its normal permission prompt
  - **PreToolUse matcher `Bash`** (second hook on the same matcher) → `scripts/hooks/block-bash-grep`, which refuses `grep`/`rg`/`ag` and their relatives over files in this repo, so code search goes through the Vera index (CLAUDE.md § Code Search)
  - **PreToolUse matcher `Grep`** → `scripts/hooks/block-grep`, the same rule for the built-in tool
  - **PreToolUse matcher `WebFetch|WebSearch`** → `scripts/hooks/block-webfetch`, so web lookups go through the configured MCP tools
  - All three blocking hooks share one escape hatch, `scripts/hooks/lib/tool-override.mjs`: a one-line reason written to `.claude/tool-override` waives the next block, once, and stays in the transcript

**How far the commit gate reaches — decided 2026-08-22.** Every check above is a Claude Code hook, installed into `.claude/settings.local.json`, so **the gate covers commits made from a Claude Code session in this repository and nothing else.** `.git/hooks/` holds only git's own `.sample` files and `core.hooksPath` is unset, so a commit made from a terminal, an IDE, or any other tool runs no checks. The consequence to hold on to is that **a commit that did not come from a session has not been through the gate.** `pnpm check` runs the identical checks over the whole tree on demand, and is the way to find out what the gate would have said.

**Dependencies installed:**
- Runtime: `openai`, `@elevenlabs/elevenlabs-js`, `fluent-ffmpeg`, `pdfjs-dist`, `canvas`, `sharp`, `chrono-node`, `pino`, `cli-progress`, `@inquirer/prompts`, `dotenv`
- Dev: `typescript`, `tsx`, `@biomejs/biome`, `eslint`, `typescript-eslint`, `vitest`, `@vitest/coverage-v8`, `nock`, `@types/node`, `@types/fluent-ffmpeg`, `@types/cli-progress`
- Dev, one per gate check that is not a compiler or a test runner: `secretlint` with `@secretlint/secretlint-rule-preset-recommend`, `jscpd`, and the ESLint plugins the architectural rules are written against — `eslint-plugin-import` with `eslint-import-resolver-typescript`, `eslint-plugin-jsdoc`, `@vitest/eslint-plugin`

**Acceptance:**
- `tsc --noEmit`, `biome check`, and `eslint .` all pass on the empty project skeleton
- After `./scripts/setup`: `lecture-notes --help` runs from any directory; a deliberately mis-formatted `Edit` triggers biome auto-fix via the PostToolUse hook; a `git commit` attempt with a tsc error is blocked by the PreToolUse hook

---

## Phase 2 — Shared Types and Utilities

**Goal:** Define all contracts, utilities, and client infrastructure that stages and the runner depend on.

**Deliverables:**

- `src/types/pipeline.ts` — every shared type, `STAGE_IDS`, the ordered stage list `StageId` is derived from, and `CONFIG_FILENAME`, the configuration file every layer names **(TD §4.1, §4.2, §4.7, §6)**. Covers the stage contracts (`PipelineStage`, `StageContext`, `StageResult`, `StageCost`, `StageRunConfig`, `StageStatus`), the persisted shapes (`Manifest`, `StageEntry`, `RunLog`, `RunLogStageEntry`, `RunLogCost`, `RunType`), config (`PipelineConfig`, `StageConfig`), QA (`QaDeficiency`, `QaCheckerReport`, `QaDeficienciesReport`, `QaSourcePassage`, `QaConsideration`), and the runner-facing `LectureMatch`, `RunOptions`, `BatchOptions`, `ReportOptions`, `RunStageOutcome`, `RunSummary`, `BatchSummary`, with `DEFAULT_RUN_OPTIONS` and `DEFAULT_BATCH_OPTIONS`
- `src/pipeline/layout.ts` — the filesystem vocabulary, declared once: `moduleDirs`, `datedFileDirs`, `workspaceRootFor`, `moduleRootOf`, `moduleName`, `MANIFEST_FILE`, `RUNS_DIR`, `runsDirPath`, `debugLogPath`, `STAGE_FILES`, `StageWithOutputFile` and the `stageOutputEntry` that admits only those stages, `stageOutputPath`, `resolveStageOutput`, `stageDirectoryPaths` **(TD §3.3, "The layout has one owner")**. Every stage, the runner, the CLI, and the fixtures take directory and file names from here; no other module states one as a literal
- `src/utils/files.ts` — `writeFileAtomic`, `writeJsonAtomic`, `readJsonSafe`, `cleanTmpFiles`, `pathExists`, and the directory reads `readDirSafe`/`listFileNames`/`listSubdirectoryNames` **(TD §4.3)**
- `src/pipeline/workspace-paths.ts` — `workspacePath` and `resolveManifestPath` with its `ManifestPathError` **(TD §4.4)**; apart from the conveniences above because a mistake here is a path escaping the module tree rather than an inconvenience
- `src/utils/logger.ts` — `createRootLogger`, `createStageLogger` **(TD §10, Logging and Progress Helpers)**
- `src/utils/date.ts` — `extractDate`, `formatDateISO`, `isCalendarDate` **(TD §3.2, Date and Naming Helpers)**
- `src/utils/naming.ts` — `extractProvisionalTitle`, `lectureFolderName`, `lectureBaseName` **(TD §3.2)**; `filenameSafe` and the `EmptyNameError` it raises **(TD §4.4)**
- `src/utils/progress.ts` — `createProgressBar` and `createUploadProgressStream` **(TD §10)**. `createUploadProgressStream` moves out of `src/index.ts`. `createParallelWorkBar` is specified in TD §10 but built in Phase 15, with the first stage that calls it
- `src/utils/cost.ts` — `accumulateCost`, the arithmetic alone **(TD §7)**
- `src/pipeline/reports.ts` — `createMoneyFormatter`, `formatCostReport` and the table engine beneath them **(TD §7, Cost and Reporting Modules)**
- `src/utils/stage-id.ts` — `isStageId`, `unknownStageMessage`: recognising a stage name and reporting one that is not, for the stage flags and the config keys alike; `isStageAfter`: one stage's position against another's in `STAGE_IDS`, asked by the CLI refusing a `--to-stage` before `--from-stage` and by the runner stopping at the bound **(TD §6; §4.7)**
- `src/utils/model-id.ts` — `splitModelId`: a model ID's provider and its name, read by the provider exemption and by `transcription`, which want opposite halves **(TD §6; §5, `transcription`)**
- `src/utils/language.ts` — `isOutputLanguage`, `unknownLanguageMessage`, `languageRule`: recognising a configured language, reporting one the pipeline cannot write, and wording the instruction every prose stage's prompt gives the model **(TD §6)**
- `src/utils/record.ts` — `isRecord`: whether a parsed value has fields to read, shared by every check over something parsed from outside the pipeline — the config file, a manifest, a model's reply **(TD §6; §4.4; §7)**
- `src/utils/text.ts` — `collapseWhitespace`: closing up the gaps that removing a fragment leaves, which both the naming rules and the date reader end by doing **(TD §3)**; `pluralise`: a count and its noun agreeing with each other, for every place that tells the user how many of something there are
- `src/utils/stage-config.ts` — `configuredStage`, `unconfiguredStageMessage`: a stage's entry in the config file and the sentence reporting its absence, for the OpenRouter client, `transcription` and the runner alike **(TD §6)**
- `src/pipeline/config.ts` — `loadConfig`, plus the model-ID resolution check and its provider exemptions **(TD §6)**
- `src/pipeline/openrouter.ts` — `createOpenRouterClient`, `callModel`, and the exported `UnconfiguredStageError`, `ContextLengthError`, `ProviderError` and `NoReplyChoicesError` **(TD §6)**
- `src/pipeline/fixtures.ts` — the shared test vocabulary: the example lecture and its derived file names, the module tree builders, the stub logger, the manifest and stage-entry builders. It belongs to this phase because it is what stops each later phase's suites inventing their own lecture, but it is the one deliverable that keeps growing: a phase that needs a fixture the suites will share extends this module rather than restating the value. Production code never imports it, which `eslint.config.js` exempts it in order to allow — it is the one file under `src/pipeline/` permitted to import from `src/pipeline/stages/`

**Tests:**

`date.ts`, `naming.ts` — unit tests using `test.each`:
- `should extract correct date when filename format is [format]` — parametrised across: `2025-10-10 BOD_...`, `10 Oct 2025 ...`, `Fri 10th Oct ...`, filename with no date (expect `null`)
- `should extract provisional title when filename is [sample]` — parametrised across samples covering a full descriptive title, a module-code prefix, trailing artefacts, day names, and a minimal date-plus-number filename
- `filenameSafe` — `test.each` covering path separators, `..`, `.`, null bytes, control chars, whitespace-only input, trailing dots, and empty result (expect throw)

`layout.ts` — unit tests, since every answer is derived from a path and a stage id:
- `should describe every stage when the pipeline is enumerated` — the map covers `STAGE_IDS` and no more
- `should root every directory but pdf-generation's in the workspace when ownership is read`
- `should resolve back to the module when a workspace beneath it is given` — `moduleRootOf` against `moduleDirs`, and `should invert workspaceRootFor when a workspace it built is given`
- `should place a lecture's workspace under the module's processing directory when it is named` — `workspaceRootFor`
- `should give the directories a lecture's own files sit in when a module is given` — `datedFileDirs` names three of the four, the workspace excluded
- `should resolve the run logs under the workspace when a workspace is given` — `runsDirPath`
- `should place the invocation's debug log under the project root when a run is identified` — `debugLogPath`, anchored to the project rather than to any one workspace
- `should fail when the stage writes no single output file` — the stages whose `outputFile` is `null`

`model-id.ts` — unit tests:
- `should read the provider as $provider when $scenario` — `test.each` over a qualified ID, an unqualified one (a `null` provider, so no exemption list can hold it), and one carrying a further segment (the split is on the first separator)

`record.ts` — unit tests:
- `should accept the value when $scenario` / `should reject the value when $scenario` — `test.each` over an object with fields and one without, against `null`, an array, a string, a number, a boolean and an absent value

`stage-config.ts` — unit tests:
- `should give the stage's configuration when the file configures it` / `should give nothing when the file configures no such stage`, and `should name the stage and the file to edit when a stage is unconfigured`

`text.ts` — unit tests:
- `should read $expected when $scenario` — `test.each` over a run of spaces, whitespace that is not a space, whitespace at either end, the gap a removal leaves, text already correctly spaced, and text that is nothing but whitespace

`files.ts` — integration tests (real temp directory):
- `should write file and remove .tmp when write succeeds`
- `should leave no partial file when write fails`
- `should delete all .tmp files when cleanTmpFiles called`
- `should write the value as indented JSON when a value is given` — and the same no-partial-file rule for `writeJsonAtomic`
- `readJsonSafe` — the parsed value, and `null` for a file that is absent and one that is not JSON

`workspace-paths.ts` — one suite, since the trusted resolver needs no filesystem and the untrusted one needs a real symlink:
- `workspacePath` — `test.each` over segment lists, including the empty one
- `resolveManifestPath` — `test.each` covering: in-workspace path (accepted), `..` escape into `Final output/` under moduleRoot (accepted), `..` escape outside moduleRoot (rejected), symlink pointing outside moduleRoot (rejected after realpath), absolute path (rejected)

`cost.ts` — unit tests:
- `accumulateCost` — `test.each` across combinations including zeros and unresolved costs

`reports.ts` — unit tests:
- `should render a stage's cost as n/a when its lookup failed` — and `should leave a stage out when it names no model`, the two rules every section applies
- `formatCostReport` — snapshot test (serialisation format regression only)

`progress.ts` — unit tests driving the bar through its control methods:
- `should list picked ids in the in-flight suffix when workers pick up items`
- `should advance the value and drop the id from in-flight when an item completes`
- `should highlight the id with a red control sequence when an item fails`
- `should pass bytes through unchanged and advance the bar when data flows` — the upload stream

`logger.ts` — integration tests, because the point of the module is a file on disk:
- `should write a JSON debug log named for the timestamp when the root logger logs`
- `should bind the stage id to every entry when a stage logger logs`

`config.ts` — HTTP interceptor tests using `nock`:
- `should throw ConfigError naming the offending stage when a configured modelId is not in the OpenRouter models response`
- `should throw ConfigError with a helpful hint when a placeholder like <REASONING_MODEL> is left un-substituted`
- `should accept the config when every stage modelId appears in the OpenRouter response`
- `should build no client when a provider is made without an API key` — the commands that reach no model must run without one, so making the provider must not build a client

`openrouter.ts` — HTTP interceptor tests using `nock`:
- `should send correct baseURL, headers, and model ID when callModel invoked`
- `should record the cost and token counts the reply carries when a call completes`
- `should return the reply and record the cost as unresolved, saying why, when $scenario` — `test.each` across a reply whose usage carries no cost, a cost that is a string, null or an object, usage that is not an object, and no usage at all
- `should retry completion call with exponential backoff when response is 429`
- `should throw typed ContextLengthError when model returns context length exceeded`
- `should throw after 120s when completion request times out`

`openrouter.integration.test.ts` intercepts with `nock` like the unit tests above. CLAUDE.md § Testing requires every external service to be mocked, so every suite here runs for anyone who clones the repo, with no key and no spend. `transcription`'s integration test is built the same way: a real file streamed through the real SDK, against a stubbed endpoint.

**Acceptance:** All unit and integration tests pass; `tsc --noEmit` clean.

---

## Phase 3 — Pipeline Runner and CLI Entry Point

**Goal:** Orchestration layer that drives stages through their full lifecycle. Built against stub stages to verify correctness before any real stage is implemented.

**Deliverables:**

`src/pipeline/runner.ts` — the `PipelineRunner` class and its supporting module-level functions (`runStage`, `assembleContext`, `updateManifest`, `deriveRunId`, `decideRunType`). Full surface and behaviour in **TD §4.7**.

`src/pipeline/manifest.ts` — where `manifest.json` lives, how it is read and atomically written, and the schema version it is stamped with: `MANIFEST_VERSION`, `pendingStages`, `manifestPath`, `ManifestUnreadableError`, `ManifestNotJsonError`, `ManifestShapeError`, `readManifest`, `readManifestSafe`, `writeManifest`, `patchManifest`. Extracted because `source-normalisation`, the runner, and the CLI all touch it (**TD §4.5**).

`src/pipeline/run-status.ts` — the shared rule reducing stage and lecture outcomes to an `OverallStatus`: `stageOutcomeStatus`, `summariseOverallStatus`, `summariseLectures`, `hasSettledOutput` (**TD §4.7**).

`src/cli/run-reporter.ts` — `createRunReporter`: the wording of the notices a run writes as it goes, one per stage, built over the `RunEvent`s the runner reports (**TD §10**).

`src/index.ts` and `src/cli/` — the CLI. Invoked in docs and examples as `lecture-notes <cmd>` via the `bin/lecture-notes` wrapper installed by `scripts/setup`. During dev without the wrapper, equivalent to `pnpm exec tsx src/index.ts <cmd>`.
- Commands: `run <date>`, `batch [<moduleRoot>]`, `cost-report [--date <YYYY-MM-DD>] [--module <moduleRoot>]`
- Flags: `--from-stage <stageId>`, `--to-stage <stageId>`, `--concurrency N`, `--continue-on-error`
- The identity-mutation commands (`rename`, `delete`, `change-date`) land with this deliverable too
- Behaviour of each — the module layout, the multi-match picker, batch scope, what `--from-stage` resets and deletes, where `--to-stage` stops the run, exit codes, and how each mutation leaves the module for `source-normalisation` to finish — is specified in **TD §4.7**

`formatRunSummary` and `formatBatchSummary` in `src/pipeline/reports.ts` — the end-of-run and batch summaries the CLI prints (**TD §7**). Neither sums anything: the run summary ends at its last stage row, and the batch table shows lecture counts and status without a money column.

**Tests:**

Runner lifecycle — integration tests (real temp directory with fixture manifests and stub stages):
- `should transition stage status to complete when stage run succeeds`
- `should transition stage status to failed when stage run throws`
- `should mark the stage running on disk before it begins when a stage runs`
- `should log the failure with its stack against the stage when a stage throws`
- `should mark stage skipped when isComplete returns true before run`
- `should execute the stage once when the same lecture is run three times` — driven through the real
  `isStageComplete` rather than a stub, and three runs rather than two: the second run is what records
  `skipped` over `complete`, and the third is what reads that back and decides whether to pay again
- `should keep the completion's time, settings, cost and files when a skip follows a skip`
- `should run the stage again when its output is deleted after repeated skips`
- `should record not-reached in run log when upstream stage fails`
- `should reset nominated stage and all downstream stages to pending when --from-stage invoked`
- `should leave upstream stages untouched when --from-stage invoked`
- `should run no stage after the nominated one when --to-stage is given`
- `should leave the stages beyond the bound pending when --to-stage is given` — nothing is reset and
  nothing deleted, so a bounded run leaves the lecture resumable rather than finished
- `should record the bound in the run log when --to-stage is given`
- `should report success when --to-stage stopped the run short of the last stage`
- `should run no lecture stage when --to-stage names a stage before them all` — the bound is a position
  in `STAGE_IDS`, not a name matched against the stages the runner happens to hold
- `should create timestamped run log file in runs/ for each invocation`
- `should classify the run as $expected when from-stage targets a stage $state` — parametrised across
  every state the target can be in, so the run log's `runType` and TD §7's classification table stay
  exhaustive against each other

`assembleContext` — unit test:
- `should assemble StageContext from manifest fields and CLI options`

`resolveLecturesByDate` — integration tests (real temp directory with two fixture module trees):
- `should return empty array when no manifest matches the date`
- `should return single match when only one module contains the date`
- `should return all matches when the date appears in multiple modules`
- `should include moduleRoot, workspaceRoot, lectureNumber, and lectureTitle in every match`
- `should skip the module when its directory holds no Pipeline processing folder` — a module the pipeline has never run over is walked past, not an error

`countLectures` — integration tests, over the same module trees:
- `should count the lectures a batch would cover when the modules are measured` — one count covers both things the scan walks past, the manifest-less folder and the unprocessed module
- `should count none when the modules hold no lecture`

Manifest I/O and run status — integration and unit tests:
- `should return null when the manifest is missing` / `when the manifest is malformed`
- `should leave no temporary file behind when the write succeeds`
- `should report success when a stage was skipped because its output already stood`, and when a stage was never reached; `failed when any part failed`

CLI argument parsing — unit tests (no filesystem, no runner):
- `should carry every run flag when they are all supplied`
- `should reject the invocation when the date names a day the month does not have`
- `should reject the invocation when %s names no known stage` — parametrised across `--from-stage`
  and `--to-stage`, which are validated the same way and must report themselves by their own name
- `should reject the invocation when --to-stage precedes --from-stage`
- `should accept the pair when both flags name the same stage` — the bound is inclusive at both ends,
  so a single-stage run is what naming one stage twice means
- `should reject --concurrency when it is zero` (and when fractional, negative, or not a number)
- `should reject $flag when the command does not take it` — parametrised across every command/flag pair the usage lines exclude

CLI prompts — unit tests with `@inquirer/prompts` mocked:
- `should label every match with its module, number, and title when prompting`
- `should return every match when the user chooses all matches` / `nothing when the user cancels`
- `should offer no all-matches choice when prompting` — the single-choice picker the identity mutations use

Identity commands — integration tests (real temp module tree with sources, workspace, and PDF):
- `should record the new title as the user's own when renaming`
- `should remove the source video and slide when deleting`
- `should rename the source video and slide to the new date when changing the date`
- `should reject the change when a source file already sits at the new date`

Command dispatch — integration tests (real manifests, stubbed runner and prompts):
- `should normalise every configured module before looking for the lecture when running`
- `should ask which lectures to run when several share the date`
- `should ask for one lecture only when $command.command is given the date` — parametrised across all three identity mutations
- `should report that nothing matched when no lecture carries the date`
- `should name only the module it searched when --module narrowed it and nothing matched` — the message reports the scope the search actually used, not the whole configuration
- `should not offer to run the pipeline again when no lecture carries the date` — `cost-report` only reads what has already run, so it offers no remedy that would spend
- `should name each failed stage and its error when a stage failed`
- `should leave the lecture in place when the deletion is declined`

End to end — integration tests through `runCli`:
- `should print the usage text without reading the config when help is asked for`
- `should report the problem plainly and fail when the config cannot be read`

**Acceptance:** Runner drives stub stages through all lifecycle states correctly; manifest and run logs written atomically to real temp directory; multi-module resolver returns correct matches for 0/1/N cases; every command dispatches, reports, and exits with the right code without a stack trace reaching the user.

---

## Phase 4 — `source-normalisation`

**Goal:** Reliable batch normalisation of source files. The most file-system-intensive stage — correctness here gates all downstream work.

**Deliverables:**

**TD §5, `source-normalisation`** in four files: date parsing, lecture numbering, slide-to-video matching and provisional titles in `src/pipeline/stages/source-normalisation/lecture-resolution.ts`; collision-safe renaming and interrupted-rename recovery in `src/pipeline/stages/source-normalisation/source-renames.ts`; the orphaned workspace direct-deletion guard (NFR-4.3) and workspace discovery in `src/pipeline/stages/source-normalisation/orphaned-workspaces.ts`; and in `src/pipeline/stages/source-normalisation/source-normalisation.ts` the order they run in, what aborting means, and workspace and manifest creation with renumbering on re-run.

The CLI identity-mutation commands that drive this same machinery — `rename`, `delete`, `change-date` (FR-6.7, TD §4.7) — are built with the CLI, not in this phase.

**Tests:**

Note: `extractDate` and `extractProvisionalTitle` unit tests are covered in Phase 2.

Unit tests (no directory tree — filenames in, answers out):
- `should read $iso off $name when the name carries a date`, and the undated counterpart
- `should pair each video with the slide sharing its date when every date matches`
- `should refuse the sources and say so when $problem` — `test.each` for: an undated video, an undated slide, two videos sharing a date, two slides sharing a date, a video with no slide on its date, a slide with no video on its date
- `should report every problem rather than the first when several sources are wrong`
- `should number lectures from one in date order when the listing is in another order`
- `should name a lecture from its number, title and date when it is new`, and by number and date alone when the filename yields no title
- `should take an existing lecture's name from its manifest title when it has been retitled`
- `should move a video and its slide onto the lecture's base name when they are freshly named`
- `should plan nothing when every item already sits at the name the numbering wants`
- `should move the workspace folder and the final PDF too when a lecture is renumbered`
- `should find the workspace whose date has no sources left when one is removed`, and `should list orphaned workspaces in date order when several workspaces have lost their sources`

Integration tests (real temp directory with fixture source files) — everything that only shows on disk:
- `should assign correct lecture numbers when lectures sorted by date` — `test.each` across straight sequence and mid-sequence insertion
- `should renumber all affected lectures when new lecture inserted between existing dates`
- `should match slide PDF to video when dates align`
- `should log an error and stop without filesystem changes when a source rule is broken` — `test.each` for: undated file, unmatched video, unmatched slide, duplicate video date, duplicate slide date
- `should rename source files atomically when normalisation runs`
- `should create workspace folder and write initial manifest when lecture is new`
- `should seed initial manifest with lectureTitle equal to provisionalTitle and userTitle and aiDerivedTitle null`
- `should name an existing lecture from its manifest lectureTitle when the title changed after source-normalisation`
- `should produce no filesystem changes when source-normalisation re-run on already-normalised sources`
- `should delete the workspace and its Final output PDF when an orphaned workspace is approved` — `test.each` for one orphaned workspace and for several all approved
- `should renumber the remaining lectures and log the prior number, title, and date when an orphaned workspace is deleted`
- `should abort without filesystem changes when a confirmation is declined` — `test.each` for: an orphaned workspace declined, the final confirmation declined
- `should not prompt when every workspace still has its source pair`
- `should restore a temporary source file to its target name when a previous run was interrupted` — and the same for a workspace folder
- `should abort without filesystem changes when a temporary file's target name is taken`

**Acceptance:** Given a folder of raw video and slide files, `source-normalisation` produces correct workspace folders, manifests, renamed source files, and handles mid-sequence insertion correctly.

---

## Phase 5 — `audio-extraction` and `transcription`

**Goal:** The first two `PipelineStage` implementations, and the first stages the runner drives end-to-end. Built from the contract, taking the proven API parameters from the `src/index.ts` prototype.

**Deliverables:**

`src/pipeline/config.ts` — three new required keys, `modelIdCheck.exemptProviders`, `elevenLabs.costPerAudioHourUsd`, and `currency.gbpPerUsd`, each specified in **TD §6**. `pipeline-config.json` gains all three plus a `transcription` stage entry.

`src/pipeline/reports.ts` — present all user-facing costs in pounds **(TD §7, NFR-2.3)**.

`src/pipeline/stages/pipeline-stage.ts` — the shared `isComplete` check and the stage factory every per-lecture stage is assembled through **(TD §4.2)**. Both stages need identical completeness logic, so it is written once.

`src/utils/files.ts` — `produceFileAtomic`, the caller-produces form of `writeFileAtomic`, needed because `audio-extraction`'s bytes come from ffmpeg rather than from memory **(TD §4.3)**.

`src/utils/errors.ts` — `errorMessage`, the narrowing every catch site repeats **(TD §8)**.

`src/pipeline/stages/audio-extraction/audio-extraction.ts` — the whole of **TD §5, `audio-extraction`**: locating the source video by workspace base name whatever its extension, the fluent-ffmpeg `-acodec copy` extraction and its progress bar, and the `.tmp`-sibling write. Makes no billable call, so its cost is `null`.

`src/pipeline/stages/transcription/transcription.ts` — the whole of **TD §5, `transcription`**: the Scribe v2 call and its parameters, stripping the provider prefix from the configured model ID, upload progress via `createUploadProgressStream`, and cost derived from audio duration × the configured rate.

Both are the first real `PipelineStage` implementations, so each defines its own `TInput`/`TOutput` pair.

**Tests:**

Config loader — integration tests:
- `should skip the OpenRouter check when a model ID names an exempt provider`
- `should still check a model ID when its provider is not exempt`
- `should throw ConfigError when a required currency or ElevenLabs field is missing or not a number`
- `should leave %s unset, and the rest of the stage alone, when it is written as null` — `test.each` over a stage's optional tuning fields, since `null` and an absent key both mean the parameter is not sent (TD §6)

Typed errors — unit tests:
- `should take its name from the concrete subclass when constructed` — the `new.target` capture in `NamedError`
- `should render $label when it is caught` — `test.each` over the values a `catch (e: unknown)` really receives: an `Error`, a `NamedError`, a string, a number, and `null`

Cost reporting — unit tests:
- `should render every figure in pounds when the stored figures are in dollars`
- `should convert at the configured rate when given $scenario` — `test.each` across the standard rate, a corrected higher rate, and parity
- `should render n/a when the cost could not be resolved`

Stages — unit tests (mock ffmpeg and ffprobe via `vi.mock`; mock ElevenLabs via `nock`):
- `should skip audio extraction when output file exists and stage is complete`
- `should skip transcription when output file exists and stage is complete`
- `should return correct filesWritten list when stage completes`
- `should fail before invoking ffmpeg when the source video is missing`
- `should fail before uploading when ELEVENLABS_API_KEY is $label`
- `should strip the provider prefix when sending the model ID to ElevenLabs`
- `should record cost from audio duration and the configured rate when transcription completes`
- `should record a null cost with costResolutionError when the audio duration cannot be read`

Shared stage helper — integration tests (real filesystem). Every case about a finished stage runs
twice, once for each of the two statuses that mean the output is on disk (**TD §4.2**), so that the
equivalence the third run of a lecture depends on is asserted at both:
- `should report incomplete when the stage $scenario` — has not run, is still running, failed
- `should report complete when a $status stage's every recorded file exists`
- `should report incomplete when a $status stage's recorded output file has been deleted`
- `should report incomplete when only some of a $status stage's recorded files exist`
- `should report complete when a $status stage recorded no output files`
- `should throw ManifestPathError when a recorded path escapes the module root`

Integration tests (`.integration.test.ts`) against a real audio/video fixture the test renders itself with ffmpeg, so no binary is committed:
- `should produce valid m4a output when extracting the audio track from a real video file`
- `should return transcript text when audio file uploaded to ElevenLabs`

The transcription integration test streams a real file through the real SDK but keeps the ElevenLabs endpoint stubbed with `nock`: the external API is mocked as CLAUDE.md requires, and the suite never spends money or depends on a live key.

**Acceptance:** Both stages implement `PipelineStage<T, U>` and are driven correctly by the runner; all existing transcription behaviour is preserved.

---

## Phase 6 — `transcript-structuring`

**Goal:** Single LLM call to structure the transcript and determine the lecture title; conditional rename of the lecture's files, which the runner learns to follow.

**Deliverables:**

`src/pipeline/lecture-files.ts` **(TD §4.7, "Moving a lecture's files")** — `baseNameForLecture`, `findDatedFile`, `removeDatedFile` and `renameLectureFiles`, lifted out of the private helpers in `src/cli/lecture-identity.ts` so `transcript-structuring` and `change-date` share one sweep rather than growing a second copy. `change-date` is rewritten onto it; the module sits under `src/pipeline/` because a stage may not import from `src/cli/`.

`callModel` gains `responseFormat` **(TD §6)** — `"text" | "json"`, stated on every call, setting the SDK's `response_format` to `json_object` for the stages that return structured data. `transcript-structuring` is its first production caller.

`PipelineRunner` follows a relocated workspace **(TD §4.7, "Following a relocated workspace" and `StageContext` assembly)** — `findLectureByDate` extracted from `resolveLecturesByDate`; new `resolveWorkspace`; `updateManifest` takes and returns the manifest rather than re-reading it; `runStage` returns `StageOutcome`; `#runStages` carries each stage's context on to the next; the run log and `RunSummary.workspaceRoot` use the resolved path.

`src/pipeline/stages/transcript-structuring/transcript-structuring.prompt.ts` **(TD §5, "Where prompts live")** — `buildStructuringMessages`, the first of the per-stage prompt modules. No test file of its own; the stage's tests exercise it.

`src/pipeline/stages/transcript-structuring/transcript-structuring.ts` **(TD §5, `transcript-structuring`)** — a single JSON-mode LLM call that judges the lecturer's provisional title against the transcript and structures the transcript into markdown, then performs the conditional rename in the documented order. Implement to TD §5, `transcript-structuring`, which specifies the response contract, the prefer-the-original title judgement, the `aiDerivedTitle`/`lectureTitle` semantics, the `userTitle` precedence, the order of operations, and the structuring rules (headings, filler removal, LaTeX, Q&A blockquotes, no added content). Output: `Structured transcript/structured-transcript.md`. Added to `lectureStages` in `src/cli/run-cli.ts`, which is what makes it run.

**Tests:**

Unit tests for the stage (mock `callModel`):
- `should extract structured markdown and keep the provisional title when LLM judges it meaningful`
- `should store suggestedTitle as aiDerivedTitle when LLM judges the provisional not meaningful`
- `should settle no identity when the model judges the title meaningful` — the stage returns no `identityChanges`, so the runner writes none and `aiDerivedTitle` stays as it was
- `should fail when the response is not the documented JSON object`
- `should fail when the LLM judges the provisional not meaningful but proposes no title`

Unit tests for `callModel`:
- `should request the json_object response format when responseFormat is json`
- `should send no response format when responseFormat is text`

Integration tests for the stage (real temp directory) — `test.each` across both `provisionalTitleMeaningful` verdicts:
- `should rename source video, slide, workspace folder, and update manifest when provisionalTitleMeaningful is false`
- `should overwrite manifest.lectureTitle with aiDerivedTitle when provisionalTitleMeaningful is false`
- `should leave manifest.lectureTitle unchanged (still equal to provisionalTitle) when provisionalTitleMeaningful is true`
- `should leave all files unchanged when provisionalTitleMeaningful is true`
- `should leave lectureTitle and every file unchanged when userTitle is set`

Integration tests for `lecture-files.ts`:
- `should rename the video, the slide, the PDF, and the workspace onto the new base name`
- `should skip the PDF when the lecture has none yet`

Integration tests for the runner following the move:
- `should record the completed stage in the manifest at its new path when a stage renames the workspace`
- `should give a downstream stage the lectureTitle an earlier stage wrote`
- `should write the run log to the renamed workspace`

**Acceptance:** Stage produces `structured-transcript.md`; renames files correctly per the conditional logic; the runner records, logs, and reports against the workspace's post-rename path, and downstream stages see the updated `lectureTitle`.

---

## Phase 7 — `transcript-verification`

**Goal:** Report what `transcript-structuring` lost, underexplained, distorted, or invented, without letting the verdict stop anything.

**Deliverables:**

`src/pipeline/stages/transcript-verification/transcript-verification.prompt.ts` **(TD §5, "Where prompts live")** — `buildVerificationMessages`. The assessment method carried over verbatim from the prompt that produced `docs/quality/`, with the reply contract appended. No test file of its own; the stage's tests exercise it.

`src/pipeline/stages/transcript-verification/transcript-verification.ts` **(TD §5, `transcript-verification`)** — a single JSON-mode call carrying the raw transcript and the structured one, writing the report to `Transcript verification/verification-report.json` and its readable view to `verification-report.md` beside it. Offers only the faithfulness categories of `QaDeficiencyType`. Added to `lectureStages` in `src/cli/run-cli.ts`, which is what makes it run.

`src/pipeline/stages/transcript-verification/transcript-verification.view.ts` **(TD §5, `transcript-verification`, "The findings are also written as a document")** — `renderVerificationReportMarkdown`, turning a stored report into the page a person reads. Its own file and its own suite, because the view is provisional: when the checker no longer needs reading by eye, this file and the layout's `markdownVersion` come out together.

`markdownVersion` in `STAGE_FILES`, with `StageWithMarkdownVersion`, `stageMarkdownVersionEntry` and `stageMarkdownVersionPath` **(TD §3.3)**, and `writeStageOutputWithMarkdownVersion` in `src/pipeline/stages/pipeline-stage.ts` **(TD §4.2)** — a stage's output may now be accompanied by a rendering of itself, written and recorded in the same act as the output. `transcript-verification` is the only stage that declares one.

`QA_SEVERITIES` in `src/types/pipeline.ts` **(TD §4.1)** — the three severities as an ordered list, worst first, with `QaSeverity` derived from it as `StageId` is from `STAGE_IDS`. The stage validates a reply against it and the view orders findings by it, and an ordering written beside a membership check is the same fact twice.

`src/pipeline/stages/model-stage.ts` **(TD §6, "A stage asks for a JSON reply through one shared act")** — `requestJsonReply`, plus the dependency pair and run arguments every model-calling stage takes. Extracted here because `transcript-verification` is the second stage to do all three, and `transcript-structuring` moves onto it in the same change. No test file of its own; both stages' suites exercise it, each failure included.

The stage set gains a tenth entry **(TD §4.1)** — `STAGE_IDS`, `STAGE_FILES`, the cost report's labels and the config example all follow from it; the manifest, config keys, `--from-stage` validation and the run log derive from `STAGE_IDS` and need no edit.

**Tests:**

Unit tests for the stage (mock `callModel`):
- `should write every finding the checker returned when the stage runs`
- `should record what the checker cleared when it reports having considered it`
- `should complete rather than fail when the checker returns a %s finding` — `test.each` across every severity
- `should fail when the $stageId output is $state` — `test.each` across each input absent and each input blank
- `should fail when the reply is $label` — `test.each` across the ways a reply can miss the documented report
- `should fail when a finding carries the prose category %s` — the categories this checker is never offered
- `should send neither a temperature nor a token cap when the shipped example configures the stage` — the routing narrowing of A11.2d is what this prevents

Unit tests for the view (`renderVerificationReportMarkdown`, no mocks — it is handed a report and returns text):
- `should open with the verdict, the coverage score and the count when a report is rendered`
- `should say the checker raised nothing when the report carries no findings`
- `should count the findings of each category when the report carries several`
- `should keep the counts in one table when the report carries several categories`
- `should put distortions before every other category when the report carries both`
- `should order findings from critical to minor when a category carries several`
- `should show both locations and the source quote when a finding carries a source`
- `should say the source carries no such passage when a finding has no source anchor`
- `should record what the checker cleared when the report carries considerations`
- `should say nothing was cleared when the checker recorded no considerations`

Unit tests for the layout's second file:
- `should render a view for a reader from transcript-verification alone when ownership is read`
- `should put the view beside the report it renders when transcript-verification is asked`
- `should admit only the stages rendering a view when a renderer is named` — the compile-time refusal, asserted with `@ts-expect-error`
- `should resolve the view under the workspace when a workspace is given`

Integration tests for the writer (real temp directory):
- `should put the view beside the output when a stage renders one`
- `should record both files when a stage renders its output for a reader`

Integration tests (real temp directory):
- `should write the report to Transcript verification when the stage completes`
- `should write the report as readable JSON when the stage completes`
- `should write the verification report Markdown beside the report when the stage completes`
- `should record both files as written when the stage completes`
- `should ask OpenRouter for JSON when the stage calls the model`
- `should put both versions in front of the checker when the stage calls the model`

Skipping when the report is present, re-running under `--from-stage`, recording status, cost and `filesWritten`, and leaving the exit code alone are the runner's behaviour rather than this stage's, and `runner.integration.test.ts` already covers them against a stub stage. Restating them per stage would be the duplication Rule Zero forbids, so the acceptance below is met through those tests, not new ones.

**Acceptance:** A lecture with a structured transcript produces a verification report and its Markdown version, both recorded as written; a poor verdict changes neither the stage's status, the run, nor the exit code; the stage skips and re-runs like every other.

---

## Phase 8 — One Folder per Stage

**Goal:** Give every stage a folder of its own before the first stage made of several files arrives. Behaviour does not change.

**Deliverables:**

Each existing stage's module, prompt module, Markdown version, the parts only it uses, and their tests move into `src/pipeline/stages/<stage-id>/`; `pipeline-stage.ts` and `model-stage.ts` stay one level up **(TD §9, "Each stage owns a folder")**.

An ESLint zone forbidding a stage folder from importing another's, beside the existing infrastructure-never-imports-a-stage zone **(TD §9)**.

Every doc naming a moved file is updated in the same commit.

**Tests:** None new. Every existing suite passes with only its import paths changed; a suite whose assertions change is a sign the move changed behaviour.

**Acceptance:** A pipeline run produces what it did before the move; the gate passes; a stage folder importing another's fails lint.

---

## Phase 9 — Panel Runs

**Goal:** One shared behaviour for any stage that makes a panel of independent model runs: bounded concurrency, each run saved as it completes, resume on relaunch, resend on an empty or malformed reply.

**Deliverables:**

`src/pipeline/stages/panel-runs.ts` **(TD §5, "Dividing the transcript", Panel runs; TD §8, "Intra-Stage Resumability")** — the whole of the panel-run behaviour the TD describes, each of its failures a named error: `sendWithResends` for one call, `runPanel` for the panel.

`tryJsonReply` in `src/pipeline/stages/model-stage.ts` **(TD §6, "A stage asks for a JSON reply through one shared act")** — the JSON call that returns a bad reply with its cost rather than throwing it; `requestJsonReply` is rebuilt on it.

`mapWithConcurrency` in `src/utils/concurrency.ts` — the batch runner's bounded-concurrency loop, moved out so the panel shares it. `accumulateCost` accepts a running total of `null`, meaning nothing counted yet.

**Tests:**

Unit tests for `tryJsonReply` (mock `callModel`):
- `should hand back the reply and its cost when the reply is the documented shape`
- `should give the reason and the call's cost when the reply is $label` — `test.each` across empty, not JSON, and the wrong shape

Unit tests for `sendWithResends` (fake timers for the pause):
- `should return the reply and one send's cost when the first send succeeds`
- `should keep the reply and count every send's cost when two sends fail first`
- `should log each unusable reply with what was sent, which send it was and why when sends fail`
- `should fail naming what was sent and the last reason when all three sends fail`
- `should wait two seconds and then four before the second and third sends when sends keep failing`
- `should let an error from the call itself through without resending when the call throws`

Unit tests for `mapWithConcurrency`:
- `should return every result in input order when items finish out of order`
- `should have at most $expected in flight when the limit is $limit` — `test.each`, a limit of 0 included
- `should return no results when given no items`

Integration tests for `runPanel` (a stand-in run maker; real temp directory):
- `should return every run in run order when the panel is made from scratch`
- `should save each run to its own numbered file when the run completes`
- `should make only the missing runs when some were saved by an earlier launch`
- `should add up the cost of the runs it made when some were saved by an earlier launch`
- `should report no cost when every run was saved by an earlier launch`
- `should fail naming the file when a saved run is $problem` — `test.each` across not JSON and not a run
- `should keep the runs already saved when a later run fails`
- `should make one run at a time when the stage sets no concurrency`

Clearing a stage's run files under `--from-stage` is the runner's reset of the stage's directories, which `runner.integration.test.ts` already covers against a stub stage.

**Acceptance:** A stand-in stage's panel survives empty replies, a crash part-way, and a relaunch, paying only for the runs it had not yet made; the existing single-call stages behave as before.

---

## Phase 10 — `initial-subtopic-splitting`

**Goal:** Cut the whole transcript into subtopics, once per splitting run in the panel.

**Deliverables:**

`src/pipeline/stages/division.ts` **(TD §5, "Dividing the transcript")** — `placeCuts`, `sliceSubtopics`, `assertLossless`, shared by the three division stages.

`src/pipeline/stages/stage-input.ts` **(TD §5, "Dividing the transcript")** — `readStageText`, reading an earlier stage's output and failing with the reading stage's own error when it is missing or blank; shared by the four division stages.

`src/pipeline/stages/initial-subtopic-splitting/` **(TD §5, `initial-subtopic-splitting`)** — the stage and its prompt module, the prototype's `s6` byte for byte. Added to `lectureStages` after transcription.

The stage set gains `initial-subtopic-splitting` after `transcription` in `STAGE_IDS`, with its `STAGE_FILES` entry and cost-report label **(TD §3.3, §4.1)**; each later division phase adds its own stage the same way, after the one before. Old manifests need no migration, since a missing entry reads as not yet run.

The required `division` section — `panelSize`, `bar`, `sizeGateWords` — in `PipelineConfig`, its validation, `pipeline-config.example.json` and the user's own `pipeline-config.json`; the stage's entry in the example config **(TD §6)**.

**Tests:**

Unit tests for `division.ts` (no mocks):
- `should start the first subtopic at the start of the text when its quote names somewhere else`
- `should cut at the quote when it matches the text exactly`
- `should find a quote when its case and spacing differ from the text`
- `should move the cut back to the sentence start when the quote drops a leading $dropped` — `test.each` across one and two words
- `should leave the cut where it is when the word before it does not open its sentence`
- `should search forward from the previous cut when the quote also appears earlier`
- `should report the quote rather than guess when it is not in the text`
- `should reproduce the text exactly when the subtopics are joined`
- `should give each subtopic its span, label and reason when the text is cut`
- `should accept the division only when its subtopics leave $shape` — `test.each` across no gap, a gap, an overlap and a short ending

Integration tests for `stage-input.ts` (real temp directory):
- `should return the file's text when the stage's output holds text`
- `should raise the reading stage's own error naming the file when it is $state` — `test.each` across missing and blank

Unit tests for the stage (mock `callModel`):
- `should send the transcript without its surrounding whitespace when a run is made`
- `should save every run of the panel with each subtopic's span, label and reason when the stage completes`
- `should record every run file as written when the stage completes`
- `should resend a run when the reply $problem` — `test.each` across opening words the transcript does not contain, not an object, no list of subtopics, an empty list, and a subtopic without its opening words
- `should make only the missing runs when an earlier launch saved some`
- `should fail when a saved run holds $problem` — `test.each` across not a list and a subtopic without its reason
- `should fail when the transcript is $state` — `test.each` across missing and blank

Config tests — rows added to the existing `should throw ConfigError when $case` table: the division section missing; a field missing, not a number, not a whole number, or below 1; the bar exceeding the panel size.

**Replay against the prototype:** a script in `docs/quality/segmentation-prototype/` feeds every saved prototype `s6` reply, across all eight lectures, through `placeCuts` and `sliceSubtopics`, and reports any run whose cut positions differ from the prototype's own run file. Every difference is explained or fixed. The script and its results stay in the prototype.

**Live run:** the stage runs on one lecture; its subtopic counts and cut sites are compared with the range the prototype's `s6` runs showed on that lecture. The cost is stated before the run.

**Acceptance:** A transcribed lecture gains a panel of initial splitting runs, each reproducing the transcript exactly; replay matches the prototype; the live run falls within the prototype's range.

---

## Phase 11 — `deepen-subtopic-splitting`

**Goal:** Divide further, in every splitting run, each subtopic over the size gate.

**Deliverables:**

`src/pipeline/stages/deepen-subtopic-splitting/` **(TD §5, `deepen-subtopic-splitting`)** — the stage and its prompt module, the prototype's `d13` byte for byte; its entry in the example config, `STAGE_IDS`, `STAGE_FILES` and the cost-report label. Added to `lectureStages`.

What it shares with `initial-subtopic-splitting`, moved out of that stage rather than copied **(TD §5, §6)**: `readTranscript` in `stage-input.ts`; `isDivision`, `isReplySubtopic` and `subtopicText` in `division.ts`; `runStagePanel`, `readPanel` and `panelDirectory` in `panel-runs.ts`, where a run needing no call now reports no cost; `tryJsonReplyAs`, `promptMessages` and `defineModelStage` in `model-stage.ts`.

**Tests:**

Unit tests (mock `callModel`):
- `should send only the subtopics over the size gate when a run is deepened`
- `should cut the transcript without its surrounding whitespace when a run is deepened`
- `should leave a subtopic unchanged when the reply says it is one step`
- `should add the cuts inside the subtopic when the reply divides it`
- `should ignore a cut proposed outside its subtopic when the reply places one there`
- `should send every subtopic still over the gate again when the first round cut anything` — one held as one step included
- `should make no second round when the first round cut nothing`
- `should stop after two rounds when a piece stays over the gate`
- `should reproduce the transcript exactly when a deepened run is joined`
- `should record every deepened run file as written when the stage completes`
- `should resend a subtopic when the reply $problem` — `test.each` across not an object, no list of cuts, a cut without its opening words
- `should fail the stage without saving the run when a subtopic fails every send` — never recorded as one step
- `should make only the missing runs when an earlier launch saved some`
- `should fail when an initial splitting run is missing`
- `should fail when the transcript is $state` — `test.each` across missing and blank

Tests for the shared pieces: `isDivision` and `isReplySubtopic` (`test.each`, in `division.test.ts`); `readPanel` — every run in order, the caller's error for a missing run, an unreadable run — and `runPanel` reporting no cost when its runs needed no calls (`panel-runs.integration.test.ts`); `readTranscript` trimming the transcript (`stage-input.integration.test.ts`); `promptMessages` and `tryJsonReplyAs` (`model-stage.test.ts`).

**Side by side with the prototype, in place of a replay:** the prototype saved its deepened runs but not the replies that made them, so there is nothing to replay. A one-off script sets the live deepened runs beside the prototype's for the same lecture, subtopic by subtopic, for the user to read.

**Live run:** on the Phase 10 lecture, comparing deepened subtopic counts with the prototype's `d13` range.

**Acceptance:** Every initial run gains a deepened run, with no subtopic over the gate unless two rounds could not divide it; the live run falls within range; the user has read the side-by-side view.

### Phase 11, continued — how much runs at once

**Goal:** Deepen a lecture in a minute or two rather than six, and say in the config how much of every kind runs at once **(TD §6, "Three settings say how much runs at once")**.

**Deliverables:**

- `callConcurrency` on a stage entry, read by `deepen-subtopic-splitting` alone: a round's subtopics are sent that many at once, their replies kept in the subtopics' order, and the second round waits for the first **(TD §5, `deepen-subtopic-splitting`)**. Set on any other stage, it is a `ConfigError`.
- The required `batch` section with `concurrency`, in `PipelineConfig`, its validation, `pipeline-config.example.json` and the user's own `pipeline-config.json`. `batch` takes it from the config when `--concurrency` is not given **(TD §4.7)**.
- `mapWithConcurrency` starts no further task once one has failed, and fails only after the tasks in flight have finished, so no call is left running unobserved after its stage has failed **(TD §5, Panel runs)**.
- In the example config and the user's own, `deepen-subtopic-splitting` at `concurrency` 6 and `callConcurrency` 10.

**Tests:**

Unit tests for `mapWithConcurrency`:
- `should start no further task when one fails`
- `should let the tasks in flight finish before failing when one fails`

Unit tests for the stage (mock `callModel`):
- `should have at most $expected calls in flight in one run when callConcurrency is $callConcurrency` — `test.each`, unset included (one at a time)
- `should give the same deepened run when the replies arrive out of order`

Unit tests for `totalCost` in `src/utils/cost.ts`, which folds the costs of a stage's parts where some made no call — the panel's runs and a round's calls both need it:
- `should be null when $case` — `test.each` across no parts and no part making a call
- `should add up the parts that made calls when some made none`

Config tests — rows added to the existing `should throw ConfigError when $case` table: the batch section missing; `batch.concurrency` missing, not a whole number, or below 1; `callConcurrency` set on a stage other than `deepen-subtopic-splitting`.

CLI tests:
- `should run $expected lectures at once when $case` — `test.each` across the config alone and `--concurrency` overriding it

**Acceptance:** The live lecture 6 deepening, rerun at 6 × 10, gives a panel within the prototype's range in a fraction of the time.

### Phase 11, continued — titles

**Goal:** Call a subtopic's title a title everywhere past the model's reply.

**Deliverables:**

- `label` becomes `title` in code, saved run files and comments: `Subtopic`, `sliceSubtopics`' `named`, the tests and fixtures. The prompts are unchanged and still ask for `label`; a reply's `label` becomes `title` as the reply is read **(TD §5, `initial-subtopic-splitting`)**. Run files saved before the rename no longer read as a division, and are made again.

**Tests:**

Unit tests for `division.ts`:
- `should give each subtopic its span, title and reason when the text is cut` — replaces the `label` test of Phase 10
- a division-reading row for a subtopic without its title

**Acceptance:** No `label` outside the prompt modules and the reply guard.

### Phase 11, continued — no inherited-title marks

**Goal:** Stop recording which subtopics have an inherited title, since `retitle-subtopics` (Phase 13) replaces every title.

**Deliverables:**

- `Subtopic` loses `titleInherited`; deepening sets no mark. `isDivision` becomes `readDivision`, which reads a run file as the subtopics it holds and nothing more, so a run file carrying the mark still reads and the mark is dropped as it is read **(TD §5, `deepen-subtopic-splitting`, "Inherited titles are not marked")**. A panel is therefore given a `readRun`, which reads a saved run, in place of `isRun`, which only recognised one.

**Tests:**

Unit tests for `division.ts`:
- `should read a saved run as a division without its mark when the run carries one`
- `should read a saved value as a division only when it holds $held` — the `isDivision` table, now asserting the subtopics read

Unit tests for `deepen-subtopic-splitting`:
- `should write no inherited-title mark when the initial runs it reads carry one`

The deepening tests of the mark are deleted.

**Acceptance:** The live deepened runs of all eight lectures still read as divisions; nothing written carries the mark.

### Phase 11, continued — refusals resent

**Goal:** Resend a call the provider refuses inside an accepted reply, in every stage, instead of failing the stage on the first refusal.

**Deliverables:**

- `callModel` sends a refused call again, up to three sends, pausing two seconds and then four, logging each refusal as a warning with the provider's sentence; the third refusal is the `ProviderError` **(TD §6, "A rejection can arrive inside an accepted reply")**. Every refused send counts as a call, costed by the usage it reports or, without one, as nothing.
- `src/utils/resend.ts` — `sendUntilAccepted`, the resend loop, moved out of the panel's `sendWithResends` so the completion call and the panel stages share one copy.

**Tests:**

Integration tests for `callModel` (stubbed OpenRouter):
- `should resend a refused call and return the reply when a later send is accepted`
- `should fail with the last refusal, naming the model and the stage, when every send is refused`
- `should log each refusal as a warning with which send it was and the provider's sentence`
- `should count the refused send as a call when the refusal $scenario` — `test.each` across reporting its own usage, which is counted, and reporting none, which costs nothing

The panel's `sendWithResends` tests cover the shared loop's pauses, cost counting and exhaustion unchanged.

**Acceptance:** A refusal no longer fails a stage unless it recurs on the third send.

### Phase 11, continued — answers kept beside a provider's error

**Goal:** Keep a complete answer that arrives with the provider's error, and log every call's finish reason, so a provider's errors can be traced afterwards.

**Deliverables:**

- `callModel` hands back the answer of a reply carrying both an answer and the provider's error, logging the error as a warning with the finish reason and which send it was, and adds the finish reason to each call's `debug` record **(TD §6, "A rejection can arrive inside an accepted reply"; TD §10)**.

**Tests:**

Integration tests for `callModel` (stubbed OpenRouter):
- `should return the answer without resending when a reply $reply` — `test.each` across carrying an answer and the provider's error, and reporting `error` as its finish reason
- `should log the provider's error as a warning with the finish reason and which send it was when a reply carries an answer as well`
- `should resend a reply carrying the provider's error when its answer is empty`
- `should record the model, prompt tokens, latency and finish reason when a call completes reporting $reported` — `test.each` across `stop` and none; replaces the test of the same line without the finish reason

**Acceptance:** No complete answer is thrown away over the provider's error, and every call's finish reason can be read from the debug log.

---

## Phase 12 — `choose-division`

**Goal:** Vote over the deepened runs and keep, whole, the run nearest the vote. No model call.

**Deliverables:**

`src/pipeline/stages/panel-vote.ts` **(TD §5, `choose-division` and `define-topics`)** — `panelVote` and `distanceFromVote`, built here for any panel of runs given as lists of positions, since `define-topics` (Phase 14) breaks its ties with them.

`src/pipeline/stages/choose-division/` **(TD §5, `choose-division`)** — `chooseDivision`, which groups cuts into cut sites and chooses the run nearest the vote over them, and the stage around it. Added to `lectureStages`, with its `STAGE_IDS` and `STAGE_FILES` entries and cost-report label.

A record beside a stage's output **(TD §3.3; §4.5, "How a result was reached is kept beside the result")**: a `record` field on every `STAGE_FILES` entry, `StageWithRecord`, `stageRecordEntry`, `stageRecordPath`, and `writeStageOutputWithRecord`, which shares its writing step with `writeStageOutputWithMarkdownVersion`. `choose-division` declares `Chosen division/choice.json`.

`readTranscriptAndRuns` in `stage-input.ts` **(TD §5, "Dividing the transcript")** — the transcript and a finished splitting panel, read the same way by `deepen-subtopic-splitting` and `choose-division`; tested in `stage-input.integration.test.ts` (`should return the transcript and every run of the panel when the panel is complete`, `should raise the reading stage's own error naming the stage to run when a run is missing`).

**Tests:**

Unit tests for `panel-vote.ts` (no mocks):
- `should keep only the positions at least $bar runs mark when the bar is $bar` — `test.each` across bars of 1, 2 and 3
- `should count the positions where one of the run and the vote marks and the other does not when they differ`

Unit tests for `chooseDivision` (no mocks):
- `should count cuts as one site when they lie within one percent of the site's first cut`
- `should open a new site when a cut lies beyond one percent of the site's first cut even within one percent of the previous cut`
- `should credit a run with a site when its cut lies within half a percent beyond the site even in a site of its own`
- `should choose the run whose cut sites differ least from the vote's when runs differ`
- `should break a tie for the vote to the run closest to the others when two runs are equally near`
- `should break a remaining tie to the earliest run when runs are equally near the vote and the others`
- `should report the chosen run counting from 1 with its distance from the vote and the panel size when a run is chosen`
- `should hand on the chosen run's subtopics unchanged, titles and reasons included, when a run is chosen`

Unit tests for the layout:
- `should keep a record of how the output was reached from choose-division alone when ownership is read`
- `should resolve the record beside the output it describes when a workspace is given`

Integration tests for the stage (real temp directory):
- `should write the chosen run's subtopics, and beside them which run was chosen, when the stage completes`
- `should fail naming the missing run when fewer deepened runs are saved than the panel holds`

**Replay against the prototype:** a one-off script in the prototype folder runs `chooseDivision` on each lecture's 18 `d13` runs at a bar of nine, and on every panel of nine drawn from them at a bar of five, and checks that it chooses the same run as `division_support.py`'s `closest_to_vote_run`. Any difference is explained or fixed.

**Live run:** the stage over Phase 11's live deepened runs on all eight lectures: which run each chose, and its distance from the vote.

**Acceptance:** A lecture gains one chosen division, a run of its panel handed on unchanged, with a record beside it of which run and how far from the vote; replay agrees on every panel.

---

## Phase 13 — `retitle-subtopics`

**Goal:** Give every subtopic of the chosen division a new title from its own text, in one call over the whole lecture, before grouping.

**Deliverables:**

`src/pipeline/stages/retitle-subtopics/` **(TD §5, `retitle-subtopics`)** — the stage and its prompt module, the prototype's `r9` byte for byte; its entry in the example config and the user's own (`openai/gpt-6.1-sol-pro`), `STAGE_IDS`, `STAGE_FILES` and the cost-report label. Added to `lectureStages` after `choose-division`.

`retitle-subtopics` declares a record, `Retitled subtopics/changes.json`, written with Phase 12's `writeStageOutputWithRecord` **(TD §4.5)**, which now takes the output as a value and writes it as JSON, as it does the record.

`writeDivisionWithRecord` in a new `stage-output.ts` **(TD §5, "Dividing the transcript")** — a division and its record written, and the stage's result given; shared by `choose-division` and `retitle-subtopics`, tested through both.

`readStageDivision` in `stage-input.ts` **(TD §5, "Dividing the transcript")** — the division an earlier stage wrote, failing with the reading stage's own error when it is missing, blank, not JSON or not a list of subtopics; tested through the stage.

**Tests:**

Unit tests for the stage (mock `callModel`):
- `should send every subtopic as its position and trimmed text, without its title, in one call when the stage runs`
- `should write the chosen division with every title replaced and spans and reasons unchanged when the stage completes`
- `should resend the call and use the next reply when the reply $problem` — `test.each` across empty, not JSON, not an object, a subtopic missing, a position repeated, a position out of range, positions out of order, a blank title
- `should fail without writing the division when the third send's reply is still unusable`
- `should fail without calling the model when the chosen division $problem` — `test.each` across missing, not JSON, and not a list of subtopics
- `should leave the chosen division's subtopics as they were when the stage completes`
- `should record beside the division each title that changed, and not one returned unchanged, when the stage completes`

**Side by side with the prototype:** covered by Phase 14's live run, which shows the new titles beside the prototype's `r9` titles.

**Acceptance:** A lecture gains a retitled division differing from the chosen one only in its titles, with a record beside it of which titles changed, from what to what.

---

## Phase 14 — `define-topics`

**Goal:** Group the retitled subtopics into topics by a panel of nine grouping runs and keep the grouping most of them made. Judging the lecture title is not in this phase.

**Deliverables:**

`src/pipeline/stages/define-topics/` **(TD §5, `define-topics`)** — the stage, its prompt module (the prototype's `g23` with titles, byte for byte), and `choose-grouping.ts` with `chooseGrouping`, which breaks its ties with Phase 12's `panelVote` and `distanceFromVote`. Added to `lectureStages` after `retitle-subtopics`, with its `STAGE_IDS` and `STAGE_FILES` entries and cost-report label.

The required `grouping` section — `panelSize` and `bar` — in `PipelineConfig`, its validation, the example config and the user's own; the stage's entry in the example config and the user's own, with `concurrency` 9 and `sendGapSeconds` 0.5 **(TD §6)**.

`sendGapSeconds` **(TD §5, "Dividing the transcript", Panel runs; TD §6, "Three settings say how much runs at once")** — accepted on `define-topics` alone; the panel spaces every send the stage makes, refusals resent by `callModel` included, at least that far apart.

`define-topics` declares a record, `Topics/choice.json`, written with Phase 12's `writeStageOutputWithRecord` **(TD §4.5, "How a result was reached is kept beside the result")**.

**Tests:**

Unit tests for `chooseGrouping` (no mocks):
- `should choose the grouping the most runs made when one leads`
- `should treat runs as the same grouping when their starts match and their titles differ`
- `should choose the grouping with more topics when two groupings made by more than one run each tie on runs`
- `should choose the run whose topic starts are closest to the vote when $panel` — `test.each` across every run differing, and tied groupings with as many topics
- `should choose the earliest run when closeness to the vote still ties`
- `should hand on the earliest run's topics when several runs made the chosen grouping`
- `should fail when there are no runs to choose from`
- `should report the chosen run, its support, the panel size and the rule that decided when $decidedBy decides` — `test.each` across each rule, and a panel whose runs all agree, decided by most runs

Tests for the stage (mock `callModel`; real temp directory, set up by the `useStageReadingDivision` fixture it shares with `retitle-subtopics`):
- `should send every retitled subtopic as its position, title as label, and text with the blank space at each end removed when each grouping run is made`
- `should resend a grouping run's call when its reply $problem` — `test.each` across no topics, a blank title, a blank `groupedBecause`, no first subtopic, not starting at 1, a start not after the one before, a start past the last subtopic
- `should write each topic's title, groupedBecause and first subtopic from the chosen run when the stage completes`
- `should record beside the topics the chosen run, its support and the deciding rule when the stage completes`
- `should fail naming the file, without calling the model, when the retitled subtopics $problem` — `test.each` across missing, not JSON, not a list of subtopics
- `should fail without writing the topics when a run's third send is still unusable`
- `should save each grouping run as the model replied when the run completes`

Tests of the stage's sending (fake timers; stubbed OpenRouter rather than a mocked `callModel`, so a refusal is really resent):
- `should start no send until the gap has passed since the stage's previous send when sendGapSeconds is set` — first sends, resent bad replies and resent refusals alike
- `should not space sends when sendGapSeconds is unset`

Unit tests for the config: as Phase 10, for the `grouping` section, the bar exceeding the panel size included; a `sendGapSeconds` row in the `should throw ConfigError when $case` table naming a stage other than `define-topics`; `should keep a fractional sendGapSeconds when define-topics sets it`.

**Replay against the prototype:** the prototype's saved `g23` runs on each lecture's `r9`-retitled division (4 per lecture) through `chooseGrouping` at bar 3; each result is compared with the grouping `analysis-2026-09-30/choose_panel.py` chooses from the same runs. That script asks "more topics" even when every run differs, which this rule does not, so a lecture whose runs all differ may disagree; each difference is explained, any other fixed.

**Live run:** `retitle-subtopics` and `define-topics` together on one lecture (about $0.51, stated first): the new titles and the chosen topics beside the prototype's, for the user to read.

**Acceptance:** A lecture gains nine grouping runs and a topics file holding the chosen grouping, with a record beside it of which run, its support and the deciding rule; replay agrees or each difference is explained.

---

## Phase 15 — `slide-conversion`

**Goal:** Vision LLM extraction of content from each slide, with intra-stage resumability and controlled concurrency.

**Deliverables:**

`src/pipeline/stages/slide-conversion.ts` — the whole of **TD §5, `slide-conversion`**: PDF-to-PNG rendering, the per-slide vision call and its prompt, intra-stage resumability, bounded concurrency, the in-flight progress bar, concatenation, and `--from-stage` cleanup.

`createParallelWorkBar` in `src/utils/progress.ts` **(TD §10)** — the in-flight-suffix bar, built here rather than in Phase 2 because this stage and `image-extraction` are what it has to serve.

**Tests:**

Unit tests (mock `callModel`; mock `pdfjs-dist`):
- `should skip slide when per-slide markdown already exists`
- `should concatenate all per-slide markdown files with correct separators and headings`

Integration tests (real temp directory; real small PDF fixture):
- `should render PDF pages to PNG files at correct resolution`
- `should resume from correct slide when per-slide files pre-exist`
- `should delete all raw/ files before processing when --from-stage invoked`
- `should remove .tmp files at stage start`

**Acceptance:** All slides extracted; simulated crash at slide N resumes from slide N on next run; `--from-stage` forces fresh extraction from slide 1.

---

## Phase 16 — `image-extraction`

**Goal:** Identify academic figures within each slide PNG, crop them with `sharp`, and produce an `images-manifest.json`.

**Deliverables:**

`src/pipeline/stages/image-extraction.ts` — the whole of **TD §5, `image-extraction`**: the per-slide vision call and its figure schema, the relevance and type exclusions, percentage-to-pixel cropping with `sharp`, the per-figure PNG and caption files, and `images-manifest.json`.

**Tests:**

Unit tests:
- `should convert bounding box percentages to correct pixel coordinates when given image dimensions` — `test.each` across edge cases (full-slide bounds, small figure, zero height)
- `should exclude figure when relevance or type is [value]` — `test.each` across `academicRelevance: 'exclude'`, `figureType: 'logo'`, `figureType: 'decorative'`
- `images-manifest.json` structure — snapshot test (serialisation format regression only)

Integration tests (real temp directory; real slide PNG fixture):
- `should crop figure from slide PNG at correct pixel coordinates`
- `should write images-manifest.json atomically after all slides processed`

**Acceptance:** Academic figures cropped and labelled; logos and decorative elements excluded; `images-manifest.json` valid and complete.

---

## Phase 17 — `synthesis`

**Goal:** Single LLM call assembling transcript, slide content, and figure captions into textbook-style notes in British English.

**Deliverables:**

`src/pipeline/stages/synthesis.ts` — the whole of **TD §5, `synthesis`**: context assembly from the structured transcript, slide content, and figure captions; the token-budget estimate and the chunking fallback above it; and the synthesis prompt and its output structure.

**Tests:**

Unit tests:
- `should estimate token count within acceptable margin when given inputs of known size`
- `should identify chunk boundary when transcript heading matches slide heading` — `test.each` across aligned, partially aligned, and misaligned heading pairs
- `should include image at correct relative path when figure present in manifest` — `test.each` across different `outputRelativePath` values
- `should activate chunking fallback when total token estimate exceeds threshold`
- `should produce single-call output when total token estimate is within threshold`

**Acceptance:** Output is valid markdown with correct relative image references; chunking fallback activates and produces coherent output when input exceeds the token threshold.

---

## Phase 18 — `qa-loop`

**Goal:** Iterative quality check and revision cycle; writes the final `QA checked/notes.md`.

**Deliverables:**

`src/pipeline/stages/qa-loop.ts` — the whole of **TD §5, `qa-loop`**: the two-prompt checker/reviser design and both prompts, the per-type reviser action table (including the NFR-1.3 prohibition on grounding an unsourced addition in a new source), the per-iteration files, all three loop-termination conditions, and the final `QA checked/` write.

**Tests:**

Unit tests (mock `callModel` via `nock`) — `test.each` across all three termination conditions:
- `should terminate with qa-passed when checker returns overallVerdict pass`
- `should terminate with max-iterations-reached when iteration count reaches configured maximum`
- `should terminate with stalled when deficiency count is identical across two consecutive iterations`
- `should record correct terminationReason in manifest for each termination condition`
- `should offer every QaDeficiency.type value this stage can judge with definitions in the checker prompt`
- `should include the per-type action table in the reviser prompt`
- `should explicitly forbid external grounding and restrict unsourced-addition remedies to removal in the reviser prompt` — grep the constructed prompt for the prohibition
- `should ask the checker to record what it examined and cleared in the checker prompt`

Integration tests (real temp directory):
- `should write QA checked/notes.md and copy figures to QA checked/images/ on termination`
- `should write per-iteration deficiency and revised files atomically`

**Acceptance:** Loop terminates correctly under all three conditions; final output written atomically; manifest reflects termination reason and iteration count.

---

## Phase 19 — `pdf-generation`

**Goal:** Convert `QA checked/notes.md` to PDF via pandoc and deposit in `Final output/`, the module directory the stage owns.

**Deliverables:**

`src/pipeline/stages/pdf-generation.ts` — the whole of **TD §5, `pdf-generation`**: the cached `pandoc` and `xelatex` pre-flight checks and their install hints, the `spawn` invocation with its explicit argv array, stderr capture on a non-zero exit, and the output filename assembled from `StageContext` through `filenameSafe` (TD §4.4).

**Tests:**

Unit tests (mock child process spawn):
- `should construct correct pandoc argv array from StageContext values` — `test.each` across different lecture numbers, titles, and dates
- `should invoke pandoc via spawn with an argv array (never exec) and never build a shell command string` — spy on the child_process import and assert `exec`/`execSync` are unused
- `should pass paths containing spaces (e.g. "Final output/") as raw argv elements with no quoting applied`
- `should throw clear actionable error when pandoc is not found on PATH` — verify error message names `pandoc` and includes the install URL
- `should throw clear actionable error when xelatex is not found on PATH` — verify error message names `xelatex` and includes the platform install hint
- `should include pandoc stderr verbatim in failure message when pandoc exits non-zero`
- `should cache pre-flight check results and skip re-checking on second invocation in the same process`

Integration tests (`pdf-generation.integration.test.ts`) — requires pandoc and xelatex installed; not run in CI:
- `should produce a valid PDF file when given a small markdown input`
- `should deposit PDF in Final output/ with correct full descriptive filename`

**Acceptance:** PDF deposited in `Final output/` with the correct full descriptive filename; stage produces a clear, actionable error distinguishing "pandoc missing" from "xelatex missing" from "pandoc ran but LaTeX failed".

---

## Phase 20 — End-to-End Validation

**Goal:** Run the full pipeline against a real lecture and verify output quality and pipeline mechanics.

**Activities:**
1. Run `source-normalisation` against the Biology of Disease source folder; verify workspace folders and renamed source files
2. Run full pipeline on one lecture; verify manifest state and run log after each stage
3. Verify the three-section cost report is correct and matches run log data
4. Verify the final PDF opens and is readable
5. Simulate a mid-run failure (kill process during `slide-conversion`); verify resumability on restart
6. Run `--from-stage slide-conversion` on a completed lecture; verify fresh extraction and downstream re-run
7. Add a new lecture to the source folder; re-run `source-normalisation`; verify re-numbering propagates correctly
8. Run batch mode across all lectures; verify sequential processing and batch summary output

**Acceptance:** Full pipeline produces a readable, well-structured PDF from a real lecture video and slides; all pipeline mechanics (resumability, re-runs, re-numbering, cost reporting) work correctly against real data.
