# Lecture Notes Generator — Implementation Plan

**Suite version:** 1.16-draft — shared across requirements, technical design, and implementation plan; any substantive edit to any of the three bumps this number in all three
**Date:** 2026-08-13
**Status:** For review

---

## Overview

The pipeline is built in twelve phases. Phases 1–3 establish the project scaffold and shared infrastructure before any stage code is written. Phases 4–11 implement stages in pipeline order. Phase 12 validates the full pipeline end-to-end against a real lecture.

Testing is not a final phase — unit tests are written alongside each deliverable per the project conventions. Integration tests are noted explicitly where unit testing alone is insufficient.

Cross-references to the technical design are noted as **(TD §N)**.

**CLAUDE.md is the single source of truth for development conventions.** Every rule in `/CLAUDE.md` — TSDoc, `Promise<T>` return types, named exports, `type` aliases, typed catches, immutability, DRY, atomic commits, etc. — applies to every deliverable in this plan and MUST be applied during development, not left to the pre-commit checklist. Rules are not restated per phase.

**Each fact has one home.** This plan owns build order, per-phase deliverables, acceptance criteria, and test intent. It does not restate design: stage behaviour, contracts, and data shapes live in the technical design (referenced as **(TD §N)**), and exact type definitions live in `src/types/*` once written — the TD references those too rather than reproducing them. A phase that needs a design detail links to it; it never copies it. Test names may echo the behaviour they verify — that is the executable spec following the design, not duplication.

---

## Phase 1 — Project Scaffolding

**Goal:** Establish the correct project structure before any feature code is written.

**Deliverables:**
- `tsconfig.json` — strict mode, `"types": ["node"]`, `moduleResolution: "bundler"`
- `biome.json` — formatting and standard linting rules, `noDefaultExport` enforced
- `eslint.config.js` — architectural rules (no cross-feature imports, restricted imports)
- `package.json` — all dependencies installed; scripts for `typecheck`, `lint`, `test`, `setup` (the last aliases `scripts/setup`)
- Directory skeleton: `src/types/`, `src/pipeline/stages/`, `src/utils/`, `docs/`, `bin/`, `scripts/`
- `pipeline-config.json` — initial config with placeholder model IDs **(TD §6)**
- `.gitignore` updated to include `.env`, `.claude/`, `CLAUDE.md`, `*.log`, test output folders (`.claude/` and `CLAUDE.md` per CLAUDE.md §Version Control)
- `bin/lecture-notes` — executable bash wrapper (`chmod +x`) that `cd`s to the repo root and `exec pnpm exec tsx src/index.ts "$@"`. Live TypeScript, no build step. Runs from any directory once the user's shell has the repo's `bin/` on `PATH`
- `scripts/setup` — executable bash script (`chmod +x`) that performs two idempotent installs:
  1. Appends a PATH export to the user's shell config (`.zshrc` / `.bashrc` / `config.fish`) so `lecture-notes` is on `PATH`. Marker-comment skip on re-run; read-then-append only (never overwrites)
  2. Merges the hook block from `scripts/claude-hooks.json` into **`.claude/settings.local.json` inside the repo** (Claude Code's per-user, per-repo settings file — gitignored by default via the existing `.claude/` rule; hooks fire only for Claude Code sessions in this project, never globally). Existing keys preserved (deep merge — e.g. any `permissions.allow` already present is untouched); a `__project` marker on each hook entry lets re-runs replace only our own entries so a human hand-editing the file to add unrelated hooks isn't clobbered. Uses `node -e '<merge script>'` (jq is not a hard dependency)
  Prints what was touched and the reload command. Users invoke it once via `./scripts/setup` or `pnpm setup`
- `scripts/claude-hooks.json` — template describing this project's Claude Code hook configuration (committed to the repo — a normal file, not under `.claude/`, so unaffected by the gitignore rule). Two hooks:
  - **PostToolUse matcher `Edit|Write`** → the hook command invokes `scripts/hooks/post-edit-biome`, which reads the tool-call JSON from stdin, extracts `.tool_input.file_path`, and runs `pnpm exec biome check --write <file>` on it. Fast fixup, no cross-file false positives (eslint deliberately omitted — its architectural rules only make sense against the whole tree)
  - **PreToolUse matcher `Bash`** → the hook command invokes `scripts/hooks/pre-commit-check`, which reads `.tool_input.command` from stdin, no-ops unless the command contains `git commit`, then on a commit runs `biome check --error-on-warnings` (staged files), `tsc --noEmit` (whole-project — TS needs the graph), and `eslint` (staged `.ts`/`.tsx` files). Any failure → the script exits `2`, which Claude Code treats as a block-with-feedback (stderr is fed back into the conversation)
  - Each hook is tagged with a marker string (`"__project": "lecture-notes-generator"`) so `scripts/setup` re-installs are idempotent: it strips only entries carrying our marker before re-inserting the template, leaving any hand-added hooks (or Claude Code's own auto-managed keys such as `permissions.allow`) untouched

**Dependencies installed:**
- Runtime: `openai`, `@elevenlabs/elevenlabs-js`, `fluent-ffmpeg`, `pdfjs-dist`, `canvas`, `sharp`, `chrono-node`, `pino`, `cli-progress`, `@inquirer/prompts`, `dotenv`
- Dev: `typescript`, `tsx`, `@biomejs/biome`, `eslint`, `typescript-eslint`, `vitest`, `nock`, `@types/node`, `@types/fluent-ffmpeg`

**Acceptance:**
- `tsc --noEmit`, `biome check`, and `eslint .` all pass on the empty project skeleton
- After `./scripts/setup`: `lecture-notes --help` runs from any directory; a deliberately mis-formatted `Edit` triggers biome auto-fix via the PostToolUse hook; a `git commit` attempt with a tsc error is blocked by the PreToolUse hook

---

## Phase 2 — Shared Types and Utilities

**Goal:** Define all contracts, utilities, and client infrastructure that stages and the runner depend on.

**Deliverables:**

- `src/types/pipeline.ts` — every shared type, and `STAGE_IDS`, the ordered stage list `StageId` is derived from **(TD §4.1, §4.2, §4.7)**. Covers the stage contracts (`PipelineStage`, `StageContext`, `StageResult`, `StageCost`, `StageRunConfig`, `StageStatus`), the persisted shapes (`RunManifest`, `ManifestStageEntry`, `RunLog`, `RunLogStageEntry`, `RunType`), config (`PipelineConfig`, `StageConfig`), QA (`QaDeficiency`, `QaDeficienciesReport`), and the runner-facing `LectureMatch`, `RunOptions`, `ReportOptions`, `RunSummary`, `BatchSummary`
- `src/utils/files.ts` — `writeFileAtomic` and `cleanTmpFiles` **(TD §4.3)**; `workspacePath` and `resolveManifestPath` **(TD §4.4)**
- `src/utils/logger.ts` — `createRootLogger`, `createStageLogger` **(TD §10, Logging and Progress Helpers)**
- `src/utils/date.ts` — `extractDate`, `formatDateISO` **(TD §3.2, Date and Naming Helpers)**
- `src/utils/naming.ts` — `extractProvisionalTitle`, `lectureFolderName` **(TD §3.2)**; `filenameSafe` **(TD §4.4)**
- `src/utils/progress.ts` — `createProgressBar`, `createUploadProgressStream`, `createParallelWorkBar` **(TD §10)**. `createUploadProgressStream` moves out of `src/index.ts`
- `src/utils/cost.ts` — `accumulateCost`, `createMoneyFormatter`, `formatCostReport` **(TD §7, Cost Module)**
- `src/pipeline/config.ts` — `loadConfig`, plus the model-ID resolution check and its provider exemptions **(TD §6)**
- `src/pipeline/openrouter.ts` — `createOpenRouterClient`, `makeCompletionCall`, and the exported `ContextLengthError` **(TD §6)**

**Tests:**

`date.ts`, `naming.ts` — unit tests using `test.each`:
- `should extract correct date when filename format is [format]` — parametrised across: `2025-10-10 BOD_...`, `10 Oct 2025 ...`, `Fri 10th Oct ...`, filename with no date (expect `null`)
- `should extract provisional title when filename is [sample]` — parametrised across samples covering a full descriptive title, a module-code prefix, trailing artefacts, day names, and a minimal date-plus-number filename
- `filenameSafe` — `test.each` covering path separators, `..`, `.`, null bytes, control chars, whitespace-only input, trailing dots, and empty result (expect throw)

`files.ts` — integration tests (real temp directory):
- `should write file and remove .tmp when write succeeds`
- `should leave no partial file when write fails`
- `should delete all .tmp files when cleanTmpFiles called`
- `resolveManifestPath` — `test.each` covering: in-workspace path (accepted), `..` escape into `Final output/` under moduleRoot (accepted), `..` escape outside moduleRoot (rejected), symlink pointing outside moduleRoot (rejected after realpath), absolute path (rejected)

`cost.ts` — unit tests:
- `accumulateCost` — `test.each` across combinations including zeros and nulls
- `formatCostReport` — snapshot test (serialisation format regression only)

`config.ts` — HTTP interceptor tests using `nock`:
- `should throw ConfigError naming the offending stage when a configured modelId is not in the OpenRouter models response`
- `should throw ConfigError with a helpful hint when a placeholder like <REASONING_MODEL> is left un-substituted`
- `should accept the config when every stage modelId appears in the OpenRouter response`
- `should skip the model-ID check when --skip-model-check is set` — for offline test runs

`openrouter.ts` — HTTP interceptor tests using `nock`:
- `should send correct baseURL, headers, and model ID when makeCompletionCall invoked`
- `should await cost lookup before makeCompletionCall promise resolves` — verify no unresolved cost promise leaks
- `should populate totalCostUsd when generation endpoint returns cost`
- `should resolve with totalCostUsd null and costResolutionError set when cost lookup fails after all retries`
- `should retry cost lookup with exponential backoff on transient failure`
- `should retry completion call with exponential backoff when response is 429`
- `should throw typed ContextLengthError when model returns context length exceeded`
- `should throw after 120s when completion request times out`
- `should time out cost lookup after 30s per attempt`

`openrouter.integration.test.ts` — live tests against real OpenRouter (not run in CI):
- `should complete a minimal prompt and return a fully-resolved non-zero cost when called with valid API key`

**Acceptance:** All unit and integration tests pass; `tsc --noEmit` clean.

---

## Phase 3 — Pipeline Runner and CLI Entry Point

**Goal:** Orchestration layer that drives stages through their full lifecycle. Built against stub stages to verify correctness before any real stage is implemented.

**Deliverables:**

`src/pipeline/runner.ts` — the `PipelineRunner` class and its supporting module-level functions (`runStage`, `assembleContext`, `updateManifest`, `deriveRunId`, `classifyRunType`). Full surface and behaviour in **TD §4.7**.

`src/index.ts` — CLI entry point. Invoked in docs and examples as `lecture-notes <cmd>` via the `bin/lecture-notes` wrapper installed by `scripts/setup`. During dev without the wrapper, equivalent to `pnpm exec tsx src/index.ts <cmd>`.
- Commands: `run <date>`, `batch [<moduleRoot>]`, `cost-report [--date <YYYY-MM-DD>] [--module <moduleRoot>]`
- Flags: `--from-stage <stageId>`, `--concurrency N`, `--continue-on-error`
- Behaviour of each — including the multi-match picker, batch scope, and what `--from-stage` resets and deletes — is specified in **TD §4.7**. The identity-mutation commands (`rename`, `delete`, `change-date`) land with this deliverable too

**Tests:**

Runner lifecycle — integration tests (real temp directory with fixture manifests and stub stages):
- `should transition stage status to complete when stage run succeeds`
- `should transition stage status to failed when stage run throws`
- `should mark stage skipped when isComplete returns true before run`
- `should record not-reached in run log when upstream stage fails`
- `should reset nominated stage and all downstream stages to pending when --from-stage invoked`
- `should leave upstream stages untouched when --from-stage invoked`
- `should create timestamped run log file in runs/ for each invocation`

`assembleContext` — unit test:
- `should assemble StageContext from manifest fields and CLI options`

`resolveLecturesByDate` — integration tests (real temp directory with two fixture module trees):
- `should return empty array when no manifest matches the date`
- `should return single match when only one module contains the date`
- `should return all matches when the date appears in multiple modules`
- `should include moduleRoot, workspaceRoot, lectureNumber, and lectureTitle in every match`
- `should skip module directories that contain no Pipeline processing/ folder`

**Acceptance:** Runner drives stub stages through all lifecycle states correctly; manifest and run logs written atomically to real temp directory; multi-module resolver returns correct matches for 0/1/N cases.

---

## Phase 4 — Stage 0: Source Normalisation

**Goal:** Reliable batch normalisation of source files. The most file-system-intensive stage — correctness here gates all downstream work.

**Deliverables:**

`src/pipeline/stages/source-normalisation.ts` — the whole of **TD Stage 0**: date parsing and lecture numbering, slide-to-video matching, provisional titles, collision-safe renaming, workspace and manifest creation, renumbering on re-run, and the orphan direct-deletion guard (NFR-4.3).

The CLI identity-mutation commands that drive this same machinery — `rename`, `delete`, `change-date` (FR-6.7, TD §4.7) — are built with the CLI, not in this phase.

**Tests:**

Note: `extractDate` and `extractProvisionalTitle` unit tests are covered in Phase 2. Stage-level tests focus on observable stage behaviour.

Integration tests (real temp directory with fixture source files):
- `should assign correct lecture numbers when lectures sorted by date` — `test.each` across straight sequence and mid-sequence insertion
- `should renumber all affected lectures when new lecture inserted between existing dates`
- `should match slide PDF to video when dates align`
- `should log an error and stop without filesystem changes when a source anomaly is found` — `test.each` for: undateable file, unmatched video, unmatched slide, duplicate video date, duplicate slide date
- `should rename source files atomically when normalisation runs`
- `should create workspace folder and write initial manifest when lecture is new`
- `should seed initial manifest with lectureTitle equal to provisionalTitle and userTitle and aiDerivedTitle null`
- `should name an existing lecture from its manifest lectureTitle when the title changed after Stage 0`
- `should produce no filesystem changes when Stage 0 re-run on already-normalised sources`
- `should delete the workspace and its Final output PDF when an orphaned lecture is approved` — `test.each` for one orphan and for several orphans all approved
- `should renumber the remaining lectures and log the prior number, title, date, and cost when an orphan is deleted`
- `should abort without filesystem changes when a confirmation is declined` — `test.each` for: an orphan declined, the final confirmation declined
- `should not prompt when every workspace still has its source pair`

**Acceptance:** Given a folder of raw video and slide files, Stage 0 produces correct workspace folders, manifests, renamed source files, and handles mid-sequence insertion correctly.

---

## Phase 5 — Stages 1 & 2: Audio Extraction and Transcription

**Goal:** The first two `PipelineStage` implementations, and the first stages the runner drives end-to-end. Built fresh from the contract, not ported from `src/index.ts` — the prototype supplies the proven API parameters and nothing else.

**Deliverables:**

`src/pipeline/config.ts` — three new required keys, `modelIdCheck.exemptProviders`, `elevenLabs.costPerAudioHourUsd`, and `currency.gbpPerUsd`, each specified in **TD §6**. `pipeline-config.json` gains all three plus a `transcription` stage entry.

`src/utils/cost.ts` — present all user-facing costs in pounds **(TD §7, NFR-2.3)**.

`src/pipeline/stages/pipeline-stage.ts` — the shared `isComplete` check and the stage factory every per-lecture stage is assembled through **(TD §4.2)**. Both stages need identical completeness logic, so it is written once.

`src/utils/files.ts` — `produceFileAtomic`, the caller-produces form of `writeFileAtomic`, needed because Stage 1's bytes come from ffmpeg rather than from memory **(TD §4.3)**.

`src/utils/errors.ts` — `errorMessage`, the narrowing every catch site repeats **(TD §8)**.

`src/pipeline/stages/audio-extraction.ts` — the whole of **TD Stage 1**: locating the source video by workspace base name whatever its extension, the fluent-ffmpeg `-acodec copy` extraction and its progress bar, and the `.tmp`-sibling write. Makes no billable call, so its cost is `null`.

`src/pipeline/stages/transcription.ts` — the whole of **TD Stage 2**: the Scribe v2 call and its parameters, stripping the provider prefix from the configured model ID, upload progress via `createUploadProgressStream`, and cost derived from audio duration × the configured rate.

Both are the first real `PipelineStage` implementations, so each defines its own `TInput`/`TOutput` pair.

**Tests:**

Config loader — integration tests:
- `should skip the OpenRouter check when a model ID names an exempt provider`
- `should still check a model ID when its provider is not exempt`
- `should throw ConfigError when a required currency or ElevenLabs field is missing or not a number`

Cost reporting — unit tests:
- `should render every total in pounds when the stored figures are in dollars`
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

Shared stage helper — integration tests (real filesystem):
- `should report incomplete when the manifest status is $status`
- `should report incomplete when a recorded output file has been deleted`
- `should throw ManifestPathError when a recorded path escapes the module root`

Integration tests (`.integration.test.ts`) against a real audio/video fixture the test renders itself with ffmpeg, so no binary is committed:
- `should produce valid m4a output when extracting the audio track from a real video file`
- `should return transcript text when audio file uploaded to ElevenLabs`

The transcription integration test streams a real file through the real SDK but keeps the ElevenLabs endpoint stubbed with `nock`: the external API is mocked as CLAUDE.md requires, and the suite never spends money or depends on a live key.

**Acceptance:** Both stages implement `PipelineStage<T, U>` and are driven correctly by the runner; all existing transcription behaviour is preserved.

---

## Phase 6 — Stage 3: Transcript Structuring

**Goal:** Single LLM call to structure the transcript and determine the lecture title; conditional source file rename.

**Deliverables:**

`src/pipeline/stages/transcript-structuring.ts` **(TD Stage 3)** — a single JSON-mode LLM call that judges the lecturer's provisional title against the transcript and structures the transcript into markdown, then performs the conditional source/folder/PDF rename. Implement to TD Stage 3, which specifies the response contract, the prefer-the-original title judgement, the `aiDerivedTitle`/`lectureTitle` semantics, the rename rules, and the structuring rules (headings, filler removal, LaTeX, Q&A blockquotes, no added content). Output: `Structured transcript/structured-transcript.md`.

**Tests:**

Unit tests (mock `makeCompletionCall`):
- `should extract structured markdown and keep the provisional title when LLM judges it meaningful`
- `should store suggestedTitle as aiDerivedTitle when LLM judges the provisional not meaningful`
- `should leave aiDerivedTitle null when LLM judges the provisional meaningful`

Integration tests (real temp directory) — `test.each` across both `provisionalTitleMeaningful` verdicts:
- `should rename source video, slide, workspace folder, and update manifest when provisionalTitleMeaningful is false`
- `should overwrite manifest.lectureTitle with aiDerivedTitle when provisionalTitleMeaningful is false`
- `should leave manifest.lectureTitle unchanged (still equal to provisionalTitle) when provisionalTitleMeaningful is true`
- `should leave all files unchanged when provisionalTitleMeaningful is true`

**Acceptance:** Stage produces `structured-transcript.md`; renames files correctly per the conditional logic; runner context reflects updated `lectureTitle` for downstream stages.

---

## Phase 7 — Stage 4: Slide Conversion

**Goal:** Vision LLM extraction of content from each slide, with intra-stage resumability and controlled concurrency.

**Deliverables:**

`src/pipeline/stages/slide-conversion.ts` — the whole of **TD Stage 4**: PDF-to-PNG rendering, the per-slide vision call and its prompt, intra-stage resumability, bounded concurrency, the in-flight progress bar, concatenation, and `--from-stage` cleanup.

**Tests:**

Unit tests (mock `makeCompletionCall`; mock `pdfjs-dist`):
- `should skip slide when per-slide markdown already exists`
- `should concatenate all per-slide markdown files with correct separators and headings`

Integration tests (real temp directory; real small PDF fixture):
- `should render PDF pages to PNG files at correct resolution`
- `should resume from correct slide when per-slide files pre-exist`
- `should delete all raw/ files before processing when --from-stage invoked`
- `should remove .tmp files at stage start`

**Acceptance:** All slides extracted; simulated crash at slide N resumes from slide N on next run; `--from-stage` forces fresh extraction from slide 1.

---

## Phase 8 — Stage 5: Image Extraction and Labelling

**Goal:** Identify academic figures within each slide PNG, crop them with `sharp`, and produce an `images-manifest.json`.

**Deliverables:**

`src/pipeline/stages/image-extraction.ts` — the whole of **TD Stage 5**: the per-slide vision call and its figure schema, the relevance and type exclusions, percentage-to-pixel cropping with `sharp`, the per-figure PNG and caption files, and `images-manifest.json`.

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

## Phase 9 — Stage 6: Synthesis

**Goal:** Single LLM call assembling transcript, slide content, and figure captions into textbook-style notes in British English.

**Deliverables:**

`src/pipeline/stages/synthesis.ts` — the whole of **TD Stage 6**: context assembly from the structured transcript, slide content, and figure captions; the token-budget estimate and the chunking fallback above it; and the synthesis prompt and its output structure.

**Tests:**

Unit tests:
- `should estimate token count within acceptable margin when given inputs of known size`
- `should identify chunk boundary when transcript heading matches slide heading` — `test.each` across aligned, partially aligned, and misaligned heading pairs
- `should include image at correct relative path when figure present in manifest` — `test.each` across different `outputRelativePath` values
- `should activate chunking fallback when total token estimate exceeds threshold`
- `should produce single-call output when total token estimate is within threshold`

**Acceptance:** Output is valid markdown with correct relative image references; chunking fallback activates and produces coherent output when input exceeds the token threshold.

---

## Phase 10 — Stage 7: QA Loop

**Goal:** Iterative quality check and revision cycle; writes the final `Output/notes.md`.

**Deliverables:**

`src/pipeline/stages/qa-loop.ts` — the whole of **TD Stage 7**: the two-prompt checker/reviser design and both prompts, the per-type reviser action table (including the NFR-1.3 prohibition on grounding an unsupported claim in a new source), the per-iteration files, all three loop-termination conditions, and the final `Output/` write.

**Tests:**

Unit tests (mock `makeCompletionCall` via `nock`) — `test.each` across all three termination conditions:
- `should terminate with qa-passed when checker returns overallVerdict pass`
- `should terminate with max-iterations-reached when iteration count reaches configured maximum`
- `should terminate with stalled when deficiency count is identical across two consecutive iterations`
- `should record correct terminationReason in manifest for each termination condition`
- `should include all eight QaDeficiency.type values with definitions in the checker prompt`
- `should include the per-type action table in the reviser prompt`
- `should explicitly forbid external grounding and restrict unsupported-claim remedies to removal in the reviser prompt` — grep the constructed prompt for the prohibition

Integration tests (real temp directory):
- `should write Output/notes.md and copy figures to Output/images/ on termination`
- `should write per-iteration deficiency and revised files atomically`

**Acceptance:** Loop terminates correctly under all three conditions; final output written atomically; manifest reflects termination reason and iteration count.

---

## Phase 11 — Stage 8: PDF Generation

**Goal:** Convert `Output/notes.md` to PDF via pandoc and deposit in `Final output/`.

**Deliverables:**

`src/pipeline/stages/pdf-generation.ts` — the whole of **TD Stage 8**: the cached `pandoc` and `xelatex` pre-flight checks and their install hints, the `spawn` invocation with its explicit argv array, stderr capture on a non-zero exit, and the output filename assembled from `StageContext` through `filenameSafe` (TD §4.4).

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

## Phase 12 — End-to-End Validation

**Goal:** Run the full pipeline against a real lecture and verify output quality and pipeline mechanics.

**Activities:**
1. Run Stage 0 against the Biology of Disease source folder; verify workspace folders and renamed source files
2. Run full pipeline on one lecture; verify manifest state and run log after each stage
3. Verify the three-section cost report is correct and matches run log data
4. Verify the final PDF opens and is readable
5. Simulate a mid-run failure (kill process during Stage 4); verify resumability on restart
6. Run `--from-stage slide-conversion` on a completed lecture; verify fresh extraction and downstream re-run
7. Add a new lecture to the source folder; re-run Stage 0; verify re-numbering propagates correctly
8. Run batch mode across all lectures; verify sequential processing and batch summary output

**Acceptance:** Full pipeline produces a readable, well-structured PDF from a real lecture video and slides; all pipeline mechanics (resumability, re-runs, re-numbering, cost reporting) work correctly against real data.
