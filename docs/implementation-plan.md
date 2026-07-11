# Lecture Notes Generator — Implementation Plan

**Version:** 0.1 (draft)
**Date:** 2026-07-11
**Status:** For review

---

## Overview

The pipeline is built in twelve phases. Phases 1–3 establish the project scaffold and shared infrastructure before any stage code is written. Phases 4–11 implement stages in pipeline order. Phase 12 validates the full pipeline end-to-end against a real lecture.

Testing is not a final phase — unit tests are written alongside each deliverable per the project conventions. Integration tests are noted explicitly where unit testing alone is insufficient.

Cross-references to the technical design are noted as **(TD §N)**.

---

## Phase 1 — Project Scaffolding

**Goal:** Establish the correct project structure before any feature code is written.

**Deliverables:**
- `tsconfig.json` — strict mode, `"types": ["node"]`, `moduleResolution: "bundler"`
- `biome.json` — formatting and standard linting rules, `noDefaultExport` enforced
- `eslint.config.js` — architectural rules (no cross-feature imports, restricted imports)
- `package.json` — all dependencies installed; scripts for `start`, `typecheck`, `lint`, `test`
- Directory skeleton: `src/types/`, `src/pipeline/stages/`, `src/utils/`, `docs/`
- `pipeline-config.json` — initial config with placeholder model IDs **(TD §6)**
- `.gitignore` updated to include `.env`, `*.log`, test output folders

**Dependencies installed:**
- Runtime: `openai`, `@elevenlabs/elevenlabs-js`, `fluent-ffmpeg`, `pdfjs-dist`, `canvas`, `sharp`, `chrono-node`, `pino`, `cli-progress`, `@inquirer/prompts`, `dotenv`
- Dev: `typescript`, `tsx`, `@biomejs/biome`, `eslint`, `vitest`, `nock`, `@types/node`, `@types/fluent-ffmpeg`

**Acceptance:** `tsc --noEmit`, `biome check`, and `eslint .` all pass on the empty project skeleton.

---

## Phase 2 — Shared Types and Utilities

**Goal:** Define all contracts, utilities, and client infrastructure that stages and the runner depend on.

**Deliverables:**

`src/types/pipeline.ts` — all shared types **(TD §4.2)**:
- `StageId` union
- `StageStatus` union (`pending | running | complete | failed | skipped`)
- `StageContext`, `StageResult<TOutput>`, `StageCost`
- `RunManifest`, `ManifestStageEntry`
- `QaDeficiency`, `QaDeficienciesReport`
- `PipelineConfig`, `StageConfig`
- `RunLog`, `RunLogStageEntry`, `RunType`

`src/utils/files.ts` — atomic write helpers **(TD §4.3)**:
- `writeFileAtomic(path, content)` — writes to `.tmp`, renames on success
- `cleanTmpFiles(dir)` — deletes any `.tmp` files in a directory
- `workspacePath(context, ...segments)` — resolves paths relative to `workspaceRoot`

`src/utils/logger.ts` — pino setup **(TD §10)**:
- Root logger with file transport to `runs/<timestamp>-debug.log`
- `createStageLogger(stageId)` — returns a child logger with `{ stage }` binding
- Info/warning to stdout/stderr; all debug output to file only

`src/utils/date.ts` — date parsing:
- `extractDate(filename)` — uses `chrono-node` to extract a `Date` from a filename; returns `null` if no date found with sufficient confidence
- `formatDateISO(date)` — `YYYY-MM-DD`

`src/utils/naming.ts` — title and folder naming:
- `extractProvisionalTitle(filename)` — strips date, day names, module code prefixes (`BOD_`, `BOD `), trailing artefacts (`co`, `copy`, `v2`); title-cases the result
- `isDescriptiveTitle(title)` — returns `true` if more than two meaningful words remain
- `lectureFolderName({ lectureNumber, title, date })` — canonical folder/filename format
- `filenameSafe(title)` — strips characters invalid in filenames

`src/utils/progress.ts` — cli-progress helpers:
- `createProgressBar(format)` — returns a configured `SingleBar`
- `createUploadProgressStream(totalBytes)` — Transform stream + bar (moved from `src/index.ts`)

`src/utils/cost.ts` — cost utilities:
- `accumulateCost(a, b)` — merges two `StageCost` objects
- `formatCostReport(runLogs, manifest)` — returns the three-section report string **(TD §7)**

`src/pipeline/config.ts` — config loader:
- `loadConfig(projectRoot)` — reads and validates `pipeline-config.json`; throws on missing required fields

`src/pipeline/openrouter.ts` — OpenRouter client **(TD §6)**:
- Exports a configured `OpenAI` instance pointing at OpenRouter
- `makeCompletionCall({ messages, stageId, config })` — wraps the SDK call; fetches cost from `/api/v1/generation`; returns `{ content, cost: StageCost }`

**Tests:**

`date.ts`, `naming.ts` — unit tests using `test.each`:
- `should extract correct date when filename format is [format]` — parametrised across: `2025-10-10 BOD_...`, `10 Oct 2025 ...`, `Fri 10th Oct ...`, filename with no date (expect `null`)
- `should extract provisional title when filename is [sample]` — parametrised across samples covering module code prefixes, trailing artefacts, and day names
- `should return correct isDescriptive result when title is [sample]` — parametrised

`files.ts` — integration tests (real temp directory):
- `should write file and remove .tmp when write succeeds`
- `should leave no partial file when write fails`
- `should delete all .tmp files when cleanTmpFiles called`

`cost.ts` — unit tests:
- `accumulateCost` — `test.each` across combinations including zeros and nulls
- `formatCostReport` — snapshot test (serialisation format regression only)

`openrouter.ts` — HTTP interceptor tests using `nock`:
- `should send correct baseURL, headers, and model ID when makeCompletionCall invoked`
- `should fetch cost from /api/v1/generation after each completion call`
- `should resolve with totalCostUsd: 0 when cost endpoint returns error`
- `should retry with exponential backoff when response is 429`
- `should throw typed ContextLengthError when model returns context length exceeded`
- `should throw after 120s when request times out`

`openrouter.integration.test.ts` — live tests against real OpenRouter (not run in CI):
- `should complete a minimal prompt and return non-zero cost when called with valid API key`

**Acceptance:** All unit and integration tests pass; `tsc --noEmit` clean.

---

## Phase 3 — Pipeline Runner and CLI Entry Point

**Goal:** Orchestration layer that drives stages through their full lifecycle. Built against stub stages to verify correctness before any real stage is implemented.

**Deliverables:**

`src/pipeline/runner.ts` — `PipelineRunner` class **(TD §4.6)**:
- `normaliseSources(moduleRoot)` — invokes Stage 0
- `runLecture(lectureSlug, options)` — assembles `StageContext`, runs stages in order, writes run log
- `runBatch(modulePath, options)` — sequential by default; `--concurrency N` for parallel
- `costReport(moduleRoot, options)` — aggregates run logs, prints three-section report
- `private runStage(stage, context)` — handles the full status lifecycle:
  - Calls `isComplete()` → sets `skipped` if true
  - Writes `running` to manifest before invoking `run()`
  - On success: writes `filesWritten` to manifest, sets `complete`
  - On exception: sets `failed`, writes `error` and `failedAt`
  - Appends stage outcome to the active run log
- `private assembleContext(slug, manifest, config)` — builds `StageContext` from manifest + CLI options **(TD §4.6)**
- `private updateManifest(slug, update)` — atomic manifest write via `writeFileAtomic`
- `private createRunLog(slug, options)` — creates timestamped run log file in `runs/`

`src/index.ts` — CLI entry point:
- Commands: `run <slug>`, `batch <modulePath>`, `cost-report`
- Flags: `--from-stage <stageId>`, `--concurrency N`, `--continue-on-error`, `--lecture`, `--module`
- `--from-stage` resets nominated stage and all downstream stages to `pending` in manifest; deletes intermediate files for those stages

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

**Acceptance:** Runner drives stub stages through all lifecycle states correctly; manifest and run logs written atomically to real temp directory.

---

## Phase 4 — Stage 0: Source Normalisation

**Goal:** Reliable batch normalisation of source files. The most file-system-intensive stage — correctness here gates all downstream work.

**Deliverables:**

`src/pipeline/stages/source-normalisation.ts` **(TD Stage 0)**:
1. Parse date from each video filename using `extractDate`
2. Sort by date; assign sequential lecture numbers
3. Match each slide PDF (date at start of filename) to its video
4. Extract provisional title; set `provisionalTitleIsDescriptive`
5. Rename source files atomically (temp name → final name to avoid collision)
6. Create workspace folders; write initial `manifest.json` for new lectures
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

`src/pipeline/stages/transcript-structuring.ts` **(TD Stage 3)**:
- One LLM call returning: `{ title: string; structuredMarkdown: string }`
- Prompt specifies: title must be 4–8 words, filename-safe, accurately reflects content
- Title stored as `aiDerivedTitle` in manifest; `lectureTitle` set per the conditional table
- Conditional rename when `provisionalTitleIsDescriptive: false`:
  - Source video, source slide, workspace folder, `Final output/` PDF (if present)
  - `workspaceFolderName` updated in manifest after rename
- Output: `Structured transcript/structured-transcript.md`

**Prompt design notes:**
- Ask for JSON response: `{ "title": "...", "markdown": "..." }` — use structured output / JSON mode
- Structuring instructions: H2 major topics, H3 sub-topics, filler words removed, LaTeX for maths, Q&A as blockquote, no added content

**Tests:**

Unit tests (mock `makeCompletionCall`):
- `should extract title and structured markdown when LLM returns valid JSON response`
- `should store aiDerivedTitle in manifest regardless of provisionalTitleIsDescriptive value`

Integration tests (real temp directory) — `test.each` across both `provisionalTitleIsDescriptive` values:
- `should rename source video, slide, workspace folder, and update manifest when provisionalTitleIsDescriptive is false`
- `should leave all files unchanged when provisionalTitleIsDescriptive is true`

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
- Checker prompt: instruct to be thorough and critical; list every omission, inaccuracy, and British English deviation found; do not suggest the notes are adequate unless they genuinely are
- Reviser prompt: apply targeted fixes only; do not rewrite wholesale; preserve all correct content

**Tests:**

Unit tests (mock `makeCompletionCall` via `nock`) — `test.each` across all three termination conditions:
- `should terminate with qa-passed when checker returns overallVerdict pass`
- `should terminate with max-iterations-reached when iteration count reaches configured maximum`
- `should terminate with stalled when deficiency count is identical across two consecutive iterations`
- `should record correct terminationReason in manifest for each termination condition`

Integration tests (real temp directory):
- `should write Output/notes.md and copy figures to Output/images/ on termination`
- `should write per-iteration deficiency and revised files atomically`

**Acceptance:** Loop terminates correctly under all three conditions; final output written atomically; manifest reflects termination reason and iteration count.

---

## Phase 11 — Stage 8: PDF Generation

**Goal:** Convert `Output/notes.md` to PDF via pandoc and deposit in `Final output/`.

**Deliverables:**

`src/pipeline/stages/pdf-generation.ts` **(TD Stage 8)**:
- Check pandoc is installed; fail with a clear actionable message if not
- Invoke pandoc as a child process:
  ```
  pandoc Output/notes.md
    --resource-path=Output/images
    --pdf-engine=xelatex
    --output="../../Final output/Lecture N - [title] - YYYY-MM-DD.pdf"
  ```
- Capture stderr; on non-zero exit: include stderr content in the stage failure message
- Output filename assembled from `StageContext` (`lectureNumber`, `lectureTitle`, `lectureDate`)

**Tests:**

Unit tests (mock child process spawn):
- `should construct correct pandoc command from StageContext values` — `test.each` across different lecture numbers, titles, and dates
- `should throw clear error when pandoc is not found on PATH`
- `should include pandoc stderr in failure message when pandoc exits non-zero`

Integration tests (`pdf-generation.integration.test.ts`) — requires pandoc and xelatex installed; not run in CI:
- `should produce a valid PDF file when given a small markdown input`
- `should deposit PDF in Final output/ with correct full descriptive filename`

**Acceptance:** PDF deposited in `Final output/` with the correct full descriptive filename; stage produces a clear, actionable error if pandoc is absent or xelatex fails.

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
