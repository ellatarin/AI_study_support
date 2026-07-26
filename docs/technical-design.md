# Lecture Notes Generator — Technical Design

**Suite version:** 1.6-draft — shared across requirements, technical design, and implementation plan; any substantive edit to any of the three bumps this number in all three
**Date:** 2026-07-26
**Status:** For review

---

## 1. System Overview

The system is a TypeScript/Node.js CLI tool with nine stages (Stage 0 through Stage 8). Stage 0 is a batch normalisation step across all lectures in a module. Stages 1–8 run per lecture, orchestrated by a pipeline runner that reads and writes a per-lecture run manifest. Every stage is idempotent — if its output exists and the manifest marks it complete, it is skipped.

---

## 2. Technology Stack

| Concern | Choice | Rationale |
|---|---|---|
| Language | TypeScript | Already established |
| Package manager | pnpm | Already established |
| Runtime / dev execution | Node.js + tsx | Already established |
| Audio extraction | fluent-ffmpeg | Already built |
| Transcription | ElevenLabs (`@elevenlabs/elevenlabs-js`) | Already built |
| LLM access (all new stages) | `openai` SDK pointed at OpenRouter | OpenRouter is OpenAI API-compatible; avoids bespoke client; gets retry logic and TypeScript types for free |
| PDF-to-image rendering | `pdfjs-dist` + `canvas` | Pure-Node, no system binary dependency, consistent PNG output |
| Image cropping | `sharp` | Standard Node image processing library |
| PDF generation | `pandoc` (system binary) | Gold standard for academic document conversion; excellent LaTeX equation and image support |
| Date parsing | `chrono-node` | Robust natural-language date parsing for varied source filename formats |
| CLI prompts | `@inquirer/prompts` | Already in use |
| Progress bars | `cli-progress` | Already in use |
| Logging | `pino` | Structured JSON log output; child loggers for per-stage context; file transport keeps debug output off stdout/stderr |
| Environment variables | `dotenv` | Already in use |

### Environment Variables

```
ELEVENLABS_API_KEY=...
OPENROUTER_API_KEY=...
```

---

## 3. Directory and File Structure

### 3.1 Top-Level Module Structure

```
Biology of Disease/
├── Source files/
│   ├── Video files/
│   └── Lecture slides/
├── Pipeline processing/
│   └── Lecture 1 - Disease Cell Injury and the Immune System - 2025-10-10/
│       └── (see §3.3)
└── Final output/
    ├── Lecture 1 - Disease Cell Injury and the Immune System - 2025-10-10.pdf
    └── Lecture 2 - Immunity to Infection - 2025-10-13.pdf
```

All pipeline artefacts for a lecture live inside a single named workspace folder. Files inside each folder use simple, stage-agnostic names — the folder itself carries the full lecture identity. This means re-numbering a lecture requires renaming only the folder, not any of its contents.

`Final output/` is a direct subfolder of the module root and is the human-facing deliverable. Because it is a flat folder shared across all lectures, its PDFs carry the full descriptive filename.

**Folder-name convention.** Only `moduleRoots[i]` is configurable (see §6). The subfolder names shown above — `Source files/`, `Video files/`, `Lecture slides/`, `Pipeline processing/`, `Final output/` — are fixed conventions baked into the pipeline. Every module folder that the pipeline manages MUST follow this layout. The tool creates these subfolders on demand; users should not rename them.

### 3.2 Source Files

#### Video files

Source videos may have the date in any position and any format. Stage 0 extracts the date using `chrono-node`, assigns a lecture number by date order, and produces the provisional title by stripping the date, day names (Mon–Sun), module code prefixes (e.g. `BOD_`), any embedded lecture-number token (e.g. `Lecture 1`, which would otherwise duplicate the assigned number), and trailing artefacts (`co`, `copy`) from the original filename, then title-casing the result.

| Pass | Example filename |
|---|---|
| Original (user-supplied) | `2025-10-10 BOD_Disease cell injury and the immune system Fri co.mp4` |
| After Stage 0 | `Lecture 1 - Disease Cell Injury and the Immune System - 2025-10-10.mp4` |

The provisional title is a best-effort guess from whatever the filename happens to carry — some filenames include a full descriptive title, others little more than a date and a lecture number. Whether it is good enough is not decided here. Stage 3, which reads the transcript, judges whether the lecturer's provisional title is meaningful and accurate for the content and **prefers it when it is** — a title the lecturer wrote deliberately is authoritative. Only when the provisional title is not meaningful does Stage 3 replace it:

| Provisional title | After Stage 3 |
|---|---|
| Meaningful (lecturer's title kept) | `Lecture 1 - Disease Cell Injury and the Immune System - 2025-10-10.mp4` *(unchanged)* |
| Not meaningful (replaced by Stage 3) | `Lecture 1 - Innate Immune Response - 2025-10-10.mp4` *(renamed by Stage 3)* |

#### Lecture slides

Slide PDFs are supplied with the date at the very beginning of the filename (e.g. `2025-10-10 Lecture slides.pdf`). Stage 0 matches each slide to the video with the same date and renames it on the same schedule as the video.

### 3.3 Pipeline Processing — Per-Lecture Workspace

```
Lecture 1 - Disease Cell Injury and the Immune System - 2025-10-10/
│
├── manifest.json
├── runs/
│   ├── 2025-10-10T09-00-00Z.json              # per-invocation run logs
│   └── 2025-10-10T10-30-00Z.json
│
├── Audio/
│   └── audio.m4a                              # Stage 1
│
├── Transcript/
│   └── transcript.txt                         # Stage 2
│
├── Structured transcript/
│   └── structured-transcript.md              # Stage 3
│
├── Slide content/
│   ├── raw/
│   │   ├── slide-001.md                       # per-slide extraction (Stage 4 resumability)
│   │   ├── slide-002.md
│   │   └── ...
│   └── slides.md                              # Stage 4 — concatenated
│
├── Slide images/
│   ├── images-manifest.json                   # Stage 5
│   ├── slide-003-figure-01.png
│   ├── slide-003-figure-01-caption.md
│   └── ...
│
├── Synthesised notes/
│   └── synthesised-notes.md                  # Stage 6
│
├── QA iterations/
│   ├── qa-iteration-01-deficiencies.json
│   ├── qa-iteration-01-revised.md
│   └── ...                                    # Stage 7
│
└── Output/
    ├── notes.md                               # Stage 7 final — simple name
    └── images/
        └── slide-003-figure-01.png
```

`Output/notes.md` uses a simple name because it lives inside the named lecture folder. The full descriptive filename appears only on the PDF in `Final output/` (Stage 8).

### 3.4 Re-numbering When New Lectures Are Added

If a new lecture is inserted whose date falls between existing lectures, Stage 0 re-runs across all lectures in the module, detects the changed sequence, and renames all affected items atomically (via a temporary name to avoid collision):

- Workspace folders in `Pipeline processing/`
- Source video and slide files in `Source files/`
- PDF files in `Final output/`
- Updates `lectureNumber` in each affected manifest

Because all other files inside the workspace use simple names, only the four items above need renaming per affected lecture. Manifests use relative paths throughout and survive folder renames without modification.

---

## 4. Pipeline Architecture

### 4.1 Stage Overview

| Stage | Name | Type | Description |
|---|---|---|---|
| 0 | Source Normalisation | Batch | Parse dates, extract provisional titles, assign lecture numbers, rename source files, create workspace folders |
| 1 | Audio Extraction | Per-lecture | Extract audio track from video using ffmpeg |
| 2 | Transcription | Per-lecture | Upload audio to ElevenLabs, save raw transcript |
| 3 | Transcript Structuring | Per-lecture | Determine AI title from transcript; structure transcript into markdown; conditionally rename files if original title was non-descriptive |
| 4 | Slide Conversion | Per-lecture | Render PDF slides as images; extract content via vision LLM |
| 5 | Image Extraction & Labelling | Per-lecture | Identify, label, and filter academic figures from slide images |
| 6 | Synthesis | Per-lecture | Combine transcript, slide content, and figures into textbook-style notes |
| 7 | QA Loop | Per-lecture | Iteratively check and revise notes; write final `Output/notes.md` |
| 8 | PDF Generation | Per-lecture | Convert `Output/notes.md` to PDF via pandoc; deposit in `Final output/` |

### 4.2 Stage Interface

Every stage implements a common `PipelineStage<TInput, TOutput>` contract: an idempotency check `isComplete(context)`, an input step `getInput(context)`, and `run({ input, context })` returning a `StageResult`. Stages read an immutable `StageContext` — lecture identity, `workspaceRoot`, `moduleRoot`, the resolved `PipelineConfig`, and the current `RunManifest` — and never mutate it; all manifest changes flow through the runner.

**Authoritative types.** The exact shape of every pipeline contract — `PipelineStage`, `StageId`, `StageContext`, `StageResult`, `StageCost`, `StageRunConfig`, and the rest — lives in `src/types/pipeline.ts` with per-field documentation. That file is the single source of truth; this section describes intent and the invariants those types encode, not field lists:

- `StageResult.cost` is `null` for stages that make no billable calls (audio-extraction, pdf-generation).
- `StageResult.filesWritten` holds paths relative to `workspaceRoot`, and MAY escape upward with `..` (e.g. pdf-generation writes to `../../Final output/`) but MUST resolve under `moduleRoot` — enforced by §4.4.
- `StageCost` is discriminated on `totalCostUsd`: a resolved cost is a `number`; a failed lookup is `null` paired with a `costResolutionError` (see §7).
- `lectureTitle` is always non-null — seeded at Stage 0, possibly overwritten at Stage 3 (see §3.2, Stage 3).

`isComplete()` checks two conditions: the manifest marks the stage `'complete'`, AND every path in `manifest.stages[stageId].filesWritten` exists on disk. Both must be true. This means a completed stage whose output was manually deleted returns `false` and re-runs automatically.

After a stage's `run()` succeeds, the runner writes the `filesWritten` list from `StageResult` to `manifest.stages[stageId].filesWritten` before marking the stage `complete`. These are exactly the paths `isComplete()` later verifies.

**Stage status semantics:**

| Status | Meaning |
|---|---|
| `pending` | Has not run in this pipeline configuration |
| `running` | Currently executing, or crashed mid-run — treated as `failed` on next launch |
| `complete` | `run()` succeeded and all output files are on disk |
| `failed` | `run()` threw an exception; `error` and `failedAt` are set |
| `skipped` | `isComplete()` returned `true` before the stage was invoked — output already existed from a prior run |

`skipped` is distinct from `not-reached`, the run log action used when an upstream failure prevented a stage from being attempted at all. A `skipped` stage was eligible to run; a `not-reached` stage was never considered.

### 4.3 Atomic File Writes

Every file is written to a `.tmp`-suffixed path first, then renamed on success. Any file that exists on disk without a `.tmp` suffix is guaranteed to be complete. At the start of every stage run, the stage scans its output directories and deletes any `.tmp` files left by a previous crashed run before beginning processing. This is automatic and requires no user intervention.

### 4.4 Path Validation

`filesWritten` entries and any other path derived from manifest or LLM output MUST be validated before any filesystem operation. The manifest is trusted only to the extent that the runner enforces its bounds — a corrupted or hand-edited manifest must never be able to delete, overwrite, or observe files outside the module tree.

**Boundary check.** For every path derived from the manifest or a stage's `filesWritten`:

1. Resolve with `path.resolve(workspaceRoot, entry)`.
2. Resolve the parent directory (or file, if it exists) with `fs.promises.realpath(...)` to collapse any symlinks.
3. Verify the resulting absolute path is a descendant of `moduleRoot`. Reject otherwise as a corrupt manifest.

This is enforced in every place a path from `filesWritten` or the manifest is used: `isComplete()` existence checks, `--from-stage` cleanup considerations, `cost-report` file discovery, and PDF output resolution.

**`filenameSafe(title)`.** Titles reach the filesystem via workspace folder names, source file renames, and the `Final output/` PDF name. Titles originate from user filenames (Stage 0) or LLM output (Stage 3) — neither is a trusted path component. `filenameSafe` MUST:

- Strip path separators (`/`, `\`), directory-traversal segments (`.`, `..`), null bytes, and ASCII control characters.
- Collapse whitespace runs to a single space; trim leading/trailing whitespace and dots.
- Reject an empty result — the caller must fall back to `provisionalTitle` or a stage-defined default.

**Stage cleanup boundaries.** `--from-stage <stageId>` MUST NOT drive its cleanup off `filesWritten` from the manifest. Cleanup deletes files inside a per-stage, hard-coded set of workspace subdirectories (e.g. `Slide content/raw/` for Stage 4). This ensures a corrupt manifest cannot trigger deletion of unintended files.

**No shell interpolation.** Every child-process invocation across the pipeline (fluent-ffmpeg in Stage 1, pandoc in Stage 8, any future subprocess call) MUST use `spawn(cmd, argv, opts)` with an explicit argv array — never `exec(shellString)` and never any variant that concatenates paths into a shell command. This eliminates the class of bug where folder names with spaces (`Final output/`, `Slide content/`, `QA iterations/`) or attacker-controlled title strings break out of an argument via unescaped shell metacharacters. Paths are passed verbatim as argv elements; no quoting is required or applied.

### 4.5 Run Manifest

One `manifest.json` per lecture, stored in the workspace root. All paths are relative to `workspaceRoot` so the manifest survives a folder rename.

The manifest tracks the **current pipeline state** and the cost of the most recent successful execution of each stage. Historical cost across multiple runs is the responsibility of the run logs (§4.6). Its TypeScript shape is `RunManifest` in `src/types/pipeline.ts` (single source of truth); the example below is illustrative, not the schema.

Each stage entry records `configUsed` — a `StageRunConfig` capturing the model ID and tuning parameters (temperature, max tokens, concurrency, max QA iterations) actually resolved for that run, or `null` for stages that make no LLM calls. This lets spend be attributed to a specific model and configuration and lets model experiments be compared (NFR-3.2). The run logs (§4.6) record the same `configUsed` per attempt.

```jsonc
{
  "version": "1",
  "lectureNumber": 1,
  "lectureDate": "2025-10-10",
  "provisionalTitle": "Disease Cell Injury and the Immune System",
  "aiDerivedTitle": null,
  "lectureTitle": "Disease Cell Injury and the Immune System",
  "workspaceFolderName": "Lecture 1 - Disease Cell Injury and the Immune System - 2025-10-10",
  "createdAt": "2025-10-10T09:00:00.000Z",
  "updatedAt": "2025-10-10T10:15:00.000Z",
  "stages": {
    "audio-extraction": {
      "status": "complete",          // pending | running | complete | failed | skipped
      "completedAt": "...",
      "configUsed": null,
      "cost": null,
      "filesWritten": ["Audio/audio.m4a"]
    },
    "transcription": {
      "status": "complete",
      "completedAt": "...",
      "configUsed": { "modelId": "elevenlabs/scribe_v2" },
      "cost": { "promptTokens": 0, "completionTokens": 0, "totalCostUsd": 0.042, "callCount": 1 },
      "filesWritten": ["Transcript/transcript.txt"]
    },
    "transcript-structuring": {
      "status": "complete",
      "completedAt": "...",
      "configUsed": { "modelId": "anthropic/claude-sonnet-4.6", "temperature": 0.2, "maxTokens": 8192 },
      "cost": { "promptTokens": 18400, "completionTokens": 3200, "totalCostUsd": 0.081, "callCount": 1 },
      "filesWritten": ["Structured transcript/structured-transcript.md"]
    },
    "slide-conversion": {
      "status": "complete",
      "completedAt": "...",
      "configUsed": { "modelId": "google/gemini-2.5-flash", "temperature": 0.1, "maxTokens": 4096, "concurrency": 3 },
      "cost": { "promptTokens": 41000, "completionTokens": 8100, "totalCostUsd": 0.034, "callCount": 24 },
      "filesWritten": ["Slide content/slides.md"]
    },
    "image-extraction": {
      "status": "complete",
      "completedAt": "...",
      "configUsed": { "modelId": "openai/gpt-4.1", "temperature": 0.0, "maxTokens": 2048, "concurrency": 2 },
      "cost": { "promptTokens": 0, "completionTokens": 2400, "totalCostUsd": 0.038, "callCount": 12 },
      "filesWritten": ["Slide images/images-manifest.json"]
    },
    "synthesis": {
      "status": "complete",
      "completedAt": "...",
      "configUsed": { "modelId": "anthropic/claude-sonnet-4.6", "temperature": 0.3, "maxTokens": 16384 },
      "cost": { "promptTokens": 65000, "completionTokens": 14200, "totalCostUsd": 0.312, "callCount": 1 },
      "filesWritten": ["Synthesised notes/synthesised-notes.md"]
    },
    "qa-loop": {
      "status": "complete",
      "completedAt": "...",
      "configUsed": { "modelId": "anthropic/claude-sonnet-4.6", "temperature": 0.1, "maxTokens": 8192, "maxIterations": 3 },
      "cost": { "promptTokens": 68000, "completionTokens": 15800, "totalCostUsd": 0.405, "callCount": 4 },
      "qaIterations": [
        { "iteration": 1, "verdict": "fail", "deficiencyCount": 7, "criticalCount": 2, "costUsd": 0.200 },
        { "iteration": 2, "verdict": "pass", "deficiencyCount": 0, "criticalCount": 0, "costUsd": 0.205 }
      ],
      "terminationReason": "qa-passed",
      "filesWritten": [
        "QA iterations/qa-iteration-01-deficiencies.json",
        "QA iterations/qa-iteration-01-revised.md",
        "Output/notes.md",
        "Output/images/slide-003-figure-01.png"
      ]
    },
    "pdf-generation": {
      "status": "complete",
      "completedAt": "...",
      "configUsed": null,
      "cost": null,
      "filesWritten": ["../../Final output/Lecture 1 - Disease Cell Injury and the Immune System - 2025-10-10.pdf"]
    }
  },
  "currentPipelineCost": {
    "totalCostUsd": 0.912,
    "byStage": {
      "transcription": 0.042,
      "transcript-structuring": 0.081,
      "slide-conversion": 0.034,
      "image-extraction": 0.038,
      "synthesis": 0.312,
      "qa-loop": 0.405
    }
  }
}
```

**`running` status is written before a stage begins.** A crash mid-stage leaves `running` in the manifest, which is treated as `failed` on next launch — the stage re-runs from scratch.

### 4.6 Run Logs

Every pipeline invocation creates a new log file in `runs/` named by ISO timestamp (e.g. `runs/2025-10-10T09-00-00Z.json`). Run logs are append-only and never modified after creation.

Each log records which stages were attempted, skipped, or re-run; cost and model per stage; and whether each stage succeeded or failed. This provides a complete financial audit trail including failed attempts and model experiments.

```jsonc
{
  "runId": "2025-10-10T09-00-00Z",
  "startedAt": "2025-10-10T09:00:00.000Z",
  "endedAt": "2025-10-10T09:12:00.000Z",
  "triggeredBy": "manual",          // 'manual' | 'from-stage'
  "fromStage": null,                // stageId if --from-stage was used
  "stages": {
    "audio-extraction":       { "action": "skipped" },
    "transcription":          { "action": "skipped" },
    "transcript-structuring": { "action": "skipped" },
    "slide-conversion": {
      "action": "ran",
      "status": "failed",
      "configUsed": { "modelId": "google/gemini-2.5-flash", "temperature": 0.1, "maxTokens": 4096, "concurrency": 3 },
      "error": "Rate limit exceeded after 3 retries on slide 14",
      "cost": { "totalCostUsd": 0.021, "callCount": 13 }
    },
    "image-extraction":  { "action": "not-reached" },
    "synthesis":         { "action": "not-reached" },
    "qa-loop":           { "action": "not-reached" },
    "pdf-generation":    { "action": "not-reached" }
  },
  "totalCostThisRun": 0.021
}
```

### 4.7 Pipeline Runner

The runner-facing types — `LectureMatch`, `RunOptions`, `ReportOptions`, `RunSummary`, and `BatchSummary` — are defined in `src/types/pipeline.ts` (single source of truth). The `PipelineRunner` surface:

```typescript
class PipelineRunner {
  async normaliseSources(args: { moduleRoots: readonly string[] }): Promise<void>          // Stage 0
  async runLecture(args: { workspaceRoot: string; options: RunOptions }): Promise<RunSummary>
  async runBatch(args: { moduleRoots: readonly string[]; options: RunOptions }): Promise<BatchSummary>
  async costReport(args: { moduleRoots: readonly string[]; options: ReportOptions }): Promise<void>
  async resolveLecturesByDate(args: { moduleRoots: readonly string[]; lectureDate: string }): Promise<readonly LectureMatch[]>
  private async runStage(args: { stage: PipelineStage<unknown, unknown>; context: StageContext }): Promise<void>
  private async updateManifest(args: { workspaceRoot: string; update: Partial<RunManifest> }): Promise<void>
  private createRunLog(args: { workspaceRoot: string; options: RunOptions }): RunLog
}
```

**Run outcome classification.** A `RunSummary.overallStatus` — and the aggregate `BatchSummary.overallStatus` across a batch's lectures — is `success` when every attempted stage completed, `partial` when one or more stages were skipped or not reached, and `failed` when at least one stage failed.

**`--from-stage <stageId>`:** Resets the nominated stage and all downstream stages to `pending` in the manifest. Also deletes per-stage intermediate files for the stages being re-run (e.g. `Slide content/raw/*.md` when re-running Stage 4), so the re-run produces entirely fresh output. Upstream stages are untouched. Deletion targets hard-coded per-stage directories (see §4.4) — never `filesWritten` from the manifest.

**Natural restart after failure:** Does not clear intermediate files — per-slide markdown files from Stage 4 are preserved for resumability, allowing a failed run to pick up at the slide where it stopped.

**Lecture identification:** A lecture is uniquely identified by `(moduleRoot, lectureDate)`. Stage 0 guarantees `lectureDate` is unique within a module. Across modules, dates may collide — see `resolveLecturesByDate` below.

**`resolveLecturesByDate`:** Scans every `moduleRoots[i]/Pipeline processing/*/manifest.json` and returns matches whose `lectureDate` equals the argument. Zero matches: caller decides (typically an error). One match: caller uses it directly. Multiple matches: caller (the CLI) prompts the user via `@inquirer/prompts` — checkbox list of matches (each labelled `<module name> — Lecture N — <title>`) with "All matches" and "Cancel" affordances. Interactive prompt lives in the CLI layer, not the runner.

**`StageContext` assembly:** Before invoking any stage, the runner reads `manifest.json` at `workspaceRoot` and assembles a `StageContext`. `lectureNumber`, `lectureDate`, `provisionalTitle`, `lectureTitle`, and `workspaceRoot` are sourced from the manifest. `moduleRoot` (the containing module for this lecture) and `config` come from the CLI invocation. The context is constructed once per lecture run and passed unchanged to every stage; stages must not mutate it directly — all manifest updates go through `updateManifest()`.

**Batch mode:** `runBatch({ moduleRoots })` processes every lecture across every listed module. The CLI passes an array of one for `batch <moduleRoot>` and the full `config.moduleRoots` for `batch` (no argument). Modules processed in the order given; lectures within a module in date order. Sequential by default; `--concurrency N` enables parallel processing (per-module or global — decided at the CLI layer). A per-module cost/status summary is printed after each module, followed by a cross-module aggregate.

**`cost-report` command:** Aggregates all run logs across the configured `moduleRoots` and prints a table showing total expenditure broken down by run and stage — enabling comparison of model experiments and visibility of wasted spend from failures (see §7). Narrowed by `--date` (via `resolveLecturesByDate`, with the same multi-match prompt) or `--module <moduleRoot>`.

---

## 5. Stage Designs

### Stage 0 — Source Normalisation (Batch)

**Runs across all lectures in the module at once, not per-lecture.**

**Inputs:** All files in `Source files/Video files/` and `Source files/Lecture slides/`.

**What it does:**

1. **Date extraction:** Parse the date from each video filename using `chrono-node`. Dates may appear in any position and format (e.g. `2025-10-10`, `10 Oct 2025`, `Fri 10th Oct`). Log a warning and skip any file where no date can be confidently extracted.

2. **Lecture number assignment:** Sort all video files by extracted date. Assign sequential lecture numbers (`Lecture 1`, `Lecture 2`, …) in date order. If Stage 0 is re-run after new lectures are added, detect changes in sequence and rename all affected workspace folders, source files, and `Final output/` PDFs.

3. **Slide matching:** Parse the date from each slide PDF (date always at the beginning of the filename). Match each slide PDF to the video with the same date. Log a warning for any unmatched video or slide.

4. **Provisional title extraction:** Strip whichever of the date, day names (Mon–Sun), module code prefix (e.g. `BOD_`, `BOD `), embedded lecture-number token (e.g. `Lecture 1`, which would otherwise duplicate the assigned number), and trailing artefacts (`co`, `copy`, `v2`) are present in the video filename; title-case the result. Filenames vary — some yield a full descriptive title, others little beyond a date and lecture number (in which case the provisional title may be empty and Stage 0 falls back to the bare `Lecture N` name). Whether the result is meaningful is **not** judged here; Stage 3 makes that call once the transcript is available.

5. **Rename source files:**
   - Video: `[original].mp4` → `Lecture N - [provisional title] - YYYY-MM-DD.mp4`
   - Slide: `[original].pdf` → `Lecture N - [provisional title] - YYYY-MM-DD.pdf`

6. **Workspace folder creation:** Create `Pipeline processing/Lecture N - [provisional title] - YYYY-MM-DD/` for any lecture that does not already have one. Write an initial `manifest.json` with `lectureNumber`, `lectureDate`, `provisionalTitle`, `lectureTitle = provisionalTitle` (Stage 3 may overwrite), `aiDerivedTitle = null`, and all stage statuses set to `pending`.

**Re-numbering:** When the sequence changes, Stage 0 renames affected workspace folders, source files, and `Final output/` PDFs atomically (rename to a temporary name first to avoid collision), then updates `lectureNumber` in each affected manifest.

---

### Stage 1 — Audio Extraction

**Already implemented.** Formally stage 1.

**Input:** `Source files/Video files/Lecture N - YYYY-MM-DD.mp4`
**Output:** `Audio/audio.m4a`

Extracts the audio track from the video using fluent-ffmpeg with `-acodec copy` (no re-encoding). Displays a `cli-progress` bar showing extraction percentage. The extracted audio is retained in `Audio/` for the life of the lecture workspace.

---

### Stage 2 — Transcription

**Already implemented.** Formally stage 2.

**Input:** `Audio/audio.m4a`
**Output:** `Transcript/transcript.txt`

Uploads the audio to ElevenLabs Scribe v2 with a streaming upload progress bar (bytes sent vs total). Parameters: `modelId: 'scribe_v2'`, `languageCode: 'eng'`, `noVerbatim: true`. Saves the returned plain-text transcript.

---

### Stage 3 — Transcript Structuring (includes title determination)

**Input:** `Transcript/transcript.txt`
**Output:** `Structured transcript/structured-transcript.md`
**Conditional side effect:** Rename of source video, source slide, workspace folder, and `Final output/` PDF only when the LLM judges the provisional title not meaningful.

Stage 3 makes a single JSON-mode LLM call returning `{ provisionalTitleMeaningful: boolean; suggestedTitle: string | null; structuredMarkdown: string }` — a title judgement and the structured transcript markdown. The title is resolved first; everything else in the pipeline depends on it.

#### Title Determination

The LLM receives the raw transcript **and the lecturer's provisional title**, and judges whether that title is meaningful and accurate for the lecture's content. A title the lecturer wrote is treated as authoritative: when it is meaningful the LLM **keeps it and proposes nothing**. Only when it is not meaningful does the LLM propose a concise, descriptive academic title (4–8 words) suitable for a filename, which is then stored as `aiDerivedTitle`; otherwise `aiDerivedTitle` stays `null`.

The rename is **conditional** on the LLM's judgement:

| LLM judgement | Action |
|---|---|
| Provisional meaningful | `lectureTitle` already equals `provisionalTitle` from Stage 0 — left unchanged; `aiDerivedTitle` stays `null`. No renaming. |
| Provisional not meaningful | `aiDerivedTitle` set to the proposed title and `lectureTitle` overwritten with it. Source video, source slide, workspace folder, and any existing `Final output/` PDF are renamed to include the AI-derived title. `workspaceFolderName` updated in manifest. |

`context.lectureTitle` is always non-null (see §4.2) — Stage 0 seeds it, Stage 3 may overwrite it. Downstream stages consume it directly with no null check required.

#### Transcript Structuring

The same LLM call produces the structured markdown. The LLM:
- Identifies topic boundaries from discourse markers ("Now, moving on to…", "To summarise…")
- Applies H2 headings for major topics, H3 for sub-topics
- Removes filler words only (um, uh, sort of, you know) — all substantive content preserved
- Converts spoken mathematics to LaTeX where detectable
- Marks Q&A sections as `> **Q&A:**` blockquote
- Does not add content not present in the transcript

**Context:** A 90-minute transcript is typically 15,000–30,000 tokens — a single call within any 128k-context model.

---

### Stage 4 — Slide Conversion

**Input:** `Source files/Lecture slides/Lecture N - [Title] - YYYY-MM-DD.pdf`
**Output:** `Slide content/raw/slide-{003d}.md` (one per slide), `Slide content/slides.md` (concatenated)

#### Approach: Vision LLM per slide

Native PDF text extraction is rejected for this use case. Academic biology slides contain pathway diagrams, chemical structures, multi-column tables, embedded formulas, and microscopy images. Text extraction libraries produce garbled output for all of these — column order is wrong, table structure is lost, formulas become character soup. A vision LLM sees each slide as a human does.

**Processing:**

1. Render each PDF page to a PNG at 150 DPI using `pdfjs-dist` + `canvas`. PNGs are written to `Slide content/raw/slide-{003d}.png` and also used by Stage 5.

2. For each slide, make a vision LLM call:
   > "This is slide {N} of {total} from a lecture titled '{lectureTitle}'. Extract all academic content into structured markdown. Reproduce all text exactly. Describe diagrams in full (structure, labels, arrows, relationships). Reconstruct tables with all cells and headers. Render formulas as LaTeX. Note the slide's apparent purpose (e.g. definition slide, pathway diagram, data table)."

3. Each slide's markdown is written to `Slide content/raw/slide-{003d}.md` immediately after its API call, enabling intra-stage resumability: if the process dies at slide 14, a restart skips slides 1–13.

4. Once all slides are processed, concatenate into `Slide content/slides.md` with `---` separators and `### Slide N` headings.

**Progress:** A single `cli-progress` `SingleBar` per stage with an in-flight status suffix — one line, no `MultiBar`:

```
Slide conversion  [████████░░░░░░░]  15/24  ETA 42s  | in flight: 16, 17, 18
```

Format string: `'{label}  [{bar}] {value}/{total}  ETA {eta_formatted}  | in flight: {inFlight}'`. The runner updates the bar's `payload.inFlight` array whenever a worker picks up or finishes a slide. Default concurrency: 3 parallel API calls.

**Failure behaviour:** If a slide's LLM call fails, the runner requests cancellation of the stage. Workers already in flight complete their current call (never abandoned mid-write); the stage then aborts. The final bar render highlights the failing slide's number in the status suffix so the failure point is visible in a scrollback.

**Non-TTY output:** When stdout isn't a TTY (piped to a file, CI), `cli-progress` falls back to periodic newline-delimited status prints on stderr — no cursor moves, no ANSI. The design tolerates this without special handling; runs remain readable in captured logs.

**Recommended model:** A cost-efficient vision model (e.g. `google/gemini-2.5-flash`) — this stage makes the most individual API calls.

**`.tmp` cleanup:** At the start of Stage 4, any `.tmp` files in `Slide content/` are deleted before processing begins.

**`--from-stage slide-conversion`:** Deletes all files in `Slide content/raw/` before starting, ensuring entirely fresh output rather than resuming from cached per-slide files.

---

### Stage 5 — Image Extraction and Labelling

**Input:** Slide PNGs from `Slide content/raw/slide-{003d}.png`
**Output:** `Slide images/slide-{003d}-figure-{02d}.png`, `Slide images/slide-{003d}-figure-{02d}-caption.md`, `Slide images/images-manifest.json`

For each slide PNG, a vision LLM call identifies distinct figures and their bounding boxes. `sharp` then crops each accepted figure from the slide PNG.

#### Vision LLM Response Schema (per slide)

```jsonc
{
  "figures": [
    {
      "figureIndex": 1,
      "boundingBox": { "topPct": 15, "leftPct": 5, "widthPct": 45, "heightPct": 60 },
      "caption": "Complement activation cascade showing classical, lectin, and alternative pathways converging at C3 convertase.",
      "academicRelevance": "include",
      "figureType": "pathway-diagram"
    },
    {
      "figureIndex": 2,
      "boundingBox": { "topPct": 85, "leftPct": 80, "widthPct": 18, "heightPct": 12 },
      "caption": "University logo",
      "academicRelevance": "exclude",
      "figureType": "logo"
    }
  ]
}
```

Figures with `academicRelevance: 'exclude'` or `figureType` of `logo` or `decorative` are discarded without saving. Cropped PNGs are saved using zero-padded naming: `slide-{003d}-figure-{02d}.png`.

**Progress, failure, and non-TTY behaviour:** Same convention as Stage 4 (single `SingleBar` with in-flight suffix). Default concurrency: 2 parallel API calls.

#### `images-manifest.json`

```jsonc
{
  "totalSlides": 24,
  "totalFiguresFound": 31,
  "totalFiguresIncluded": 19,
  "figures": [
    {
      "filename": "slide-003-figure-01.png",
      "captionFile": "slide-003-figure-01-caption.md",
      "slideNumber": 3,
      "caption": "Complement activation cascade…",
      "figureType": "pathway-diagram",
      "outputRelativePath": "images/slide-003-figure-01.png"
    }
  ]
}
```

`outputRelativePath` is the path used in the final output markdown, relative to the `Output/` folder.

---

### Stage 6 — Synthesis

**Inputs:**
- `Structured transcript/structured-transcript.md`
- `Slide content/slides.md`
- `Slide images/images-manifest.json` (captions and filenames; not the images themselves)

**Output:** `Synthesised notes/synthesised-notes.md`

A single LLM call assembles all three inputs into a unified textbook-style document. A 90-minute lecture typically produces 25,000–45,000 tokens of combined input — well within a 128k-context model.

**What the LLM produces:**
- Formal British English prose (not bullet lists)
- H2 for major topics, H3 for sub-topics
- Transcript provides the narrative voice; slides provide structural anchors and key points; both are woven into flowing paragraphs
- Image references at contextually appropriate positions: `![{caption}]({outputRelativePath})`
- A "Key Concepts" summary box at the end of each H2 section
- A "Glossary" section at the end defining all technical terms introduced
- No content added beyond what is present in the source materials

**Context window fallback for very long lectures (> ~80,000 input tokens):**
Align transcript sections to slide sections by heading similarity to produce paired section bundles. Synthesise each bundle independently. Concatenate, then make a lightweight "coherence pass" call that smooths transitions without re-reading the full content.

---

### Stage 7 — QA Loop

**Inputs:** All source materials + current synthesised notes draft.
**Outputs (per iteration):** `QA iterations/qa-iteration-{02d}-deficiencies.json`, `QA iterations/qa-iteration-{02d}-revised.md`
**Final output:** `Output/notes.md` and `Output/images/`

#### Two-Prompt Design

QA and revision are two separate LLM calls per iteration. Combining them in one call degrades quality — the model cannot be simultaneously maximally critical and produce fluent prose. Separating the tasks allows each to be done well.

**QA checker call:** Reads source transcript + source slides + image manifest + current draft. Returns a structured `QaDeficienciesReport`.

**QA reviser call:** Reads current draft + deficiencies report. Applies targeted edits to address each deficiency. Does not rewrite wholesale. Every remedy is grounded in the lecture's own source materials (transcript, slide content, image manifest) — the reviser MUST NOT introduce content from outside the source set. The reviser branches on `type`:

- `omission` → insert the missing content, grounded in the cited `sourceEvidence`
- `inadequate-coverage` → expand the existing passage using the cited evidence; do not add unrelated material
- `factual-error` → correct the claim against the cited source
- `unsupported-claim` → **remove** the claim. The reviser MUST NOT go looking for external corroboration — grounding an unsupported statement in a newly-cited source would violate NFR-1.3 (faithful representation) and licenses citation fabrication
- `clarity` → rewrite the passage for readability without introducing new content or altering meaning
- `british-english` / `formatting` / `figure-reference` → apply the targeted edit; no other changes

#### Deficiency Schema

The QA checker returns a `QaDeficienciesReport`: an `overallVerdict` (`pass`/`fail`), a self-assessed `coverageScore` (0–100), and a list of `QaDeficiency` items. Each deficiency carries a `severity` (`critical`/`major`/`minor`), a `type` (the eight categories listed in the reviser-branch table above, each mapped to FR-4.2/FR-4.3), a `description`, a `sourceEvidence` quote from the source material, a `suggestedFix`, and a `location`. Exact shapes and per-field/per-category documentation are the single source of truth in `src/types/pipeline.ts` (`QaDeficienciesReport`, `QaDeficiency`, `QaDeficiencyType`, `QaSeverity`).

#### Loop Termination

The loop exits when any one of the following is true:

1. `overallVerdict === 'pass'`
2. `currentIteration >= maxQaIterations` (configurable, default 3) — exits with a warning in the manifest
3. Two consecutive iterations with identical deficiency counts and no severity change — exits to prevent infinite cycling on issues the model cannot resolve

`terminationReason` in the manifest records which condition triggered the exit (`'qa-passed'`, `'max-iterations-reached'`, `'stalled'`).

On successful exit, the final revised draft is written to `Output/notes.md` and all included figures are copied to `Output/images/`. Stage 8 then converts this to the final PDF.

---

### Stage 8 — PDF Generation

**Input:** `Output/notes.md`, `Output/images/`
**Output:** `Final output/Lecture N - [title] - YYYY-MM-DD.pdf` (at module level)

Invokes `pandoc` as a child process to convert `Output/notes.md` to PDF, placing the result in `Final output/` with the full descriptive filename:

```typescript
spawn('pandoc', [
  'Output/notes.md',
  '--resource-path', 'Output/images',
  '--pdf-engine=xelatex',
  '--output', '../../Final output/Lecture N - [title] - YYYY-MM-DD.pdf',
], { cwd: workspaceRoot });
```

`xelatex` is used as the PDF engine for correct Unicode and LaTeX equation rendering. The `--resource-path` flag allows pandoc to resolve relative image references in the markdown. The output filename carries the full lecture identity since `Final output/` is a flat folder shared across all lectures in the module. Every argv element is passed to pandoc verbatim — spaces in paths (`Final output/`, the lecture title) need no quoting because there is no shell to interpret them (see §4.4).

**External dependencies:** Both `pandoc` and `xelatex` must be present on the system `PATH`. The stage runs a pre-flight check for each binary at process start (cached) and fails with a clear, platform-specific install hint if either is missing — `pandoc` missing, `xelatex` missing, and "pandoc ran but LaTeX errored" are distinct failure modes.

---

## 6. Model Configuration

### OpenRouter Integration

The `openai` npm package is used with a custom `baseURL`:

```typescript
const openrouter = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'X-Title': 'Lecture Notes Pipeline',   // display name shown on OpenRouter analytics; no URL header until there is a real public repo
  },
  maxRetries: 5,
  timeout: 120_000,
});
```

### `pipeline-config.json`

Located in the project root. Specifies model and parameters per stage independently. Changing a model requires only a config edit — no code changes.

Model IDs below are **capability-based placeholders**, not real OpenRouter routing strings. Before running the pipeline, replace each `<...>` with a concrete model ID looked up on `https://openrouter.ai/models`. The config loader validates every configured ID against OpenRouter's live model list at startup (see Phase 2) and fails fast if any is unrecognised or retired.

```jsonc
{
  "version": "1",
  "moduleRoots": [
    "/absolute/path/to/Biology of Disease",
    "/absolute/path/to/Anatomy"
  ],
  "openRouter": {
    "rateLimitRpm": 60
  },
  "stages": {
    "transcript-structuring": {
      "modelId": "<REASONING_MODEL>",             // long-context text model with strong structure/summarisation
      "temperature": 0.2,
      "maxTokens": 8192
    },
    "slide-conversion": {
      "modelId": "<COST_EFFICIENT_VISION_MODEL>", // vision model — called once per slide, so cost per call matters most
      "temperature": 0.1,
      "maxTokens": 4096,
      "concurrency": 3
    },
    "image-extraction": {
      "modelId": "<PRECISION_VISION_MODEL>",      // vision model — fewer calls, prioritise bounding-box accuracy
      "temperature": 0.0,
      "maxTokens": 2048,
      "concurrency": 2
    },
    "synthesis": {
      "modelId": "<REASONING_MODEL>",             // single long-context call combining transcript + slides + captions
      "temperature": 0.3,
      "maxTokens": 16384
    },
    "qa-loop": {
      "modelId": "<REASONING_MODEL>",             // iterative critical review + revision
      "temperature": 0.1,
      "maxTokens": 8192,
      "maxIterations": 3
    }
  },
  "output": {
    "language": "en-GB",
    "pandocEngine": "xelatex"
  }
}
```

---

## 7. Cost Tracking

### Sources

OpenRouter exposes cost via the `/api/v1/generation?id={response.id}` endpoint. After each LLM call, `response.usage.prompt_tokens` and `response.usage.completion_tokens` are captured synchronously, then `makeCompletionCall` awaits the cost lookup before its own promise resolves — its return value already includes a fully-resolved `StageCost`. Stages that issue multiple completions in parallel therefore get their concurrency naturally: cost lookups fan out with the completions. The stage's `run()` awaits every completion promise before returning, so **the stage is never marked `complete` while a cost lookup is still outstanding**. This eliminates the race where a process exit or crash silently drops cost data.

Each cost lookup has a 30-second timeout and up to 3 exponential-backoff retries (the generation endpoint is briefly eventually-consistent after completion). If a lookup ultimately fails, the stage still succeeds — cost telemetry MUST NOT gate pipeline progress. The manifest and run-log entries record `cost.totalCostUsd = null` along with `cost.costResolutionError` describing why. Tokens and `callCount` are always populated regardless.

ElevenLabs transcription cost is captured synchronously from the API response where available; otherwise it is approximated from audio duration.

### Two-Level Tracking

| Level | Location | What it tracks |
|---|---|---|
| Current pipeline | `manifest.json` → `currentPipelineCost` | Cost of the outputs currently on disk |
| All-time expenditure | `runs/*.json` | Every API call ever made, including failures and experiments |

### Run Classification

The pipeline runner classifies each run automatically by inspecting the manifest state at the time the run starts:

| Condition | Classification |
|---|---|
| Normal run, no `--from-stage` | `normal` |
| `--from-stage` targets a stage that was `failed` or `running` | `error-recovery` |
| `--from-stage` targets a stage that was `complete` | `experiment` |

This classification is stored in the run log as `runType` and drives the layout of the cost report.

### End-of-Run Summary

Printed after every run, showing only the stages executed in that invocation:

```
Stage                    Model                      Calls    Tokens (in / out)    Cost
────────────────────────────────────────────────────────────────────────────────────────
Slide conversion         gemini-2.5-flash             24      41,000 /  8,100     $0.034
Image extraction         gpt-4.1                       12           0 /  2,400     $0.038
Synthesis                claude-sonnet-4.6             1      65,000 / 14,200     $0.312
QA loop (2 iterations)   claude-sonnet-4.6             4      68,000 / 15,800     $0.405
────────────────────────────────────────────────────────────────────────────────────────
This run                                              41     174,000 / 40,500     $0.789
```

### Cost Report Command

`lecture-notes cost-report [--date <YYYY-MM-DD>] [--module <moduleRoot>]` aggregates all run logs across the configured `moduleRoots` and presents three sections. With no flags, aggregates across everything. With `--date`, narrows to lectures on that date (uses `resolveLecturesByDate`; prompts if the date matches multiple modules). With `--module`, restricts to a single module.

(The `lecture-notes` command becomes available after running `./scripts/setup` once, which appends a PATH export to your shell config. During dev the equivalent invocation is `pnpm exec tsx src/index.ts cost-report …`.)

**1 — Current pipeline cost** (what the outputs on disk cost to produce):
```
Stage                    Model                  Calls    Cost
──────────────────────────────────────────────────────────────
Transcription            elevenlabs/scribe_v2      1    $0.042
Transcript structuring   claude-sonnet-4.6         1    $0.081
Slide conversion         gemini-2.5-flash         24    $0.034
Image extraction         gpt-4.1                   12    $0.038
Synthesis                claude-sonnet-4.6         1    $0.312
QA loop                  claude-sonnet-4.6         4    $0.405
──────────────────────────────────────────────────────────────
                                                         $0.912
```

**2 — Error recovery cost** (spend from failed runs and retries):
```
Run                    Stage                  Status    Cost
────────────────────────────────────────────────────────────
2025-10-10T09:00Z      slide-conversion       failed   $0.021
2025-10-10T10:30Z      slide-conversion       retry    $0.034
────────────────────────────────────────────────────────────
Wasted on failures                                     $0.021
```

**3 — Experiment cost** (deliberate model re-runs, grouped for comparison):
```
Stage: synthesis
  Run 2025-10-11T14:00Z    claude-sonnet-4.6      $0.312
  Run 2025-10-11T15:30Z    anthropic/claude-opus  $0.890
```

---

## 8. Error Handling

### Stage Failure Protocol

1. Manifest updated to `status: 'running'` before the stage begins
2. On exception: manifest updated to `status: 'failed'`, `error: err.message`, `failedAt: now`
3. Partial output files are not deleted — they remain for inspection
4. Error is logged to stderr with full stack trace
5. Default behaviour: pipeline halts. `--continue-on-error` skips to the next stage

### Intra-Stage Resumability (Slide Conversion)

Each slide's extracted markdown is written to `Slide content/raw/slide-{003d}.md` immediately after its API call completes. On restart after a `failed` stage, the runner checks for each per-slide file before making its API call — already-processed slides are skipped. The stage is only marked `complete` once all slides have been assembled into `Slide content/slides.md`.

### API Error Handling

| Error | Handling |
|---|---|
| Rate limit (429) | Exponential backoff with jitter; SDK `maxRetries: 5` |
| Context length exceeded | Stage fails with a message advising the user to switch to a larger-context model in config |
| Model unavailable | Stage fails; model ID included in error message |
| Network timeout | SDK `timeout: 120_000ms` (2 minutes) |

---

## 9. Source File Structure

```
src/
├── index.ts                          # CLI entry point
├── types/
│   └── pipeline.ts                   # All shared types: StageId, StageContext, StageResult,
│                                     # StageCost, RunManifest, QaDeficiency
├── pipeline/
│   ├── runner.ts                     # Orchestrator, manifest I/O, run log creation, batch mode, cost accumulation
│   ├── config.ts                     # Config file loader and validator
│   ├── openrouter.ts                 # OpenAI SDK client configured for OpenRouter
│   └── stages/
│       ├── source-normalisation.ts   # Stage 0 — batch, date parsing, renaming
│       ├── audio-extraction.ts       # Stage 1 — existing, refactored to implement PipelineStage
│       ├── transcription.ts          # Stage 2 — existing, refactored to implement PipelineStage
│       ├── transcript-structuring.ts # Stage 3 — title determination + structuring
│       ├── slide-conversion.ts       # Stage 4 — PDF render + per-slide vision LLM
│       ├── image-extraction.ts       # Stage 5 — vision-guided crop + labelling
│       ├── synthesis.ts              # Stage 6 — context assembly, chunking fallback
│       ├── qa-loop.ts               # Stage 7 — two-prompt QA pattern, loop termination
│       └── pdf-generation.ts         # Stage 8 — pandoc invocation, Final output/ deposit
└── utils/
    ├── date.ts                       # Date extraction and normalisation (chrono-node)
    ├── naming.ts                     # Lecture folder and file naming helpers
    ├── files.ts                      # Atomic write helpers (.tmp pattern), workspace path resolution
    ├── progress.ts                   # Shared cli-progress bar helpers
    ├── cost.ts                       # Cost accumulation and report formatting
    └── logger.ts                     # pino instance and child-logger factory
```

---

## 10. Logging

`pino` is used for all structured logging. Each pipeline invocation creates a child logger bound to the run timestamp. Stage implementations call `logger.child({ stage: stageId })` to add per-stage context to every log entry automatically.

### Debug Log File

The pino file transport writes newline-delimited JSON to `runs/<timestamp>-debug.log` alongside the structured run log. This file captures operational detail not stored in the run log:

- Every LLM call: model, prompt token count, latency ms
- Rate limit retries: attempt number, back-off delay, error message
- Per-slide processing times (Stage 4)
- File I/O errors: path and OS error code

The debug log is for human inspection when diagnosing failures. Its JSON format also makes it trivially parseable if automated analysis is ever needed.

### Output Streams

| Level | Destination | When used |
|---|---|---|
| Progress | stdout (cli-progress) | Real-time stage progress bars |
| Info | stdout | Stage start/end messages, skipped-stage notices |
| Warning | stderr | Unmatched source files (Stage 0), stalled QA loop, max-iterations reached |
| Error | stderr | Stage failure with full stack trace |

The pino file transport is configured with `sync: false` and routes only to the debug log file — no debug output reaches stdout or stderr during normal operation, so it does not interfere with cli-progress bars.
