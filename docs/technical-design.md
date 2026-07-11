# Lecture Notes Generator — Technical Design

**Version:** 0.2 (draft)
**Date:** 2026-07-11
**Status:** For review

---

## 1. System Overview

The system is a TypeScript/Node.js CLI tool with eight stages (Stage 0 through Stage 7). Stage 0 is a one-time batch normalisation step across all lectures in a module. Stages 1–7 run per lecture, orchestrated by a pipeline runner that reads and writes a per-lecture run manifest. Every stage is idempotent — if its output exists and the manifest marks it complete, it is skipped.

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
| Date parsing | `chrono-node` | Robust natural-language date parsing for varied source filename formats |
| CLI prompts | `@inquirer/prompts` | Already in use |
| Progress bars | `cli-progress` | Already in use |
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
└── Pipeline processing/
    └── Lecture 1 - Cell Injury and the Immune System - 2025-10-10/
        ├── manifest.json
        ├── Audio/
        ├── Transcript/
        ├── Structured transcript/
        ├── Slide content/
        ├── Slide images/
        ├── Synthesised notes/
        ├── QA iterations/
        └── Output/
```

All pipeline artefacts for a lecture live inside a single named folder. Folder names carry the full lecture identity. Files inside each folder use simple, stage-agnostic names so that if stage ordering ever changes, no files need renaming — only the manifest stage mapping changes.

### 3.2 Source Files

#### Video files
Source videos are renamed in two passes by the pipeline (see Stage 0 and Stage 3):

| Pass | Example filename |
|---|---|
| Original (user-supplied) | `2025-10-10 BOD_Disease cell injury and the immune system Fri co.mp4` |
| After Stage 0 | `Lecture 1 - 2025-10-10.mp4` |
| After Stage 3 (title known) | `Lecture 1 - Cell Injury and the Immune System - 2025-10-10.mp4` |

#### Lecture slides
Source slide PDFs are supplied with the date at the very beginning of the filename (e.g. `2025-10-10 Lecture slides.pdf`). Stage 0 matches them to videos by date and renames them on the same two-pass schedule:

| Pass | Example filename |
|---|---|
| Original (user-supplied) | `2025-10-10 Lecture slides.pdf` |
| After Stage 0 | `Lecture 1 - 2025-10-10.pdf` |
| After Stage 3 (title known) | `Lecture 1 - Cell Injury and the Immune System - 2025-10-10.pdf` |

### 3.3 Pipeline Processing — Per-Lecture Folder

The lecture folder is created in two passes matching the source file renames:

| Pass | Folder name |
|---|---|
| Created at Stage 0 | `Lecture 1 - 2025-10-10/` |
| Renamed at end of Stage 3 | `Lecture 1 - Cell Injury and the Immune System - 2025-10-10/` |

Full structure of a completed lecture folder:

```
Lecture 1 - Cell Injury and the Immune System - 2025-10-10/
│
├── manifest.json
│
├── Audio/
│   └── audio.m4a                              # Stage 1 output
│
├── Transcript/
│   └── transcript.txt                         # Stage 2 output
│
├── Structured transcript/
│   └── structured-transcript.md              # Stage 3 output
│
├── Slide content/
│   ├── raw/
│   │   ├── slide-001.md                       # per-slide extraction (resumability)
│   │   ├── slide-002.md
│   │   └── ...
│   └── slides.md                              # Stage 4 output — concatenated
│
├── Slide images/
│   ├── images-manifest.json                   # Stage 5 output — index of all figures
│   ├── slide-003-figure-01.png
│   ├── slide-003-figure-01-caption.md
│   ├── slide-007-figure-01.png
│   └── slide-007-figure-01-caption.md
│
├── Synthesised notes/
│   └── synthesised-notes.md                  # Stage 6 output
│
├── QA iterations/
│   ├── qa-iteration-01-deficiencies.json
│   ├── qa-iteration-01-revised.md
│   └── qa-iteration-02-deficiencies.json     # Stage 7 output
│
└── Output/
    ├── Lecture 1 - Cell Injury and the Immune System - 2025-10-10.md   # final deliverable
    └── images/
        ├── slide-003-figure-01.png            # copies of included figures
        └── slide-007-figure-01.png
```

The final deliverable in `Output/` is the only file in the pipeline that carries the full lecture name. All other files use short, descriptive names that are unambiguous within the context of their containing folder.

### 3.4 Re-numbering When New Lectures Are Added

If a new lecture is inserted whose date falls between existing lectures, Stage 0 re-runs across all lectures in the module, detects the change in sequence, and renames all affected lecture folders and source files. Because files inside each lecture folder use simple names (not the lecture title), only the folder itself needs renaming — not its contents. The manifest uses relative paths throughout, so it survives a folder rename without modification.

---

## 4. Pipeline Architecture

### 4.1 Stage Overview

| Stage | Name | Type | Description |
|---|---|---|---|
| 0 | Source Normalisation | Batch | Parse dates, assign lecture numbers, rename source files, create workspace folders |
| 1 | Audio Extraction | Per-lecture | Extract audio track from video using ffmpeg |
| 2 | Transcription | Per-lecture | Upload audio to ElevenLabs, save raw transcript |
| 3 | Transcript Structuring | Per-lecture | Determine meaningful title; structure raw transcript into markdown |
| 4 | Slide Conversion | Per-lecture | Render PDF slides as images; extract content via vision LLM |
| 5 | Image Extraction & Labelling | Per-lecture | Identify, label, and filter academic figures from slide images |
| 6 | Synthesis | Per-lecture | Combine transcript, slide content, and figures into textbook-style notes |
| 7 | QA Loop | Per-lecture | Iteratively check and revise notes until they pass quality review |

### 4.2 Stage Interface

```typescript
interface PipelineStage<TInput, TOutput> {
  readonly stageId: StageId;

  isComplete(context: StageContext): Promise<boolean>;
  getInput(context: StageContext): Promise<TInput>;
  run(input: TInput, context: StageContext): Promise<StageResult<TOutput>>;
}

type StageId =
  | 'source-normalisation'
  | 'audio-extraction'
  | 'transcription'
  | 'transcript-structuring'
  | 'slide-conversion'
  | 'image-extraction'
  | 'synthesis'
  | 'qa-loop';

interface StageContext {
  lectureSlug: string;            // e.g. 'lecture-01-2025-10-10' (stable, date-based)
  lectureTitle: string | null;    // null until Stage 3 completes
  lectureNumber: number;
  lectureDate: string;            // YYYY-MM-DD
  workspaceRoot: string;          // absolute path to the lecture folder
  moduleRoot: string;             // absolute path to Biology of Disease/
  config: PipelineConfig;
  manifest: RunManifest;
}

interface StageResult<TOutput> {
  output: TOutput;
  cost: StageCost;
  filesWritten: string[];         // relative paths from workspaceRoot
}

interface StageCost {
  promptTokens: number;
  completionTokens: number;
  totalCostUsd: number;
  modelId: string;
  callCount: number;
}
```

`isComplete()` checks two conditions: the manifest marks the stage `'complete'`, AND the expected output files exist on disk. Both must be true.

### 4.3 Atomic File Writes

Every file is written to a `.tmp`-suffixed path first, then renamed on success. Any file that exists on disk without a `.tmp` suffix is guaranteed to be complete. Partial `.tmp` files are safe to delete on restart.

### 4.4 Run Manifest

One `manifest.json` per lecture, stored in the lecture workspace root. All paths are relative to `workspaceRoot` so the manifest survives a folder rename.

```jsonc
{
  "version": "1",
  "lectureNumber": 1,
  "lectureDate": "2025-10-10",
  "lectureTitle": "Cell Injury and the Immune System",   // null until Stage 3 completes
  "workspaceFolderName": "Lecture 1 - Cell Injury and the Immune System - 2025-10-10",
  "createdAt": "2025-10-10T09:00:00.000Z",
  "updatedAt": "2025-10-10T10:15:00.000Z",
  "stages": {
    "audio-extraction": {
      "status": "complete",          // pending | running | complete | failed | skipped
      "completedAt": "...",
      "modelId": null,
      "cost": null,
      "filesWritten": ["Audio/audio.m4a"]
    },
    "transcription": {
      "status": "complete",
      "completedAt": "...",
      "modelId": "elevenlabs/scribe_v2",
      "cost": { "promptTokens": 0, "completionTokens": 0, "totalCostUsd": 0.042, "callCount": 1 },
      "filesWritten": ["Transcript/transcript.txt"]
    },
    "transcript-structuring": {
      "status": "complete",
      "completedAt": "...",
      "modelId": "anthropic/claude-3.5-sonnet",
      "cost": { "promptTokens": 18400, "completionTokens": 3200, "totalCostUsd": 0.081, "callCount": 1 },
      "filesWritten": ["Structured transcript/structured-transcript.md"]
    },
    "qa-loop": {
      "status": "complete",
      "modelId": "anthropic/claude-3.5-sonnet",
      "cost": { "totalCostUsd": 0.312, "callCount": 6 },
      "qaIterations": [
        { "iteration": 1, "verdict": "fail", "deficiencyCount": 7, "criticalCount": 2, "costUsd": 0.098 },
        { "iteration": 2, "verdict": "pass", "deficiencyCount": 0, "criticalCount": 0, "costUsd": 0.104 }
      ],
      "terminationReason": "qa-passed",
      "filesWritten": [
        "QA iterations/qa-iteration-01-deficiencies.json",
        "QA iterations/qa-iteration-01-revised.md",
        "Output/Lecture 1 - Cell Injury and the Immune System - 2025-10-10.md",
        "Output/images/slide-003-figure-01.png"
      ]
    }
  },
  "totalCost": {
    "totalCostUsd": 0.954,
    "byStage": {
      "transcription": 0.042,
      "transcript-structuring": 0.081
    }
  }
}
```

**`running` status is persisted before a stage begins.** A crash mid-stage leaves `running` in the manifest, which is treated as `failed` on next launch — the stage re-runs from scratch. This prevents silent data corruption from partial outputs.

### 4.5 Pipeline Runner

```typescript
class PipelineRunner {
  async normaliseSources(moduleRoot: string): Promise<void>          // Stage 0, batch
  async runLecture(lectureSlug: string, options: RunOptions): Promise<RunSummary>
  async runBatch(modulePath: string, options: RunOptions): Promise<BatchSummary>
  private async runStage(stage: PipelineStage<unknown, unknown>, context: StageContext): Promise<void>
  private async updateManifest(slug: string, update: Partial<RunManifest>): Promise<void>
}
```

**`--from-stage <stageId>` flag:** Forces re-run from the named stage. All downstream stages are reset to `pending` before execution. Upstream stages are untouched.

**Batch mode:** Lectures are processed sequentially by default to respect OpenRouter rate limits. `--concurrency N` enables parallel processing. A batch summary (status and cost per lecture) is printed on completion.

---

## 5. Stage Designs

### Stage 0 — Source Normalisation (Batch)

**Runs across all lectures in the module at once, not per-lecture.**

**Inputs:** All files in `Source files/Video files/` and `Source files/Lecture slides/`.

**What it does:**

1. **Date extraction:** Parse the date from each video filename using `chrono-node`. Dates may appear in any position and format (e.g. `2025-10-10`, `10 Oct 2025`, `Fri 10th Oct`). Log a warning and skip any file where no date can be confidently extracted.

2. **Lecture number assignment:** Sort all video files by extracted date. Assign sequential lecture numbers (`Lecture 1`, `Lecture 2`, …) in date order. If Stage 0 is re-run after new lectures are added, detect changes in sequence and rename all affected workspace folders and source files.

3. **Slide matching:** Parse the date from each slide PDF (date always at beginning of filename). Match each slide PDF to the video with the same date. Log a warning for any unmatched video or slide.

4. **First-pass rename (Pass 1):**
   - Video: `[original].mp4` → `Lecture N - YYYY-MM-DD.mp4`
   - Slide: `[original].pdf` → `Lecture N - YYYY-MM-DD.pdf`

5. **Workspace folder creation:** Create `Pipeline processing/Lecture N - YYYY-MM-DD/` for any lecture that does not already have one. Write an initial `manifest.json` with `lectureNumber`, `lectureDate`, and all stage statuses set to `pending`.

**Re-numbering:** When the sequence changes, Stage 0 renames affected workspace folders and source files in a single atomic operation (rename to a temporary name, then rename to the final name, to avoid collision). Manifests do not need updating because they use relative paths.

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
**Side effects:** Second-pass rename of source video, source slide, and workspace folder (once title is known).

Stage 3 makes a single LLM call that returns two things: a proposed lecture title and the structured transcript markdown. The title is extracted first; everything else in the pipeline depends on it.

#### Title Determination

The LLM receives the raw transcript and is asked to infer a concise, descriptive academic title (4–8 words) that accurately reflects the content, suitable for use in a filename. The title is returned as a structured JSON field alongside the markdown output, or as the first line of the response in a defined format that the pipeline parses before processing the rest.

Once the title is confirmed, the pipeline performs the **second-pass rename:**
- `Source files/Video files/Lecture N - YYYY-MM-DD.mp4` → `Lecture N - [Title] - YYYY-MM-DD.mp4`
- `Source files/Lecture slides/Lecture N - YYYY-MM-DD.pdf` → `Lecture N - [Title] - YYYY-MM-DD.pdf`
- `Pipeline processing/Lecture N - YYYY-MM-DD/` → `Lecture N - [Title] - YYYY-MM-DD/`
- `manifest.json` `lectureTitle` and `workspaceFolderName` fields updated

All subsequent stages use the now-resolved `context.lectureTitle`.

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

**Progress:** `cli-progress` bar showing `Slide X / N`. Default concurrency: 3 parallel API calls.

**Recommended model:** A cost-efficient vision model (e.g. `google/gemini-flash-1.5`) — this stage makes the most individual API calls.

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
**Final output:** `Output/Lecture N - [Title] - YYYY-MM-DD.md` and `Output/images/`

#### Two-Prompt Design

QA and revision are two separate LLM calls per iteration. Combining them in one call degrades quality — the model cannot be simultaneously maximally critical and produce fluent prose. Separating the tasks allows each to be done well.

**QA checker call:** Reads source transcript + source slides + image manifest + current draft. Returns a structured `QaDeficienciesReport`.

**QA reviser call:** Reads current draft + deficiencies report. Applies targeted edits to address each deficiency. Does not rewrite wholesale.

#### Deficiency Schema

```typescript
interface QaDeficienciesReport {
  iteration: number;
  overallVerdict: 'pass' | 'fail';
  coverageScore: number;          // 0–100, LLM self-assessed
  deficiencies: QaDeficiency[];
}

interface QaDeficiency {
  severity: 'critical' | 'major' | 'minor';
  type: 'omission' | 'inaccuracy' | 'british-english' | 'formatting' | 'figure-reference';
  description: string;
  sourceEvidence: string;         // direct quote from source material
  suggestedFix: string;
  location: string;               // section heading, "Glossary", or "throughout"
}
```

#### Loop Termination

The loop exits when any one of the following is true:

1. `overallVerdict === 'pass'`
2. `currentIteration >= maxQaIterations` (configurable, default 3) — exits with a warning in the manifest
3. Two consecutive iterations with identical deficiency counts and no severity change — exits to prevent infinite cycling on issues the model cannot resolve

`terminationReason` in the manifest records which condition triggered the exit (`'qa-passed'`, `'max-iterations-reached'`, `'stalled'`).

On successful exit, the final revised draft is copied to `Output/Lecture N - [Title] - YYYY-MM-DD.md` and all included figures are copied to `Output/images/`.

---

## 6. Model Configuration

### OpenRouter Integration

The `openai` npm package is used with a custom `baseURL`:

```typescript
const openrouter = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'https://github.com/your-org/lecture-notes-pipeline',
    'X-Title': 'Lecture Notes Pipeline',
  },
  maxRetries: 5,
  timeout: 120_000,
});
```

### `pipeline-config.json`

Located in the project root. Specifies model and parameters per stage independently. Changing a model requires only a config edit — no code changes.

```jsonc
{
  "version": "1",
  "moduleRoot": "/Users/jamestarin/Source material/Lecture Content/Biology of Disease",
  "openRouter": {
    "rateLimitRpm": 60
  },
  "stages": {
    "transcript-structuring": {
      "modelId": "anthropic/claude-3.5-sonnet",
      "temperature": 0.2,
      "maxTokens": 8192
    },
    "slide-conversion": {
      "modelId": "google/gemini-flash-1.5",
      "temperature": 0.1,
      "maxTokens": 4096,
      "concurrency": 3
    },
    "image-extraction": {
      "modelId": "openai/gpt-4o",
      "temperature": 0.0,
      "maxTokens": 2048,
      "concurrency": 2
    },
    "synthesis": {
      "modelId": "anthropic/claude-3.5-sonnet",
      "temperature": 0.3,
      "maxTokens": 16384
    },
    "qa-loop": {
      "modelId": "anthropic/claude-3.5-sonnet",
      "temperature": 0.1,
      "maxTokens": 8192,
      "maxIterations": 3
    }
  },
  "output": {
    "language": "en-GB"
  }
}
```

---

## 7. Cost Tracking

OpenRouter exposes cost via the `/api/v1/generation?id={response.id}` endpoint. After each LLM call, `response.usage.prompt_tokens` and `response.usage.completion_tokens` are captured synchronously. The USD cost is fetched asynchronously from the generation endpoint and written to the manifest when it resolves.

Each stage accumulates a `StageCost` across all its API calls. The pipeline runner recomputes `totalCost` by summing all complete stage costs after each stage finishes. A formatted cost table is printed at the end of every run:

```
Stage                    Model                      Calls    Tokens (in / out)    Cost
────────────────────────────────────────────────────────────────────────────────────────
Audio extraction         —                             —               —           $0.042
Transcription            elevenlabs/scribe_v2          1               —           $0.042
Transcript structuring   claude-3.5-sonnet             1      18,400 /  3,200     $0.081
Slide conversion         gemini-flash-1.5             24      41,000 /  8,100     $0.034
Image extraction         gpt-4o                       12           0 /  2,400     $0.038
Synthesis                claude-3.5-sonnet             1      65,000 / 14,200     $0.312
QA loop (2 iterations)   claude-3.5-sonnet             4      68,000 / 15,800     $0.405
────────────────────────────────────────────────────────────────────────────────────────
TOTAL                                                 43     192,400 / 43,700     $0.912
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
│   ├── runner.ts                     # Orchestrator, manifest I/O, batch mode, cost accumulation
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
│       └── qa-loop.ts               # Stage 7 — two-prompt QA pattern, loop termination
└── utils/
    ├── date.ts                       # Date extraction and normalisation (chrono-node)
    ├── naming.ts                     # Lecture folder and file naming helpers
    ├── progress.ts                   # Shared cli-progress bar helpers
    └── cost.ts                       # Cost accumulation and report formatting
```
