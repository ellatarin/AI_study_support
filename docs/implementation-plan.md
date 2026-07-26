# Lecture Notes Generator — Implementation Plan

**Suite version:** 1.6-draft — shared across requirements, technical design, and implementation plan; any substantive edit to any of the three bumps this number in all three
**Date:** 2026-07-26
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

`src/types/pipeline.ts` — all shared types **(TD §4.2, §4.7)**. All declared as `type` aliases (never `interface`) per CLAUDE.md:
- `StageId` union
- `StageStatus` union (`pending | running | complete | failed | skipped`)
- `PipelineStage<TInput, TOutput>`, `StageContext`, `StageResult<TOutput>`, `StageCost`, `StageRunConfig`
- `RunManifest`, `ManifestStageEntry`
- `QaDeficiency`, `QaDeficienciesReport`
- `PipelineConfig`, `StageConfig`
- `RunLog`, `RunLogStageEntry`, `RunType`
- `LectureMatch`, `RunOptions`, `ReportOptions`, `RunSummary`, `BatchSummary` (runner-facing)

`src/utils/files.ts` — atomic write helpers **(TD §4.3)** and path validation **(TD §4.4)**:
- `writeFileAtomic({ path, content })` — writes to `.tmp`, renames on success
- `cleanTmpFiles(dir)` — deletes any `.tmp` files in a directory
- `workspacePath({ workspaceRoot, segments })` — resolves an absolute path from trusted, code-supplied segments (no boundary check; untrusted paths use `resolveManifestPath`)
- `resolveManifestPath({ workspaceRoot, moduleRoot, entry })` — resolves an entry from `filesWritten`, then `realpath`, then asserts the result is under `moduleRoot`; throws `ManifestPathError` if not. Used everywhere a manifest-derived path reaches the filesystem.

`src/utils/logger.ts` — pino setup **(TD §10)**:
- `createRootLogger({ runTimestamp })` — root logger writing newline-delimited JSON to `runs/<runTimestamp>-debug.log` (`sync: false`, `mkdir`, file-only); takes the run timestamp so the debug log shares it with the run log
- `createStageLogger({ logger, stageId })` — returns a child logger with `{ stage }` binding
- File-only: no debug output reaches stdout/stderr. User-facing info/warning/error messaging (Output Streams table, §10) is emitted by the CLI/runner, not this logger

`src/utils/date.ts` — date parsing:
- `extractDate(filename)` — uses `chrono-node` to extract a `Date` from a filename; returns `null` if no date found with sufficient confidence
- `formatDateISO(date)` — `YYYY-MM-DD`

`src/utils/naming.ts` — title and folder naming:
- `extractProvisionalTitle(filename)` — best-effort title: strips whichever of the date, day names, module-code prefix (`BOD_`, `BOD `), embedded lecture-number token (e.g. `Lecture 1`, which would otherwise duplicate the assigned number), and trailing artefacts (`co`, `copy`, `v2`) are present, then title-cases the result. Filenames vary; a thin or even empty result is acceptable (a date-plus-number filename leaves nothing) — the caller falls back and Stage 3's LLM judges title meaningfulness once the transcript exists (TD Stage 3)
- `lectureFolderName({ lectureNumber, title, date })` — canonical folder/filename format
- `filenameSafe(title)` — strips path separators (`/`, `\`), traversal segments (`.`, `..`), null bytes, and ASCII control chars; collapses whitespace; trims leading/trailing whitespace and dots; throws if the result is empty **(TD §4.4)**

`src/utils/progress.ts` — cli-progress helpers:
- `createProgressBar({ format, formatValue? })` — shared `SingleBar` factory (preset + hideCursor) reused by the other two helpers so bar construction lives in one place; `formatValue` supports e.g. byte→MB display
- `createUploadProgressStream(totalBytes)` — Transform stream + bar (moved from `src/index.ts`)
- `createParallelWorkBar({ label, total })` — returns `{ bar, start, pick, complete, fail, stop }`. Wraps a `SingleBar` pre-configured with the in-flight-suffix format from TD Stage 4. `pick(id)` adds an id to the in-flight set; `complete(id)` removes it and ticks the bar; `fail(id)` marks the item red in the final render. Used by Stages 4 and 5. Non-TTY fallback delegated to `cli-progress` defaults.

`src/utils/cost.ts` — cost utilities:
- `accumulateCost({ current, incoming })` — merges two `StageCost` objects
- `formatCostReport({ runLogs, manifest })` — returns the three-section report string **(TD §7)**

`src/pipeline/config.ts` — config loader:
- `loadConfig(projectRoot)` — reads and validates `pipeline-config.json`; throws on missing required fields
- **Model-ID resolution check:** at startup, fetches `https://openrouter.ai/api/v1/models` once and asserts every configured `stages[*].modelId` appears in the response. On any miss, throws a `ConfigError` naming the stage(s) with unrecognised IDs and linking to `https://openrouter.ai/models`. This catches placeholder strings (e.g. `<REASONING_MODEL>` left un-substituted), typos, and retired IDs before any billable call is made. The check is cached in-process; a `--skip-model-check` flag exists for offline runs against a mocked SDK.

`src/pipeline/openrouter.ts` — OpenRouter client **(TD §6)**:
- Exports a configured `OpenAI` instance pointing at OpenRouter
- `makeCompletionCall({ messages, stageId, config })` — wraps the SDK call; fetches cost from `/api/v1/generation`; returns `{ content, cost: StageCost }`

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

`src/pipeline/runner.ts` — `PipelineRunner` class **(TD §4.7)**. All method signatures use a single options object per CLAUDE.md:
- `normaliseSources({ moduleRoots })` — invokes Stage 0 across every listed module
- `runLecture({ workspaceRoot, options })` — assembles `StageContext`, runs stages in order, writes run log
- `runBatch({ moduleRoots, options })` — one module or many; sequential by default; `--concurrency N` for parallel
- `costReport({ moduleRoots, options })` — aggregates run logs across the given modules, prints three-section report
- `resolveLecturesByDate({ moduleRoots, lectureDate })` — returns matches from scanning `${moduleRoot}/Pipeline processing/*/manifest.json`
- `private runStage({ stage, context })` — handles the full status lifecycle:
  - Calls `isComplete()` → sets `skipped` if true
  - Writes `running` to manifest before invoking `run()`
  - On success: writes `filesWritten` to manifest, sets `complete`
  - On exception: sets `failed`, writes `error` and `failedAt`
  - Appends stage outcome to the active run log
- `private assembleContext({ workspaceRoot, moduleRoot, config })` — reads manifest at `workspaceRoot`, builds `StageContext` **(TD §4.7)**
- `private updateManifest({ workspaceRoot, update })` — atomic manifest write via `writeFileAtomic`
- `private createRunLog({ workspaceRoot, options })` — creates timestamped run log file in `runs/`

`src/index.ts` — CLI entry point. Invoked in docs and examples as `lecture-notes <cmd>` via the `bin/lecture-notes` wrapper installed by `scripts/setup`. During dev without the wrapper, equivalent to `pnpm exec tsx src/index.ts <cmd>`.
- Commands:
  - `lecture-notes run <date>` — resolves the date across `config.moduleRoots`; 0 matches → error, 1 → run it, N → interactive picker (`@inquirer/prompts` checkbox with "All matches" and "Cancel") calling `runLecture` per selection
  - `lecture-notes batch [<moduleRoot>]` — with an arg, runs that module; without, runs every configured module
  - `lecture-notes cost-report [--date <YYYY-MM-DD>] [--module <moduleRoot>]` — aggregates by default; narrows with either flag; `--date` uses the same picker on multi-match
- Flags: `--from-stage <stageId>`, `--concurrency N`, `--continue-on-error`
- `--from-stage` resets nominated stage and all downstream stages to `pending` in manifest; deletes intermediate files for those stages (using hard-coded per-stage directories per TD §4.4, not manifest input)

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

`src/pipeline/stages/source-normalisation.ts` **(TD Stage 0)**:
1. Parse date from each video filename using `extractDate`
2. Sort by date; assign sequential lecture numbers
3. Match each slide PDF (date at start of filename) to its video
4. Extract a best-effort provisional title (adequacy judged later, at Stage 3)
5. Rename source files atomically (temp name → final name to avoid collision)
6. Create workspace folders; write initial `manifest.json` for new lectures — including `lectureTitle = provisionalTitle` and `aiDerivedTitle = null` (Stage 3 may overwrite both)
7. On re-run after new lectures added: detect sequence changes, rename all affected workspace folders, source files, and any `Final output/` PDFs; update `lectureNumber` in affected manifests

**Tests:**

Note: `extractDate` and `extractProvisionalTitle` unit tests are covered in Phase 2. Stage-level tests focus on observable stage behaviour.

Integration tests (real temp directory with fixture source files):
- `should assign correct lecture numbers when lectures sorted by date` — `test.each` across straight sequence and mid-sequence insertion
- `should renumber all affected lectures when new lecture inserted between existing dates`
- `should match slide PDF to video when dates align`
- `should log warning and continue when source file has no matching counterpart` — `test.each` for unmatched video and unmatched slide
- `should rename source files atomically when normalisation runs`
- `should create workspace folder and write initial manifest when lecture is new`
- `should seed initial manifest with lectureTitle equal to provisionalTitle and aiDerivedTitle null`
- `should produce no filesystem changes when Stage 0 re-run on already-normalised sources`

**Acceptance:** Given a folder of raw video and slide files, Stage 0 produces correct workspace folders, manifests, renamed source files, and handles mid-sequence insertion correctly.

---

## Phase 5 — Stages 1 & 2: Audio Extraction and Transcription

**Goal:** Refactor the existing proof-of-concept code in `src/index.ts` into `PipelineStage` implementations.

**Deliverables:**

`src/pipeline/stages/audio-extraction.ts` **(TD Stage 1)**:
- Implements `PipelineStage<AudioExtractionInput, AudioExtractionOutput>`
- Preserves existing behaviour: `fluent-ffmpeg`, `-acodec copy`, `cli-progress` bar
- Input: path to source video; Output: `Audio/audio.m4a`

`src/pipeline/stages/transcription.ts` **(TD Stage 2)**:
- Implements `PipelineStage<TranscriptionInput, TranscriptionOutput>`
- Preserves existing behaviour: ElevenLabs `scribe_v2`, `languageCode: 'eng'`, `noVerbatim: true`
- Upload progress via `createUploadProgressStream` (from `progress.ts`)
- Output: `Transcript/transcript.txt`

**Tests:**

Unit tests (mock ffmpeg via child process stub; mock ElevenLabs via `nock`):
- `should skip audio extraction when output file exists and stage is complete`
- `should skip transcription when output file exists and stage is complete`
- `should pass bytes through unchanged when upload progress stream processes a chunk`
- `should return correct filesWritten list when stage completes`

Integration tests (`.integration.test.ts`) against a small real test audio/video fixture — not run in CI:
- `should extract audio track from video file producing valid m4a output`
- `should return transcript text when audio file uploaded to ElevenLabs`

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

`src/pipeline/stages/slide-conversion.ts` **(TD Stage 4)**:
1. Render each PDF page to `Slide content/raw/slide-{003d}.png` at 150 DPI using `pdfjs-dist` + `canvas`
2. For each slide, check if `slide-{003d}.md` already exists — skip if so (resumability)
3. Make vision LLM call; write result to `Slide content/raw/slide-{003d}.md` immediately
4. Concurrency controlled by `config.stages['slide-conversion'].concurrency` (default 3)
5. `.tmp` cleanup at stage start
6. Concatenate all per-slide markdown into `Slide content/slides.md` with `---` separators and `### Slide N` headings
7. On `--from-stage slide-conversion`: delete all files in `Slide content/raw/` before processing

**Prompt design notes:**
- Per-slide prompt includes: slide number, total slides, lecture title, instructions to reproduce all text exactly, describe diagrams fully (structure, labels, arrows), reconstruct tables, render formulas as LaTeX, note slide purpose

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

`src/pipeline/stages/image-extraction.ts` **(TD Stage 5)**:
1. For each slide PNG, make a vision LLM call returning the figure schema (bounding boxes as percentages, caption, `academicRelevance`, `figureType`)
2. Discard figures where `academicRelevance: 'exclude'` or `figureType` is `logo` / `decorative`
3. Crop each accepted figure from the slide PNG using `sharp` (convert percentage bounds to pixel coordinates)
4. Save to `Slide images/slide-{003d}-figure-{02d}.png` and `slide-{003d}-figure-{02d}-caption.md`
5. Write `Slide images/images-manifest.json` atomically after all slides processed
6. `outputRelativePath` in the manifest is relative to `Output/` for use in synthesis **(TD Stage 5)**

**Prompt design notes:**
- Instruct the LLM to be conservative: only include figures that a student would meaningfully benefit from seeing in their notes
- Request JSON-mode response matching the figure schema

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

`src/pipeline/stages/synthesis.ts` **(TD Stage 6)**:
- Assemble context: `structured-transcript.md` + `slides.md` + figure captions from `images-manifest.json` (captions and filenames only — not the images)
- Estimate total token count before calling; if > ~80,000 tokens, activate chunking fallback:
  - Align transcript sections to slide sections by heading similarity
  - Synthesise each bundle independently
  - Coherence pass to smooth transitions
- Output: `Synthesised notes/synthesised-notes.md`

**Prompt design notes:**
- Specify: formal British English prose (not bullet lists), H2 major topics, H3 sub-topics, transcript provides narrative voice, slides provide structural anchors, image references as `![caption](outputRelativePath)`, Key Concepts box at end of each H2 section, Glossary at end
- Explicitly prohibit adding content not present in the sources

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

`src/pipeline/stages/qa-loop.ts` **(TD Stage 7)**:
- **Checker call:** source materials + current draft → `QaDeficienciesReport` (JSON mode)
- **Reviser call:** current draft + deficiencies report → revised draft
- Loop termination conditions:
  1. `overallVerdict === 'pass'`
  2. `currentIteration >= maxQaIterations` (from config, default 3) — log warning
  3. Two consecutive iterations with identical deficiency count and no severity change — log stall warning
- Per-iteration files: `QA iterations/qa-iteration-{02d}-deficiencies.json`, `QA iterations/qa-iteration-{02d}-revised.md`
- `terminationReason` written to manifest (`qa-passed | max-iterations-reached | stalled`)
- On successful termination: write `Output/notes.md` (final revised draft) and copy accepted figures to `Output/images/`

**Prompt design notes:**
- Checker prompt: instruct to be thorough and critical; categorise every deficiency into exactly one of the eight `QaDeficiency.type` values; provide short in-prompt definitions per type; be strict about `factual-error` vs `unsupported-claim` (contradiction of the source vs. simple absence of source support); do not suggest the notes are adequate unless they genuinely are
- Reviser prompt: apply targeted fixes only; do not rewrite wholesale; preserve all correct content; branch per the type-specific action table in TD Stage 7. **Explicitly forbid the reviser from introducing content outside the provided source set** — for `unsupported-claim` the only remedy is removal (never adding a citation to an external source, which would license fabrication and violate NFR-1.3)

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

`src/pipeline/stages/pdf-generation.ts` **(TD Stage 8)**:
- **Pre-flight checks (before invoking pandoc):**
  - `pandoc --version` — verify pandoc is on PATH; on failure, throw a stage error naming the missing binary and pointing to `https://pandoc.org/installing.html` (plus the platform-specific install command: `brew install pandoc` on macOS)
  - `xelatex --version` — verify the LaTeX engine is on PATH; on failure, throw a stage error naming `xelatex` and pointing to the platform-specific LaTeX distribution (`brew install --cask mactex-no-gui` on macOS, `apt install texlive-xetex` on Debian/Ubuntu)
  - Cache both check results at process start so subsequent per-lecture invocations don't re-shell
- Invoke pandoc via `spawn` with an explicit argv array (never `exec` — see TD §4.4 "No shell interpolation"):
  ```typescript
  spawn('pandoc', [
    'Output/notes.md',
    '--resource-path', 'Output/images',
    '--pdf-engine=xelatex',
    '--output', `../../Final output/${outputFilename}`,
  ], { cwd: workspaceRoot });
  ```
- Capture stderr; on non-zero exit: include stderr content in the stage failure message. Pandoc's own stderr on a LaTeX failure is verbose but usually includes the offending line — surface it verbatim rather than trying to parse it
- `outputFilename` assembled from `StageContext` (`lectureNumber`, `lectureTitle`, `lectureDate`); each component passed through `filenameSafe` per TD §4.4

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
