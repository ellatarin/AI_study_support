# Lecture Notes Generator — Technical Design

**Version:** 0.1 (draft)
**Date:** 2026-07-11
**Status:** For review

---

## 1. System Overview

The system is a TypeScript/Node.js CLI tool. Two pipeline stages (audio extraction, transcription) are already built. This document covers the full architecture for all stages, including the five new stages that take the raw transcript and slide PDFs through to final quality-checked notes.

The pipeline is stage-based: each stage is an independent module with a defined interface, orchestrated by a pipeline runner that reads and writes a per-lecture run manifest to disk. Every stage is idempotent — if its output files exist and the manifest marks it complete, it is skipped.

---

## 2. Technology Stack

| Concern | Choice | Rationale |
|---|---|---|
| Language | TypeScript | Already established |
| Package manager | pnpm | Already established |
| Runtime / dev execution | Node.js + tsx | Already established |
| Audio extraction | fluent-ffmpeg | Already built |
| Transcription | ElevenLabs (`@elevenlabs/elevenlabs-js`) | Already built |
| LLM access (all new stages) | OpenAI SDK (`openai`) pointed at OpenRouter | OpenRouter-compatible with OpenAI API; avoids bespoke client; gets retry logic and TypeScript types for free |
| PDF-to-image rendering | `pdfjs-dist` + `canvas` | Pure-Node, no system binary dependency, consistent PNG output |
| Image cropping | `sharp` | Standard Node image processing, efficient PNG crop |
| CLI prompts | `@inquirer/prompts` | Already in use |
| Progress bars | `cli-progress` | Already in use |
| Environment variables | `dotenv` | Already in use |

### Environment Variables Required

```
ELEVENLABS_API_KEY=...
OPENROUTER_API_KEY=...
```

---

## 3. Directory and File Structure

### Source Material Tree

```
/Users/jamestarin/Source material/Lecture Content/Biology of Disease/
├── Lecture recordings/                         # input — video files
├── Lecture audio extracts/                     # stage 1 output (existing)
├── Lecture transcriptions/                     # stage 2 output (existing)
├── Lecture slides/                             # input — PDF slide decks (new)
└── Lecture notes/                              # all new pipeline outputs
    └── lecture-01-cell-biology/               # slug derived from filename
        ├── manifest.json
        ├── stage-3-transcript/
        │   └── structured-transcript.md
        ├── stage-4-slides/
        │   ├── raw/                           # per-slide extracted markdown (resumability)
        │   │   ├── slide-001.md
        │   │   └── slide-002.md
        │   └── structured-slides.md
        ├── stage-5-images/
        │   ├── images-manifest.json
        │   ├── slide-003-figure-01.png
        │   ├── slide-003-figure-01-caption.md
        │   └── slide-007-figure-01.png
        ├── stage-6-synthesis/
        │   └── synthesised-notes.md
        ├── stage-7-qa/
        │   ├── qa-iteration-01-deficiencies.json
        │   ├── qa-iteration-01-revised.md
        │   ├── qa-iteration-02-deficiencies.json
        │   └── qa-iteration-02-revised.md
        └── output/
            ├── Lecture 01 - Cell Biology — Notes.md
            └── images/
                ├── slide-003-figure-01.png
                └── slide-007-figure-01.png
```

### Slug Convention

Filename → slug: strip extension, lowercase, replace spaces and non-alphanumeric characters with hyphens, collapse consecutive hyphens. `Lecture 01 - Cell Biology.mp4` → `lecture-01-cell-biology`. Computed once and stored in the manifest.

### Atomic File Writes

Every file is written to a `.tmp`-suffixed path first, then renamed on success. This guarantees that any file that exists on disk is complete and valid. Incomplete `.tmp` files can be safely deleted on restart.

---

## 4. Pipeline Architecture

### 4.1 Stage Interface

Every pipeline stage implements a common TypeScript interface:

```typescript
interface PipelineStage<TInput, TOutput> {
  readonly stageId: StageId;
  readonly stageNumber: number;

  isComplete(context: StageContext): Promise<boolean>;
  getInput(context: StageContext): Promise<TInput>;
  run(input: TInput, context: StageContext): Promise<StageResult<TOutput>>;
}
```

`isComplete()` checks two conditions: (1) the manifest marks the stage as `'complete'`, and (2) the expected output files physically exist on disk. Both must be true — this prevents a corrupted manifest from silently skipping a stage whose files were deleted.

### 4.2 Core Types

```typescript
type StageId =
  | 'audio-extraction'
  | 'transcription'
  | 'transcript-structuring'
  | 'slide-conversion'
  | 'image-extraction'
  | 'synthesis'
  | 'qa-loop';

interface StageContext {
  lectureSlug: string;
  lectureTitle: string;
  workspaceRoot: string;       // absolute path to lecture-01-cell-biology/
  config: PipelineConfig;
  manifest: RunManifest;
  onProgress?: (message: string) => void;
}

interface StageResult<TOutput> {
  output: TOutput;
  cost: StageCost;
  filesWritten: string[];      // absolute paths, logged to manifest
}

interface StageCost {
  promptTokens: number;
  completionTokens: number;
  totalCostUsd: number;
  modelId: string;
  callCount: number;
}
```

### 4.3 Run Manifest Schema

One `manifest.json` per lecture, written to `lecture-{slug}/manifest.json`.

```jsonc
{
  "version": "1",
  "lectureSlug": "lecture-01-cell-biology",
  "lectureTitle": "Lecture 01 - Cell Biology",
  "createdAt": "2026-07-10T09:00:00.000Z",
  "updatedAt": "2026-07-10T09:45:00.000Z",
  "stages": {
    "audio-extraction": {
      "status": "complete",         // pending | running | complete | failed | skipped
      "completedAt": "...",
      "modelId": null,
      "cost": null,
      "filesWritten": ["/absolute/path/..."]
    },
    "synthesis": {
      "status": "failed",
      "failedAt": "...",
      "error": "Context length exceeded: 187,432 tokens > 128,000 limit",
      "modelId": "anthropic/claude-3.5-sonnet",
      "cost": { "promptTokens": 0, "completionTokens": 0, "totalCostUsd": 0, "callCount": 0 },
      "filesWritten": []
    },
    "qa-loop": {
      "status": "complete",
      "modelId": "anthropic/claude-3.5-sonnet",
      "cost": { "totalCostUsd": 0.312, "callCount": 6 },
      "qaIterations": [
        { "iteration": 1, "verdict": "fail", "deficiencyCount": 7, "criticalCount": 2, "costUsd": 0.098 },
        { "iteration": 2, "verdict": "fail", "deficiencyCount": 2, "criticalCount": 0, "costUsd": 0.104 },
        { "iteration": 3, "verdict": "pass", "deficiencyCount": 0, "criticalCount": 0, "costUsd": 0.110 }
      ],
      "terminationReason": "qa-passed",
      "filesWritten": ["..."]
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

**`running` status is persisted before a stage begins.** If the process crashes mid-stage, the status remains `running` on next launch, which is treated as `failed` — the stage re-runs from scratch. This prevents silent data corruption from partial outputs.

### 4.4 Pipeline Runner

```typescript
class PipelineRunner {
  async runLecture(lectureTitle: string, options: RunOptions): Promise<RunSummary>
  async runBatch(lectureTitles: string[], options: RunOptions): Promise<BatchSummary>
  private async runStage(stage: PipelineStage<unknown, unknown>, context: StageContext): Promise<void>
  private async updateManifest(slug: string, update: Partial<RunManifest>): Promise<void>
  private async loadOrCreateManifest(slug: string): Promise<RunManifest>
}
```

For each stage in sequence, the runner calls `stage.isComplete(context)`. If true, it logs a skip message and moves on. If false, it runs the stage.

**`--from-stage <stageId>` flag:** Forces re-run from a specific stage. All subsequent stages are reset to `pending` in the manifest before execution begins. Stages upstream of the nominated stage are untouched.

**Batch mode:** Lectures are processed sequentially by default to avoid exceeding OpenRouter rate limits. An optional `--concurrency N` flag enables parallel processing. A batch-level cost and status summary is printed at the end.

---

## 5. Stage Designs

### Stage 1 — Audio Extraction (existing)

Already implemented. Extracts audio from MP4 to M4A using fluent-ffmpeg with a cli-progress bar. Output saved to `Lecture audio extracts/`.

### Stage 2 — Transcription (existing)

Already implemented. Uploads M4A to ElevenLabs Scribe v2 with a streaming upload progress bar. Output saved to `Lecture transcriptions/` as plain-text `.txt`.

### Stage 3 — Transcript Structuring

**Input:** Raw `.txt` transcript from stage 2.

**Output:** `stage-3-transcript/structured-transcript.md`

**Single LLM call.** A 90-minute lecture transcript is typically 15,000–30,000 tokens — well within a 128k-context model in a single call.

**What the LLM does:**
- Identifies natural topic boundaries from discourse markers ("Now, moving on to…", "To summarise…")
- Produces H2 headings for major topics, H3 for sub-topics
- Removes filler words only (um, uh, sort of, you know) — all substantive content is preserved
- Converts spoken mathematics to LaTeX where detectable
- Marks Q&A sections as `> **Q&A:**` blockquote where speaker changes suggest it
- Does not add content, does not summarise

**System prompt role:** Academic transcript structurer. Explicit instruction: do not add content not present in the transcript.

---

### Stage 4 — Slide Conversion

**Input:** PDF slide deck from `Lecture slides/`.

**Output:** `stage-4-slides/structured-slides.md`

#### Approach: Vision LLM per slide

Native PDF text extraction (e.g., `pdf-parse`) is rejected for this use case. Academic biology slides contain pathway diagrams, chemical structures, multi-column tables, embedded formulas, and microscopy images. Text extraction libraries produce garbled output for all of these — column order is wrong, table structure is lost, formulas become character soup, and embedded figures are silently dropped. A vision LLM sees each slide as a human does.

**Processing:**
1. Render each PDF page to a PNG at 150 DPI using `pdfjs-dist` + `canvas`. Files saved to `stage-4-slides/raw/slide-{003d}.png` (kept for use by stage 5).
2. For each slide PNG, make a vision LLM call:
   - **User message:** "This is slide {N} of {total} from '{lectureTitle}'. Extract all academic content into structured markdown. Reproduce text exactly. Describe diagrams in detail (structure, labels, arrows, relationships). Reconstruct tables with all cells and headers. Convert formulas/equations to LaTeX. Note the slide's apparent purpose."
   - **Output format:** `### Slide {N}: {inferred title}` followed by content.
3. Each slide's extracted markdown is saved to `stage-4-slides/raw/slide-{003d}.md` immediately after its API call completes (enables intra-stage resumability: if the process dies at slide 14, a restart skips slides 1–13).
4. Once all slides are processed, concatenate into `structured-slides.md` with `---` separators.

**Progress:** `cli-progress` bar showing `Slide X / N`. Configurable concurrency (default 3 concurrent calls).

**Recommended model:** A cost-efficient vision model (e.g., `google/gemini-flash-1.5`) — this stage makes the most API calls.

---

### Stage 5 — Image Extraction and Labelling

**Input:** Rendered slide PNGs from `stage-4-slides/raw/`.

**Output:** PNG image files + caption markdown files + `stage-5-images/images-manifest.json`

#### Approach: Vision-guided detection and cropping

For each slide PNG, a vision LLM call identifies distinct figures and their bounding boxes. `sharp` then crops each accepted figure from the slide PNG.

**Vision LLM call per slide — expected JSON response:**

```jsonc
{
  "figures": [
    {
      "figureIndex": 1,
      "boundingBox": { "topPct": 15, "leftPct": 5, "widthPct": 45, "heightPct": 60 },
      "caption": "Diagram showing the complement activation cascade, illustrating classical, lectin, and alternative pathways converging at C3 convertase.",
      "academicRelevance": "include",
      "figureType": "pathway-diagram"   // pathway-diagram | graph | table | microscopy | chemical-structure | logo | decorative
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

**Filter rule:** Any figure where `academicRelevance === 'exclude'` or `figureType` is `logo` or `decorative` is discarded without saving.

**Output file naming:** `slide-{003d}-figure-{02d}.png` — zero-padded so alphabetical sort matches document order.

**`images-manifest.json` schema:**

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
      "caption": "Diagram showing the complement activation cascade…",
      "figureType": "pathway-diagram",
      "relativeOutputPath": "images/slide-003-figure-01.png"
    }
  ]
}
```

The `relativeOutputPath` is the path used in the final output markdown (relative to the output notes file).

---

### Stage 6 — Synthesis

**Input:**
- `stage-3-transcript/structured-transcript.md`
- `stage-4-slides/structured-slides.md`
- `stage-5-images/images-manifest.json` (captions and filenames; not the images themselves)

**Output:** `stage-6-synthesis/synthesised-notes.md`

**Single LLM call (standard path).** A typical lecture produces 20,000–45,000 tokens of combined input — well within a 128k-context model.

**What the LLM produces:**
- Formal British English prose (not bullet lists)
- H2 for major topics, H3 for sub-topics
- Transcript and slides woven together — transcript provides the narrative, slides provide structural anchors and key points
- Image references inserted at contextually appropriate positions: `![{caption}]({relativeOutputPath})`
- A "Key Concepts" summary box at the end of each H2 section
- A "Glossary" section at the end defining all technical terms introduced
- No content added beyond what is in the source materials

**Context window fallback for very long lectures (> ~80,000 input tokens):**

If the combined input exceeds the model's safe context limit, a two-pass strategy is used:
1. Align transcript sections to slide sections by heading similarity to produce paired section bundles.
2. Synthesise each section bundle independently.
3. Concatenate all section outputs, then make a lightweight "coherence pass" LLM call that smooths section transitions without re-reading the full content.

---

### Stage 7 — Quality Assurance Loop

**Input:** All source materials + current synthesised notes draft.

**Output (per iteration):** `qa-iteration-{02d}-deficiencies.json` and `qa-iteration-{02d}-revised.md`

**Final output:** `output/Lecture 01 - Cell Biology — Notes.md` (copy of the last accepted revision, with images copied to `output/images/`).

#### Two-prompt design (checker + reviser)

QA and revision are intentionally separated into two distinct LLM calls. Combining them in one call produces lower quality: the model simultaneously tries to be maximally critical and produce valid prose, which degrades both. Separating the tasks allows the checker to be uncompromisingly critical.

**QA checker call:**
- Reads: source transcript + source slides + image manifest + current draft
- Output: a structured `QaDeficienciesReport` (below)

**QA reviser call:**
- Reads: current draft + deficiencies report
- Instruction: address each deficiency with the minimum necessary targeted edit; do not rewrite the document wholesale

#### QA Deficiency Schema

```typescript
interface QaDeficienciesReport {
  iteration: number;
  overallVerdict: 'pass' | 'fail';
  coverageScore: number;        // 0–100, LLM self-assessed
  deficiencies: QaDeficiency[];
}

interface QaDeficiency {
  severity: 'critical' | 'major' | 'minor';
  type: 'omission' | 'inaccuracy' | 'british-english' | 'formatting' | 'figure-reference';
  description: string;          // human-readable description
  sourceEvidence: string;       // direct quote from source material
  suggestedFix: string;         // specific instruction for the reviser
  location: string;             // section heading or "Glossary" or "throughout"
}
```

#### Loop Termination Conditions

The loop exits when **any one** of the following is true:

1. `overallVerdict === 'pass'` — exit, use current draft as final
2. `currentIteration >= maxQaIterations` (configurable, default 3) — exit with a warning logged to console and manifest
3. Two consecutive iterations have identical deficiency counts with no change in severity distribution — exit to prevent infinite cycling on issues the model cannot resolve

`terminationReason` in the manifest records which condition triggered the exit.

---

## 6. Model Configuration

### OpenRouter Integration

The `openai` npm package is used with a custom `baseURL`:

```typescript
import OpenAI from 'openai';

const openrouter = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'https://github.com/your-org/lecture-notes-pipeline',
    'X-Title': 'Lecture Notes Pipeline',
  },
  maxRetries: 5,
  timeout: 120_000,             // 2 minutes — vision calls can be slow
});
```

The `HTTP-Referer` and `X-Title` headers are required by OpenRouter for usage attribution.

### `pipeline-config.json`

Located in the project root. Not committed if it contains paths specific to the local machine (though it contains no secrets — those remain in `.env`).

```jsonc
{
  "version": "1",
  "sourceRoot": "/Users/jamestarin/Source material/Lecture Content/Biology of Disease",
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
    "language": "en-GB",
    "filenameTemplate": "{lectureTitle} — Notes.md"
  }
}
```

Swapping a model at any stage is a one-line config change. No code changes required.

---

## 7. Cost Tracking

### Where OpenRouter Exposes Cost

OpenRouter extends the standard OpenAI `usage` response object. The cost in USD is available via the `/api/v1/generation?id={response.id}` endpoint — a follow-up GET request after each LLM call. This is the most reliable source; the `usage` object itself may contain cost data in a non-standard field depending on the model.

Pragmatic approach: capture `prompt_tokens` and `completion_tokens` from `response.usage` synchronously, then fetch the generation cost asynchronously (non-blocking) and write it to the manifest when it resolves.

### Cost Accumulation

Each stage accumulates a `StageCost` across all its API calls. When a stage completes, its cost is written to the manifest. The pipeline runner recomputes the run's `totalCost` by summing all complete stage costs after each stage finishes.

### Cost Report

Printed to stdout at the end of every run (or batch):

```
Stage                    Model                      Calls    Tokens (in / out)    Cost
────────────────────────────────────────────────────────────────────────────────────────
Transcript structuring   claude-3.5-sonnet             1       18,400 /  3,200    $0.081
Slide conversion         gemini-flash-1.5             24       41,000 /  8,100    $0.034
Image extraction         gpt-4o                       12            0 /  2,400    $0.038
Synthesis                claude-3.5-sonnet             1       65,000 / 14,200    $0.312
QA loop (3 iterations)   claude-3.5-sonnet             6       98,000 / 21,000    $0.489
────────────────────────────────────────────────────────────────────────────────────────
TOTAL                                                 44      222,400 / 48,900    $0.954
```

---

## 8. Error Handling

### Stage Failure Protocol

1. Manifest updated to `status: 'running'` before stage begins
2. On exception: manifest updated to `status: 'failed'`, `error: err.message`, `failedAt: now`
3. Partial output files are not deleted — they remain on disk for inspection
4. The error is logged to stderr with full stack trace
5. Default behaviour: pipeline halts. `--continue-on-error` flag skips to the next stage

### Intra-Stage Resumability (Slide Conversion)

Slide conversion makes one API call per slide. To avoid re-processing all slides on restart, each slide's extracted markdown is saved to `stage-4-slides/raw/slide-{003d}.md` immediately after its call completes. On re-run, the stage checks for this file before making the API call. The stage is only marked `complete` in the manifest after all slide files are assembled into `structured-slides.md`.

### API Error Handling

| Error | Handling |
|---|---|
| Rate limit (429) | Exponential backoff with jitter. The OpenAI SDK `maxRetries: 5` handles this automatically |
| Context length exceeded | Caught explicitly; stage fails with a clear message advising the user to switch to a larger-context model in config, or that the chunking fallback needs enabling |
| Model unavailable | Stage fails with the specific model ID in the error message |
| Network timeout | SDK `timeout: 120_000ms` (2 minutes) — generous for vision calls |

---

## 9. Source File Structure

```
src/
├── index.ts                          # CLI entry point (existing, to be extended)
├── types/
│   └── pipeline.ts                   # PipelineStage, StageContext, StageResult, StageCost,
│                                     # RunManifest, QaDeficiency schemas
├── pipeline/
│   ├── runner.ts                     # Orchestrator, manifest I/O, batch mode, cost accumulation
│   ├── config.ts                     # Config file loader and validator
│   ├── openrouter.ts                 # OpenAI SDK client configured for OpenRouter
│   └── stages/
│       ├── audio-extraction.ts       # Existing (refactor to implement PipelineStage)
│       ├── transcription.ts          # Existing (refactor to implement PipelineStage)
│       ├── transcript-structuring.ts
│       ├── slide-conversion.ts
│       ├── image-extraction.ts
│       ├── synthesis.ts              # Most complex; context assembly, chunking fallback
│       └── qa-loop.ts               # Two-prompt QA pattern, loop termination logic
└── utils/
    ├── slug.ts                       # Filename → slug conversion
    ├── progress.ts                   # Shared cli-progress bar helpers
    └── cost.ts                       # Cost accumulation and report formatting
```
