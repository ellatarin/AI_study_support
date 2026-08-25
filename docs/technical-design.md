# Lecture Notes Generator — Technical Design

**Suite version:** 1.39-draft — shared across requirements, technical design, and implementation plan; any substantive edit to any of the three bumps this number in all three
**Date:** 2026-08-14
**Status:** For review

---

## 1. System Overview

The system is a TypeScript/Node.js CLI tool with nine stages (Stage 0 through Stage 8). Stage 0 is a batch normalisation step across all lectures in a module. Stages 1–8 run per lecture, orchestrated by a pipeline runner that reads and writes a per-lecture run manifest. Every stage is idempotent — if its output exists and the manifest marks it complete or skipped, it is skipped.

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

Source videos may have the date in any position and any format. Stage 0 extracts the date, assigns a lecture number by date order, and produces the provisional title by stripping the date, day names (Mon–Sun), configured module prefixes (e.g. `BOD_`, `Biology of Disease -`), any embedded lecture-number token (e.g. `Lecture 1`, which would otherwise duplicate the assigned number), and trailing artefacts (`co`, `copy`) from the original filename, keeping the lecturer's capitalisation as typed. The separators left behind by those removals go too, so a name Stage 0 itself produced reads back as the title it was built from: `Lecture 1 - Cell Injury - 2025-10-10.mp4` gives `Cell Injury`, which is how a lecture renamed by a run that stopped before writing its manifest keeps its title on the next one.

**Dates are read in British convention.** A four-digit component is the year; otherwise the day leads. Month-first is never read. All eight numeric forms are accepted:

| Day first | Year first |
|---|---|
| `10112025` | `20251110` |
| `10-11-2025` | `2025-11-10` |
| `10.11.2025` | `2025.11.10` |
| `10/11/2025` | `2025/11/10` |

Each of those is the tenth of November. Single-digit day and month are accepted (`1/2/2025` is the first of February).

A **two-digit year** is read only in the trailing position, and always as this century: `10-11-26` is the tenth of November 2026. A leading two-digit component is always the day, so `YY-MM-DD` is not a supported form — nothing in `26-11-10` distinguishes it from `DD-MM-YY`, and the year-first convention is written with four digits precisely because it sorts.

`DDMMYY` — six bare digits — is tried **last**, only when the filename yields no date any other way, prose included. Six digits are as likely to be an identifier as a date, and unlike the eight-digit form there is no four-digit year to anchor the reading. Where a stray identifier does resolve, Stage 0's 1:1 video-to-slide date match is the backstop: an invented date will not have a matching slide deck, so the module is refused and the file named.

The numeric forms are matched in `src/utils/date.ts` rather than delegated to `chrono-node`, because chrono reads `10/11/2025` as the eleventh of October — the American convention, and wrong here in every separated case. Chrono still handles dates written in words (`13 Oct 2025`, `Fri 10th Oct`), which carry no such ambiguity. Note that a prose date omitting the year is anchored to the current year, so a year-less filename dates itself to whenever it was processed.

A date is recognised wherever it sits and whatever abuts it: the boundary is "not a digit", not a word boundary, so `BOD_10112025_Cell Injury.mp4` resolves. This matters because `_` is a word character, and underscore-separated exports (Panopto, Echo360, Zoom) would otherwise hide the date entirely. A bare eight-digit run is read as a date only when one end is a plausible year (2000–2099), so an eight-digit identifier is left alone; separated forms need no such bound, since position alone identifies the year. Combinations naming no real day — `31022025`, `2025-13-10` — are rejected rather than rolled over into March or quietly corrected. A span with a date's shape is claimed even when it names no day, so chrono cannot reinterpret it: left to chrono, `2025-13-10` comes back as a valid date with the month silently adjusted, which is worse than no date at all.

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

#### Date and Naming Helpers

`src/utils/date.ts` and `src/utils/naming.ts` hold the filename parsing described above.

```typescript
extractDate(filename: string): Date | null
// Numeric forms first, read in British convention; chrono for dates written in words.
// null when no date is found with sufficient confidence.
formatDateISO(date: Date): string                    // YYYY-MM-DD, in local time — the zone the date was read in
stripDateTokens(text: string): string                // removes every numeric date, and every date and weekday span chrono finds
isCalendarDate(value: string): boolean
// Whether text is an ISO `YYYY-MM-DD` date that exists, so `2025-02-30` is refused as firmly as
// `yesterday`. Asked at both points a date enters the pipeline from outside — the command line, and a
// manifest read off disk (§4.2). A lecture is looked up *by* its date everywhere, so a date written any
// other way matches nothing rather than failing where it was introduced.

extractProvisionalTitle(args: { filename: string; modulePrefixes: readonly string[] }): string
// Best-effort title: strips whichever of the date, day names, a configured module prefix (`BOD_`, `BOD `),
// embedded lecture-number token (e.g. `Lecture 1`, which would duplicate the assigned number),
// separator debris at either end, and trailing artefacts (`co`, `copy`, `v2`) are present. The separator
// strip is what lets a name this module built read back as the title it was built from:
// `Lecture 1 - Cell Injury - 2025-10-10.mp4` gives `Cell Injury`. The lecturer's capitalisation is kept
// exactly as typed — the title becomes the workspace folder and the final PDF name, so re-casing it
// misspells the subject in both, and no rule can tell `mRNA` from an ordinary word since either may mix
// cases. The cost is that a filename typed in lower case yields a lower-case title: names are exactly as
// consistent as the filenames are, and nothing here invents a spelling of its own.
// A thin or empty result is acceptable — a date-plus-number filename leaves nothing — and Stage 3 judges
// the title once the transcript exists. The prefixes come from `naming.modulePrefixes` (§6) rather than
// being written here: a prefix names a module, and the pipeline is pointed at several. Each is matched
// literally and without regard to case, so one carrying a pattern character means itself, and an empty
// list strips nothing.
lectureFolderName(args: { lectureNumber: number; title: string; date: Date }): string
// The canonical `Lecture N - <title> - YYYY-MM-DD` form shared by the folder, sources, and PDF. Takes the
// parsed Date rather than a formatted string so the one place that formats a lecture date is formatDateISO.
lectureBaseName(args: { lectureNumber: number; title: string; date: Date }): string
// The same name, falling back to a bare `Lecture N - YYYY-MM-DD` when the title is empty — which a filename
// carrying nothing but a date and a number leaves it. This is the name every caller that renames a lecture
// asks for; lectureFolderName is the form beneath it. It lives here rather than in Stage 0, which first
// needed it, because pipeline infrastructure may not depend on a stage (§9).
filenameSafe(title: string): string                  // see §4.4 for the rules it enforces
class EmptyNameError extends NamedError              // sanitising left nothing to name a file with
```

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
└── QA checked/
    ├── notes.md                               # Stage 7 final — simple name
    └── images/
        └── slide-003-figure-01.png
```

`QA checked/notes.md` uses a simple name because it lives inside the named lecture folder. The full descriptive filename appears only on the PDF in `Final output/` (Stage 8).

The directory is named for the stage that fills it, not for the pipeline's end: it holds Stage 7's quality-checked notes, and Stage 8 only reads it. Stage 8's own output is the PDF in the module's `Final output/` (§3.1) — the one place a stage writes outside its workspace, and the one a re-run cannot clear by emptying, because every lecture's PDF is in it. `--from-stage pdf-generation` takes this lecture's PDF and leaves the rest (§4.4).

#### The layout has one owner

Every name in the two trees above — the module's four directories, each stage's workspace directory and the file it writes, `runs/`, and `manifest.json` — is declared once, in `src/pipeline/layout.ts`. Nothing else states a directory or filename as a literal.

This matters beyond tidiness, because the same name is relied on by parties that would otherwise each keep their own copy:

- **A stage and the runner.** A stage writes into its directory; `--from-stage` clears the stage's work there (§4.7). Two copies of the name means a rename breaks the reset silently — it would clear a path that no longer exists, report success, and leave the stage skipping on a manifest that still says complete.
- **A stage and the stage after it.** Stage 2 reads what Stage 1 wrote, Stage 3 reads what Stage 2 wrote. Declaring the path at both ends means the hand-off is stated twice and can drift in one place.
- **Production and tests.** A suite asserting a stage's output existed restated the path; it now asks the same module the stage asks.

```typescript
// src/pipeline/layout.ts
type ModuleDirs = { video: string; slide: string; processing: string; finalOutput: string }
moduleDirs(args: { moduleRoot: string }): ModuleDirs      // the module layout of §3.1, stated once
MANIFEST_FILE: string                                     // "manifest.json"
RUNS_DIR: string                                          // "runs"
runsDirPath(args: { workspaceRoot: string }): string
// That directory within one workspace. The runner writes a log into it and reads every log back out of it,
// and the suites look for what it wrote, so the three address it through one name rather than rebuilding it.
debugLogPath(args: { projectRoot: string; runId: string }): string
// One invocation's debug log, at <projectRoot>/runs/<runId>-debug.log. Anchored to the project because an
// invocation is wider than a lecture run — a batch spans every configured module, and Stage 0's work happens
// before any lecture is chosen — and because a relative path would follow the directory the user invoked
// from (§10).
workspaceRootFor(args: { moduleRoot: string; folderName: string }): string
// Where one lecture's workspace sits: a folder named after the lecture, inside the module's processing
// directory. Every stage, the runner, the CLI and every suite that lays a lecture out was rebuilding this.
moduleRootOf(args: { workspaceRoot: string }): string
// The module two levels up from a lecture workspace (`moduleRoot/Pipeline processing/<folder>`) — the inverse
// of the above, so the nesting is stated once. Used to assemble StageContext and to resolve the one stage
// directory that sits outside the workspace.
moduleName(args: { moduleRoot: string }): string
// What a module is called when it is shown to the user: its directory leaf, since a module has no name beyond
// the folder it is. Read by the batch summary's module column and by the CLI's "nothing matched" message.
datedFileDirs(args: { dirs: ModuleDirs }): readonly string[]
// The three directories holding a file of the lecture's own — video, slides, finished PDF — and so the three a
// lecture is addressed in by its date (§4.7). `processing` is excluded because a workspace is a folder named
// after the lecture rather than a file. Walked by `renameLectureFiles`, by `delete`, and by the fixtures.

type StageDirectoryName = string & { readonly [declaredInLayout]: true }   // branded; minted only in layout.ts
// Branded, and the private constructor that mints it rejects a widened `string`, so a value read back from the
// manifest or an LLM response cannot reach this map. See §4.4, "Stage cleanup boundaries".
type StageOutputLocation =
  | { root: "workspace"; directories: readonly StageDirectoryName[] }
  | { root: "module"; directory: StageDirectoryName }
// Where a stage's work sits, and so what a reset may take. The two variants are not two spellings of one thing.
// A workspace directory holds one lecture's work and nothing else, so a reset takes the directory. The module's
// `Final output/` holds every lecture in the module, so a reset there takes only the file belonging to the
// lecture being reset — which is why that variant names a directory *deposited into* rather than a set owned.
// A stage cannot declare that it owns a module-wide directory, so no reset can sweep one (§4.7).
type StageWorkspace = { outputLocation: StageOutputLocation; outputFile: string | null }
STAGE_WORKSPACE: Readonly<Record<StageId, StageWorkspace>>
// What each stage owns: where its work sits, and the single file it writes where it writes one. Every stage but
// pdf-generation works in workspace directories; pdf-generation deposits its PDF in the module's `Final
// output/`. `outputFile` is null for source-normalisation (which writes nothing of its own), for the stages
// producing a set rather than a file (image-extraction, qa-loop), and for pdf-generation, whose one file lands
// outside the workspace where a workspace-relative path cannot reach it. slide-conversion produces a set too —
// one markdown file per slide — but concatenates it into `Slide content/slides.md`, which is the single file
// the stage after it reads.

type StageInWorkspace = { workspaceRoot: string; stageId: StageId }
// One stage's work within one lecture, the pair every resolver below is addressed by.
class NoStageOutputFileError extends NamedError   // asked of a stage that writes no one file
stageOutputEntry(stageId: StageId): string
// The stage's output path relative to the workspace, as recorded in `filesWritten` (§4.5). The four stages
// whose `outputFile` is null have no answer to give, and each is null for a different reason, so asking raises
// the error above rather than returning a value that would have to be read as "none of the four".
stageOutputPath(query: StageInWorkspace): string
// The same path, absolute. A stage uses it for its own output and for its upstream's input, so a hand-off
// between two stages is stated once rather than at both ends.
type ResolvedStageOutput =
  | { root: "workspace"; directories: readonly string[] }
  | { root: "module"; directory: string }
resolveStageOutput(query: StageInWorkspace): ResolvedStageOutput
// Where the stage's work sits for one lecture, as absolute paths, resolved against whichever root it hangs
// off — decided here rather than at each end, so a directory that moved between roots cannot be written in one
// place and looked for in another. The variant comes through with the paths because it is what tells a reset
// whether it may take the directory (§4.7).
stageDirectoryPaths(query: StageInWorkspace): readonly string[]
// Every directory the stage works in, in declaration order; `[]` for a stage working in none. This is what the
// factory creates and clears of leftovers before a run (§4.3). It is deliberately *not* what a reset deletes:
// the module directory pdf-generation deposits into appears here, because it must exist before pandoc writes
// into it, and a reset taking this list at face value would remove every lecture's PDF.
```

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
| 7 | QA Loop | Per-lecture | Iteratively check and revise notes; write final `QA checked/notes.md` |
| 8 | PDF Generation | Per-lecture | Convert `QA checked/notes.md` to PDF via pandoc; deposit in `Final output/` |

### 4.2 Stage Interface

Every stage implements a common `PipelineStage<TInput, TOutput>` contract: an idempotency check `isComplete(context)`, an input step `getInput(context)`, and `run({ input, context })` returning a `StageResult`. Stages read an immutable `StageContext` — lecture identity, `workspaceRoot`, `moduleRoot`, the resolved `PipelineConfig`, and the current `RunManifest` — and never mutate it. A stage's own bookkeeping in the manifest — its status, cost, and `filesWritten` — is written by the runner, never by the stage, and so is the manifest's *lecture identity*. **No per-lecture stage writes `manifest.json`.** Stage 3 settles the lecture's title (§5, Stage 3) and is the only stage that changes anything about the lecture's identity; it reports what it settled on `StageResult.identityChanges` and the runner writes it with the stage's `complete` entry.

A stage's context is assembled before its own entry is marked `running`, so the manifest copy it carries is out of date in that field for as long as the stage runs. The copy is a read model. The runner re-reads the manifest immediately before each write and is its only writer, so every write has a current base, and the `running` marker survives the stage it belongs to (§4.5). Current is not trusted: the manifest is untrusted input throughout, bounded by §4.4.

**Authoritative types.** The exact shape of every pipeline contract — `PipelineStage`, `StageId`, `StageContext`, `StageResult`, `StageCost`, `StageRunConfig`, and the rest — lives in `src/types/pipeline.ts` with per-field documentation. That file is the single source of truth; this section describes intent and the invariants those types encode, not field lists:

- `StageResult.cost` is `null` for stages that make no billable calls (audio-extraction, pdf-generation).
- `StageResult.filesWritten` holds paths relative to `workspaceRoot`, and MAY escape upward with `..` (e.g. pdf-generation writes to `../../Final output/`) but MUST resolve under `moduleRoot` — enforced by §4.4.
- `StageCost` is discriminated on `costUsd`: a resolved cost is a `number`; a failed lookup is `null` paired with a `costResolutionError` (see §7).
- `StageResult.identityChanges` holds the lecture-identity fields the stage settled — `lectureTitle`, `aiDerivedTitle`, `workspaceFolderName` — for the runner to write. Absent and `{}` both mean the stage settled nothing; only Stage 3 ever settles anything. `workspaceFolderName` is the lecture's canonical base name recorded in the manifest, not the runner's handle on the workspace — the runner locates that itself (§4.7).
- `lectureTitle` is always non-null — seeded at Stage 0, possibly overwritten at Stage 3 (see §3.2, Stage 3).

`isComplete()` checks two conditions: the manifest marks the stage `'complete'` or `'skipped'`, AND every path in `manifest.stages[stageId].filesWritten` exists on disk. Both must be true. The two statuses count alike because a run that honours this check records `skipped` in place of the `complete` it read, so from the next run's point of view they describe the same disk — the work is done and does not need paying for again. This means a completed stage whose output was manually deleted returns `false` and re-runs automatically. A recorded path that cannot be resolved at all counts as absent rather than as an error, since deleting a stage's output usually removes its containing directory too; a path resolving *outside* `moduleRoot` is a different matter and always throws (§4.4).

That check is identical for every stage, so stages are not assembled by hand: each is built through a shared factory that supplies `isComplete` for the given stage id, leaving a stage to define only the two things that genuinely differ — how it gathers its input, and what it does.

The factory carries two further things every stage would otherwise restate. It prepares the stage's output directories before `run` begins (§4.3), and it binds the run's logger to the stage **once, at construction**, so `run` is handed a logger already stamping `{ stage }` (§10). Note where `logger` sits: on the factory, not on `PipelineStage.run`. The runner invokes a stage with the input and the context and nothing else, so the logging capability never travels through the stage contract — and `src/types/pipeline.ts` stays free of any dependency on the logging library.

```typescript
// src/pipeline/stages/pipeline-stage.ts
isStageComplete(args: { context: StageContext; stageId: StageId }): Promise<boolean>
createPipelineStage<TInput, TOutput>(args: {
  stageId: StageId
  logger: Logger                                        // the run's; bound to the stage here, once
  getInput: (context: StageContext) => Promise<TInput>
  run: (args: { input: TInput; context: StageContext; logger: Logger }) => Promise<StageResult<TOutput>>
}): PipelineStage<TInput, TOutput>
// `run`'s logger is the bound child, not the one passed in. Every per-lecture stage factory therefore takes
// { logger } and forwards it, exactly as createSourceNormalisationStage already does for Stage 0.
```

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

Every file is written to a `.tmp`-suffixed path first, then renamed on success. Any file that exists on disk without a `.tmp` suffix is guaranteed to be complete. At the start of every stage run, the stage's output directories are created if absent and any `.tmp` files left by a previous crashed run are deleted, before processing begins. This is automatic and requires no user intervention.

The stage does not do this for itself — `createPipelineStage` does it on every stage's behalf (§4.2), reading the directories from `STAGE_WORKSPACE` (§3.3) rather than from the stage's output file, so a stage owning several directories, or one outside the workspace as `pdf-generation` does, is prepared as completely as a stage owning a single one.

Output a stage does not hold in memory — bytes written by a subprocess, such as Stage 1's ffmpeg extraction — goes through the same discipline via `produceFileAtomic`, which hands the producer the `.tmp` path and renames only once it resolves. One consequence is worth stating because it looks like an oversight otherwise: a `.tmp` suffix defeats the container inference ffmpeg does from the output extension, so any stage muxing to a temporary path must name its output format explicitly.

```typescript
// src/utils/files.ts
writeFileAtomic(args: { path: string; content: string | Uint8Array }): Promise<void>   // writes .tmp, renames on success
produceFileAtomic(args: { path: string; produce: (tmpPath: string) => Promise<void> }): Promise<void>
// the general form: the caller creates the file at the .tmp path it is given
readJsonSafe(path: string): Promise<unknown>
// The read half: the parsed value, or null when the file is missing, unreadable, or not JSON. Answers with a
// value rather than a throw because both callers scan speculatively — the runner over whatever `runs/` holds,
// `readManifestSafe` over a folder that may not be a lecture. The value is `unknown`: what the file was
// supposed to hold is the caller's claim, and a parse cannot check it.
writeJsonAtomic(args: { path: string; value: unknown }): Promise<void>
// the same, for a value serialised as JSON. Every JSON file the pipeline persists — the lecture manifest
// (§4.5) and the run logs (§4.6) — is read by a human before anything else reads it, so they are indented
// alike; the indentation is the one part of the format neither writer owns, and is settled here.
cleanTmpFiles(dir: string): Promise<void>                                 // deletes any .tmp files in a directory
```

The same module holds the reads, because a pipeline whose directories are created on demand asks about a
directory that may not be there yet on nearly every path — a workspace with no `runs/`, a module with no
`Final output/`, a lecture with no PDF. Each answers with an ordinary value rather than a throw, so no caller
wraps a listing in a try/catch:

```typescript
readDirSafe(dir: string): Promise<readonly Dirent[]>          // `[]` when the directory does not exist
pathExists(path: string): Promise<boolean>                    // whatever kind of entry it is
listFileNames(dir: string): Promise<readonly string[]>        // real files only, dotfiles excluded
listSubdirectoryNames(dir: string): Promise<readonly string[]>
// The last is how `Pipeline processing/` is scanned for lectures (§4.7) and `listFileNames` how sources are
// found by date (§4.7, "Moving a lecture's files").
```

### 4.4 Path Validation

`filesWritten` entries and any other path derived from manifest or LLM output MUST be validated before any filesystem operation. The manifest is trusted only to the extent that the runner enforces its bounds — a corrupted or hand-edited manifest must never be able to delete, overwrite, or observe files outside the module tree.

**Boundary check.** For every path derived from the manifest or a stage's `filesWritten`:

1. Resolve with `path.resolve(workspaceRoot, entry)`.
2. Resolve the parent directory (or file, if it exists) with `fs.promises.realpath(...)` to collapse any symlinks.
3. Verify the resulting absolute path is a descendant of `moduleRoot`. Reject otherwise as a corrupt manifest.

This is enforced in every place a path from `filesWritten` or the manifest is used. Today that is one place — the `isComplete()` existence checks, via `recordedFileExists` — and it extends to `cost-report` file discovery and PDF output resolution as those are built.

`--from-stage` cleanup is deliberately **not** on that list. It takes no manifest-derived path at all, so it has nothing to validate: every directory it works in comes from the hard-coded `STAGE_WORKSPACE`, and it never consults `filesWritten` (see "Stage cleanup boundaries" below). Eliminating the untrusted input is stronger than checking it — a boundary check is only as sound as its own symlink handling, whereas a path that never enters the function cannot be steered at all. `isComplete()` has no such option, since reading `filesWritten` is precisely its job. Running the check in cleanup would also be inert, passing unconditionally on names like `"Audio"`, and an assertion that cannot fail would misrepresent the input as untrusted to the next reader.

```typescript
// src/utils/files.ts — the two path resolvers, deliberately distinct
workspacePath(args: { workspaceRoot: string; segments: readonly string[] }): string
// Trusted, code-supplied segments only. No boundary check — untrusted input uses the resolver below.
type ManifestPathQuery = { workspaceRoot: string; moduleRoot: string; entry: string }
resolveManifestPath(query: ManifestPathQuery): Promise<string>
// The three steps above, in order; throws ManifestPathError when the result escapes moduleRoot.
// The query is a named type so callers forwarding a path state the shape once.
```

**`filenameSafe(title)`.** Titles reach the filesystem via workspace folder names, source file renames, and the `Final output/` PDF name. Titles originate from user filenames (Stage 0) or LLM output (Stage 3) — neither is a trusted path component. `filenameSafe` MUST:

- Strip path separators (`/`, `\`), directory-traversal segments (`.`, `..`), null bytes, and ASCII control characters.
- Collapse whitespace runs to a single space; trim leading/trailing whitespace and dots.
- Reject an empty result — the caller must fall back to `provisionalTitle` or a stage-defined default.

```typescript
filenameSafe(title: string): string   // src/utils/naming.ts; throws when the result would be empty
```

**Stage cleanup boundaries.** `--from-stage <stageId>` MUST NOT drive its cleanup off `filesWritten` from the manifest. Cleanup works from the per-stage, hard-coded `STAGE_WORKSPACE` (§3.3) — `Slide content/` for Stage 4, the module's `Final output/` for Stage 8 — so a corrupt manifest cannot trigger deletion of unintended files. "Hard-coded" is enforced by the type system rather than left to convention: a stage directory name is branded, and the private constructor that mints it rejects a widened `string` (§3.3). A `filesWritten` entry or LLM-supplied name reaching that map is a compile error.

Stage 8's directory is the sole one resolved against `moduleRoot` rather than the workspace, and it holds every lecture in the module. What a stage declares is therefore a `StageOutputLocation` (§3.3), and the variant decides how cleanup proceeds. Its `workspace` variant carries directories, which cleanup takes whole, since each holds one lecture's work and nothing else. Its `module` variant carries the directory the stage deposits into, where cleanup removes the single file carrying the reset lecture's date and leaves the directory and every other lecture's PDF standing. A stage has no way to declare that it owns a module-wide directory, so the reach of a reset is bounded by the type rather than by the care taken at each call site.

The delete target is anchored at the other end too: `workspaceRoot` is always built by `listWorkspaces` as `join(moduleDirs({ moduleRoot }).processing, <directory listing entry>)`, and the manifest is read only to match a lecture date, never to supply a path. So `moduleRootOf(workspaceRoot)` returns the same `moduleRoot` the caller passed in, and neither root nor name is manifest-derived.

**No shell interpolation.** Every child-process invocation across the pipeline (fluent-ffmpeg in Stage 1, pandoc in Stage 8, any future subprocess call) MUST use `spawn(cmd, argv, opts)` with an explicit argv array — never `exec(shellString)` and never any variant that concatenates paths into a shell command. This eliminates the class of bug where folder names with spaces (`Final output/`, `Slide content/`, `QA iterations/`) or attacker-controlled title strings break out of an argument via unescaped shell metacharacters. Paths are passed verbatim as argv elements; no quoting is required or applied.

### 4.5 Run Manifest

One `manifest.json` per lecture, stored in the workspace root. All paths are relative to `workspaceRoot` so the manifest survives a folder rename.

The manifest tracks the **current pipeline state** and the cost of the most recent successful execution of each stage. Historical cost across multiple runs is the responsibility of the run logs (§4.6). Its TypeScript shape is `RunManifest` in `src/types/pipeline.ts` (single source of truth); the example below is illustrative, not the schema.

Three separate callers touch it — Stage 0 creates and renumbers it, the runner patches a stage entry after every stage (and with it any lecture-identity change Stage 3 settled, §4.2), and the CLI's identity commands rewrite a lecture's title or date — so where it lives and how it is written are stated once:

```typescript
// src/pipeline/manifest.ts
MANIFEST_VERSION: string   // "1" — the schema version stamped into every manifest the pipeline writes
// Declared beside the format it versions, because both parties that write a version — Stage 0, which creates a
// manifest, and the fixtures, which seed one per suite — would otherwise hold their own, and nothing reads
// `version` back to notice. Bumping it here bumps what the suites seed, so a migration is tested against the
// version it migrates from.
pendingStages(): RunManifest["stages"]   // every stage `pending`, as Stage 0 writes it for a new workspace
// Beside the version and for the same reason: Stage 0 writes this map and the fixtures seed one, and each had
// been building its own. Nothing reads the map back in a way that would notice the two drifting apart.
manifestPath(args: { workspaceRoot: string }): string
class ManifestUnreadableError extends NamedError   // missing, or the filesystem refused it
class ManifestNotJsonError extends NamedError      // read, but does not parse as JSON
class ManifestShapeError extends NamedError        // parses, but describes no lecture
// One class per way `readManifest` fails, the two the platform raises included: a caught failure names which
// of the three happened from its type, and a raw `ENOENT` or `SyntaxError` reaching a caller says only that
// something below went wrong.
readManifest(args: { workspaceRoot: string }): Promise<RunManifest>        // throws when missing or malformed
// "Malformed" is judged the same way both readers judge it, on the parsed value rather than on whether parsing
// threw. `{}`, `[]` and `null` all parse and none describes a lecture. The two readers differ only in what they
// do about it: this one throws, `readManifestSafe` answers `null`.
readManifestSafe(args: { workspaceRoot: string }): Promise<RunManifest | null>
// null instead: a folder under `Pipeline processing/` with no readable manifest is not a lecture, which is a
// fact to skip over rather than an error, since both Stage 0 and the runner scan those folders speculatively.
// "Readable" is judged on the parsed value, not on whether parsing threw: a `manifest.json` holding `{}` or
// `[]` parses perfectly and still identifies no lecture. The check is the three fields every scanning caller
// goes on to read — `lectureNumber`, `lectureDate`, `stages` — so a manifest with imperfect stage entries
// still describes a lecture and reaches the caller that reads them.
writeManifest(args: { workspaceRoot: string; manifest: RunManifest }): Promise<void>   // atomic (§4.3); creates the workspace if absent
patchManifest(args: { workspaceRoot: string; manifest: RunManifest; changes: Partial<RunManifest>; updatedAt: string }): Promise<RunManifest>
// Lays changes over the manifest, stamps `updatedAt`, and writes the result. All three callers do exactly
// that, so an edit cannot leave a manifest claiming nothing happened to it. The instant is given rather than
// read here because the runner's is not simply "now": it stamps the same instant it writes into the stage
// entry, so the manifest and the entry inside it name one moment.
```

Each stage entry records `configUsed` — a `StageRunConfig` capturing the model ID and tuning parameters (temperature, max tokens, concurrency, max QA iterations) actually resolved for that run, or `null` for stages that make no LLM calls. This lets spend be attributed to a specific model and configuration and lets model experiments be compared (NFR-3.2). The run logs (§4.6) record the same `configUsed` per attempt.

```jsonc
{
  "version": "1",
  "lectureNumber": 1,
  "lectureDate": "2025-10-10",
  "provisionalTitle": "Disease Cell Injury and the Immune System",
  "userTitle": null,
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
      "cost": { "promptTokens": 0, "completionTokens": 0, "costUsd": 0.042, "callCount": 1 },
      "filesWritten": ["Transcript/transcript.txt"]
    },
    "transcript-structuring": {
      "status": "complete",
      "completedAt": "...",
      "configUsed": { "modelId": "anthropic/claude-sonnet-4.6", "temperature": 0.2, "maxTokens": 8192 },
      "cost": { "promptTokens": 18400, "completionTokens": 3200, "costUsd": 0.081, "callCount": 1 },
      "filesWritten": ["Structured transcript/structured-transcript.md"]
    },
    "slide-conversion": {
      "status": "complete",
      "completedAt": "...",
      "configUsed": { "modelId": "google/gemini-2.5-flash", "temperature": 0.1, "maxTokens": 4096, "concurrency": 3 },
      "cost": { "promptTokens": 41000, "completionTokens": 8100, "costUsd": 0.034, "callCount": 24 },
      "filesWritten": ["Slide content/slides.md"]
    },
    "image-extraction": {
      "status": "complete",
      "completedAt": "...",
      "configUsed": { "modelId": "openai/gpt-4.1", "temperature": 0.0, "maxTokens": 2048, "concurrency": 2 },
      "cost": { "promptTokens": 0, "completionTokens": 2400, "costUsd": 0.038, "callCount": 12 },
      "filesWritten": ["Slide images/images-manifest.json"]
    },
    "synthesis": {
      "status": "complete",
      "completedAt": "...",
      "configUsed": { "modelId": "anthropic/claude-sonnet-4.6", "temperature": 0.3, "maxTokens": 16384 },
      "cost": { "promptTokens": 65000, "completionTokens": 14200, "costUsd": 0.312, "callCount": 1 },
      "filesWritten": ["Synthesised notes/synthesised-notes.md"]
    },
    "qa-loop": {
      "status": "complete",
      "completedAt": "...",
      "configUsed": { "modelId": "anthropic/claude-sonnet-4.6", "temperature": 0.1, "maxTokens": 8192, "maxIterations": 3 },
      "cost": { "promptTokens": 68000, "completionTokens": 15800, "costUsd": 0.405, "callCount": 4 },
      "qaIterations": [
        { "iteration": 1, "verdict": "fail", "deficiencyCount": 7, "criticalCount": 2, "costUsd": 0.200 },
        { "iteration": 2, "verdict": "pass", "deficiencyCount": 0, "criticalCount": 0, "costUsd": 0.205 }
      ],
      "terminationReason": "qa-passed",
      "filesWritten": [
        "QA iterations/qa-iteration-01-deficiencies.json",
        "QA iterations/qa-iteration-01-revised.md",
        "QA checked/notes.md",
        "QA checked/images/slide-003-figure-01.png"
      ]
    },
    "pdf-generation": {
      "status": "complete",
      "completedAt": "...",
      "configUsed": null,
      "cost": null,
      "filesWritten": ["../../Final output/Lecture 1 - Disease Cell Injury and the Immune System - 2025-10-10.pdf"]
    }
  }
}
```

Each stage's `cost` is the only record of what that stage cost, and the manifest holds no roll-up of them. A reader that wants a stage's spend reads that stage's entry; nothing has to be kept in step with anything else, and a stage reset by `--from-stage` takes its cost with it when its entry goes back to `pending` (NFR-2.2).

**`running` status is written before a stage begins.** A crash mid-stage leaves `running` in the manifest, which is treated as `failed` on next launch — the stage re-runs from scratch.

### 4.6 Run Logs

Every pipeline invocation creates a new log file in `runs/` named by ISO timestamp (e.g. `runs/2025-10-10T09-00-00Z.json`). Run logs are append-only and never modified after creation.

Each log records which stages were attempted, skipped, or re-run; cost and model per stage; and whether each stage succeeded or failed. This provides a complete financial audit trail including failed attempts and model experiments.

`runs/` is read by scanning it, not from an index, so the cost report is offered every file that sits there — including one the pipeline never wrote, such as a debug log dropped alongside them (§10). Parsing as JSON is not enough to be a run: a file is taken as one only if it carries the `runId` it is filed under and the stage map the report iterates. Anything else is skipped, the same judgement `readManifestSafe` makes about a folder that is not a lecture (§4.5).

```jsonc
{
  "runId": "2025-10-10T09-00-00Z",
  "startedAt": "2025-10-10T09:00:00.000Z",
  "endedAt": "2025-10-10T09:12:00.000Z",
  "triggeredBy": "manual",          // 'manual' | 'from-stage'
  "runType": "normal",              // 'normal' | 'error-recovery' | 'experiment' — classified at run start (§7)
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
      "cost": { "costUsd": 0.021, "callCount": 13 }
    },
    "image-extraction":  { "action": "not-reached" },
    "synthesis":         { "action": "not-reached" },
    "qa-loop":           { "action": "not-reached" },
    "pdf-generation":    { "action": "not-reached" }
  }
}
```

A run log records what each stage of that run cost and stops there — no figure for the run as a whole (NFR-2.2).

### 4.7 Pipeline Runner

The runner-facing types — `LectureMatch`, `RunOptions`, `BatchRunOptions`, `ReportOptions`, `RunStageOutcome`, `RunSummary`, and `BatchSummary` — are defined in `src/types/pipeline.ts` (single source of truth).

`RunOptions` carries what any run can be told: which stage to restart from, and `onStageFailure`, `'halt' | 'continue'`, which the caller always states. `BatchRunOptions` extends it with `concurrency`, how many lectures are in flight at once; only a batch has more than one lecture to place, so the option lives on the batch's type alone and a single-lecture run cannot express it. What a caller who states no preference gets is named once, as `DEFAULT_RUN_OPTIONS` and `DEFAULT_BATCH_OPTIONS`: halt at the first failed stage, one lecture at a time.

The `PipelineRunner` surface:

```typescript
class PipelineRunner {
  // Stages are injected so the runner is driven by stub stages under test and real stages in production.
  constructor(deps: { config: PipelineConfig; sourceNormalisation: Readonly<SourceNormalisationStage>; lectureStages: readonly Readonly<PipelineStage<unknown, unknown>>[]; logger: Logger })
  async normaliseSources(args: { moduleRoots: readonly string[] }): Promise<void>          // Stage 0
  async runLecture(args: { workspaceRoot: string; options?: RunOptions }): Promise<RunSummary>
  async runBatch(args: { moduleRoots: readonly string[]; options?: BatchRunOptions }): Promise<BatchSummary>
  async costReport(args: { moduleRoots: readonly string[]; options?: ReportOptions }): Promise<readonly string[]>
  // One rendered report per reported lecture, handed back rather than printed. The CLI writes them
  // through its injected stream like every other block of output (§8), so nothing in the pipeline
  // writes to the process's own stdout.
  async resolveLecturesByDate(args: { moduleRoots: readonly string[]; lectureDate: string }): Promise<readonly LectureMatch[]>
  async countLectures(args: { moduleRoots: readonly string[] }): Promise<number>
}

// Stage 0's per-module contract (Phase 4 supplies the real implementation):
type SourceNormalisationStage = { stageId: "source-normalisation"; normaliseModule(args: { moduleRoot: string }): Promise<void> }

// The runner's supporting logic lives in module-level functions rather than private methods, so each has one
// job and the class stays orchestration. All of them are module-private but `deriveRunId`: `PipelineRunner`
// is the module's surface, and the surface its own tests drive. Notably runStage returns its outcome (rather
// than void): the caller collects the entries, decides whether to halt, and fills `not-reached` — so no
// shared mutable run-log state exists and batch concurrency is safe.
export deriveRunId(args: { instant: Date }): string     // filesystem-safe run id, e.g. 2025-10-10T09-00-00Z
// Exported for the CLI, which names the run's debug log after the run it belongs to (§10).
classifyRunType(args: { options: RunOptions; manifest: RunManifest }): RunType  // normal | experiment | error-recovery (§7)
// Private. The classification reaches the outside world on `RunLog.runType`, which is where the cost report
// reads it and where the runner's tests assert it.
type StageOutcome = { entry: RunLogStageEntry; context: StageContext }
runStage(args: { stage: PipelineStage<unknown, unknown>; context: StageContext; config: PipelineConfig; timestamp: string; logger: Logger }): Promise<StageOutcome>
// Runs or skips one stage: marks it `running`, converts a throw into a failed entry (never throws), and logs
// any failure with its stack (§8). Returns the run-log entry together with the context the next stage runs
// against — see "Following a relocated workspace" below. It owns the decisions — run, skip, map a throw to
// an entry — and delegates every manifest transition to a recorder.
createStageRecorder(args: { stageId: StageId; context: StageContext; config: PipelineConfig; timestamp: string }): StageRecorder
type StageRecorder = { skipped(): Promise<void>; running(): Promise<void>
                       complete(args: { configUsed: StageRunConfig | null; result: StageResult<unknown> }): Promise<void>
                       failed(args: { configUsed: StageRunConfig | null; error: string }): Promise<void>
                       context(): StageContext }
// One stage's manifest transitions, and the context that follows from the last of them. Each write locates
// the workspace first (the stage may have moved it), patches the entry through updateManifest, and rebuilds
// the context from what was written. `complete` also carries the stage's `identityChanges` (§4.2).
updateManifest(args: { workspaceRoot: string; manifest: RunManifest; stageId: StageId; entry: ManifestStageEntry; identityChanges: LectureIdentityChanges; timestamp: string }): Promise<RunManifest>
// Atomic per-stage manifest patch via manifest.ts (§4.5). Takes the manifest to patch rather than reading it,
// and returns what it wrote, so the caller rebuilds the stage context without a second read. It is the one
// place a manifest gains a stage entry and a lecture-identity change, so the two always land in a single write.
resolveWorkspace(args: { workspaceRoot: string; moduleRoot: string; lectureDate: string }): Promise<{ workspaceRoot: string; manifest: RunManifest }>
// Where the workspace is now, and what its manifest says. Returns the path given when its manifest still
// reads; otherwise finds the lecture again by date (see "Following a relocated workspace").
findLectureByDate(args: { moduleRoot: string; lectureDate: string }): Promise<{ workspaceRoot: string; manifest: RunManifest } | null>
// Scans `moduleRoot/Pipeline processing/*/manifest.json` for the lecture carrying this date. Shared by
// resolveWorkspace and resolveLecturesByDate, which apply the same identity rule to different ends.
```

A `RunSummary` lists its stages as `RunStageOutcome` — the run-log entry *paired with the stage id it belongs to*. The run log keys entries by stage id, but a summary is an ordered list, and its consumer (the end-of-run summary, §7) has to name each stage it reports.

**Reducing outcomes to a status.** The same three-way rule applies at every level — a stage within a lecture, a lecture within a module, a module within a batch — so it is stated once in `src/pipeline/run-status.ts` and applied by both the runner and the reporting that prints its summaries:

```typescript
stageOutcomeStatus(entry: RunLogStageEntry): OverallStatus            // failed | partial (skipped/not-reached) | success
summariseOverallStatus(args: { statuses: readonly OverallStatus[] }): OverallStatus  // any failure wins, then any partial
summariseLectures(args: { lectures: readonly { overallStatus: OverallStatus }[] }): OverallStatus
// The same rule over lectures, which carry their own status: the runner folds a whole batch this way and the
// batch table folds each module's rows, and both were writing the projection out. The parameter asks for the
// status alone rather than a whole RunSummary, because that is all the rule reads.
hasSettledOutput(entry: ManifestStageEntry | QaManifestStageEntry | undefined): entry is SettledStageEntry
// Whether a *manifest* entry means the stage's output is on disk — `complete` or `skipped` (§4.2). Three
// unrelated callers ask it: the shared `isComplete`, the run classifier, and the cost report's current-pipeline
// section. A type guard rather than a boolean, so a caller that has checked can read `filesWritten` without a cast.
```

**Run outcome classification.** A `RunSummary.overallStatus` — and the aggregate `BatchSummary.overallStatus` across a batch's lectures — is `success` when every attempted stage completed, `partial` when one or more stages were skipped or not reached, and `failed` when at least one stage failed.

**Pipeline order comes from `STAGE_IDS`.** `src/types/pipeline.ts` declares `STAGE_IDS` as the ordered stage list, and everything that walks the stages in order — the runner's `--from-stage` reset, the cost report's per-stage breakdown — iterates that array. Neither derives its own order from the keys of some other map: a map is a lookup keyed *by* stage, and using its key order as the pipeline order means a stage added to one map and not another silently changes or truncates the sequence.

**`--from-stage <stageId>`:** Resets the nominated stage and all downstream stages to `pending` in the manifest. Also deletes per-stage intermediate files for the stages being re-run (e.g. `Slide content/raw/*.md` when re-running Stage 4), so the re-run produces entirely fresh output. Upstream stages are untouched. Deletion targets hard-coded per-stage directories (see §4.4) — never `filesWritten` from the manifest — and in the module's `Final output/`, which is shared, it takes only this lecture's PDF.

**The reset is confirmed before anything is deleted (NFR-4.3).** The CLI asks once per invocation, leading with the number of lectures that will lose work, and declining runs nothing at all rather than running without the reset. The count is what makes the question worth reading, because nothing the user typed states it: `run <date>` covers however many lectures that date matched and they then chose, and `batch` covers every lecture in the module named — or, with no module named, in every configured one. The question is asked wherever that set first becomes known, which is the CLI for a date and, for a batch, only after `countLectures` has scanned the modules (§4.7, "Counting a batch's scope"). Establishing the count costs that scan, so it is taken only when a stage is nominated; an ordinary run asks nothing and pays nothing. There is no flag to suppress the question.

**Natural restart after failure:** Does not clear intermediate files — per-slide markdown files from Stage 4 are preserved for resumability, allowing a failed run to pick up at the slide where it stopped.

**Lecture identification:** A lecture is uniquely identified by `(moduleRoot, lectureDate)`. Stage 0 guarantees `lectureDate` is unique within a module. Across modules, dates may collide — see `resolveLecturesByDate` below.

**`resolveLecturesByDate`:** Scans every `moduleRoots[i]/Pipeline processing/*/manifest.json` and returns matches whose `lectureDate` equals the argument. Zero matches: caller decides (typically an error). One match: caller uses it directly. Multiple matches: caller (the CLI) prompts the user via `@inquirer/prompts` — checkbox list of matches (each labelled `<module name> — Lecture N — <title>`) with "All matches" and "Cancel" affordances. Interactive prompt lives in the CLI layer, not the runner.

**`StageContext` assembly:** Before invoking any stage, the runner reads `manifest.json` at `workspaceRoot` and assembles a `StageContext`. `lectureNumber`, `lectureDate`, `provisionalTitle`, `lectureTitle`, and `workspaceRoot` are sourced from the manifest. `moduleRoot` (the containing module for this lecture) is derived from `workspaceRoot` two levels up (`moduleRoot/Pipeline processing/<folder>`); `config` comes from the runner's construction. Every context is frozen and no stage may mutate one; the per-stage manifest entries are the runner's to write, through `updateManifest()` (§4.2).

The assembly lives in its own module rather than on the runner, because the runner is not its only caller: the stage test fixtures build a context for every stage suite, and building it here means a stage under test is handed one put together exactly as a real run puts it together.

```typescript
// src/pipeline/stage-context.ts
assembleContext(args: { workspaceRoot: string; manifest: RunManifest; config: PipelineConfig }): StageContext
// moduleRoot derived two levels up; the result is frozen.
```

The context is **rebuilt between stages** rather than assembled once for the run. It costs no extra reads: the runner already re-reads the manifest at every stage transition, so `updateManifest` hands back what it wrote and the next context is assembled from that. What it buys is that a stage's manifest changes reach the stages that follow — Stage 3 replaces `lectureTitle`, and Stage 8 names the PDF from it.

**Following a relocated workspace.** Stage 3 renames the workspace folder when it replaces the lecture's title (§5, Stage 3), which invalidates the path the runner is holding mid-run. Stages do not report the move; the runner re-locates the lecture by the identity this section treats as canonical — `(moduleRoot, lectureDate)`. `resolveWorkspace` reads the manifest at the path it has and, failing that, falls back to `findLectureByDate`, which scans `Pipeline processing/` for the workspace whose manifest carries the date. The fallback is reached only after a stage has moved the folder; every other transition costs the read it always cost. The run log is written at the resolved path and `RunSummary.workspaceRoot` reports it, so a run that renames its own workspace still leaves its log beside the work.

**Counting a batch's scope.** `countLectures({ moduleRoots })` reports how many lectures stand across those modules, applying the same reading as the batch itself: a folder holding no manifest is not a lecture, and a module the pipeline has never processed holds none. It exists because the `--from-stage` confirmation has to state a number the user has no other way of knowing, and it is called only on that path — the scan it costs is not something an ordinary batch should pay for. Sources are normalised before it runs, so a lecture whose video and slides were only just added is counted; the batch is about to run it either way.

**Batch mode:** `runBatch({ moduleRoots })` normalises every listed module, then processes every lecture across them. The CLI passes an array of one for `batch <moduleRoot>` and the full `config.moduleRoots` for `batch` (no argument). Modules processed in the order given; lectures within a module in date order. Sequential by default; `--concurrency N` runs that many lectures at once, drawn from a single global queue rather than per module — with modules in order, a global queue keeps every worker busy where a per-module one would idle at each module boundary. Because lectures from different modules may therefore be in flight together, the per-module and cross-module summaries are printed once the batch completes rather than as each module finishes (§7).

**`cost-report` command:** Aggregates all run logs across the configured `moduleRoots` and prints a table showing total expenditure broken down by run and stage — enabling comparison of model experiments and visibility of wasted spend from failures (see §7). Narrowed by `--date` (via `resolveLecturesByDate`, with the same multi-match prompt) or `--module <moduleRoot>`.

**Identity-mutation commands (`rename`, `delete`, `change-date`).** A lecture's identity is changed only through these commands — never by editing the filesystem directly — so the manifest and filesystem stay in lock-step (see Stage 0, §5):
- `rename <date> "<new title>"` — sets `userTitle` in the manifest (which then wins the title precedence) and renames the video, slide, workspace folder, and any `Final output/` PDF to match.
- `delete <date>` — removes the lecture's video, slide, workspace, and outputs, then renumbers the remaining lectures.
- `change-date <date> <new date>` — moves the lecture (video, slide, workspace, outputs) to the new date, updates its manifest, and renumbers.

Each performs its change and then re-runs Stage 0's normalisation to return the module to a consistent, renumbered state. A lecture is addressed by `<date>`, resolved through `resolveLecturesByDate`.

**A mutation acts on exactly one lecture.** FR-6.7 asks for commands to rename *a* lecture, delete *a* lecture, and change *a* lecture's date, so a date that turns out to name several is a question to settle, not a licence to act on all of them: all three use a single-choice picker with no "All matches", and cancelling leaves the module untouched. `run` and `cost-report` keep the multi-select picker, since running or reporting on several lectures at once is exactly what they are for.

Each mutation leaves the module in a state Stage 0 can finish, rather than doing Stage 0's work itself:

- **`rename`** writes `userTitle` (and `lectureTitle`) to the manifest and stops there. The renaming of video, slide, workspace, and PDF falls out of the following Stage 0 pass, which names them from the manifest's current `lectureTitle` — the same code path that named them originally, so a rename cannot drift from a normalisation.
- **`delete`** removes the video, the slide, the workspace, and the `Final output/` PDF, having first asked for confirmation. Removing the sources *and* the workspace together is what keeps the module consistent: a workspace left without sources is an orphan the next Stage 0 run would stop to ask about, and sources left without a workspace would simply be normalised back into one. Stage 0 then renumbers the lectures that follow.
- **`change-date`** renames the video, slide, and PDF to the base name Stage 0 would give them at the new date, renames the workspace folder to match, and writes the new `lectureDate` and `workspaceFolderName` to the manifest — so the Stage 0 pass that follows has only renumbering left, and renames again if the new date changes the lecture's number. It refuses when a source file already carries the target date, since a rename would otherwise overwrite another lecture, and when the lecture's own video or slide is missing.

**Moving a lecture's files.** `change-date` and Stage 3 both rename the same four things onto a new base name — the source video, the source slide, any `Final output/` PDF, and the workspace folder — so the sweep is stated once and shared. It lives under `src/pipeline/` rather than beside the CLI commands that were its first caller, because a stage may not import from the CLI layer.

Removing one lecture's file lives here for the same reason. Every directory a lecture's own files sit in is shared with every other lecture in the module, so `delete` and a `--from-stage` re-run at or before Stage 8 both have to take one file rather than sweep a directory, and both find it the way everything else here does — by the date it carries.

```typescript
// src/pipeline/lecture-files.ts
baseNameForLecture(args: { lectureNumber: number; title: string; lectureDate: string }): string
// `lectureBaseName` (§3.2) for a caller holding the date as the `YYYY-MM-DD` string the manifest stores.
// Both callers that move a lecture hold it in that form, so the conversion is made here rather than at each:
// the string must be read as *local* midnight, matching how `formatDateISO` writes one, or the base name
// lands a day early west of Greenwich.
findDatedFile(args: { dir: string; lectureDate: string }): Promise<string | null>
// The one file in a directory whose name carries this date. Sources are addressed by date rather than by
// name because a lecture's name changes with its number and title, while its date is what identifies it (§3.2).
// The *last* date in the name is the one compared: these directories hold names Stage 0 has normalised, and
// `lectureBaseName` puts the title before the date, so a title naming a date of its own — a cohort, a study,
// a historical event — precedes the lecture's own.
removeDatedFile(args: { dir: string; lectureDate: string }): Promise<void>
// Removes the one file in a directory carrying this date, where there is one. Used by `delete` across all
// three of a lecture's directories, and by `--from-stage` for the PDF in the module-wide `Final output/`.
// Neither may sweep the directory it clears from: all three hold every lecture in the module.
renameLectureFiles(args: { dirs: ModuleDirs; workspaceRoot: string; lectureDate: string; baseName: string }): Promise<string>
// Renames the video, the slide, any Final output/ PDF, and the workspace folder onto `baseName`, each keeping
// the extension it carried, and returns the workspace's new path. Anything absent is skipped, so a lecture
// with no PDF yet moves cleanly; a caller that requires a file to be present checks for it first, as
// `change-date` does for the source pair.
```

#### CLI Structure

`src/index.ts` is a bootstrap and nothing more: it loads `dotenv`, hands `process.argv` to `runCli`, and sets the exit code. Everything else lives under `src/cli/` so that it can be tested without a process, a terminal, or a real pipeline:

```typescript
// src/cli/args.ts — the command line, parsed and validated
type CliCommand = { command: 'run'; lectureDate; options } | { command: 'batch'; moduleRoot: string | null; options }
                | { command: 'cost-report'; lectureDate: string | null; moduleRoot: string | null }
                | { command: 'rename'; lectureDate; title } | { command: 'delete'; lectureDate }
                | { command: 'change-date'; lectureDate; newLectureDate } | { command: 'help' }
parseCliArgs(args: { argv: readonly string[] }): CliCommand   // throws CliUsageError; USAGE holds the help text

// src/cli/prompts.ts — the only code that touches the terminal
confirmPrompt: ConfirmPrompt                                                  // @inquirer/prompts confirm, defaulting to no
selectLectureMatches(args: { matches: readonly LectureMatch[] }): Promise<readonly LectureMatch[]>
// The checkbox picker: several lectures, "All matches", and "Cancel".
selectLectureMatch(args: { matches: readonly LectureMatch[] }): Promise<LectureMatch | null>
// The single-choice picker the identity mutations use; `null` when the user cancels.

// src/cli/lecture-identity.ts — the filesystem half of rename/delete/change-date
renameLecture(args: { workspaceRoot: string; title: string }): Promise<void>
deleteLecture(args: { match: LectureMatch }): Promise<void>
changeLectureDate(args: { match: LectureMatch; newLectureDate: string }): Promise<void>
// All three throw LectureIdentityError, having made no change (§8).

// src/cli/commands.ts — carrying a command out
type PipelineRunnerFacade = { readonly [TOperation in RunnerOperation]: PipelineRunner[TOperation] }
// The runner as a command sees it: the five operations above, as readonly properties, so a suite stands a
// stub in without constructing a real runner and its stages.
type CliDeps = { runner: PipelineRunnerFacade; moduleRoots; gbpPerUsd; selectMatches; selectMatch; confirm; write }
// Two pickers, because the two questions differ: `selectMatches` is the checkbox picker `run` and
// `cost-report` use, `selectMatch` the single-choice one the identity mutations use ("A mutation acts on
// exactly one lecture").
type RunnableCliCommand = Exclude<CliCommand, { command: 'help' }>
// `help` is answered before the configuration is read, so it never reaches a command that needs deps.
executeCommand(args: { command: RunnableCliCommand; deps: CliDeps }): Promise<number>   // returns the exit code
EXIT_SUCCESS: 0
EXIT_FAILURE: 1
// The two codes of "Exit codes" below, named once so the commands and their suites agree on them.

// src/cli/run-cli.ts — composition root
runCli(args: { argv; projectRoot?; write?; writeError? }): Promise<number>
```

Parsing is validated in full before anything runs: the command must exist, its positional arguments must be present and well formed, `<date>` must be a real calendar date (`2025-02-30` is rejected as firmly as `yesterday`), `--from-stage` must name a stage that exists, and `--concurrency` must be a whole number of 1 or more.

**Flags belong to commands.** They are declared once for the whole CLI, so `parseArgs` will accept any of them anywhere; each command then declares the ones it acts on, and anything else is a usage error naming the flag and what the command does take. Without that, a surplus flag would be parsed and quietly ignored — `run --concurrency 4` would run one lecture and say nothing about the request to run four, since `--concurrency` counts lectures running at once and only `batch` runs more than one.

**`run <date>` normalises first.** Before resolving the date it runs Stage 0 across the configured modules. Without that, a lecture whose video and slides were added this week has no workspace and no manifest, so no date could resolve to it and `run` could never be its first command — the user would have to reach for `batch` and process everything. Stage 0 is idempotent, so this costs nothing when there is nothing new.

**Exit codes.** `0` when the command did what was asked, `1` when it could not: an unusable command line, a date matching no lecture, an unreadable configuration, or a run in which any stage failed. A user who cancels a choice has not failed at anything and exits `0`.

**`--help` is answered before the configuration is read**, so the commands can be discovered in a project that is not yet configured.

---

## 5. Stage Designs

**Where prompts live.** A stage that calls an LLM keeps its prompt in a sibling module, `<stage>.prompt.ts`, exporting the function that builds the messages. Only the five stages that make LLM calls have one; Stages 0, 1, 2, and 8 do not. Where a stage makes more than one kind of call, its single prompt module exports one builder per call — the QA loop's checker and reviser both belong to Stage 7.

Prompts sit beside their stage rather than gathered into one shared file: a shared file would collect text each used by a single stage, and every prompt tweak would touch a module five other stages import (NFR-5.2). Splitting them out of the stage module itself keeps prompt changes legible — a prompt is the part iterated on hardest once real lectures run, and its diffs should not be buried among file renames and manifest writes.

A prompt module has no test file of its own. Its builder is a pure assembly whose contract is that the stage's inputs reach the messages, and the stage's own tests verify that against the real builder. A separate suite could only assert that particular sentences are present, which would pin the wording down and make every prompt iteration a two-file edit — the opposite of what splitting them achieves.

### Stage 0 — Source Normalisation (Batch)

**Runs across all lectures in the module at once, not per-lecture**, and is re-run over the module's life as new lectures are added (they arrive weekly). Each run is a full pass over whatever sources are currently present. Whole-module scope is required because lecture numbers are sequential by date across the module: a newly added, earlier-dated lecture shifts later numbers, so correct numbering and collision-safe renumbering are impossible lecture-in-isolation.

**Inputs:** All files in `Source files/Video files/` and `Source files/Lecture slides/`.

**Identity and source of truth.** A lecture is identified by its **date** (unique within a module, enforced below). The **filesystem is authoritative for a lecture's existence**: adding a lecture means dropping its `video + slide` into the source folders, which Stage 0 picks up on the next run. The **manifest is authoritative for a lecture's title, cost, and history**. Because the two must never drift, **identity changes — rename, delete, change date — are made only through the CLI** (§4.7), which drives the same Stage 0 machinery and updates manifest and filesystem together. The user is instructed never to rename, move, or delete sources or workspaces directly; only *adding* a pair is done by dropping files. The sole guard against an accidental direct deletion is orphan handling (below).

**Title precedence.** The effective `lectureTitle` is, in order: a user-supplied title (`userTitle`, set by the CLI `rename` command) › the AI-derived title (`aiDerivedTitle`, Stage 3) › the provisional title Stage 0 extracts from the filename. Stage 0 seeds `lectureTitle = provisionalTitle` for a new lecture and never overwrites a title set later; on re-run it names files and folders from the manifest's current `lectureTitle`, never by re-parsing the already-canonical filename.

**Validate, then apply.** Stage 0 first validates the whole module with read-only checks. If any check fails it logs every problem found (at `error`) and throws, making **no filesystem changes** — a failed run never leaves a half-normalised module, and the error propagates through the runner to the CLI. Only a module that passes every check is mutated. The following **stop the run** (they are errors, not warnings):
- a video or slide filename with no confidently extractable date;
- a video with no matching slide, or a slide with no matching video (matching is 1:1 by date);
- two videos sharing a date, or two slides sharing a date — Stage 0 enforces the "`lectureDate` unique within a module" guarantee the rest of the system relies on (see §4.7).

**What it does** (once validation passes):

1. **Date extraction:** Parse the date from each video filename with `extractDate` (§3.2). Dates may appear in any position and format (e.g. `2025-10-10`, `10 Oct 2025`, `Fri 10th Oct`): the numeric forms are read in British convention by `src/utils/date.ts`, and `chrono-node` handles the ones written in words.

2. **Lecture number assignment:** Sort all video files by extracted date. Assign sequential lecture numbers (`Lecture 1`, `Lecture 2`, …) in date order.

3. **Slide matching:** Parse the date from each slide PDF (date always at the beginning of the filename) and match it to the video with the same date (validation has already guaranteed a 1:1 match).

4. **Title resolution:** For a **new** lecture, extract a provisional title from the video filename — strip whichever of the date, day names (Mon–Sun), a configured module prefix (e.g. `BOD_`, `Biology of Disease -`; see `naming.modulePrefixes`, §6), embedded lecture-number token (e.g. `Lecture 1`), and trailing artefacts (`co`, `copy`, `v2`) are present, keeping the lecturer's capitalisation exactly as typed (§3.2). A filename with nothing beyond a date and lecture number yields an **empty** provisional title, and the lecture falls back to a bare `Lecture N` name. Whether the title is meaningful is **not** judged here; Stage 3 makes that call. For an **existing** lecture, the title is taken from its manifest (`lectureTitle`), never re-extracted — so a CLI `rename` and a Stage 3 rename are both preserved.

5. **Canonical naming:** Rename the source video and its matched slide, the workspace folder, and any `Final output/` PDF to the shared base name `Lecture N - <title> - YYYY-MM-DD` (bare `Lecture N - YYYY-MM-DD` when the title is empty). Items already at their target are left untouched.

6. **Workspace + manifest:** Create `Pipeline processing/Lecture N - <title> - YYYY-MM-DD/` for any lecture that does not already have one, writing an initial `manifest.json` with `lectureNumber`, `lectureDate`, `provisionalTitle`, `lectureTitle = provisionalTitle`, `userTitle = null`, `aiDerivedTitle = null`, and all stage statuses `pending`. For an existing lecture whose number or folder changed, update `lectureNumber` and `workspaceFolderName` in its manifest, preserving everything else.

**Collision-safe renaming.** When the sequence changes, all renames (source files, workspace folders, `Final output/` PDFs) are applied in two phases — each item to a temporary name, then each temporary to its target — so shifting lecture numbers never collide mid-rename. Items already correct are skipped, so a re-run with no changes touches nothing.

The temporary suffix sits outside the `.tmp` convention of §4.3, because the two name opposite things: a `.tmp` file is a partial write and is deleted at stage start, while a Stage 0 temporary holds a complete item — the only copy of a source video, or a whole lecture workspace — between leaving one name and reaching the next. A run therefore begins by finishing any rename its predecessor was interrupted partway through: every temporary entry across the module's four directories is moved on to its target before anything is read, so an interrupted run costs the next one nothing. Where a target name is occupied, the run stops and names those entries, leaving every one of them where it stands.

**Orphan handling (direct-deletion guard).** If a workspace's date has **no source pair present** (both its video and slide are gone — a partial loss is already a 1:1 validation error), the sources were deleted directly rather than via the CLI, which can leave the pipeline inconsistent. Stage 0 neither silently deletes work nor silently proceeds. For **each** orphaned workspace it prompts the user — via an injected `confirm` callback the CLI backs with `@inquirer/prompts` — showing the lecture's number, title and date, and asks whether to delete the workspace and its outputs. The prompt quotes no figure: what a lecture has cost is the sum of its stages, and stage costs are not summed (NFR-2.2). What was spent on it is in its own cost report, which `cost-report` will still print until the workspace goes. Only if **every** orphan is approved does a final "are you sure?" confirm the irreversible deletion; then the workspaces and their `Final output/` PDFs are deleted (their manifests go with them), the module is renumbered, and each deletion is logged with its prior state. If **any** orphan is declined, or the final confirmation is declined, Stage 0 aborts with an informative error and makes **no changes** — protecting against, e.g., the whole source folder being moved by mistake.

**Logging:** Every action — files discovered, dates extracted, numbers assigned, matches, each rename, each workspace/manifest write, each renumber, each approved deletion (with its prior number/title/date) — is recorded at `info` on the run's pino logger; validation and orphan-abort failures are recorded at `error` before the throw.

```typescript
// src/pipeline/stages/source-normalisation.ts
type ConfirmPrompt = (args: { message: string }) => Promise<boolean>
createSourceNormalisationStage(args: { logger: Logger; confirm: ConfirmPrompt }): SourceNormalisationStage
// `confirm` is injected rather than imported so the stage never reaches for stdin: the CLI backs it with
// @inquirer/prompts and tests stub it. Throws SourceNormalisationError on any validation failure or declined
// confirmation, having made no filesystem changes.
```

The stage names and places nothing itself: it takes the module's directories from `moduleDirs` (§3.3) and
every name it writes from `lectureBaseName` (§3.2), which is what lets the CLI's identity commands move the
same files onto the same names a normalisation would give them (§4.7).

---

### Stage 1 — Audio Extraction

**Input:** `Source files/Video files/Lecture N - YYYY-MM-DD.mp4`
**Output:** `Audio/audio.m4a`

Extracts the audio track from the video using fluent-ffmpeg with `-acodec copy` (no re-encoding). Displays a `cli-progress` bar showing extraction percentage. The extracted audio is retained in `Audio/` for the life of the lecture workspace.

The source video is located by base name: the workspace folder name plus whatever extension the video carries, since Stage 0 gives the video, the slide, and the workspace folder the same base name but preserves the original container extension. A missing or ambiguous video is a stage failure, reported before ffmpeg is invoked. fluent-ffmpeg spawns with an explicit argv array, satisfying the no-shell-interpolation rule (§4.4). Extraction writes to a `.tmp` sibling and renames on success (§4.3), so a killed run never leaves a truncated `audio.m4a` that a later run would mistake for complete — and because that `.tmp` suffix stops ffmpeg inferring the container, the m4a muxer is named explicitly. This stage makes no billable call, so its recorded cost is `null`.

```typescript
// src/pipeline/stages/audio-extraction.ts
type AudioExtractionInput = { sourceVideoPath: string }
type AudioExtractionOutput = { audioPath: string }
createAudioExtractionStage(args: { logger: Logger }): PipelineStage<AudioExtractionInput, AudioExtractionOutput>
// Throws AudioExtractionError when the source video is missing or ambiguous, or when ffmpeg fails.
```

---

### Stage 2 — Transcription

**Input:** `Audio/audio.m4a`
**Output:** `Transcript/transcript.txt`

Uploads the audio to ElevenLabs Scribe v2 with a streaming upload progress bar (bytes sent vs total). Parameters: `languageCode` from `elevenLabs.languageCode` (§6), and `noVerbatim: true` — the latter is supported only on `scribe_v2`, so it travels with that model ID.

**Model ID and the provider prefix.** Config holds `stages.transcription.modelId = "elevenlabs/scribe_v2"`, but the ElevenLabs API takes a bare `model_id` of `scribe_v2` with no provider prefix. The prefix therefore exists purely to serve this codebase: `modelIdCheck.exemptProviders` matches on the segment before the `/` (§6), so a model can only be exempted from the OpenRouter check if it is provider-qualified — a bare `scribe_v2` would have no prefix to match and no way to opt out of a check it must fail. The stage strips the prefix before the call, so config keeps the qualified form the exemption and the cost report need, and ElevenLabs receives the form it expects. It takes the name from `splitModelId` (§6), the same reader the exemption asks for the provider.

The client is pointed at `elevenLabs.baseUrl` (§6) rather than left on the SDK's default host. The API key comes from `ELEVENLABS_API_KEY`; its absence is a stage failure raised before any upload begins, as is an unconfigured model — neither costs anything to detect, so both are checked before the file is opened. Cost is derived from audio duration as described in §7. The transcript is written atomically (§4.3).

The SDK types `model_id` as the Scribe versions it shipped with, but the model is configuration (§6): a newer Scribe ID must be usable by editing `pipeline-config.json`, not by waiting for an SDK release, and ElevenLabs rejects an unknown ID itself. The stage therefore widens the configured value to the SDK's parameter type at the call site.

```typescript
// src/pipeline/stages/transcription.ts
type TranscriptionInput = { audioPath: string; sizeBytes: number }
type TranscriptionOutput = { transcriptPath: string }
createTranscriptionStage(args: { logger: Logger }): PipelineStage<TranscriptionInput, TranscriptionOutput>
// Throws TranscriptionError when the audio, the API key, or the configured model is missing,
// or when the response carries no transcript text. A failed cost lookup is not a failure (§7).

ELEVENLABS_PATHS: { speechToText: "/v1/speech-to-text" }
// The route the SDK appends to elevenLabs.baseUrl. Named here, not built here (§6).
API_KEY_VARIABLE: "ELEVENLABS_API_KEY"
// The environment variable the key is read from, named for the same reason the route is: a suite that stubs
// or unsets it names the variable the stage reads rather than its own copy. The key itself never leaves the
// environment (§2, Environment Variables).
```

The `v1` in that route is the ElevenLabs **API** version, not the Scribe version: one endpoint serves every Scribe model, and which one runs is decided by the `model_id` in the request body. Moving to a later Scribe stays a config edit, as intended.

---

### Stage 3 — Transcript Structuring (includes title determination)

**Input:** `Transcript/transcript.txt`
**Output:** `Structured transcript/structured-transcript.md`
**Conditional side effect:** Rename of source video, source slide, workspace folder, and `Final output/` PDF only when the LLM judges the provisional title not meaningful and the user has not named the lecture themselves.

Stage 3 makes a single JSON-mode LLM call returning `{ provisionalTitleMeaningful: boolean; suggestedTitle: string | null; structuredMarkdown: string }` — a title judgement and the structured transcript markdown. The title is resolved first; everything else in the pipeline depends on it.

#### Title Determination

The LLM receives the raw transcript **and the lecturer's provisional title**, and judges whether that title is meaningful and accurate for the lecture's content. A title the lecturer wrote is treated as authoritative: when it is meaningful the LLM **keeps it and proposes nothing**. Only when it is not meaningful does the LLM propose a concise, descriptive academic title (4–8 words) suitable for a filename, which is then stored as `aiDerivedTitle`; otherwise `aiDerivedTitle` stays `null`.

The rename is **conditional** on the LLM's judgement:

| LLM judgement | Action |
|---|---|
| Provisional meaningful | `lectureTitle` already equals `provisionalTitle` from Stage 0 — left unchanged; `aiDerivedTitle` stays `null`. No renaming. |
| Provisional not meaningful | `aiDerivedTitle` set to the proposed title and `lectureTitle` overwritten with it. Source video, source slide, workspace folder, and any existing `Final output/` PDF are renamed to include the AI-derived title. `workspaceFolderName` updated in manifest. |

**A user title outranks the judgement.** When `userTitle` is non-null the user has already named the lecture through `rename`, and it wins the title precedence outright (§5, Stage 0). Stage 3 still records `aiDerivedTitle` when the LLM proposes one — it is a true record of what the model derived from the transcript, and it is what the title would fall back to were the user's ever cleared — but `lectureTitle` is left alone and nothing on disk is renamed.

`context.lectureTitle` is always non-null (see §4.2) — Stage 0 seeds it, Stage 3 may overwrite it. Downstream stages consume it directly with no null check required.

#### Order of Operations

Stage 3 is the only per-lecture stage that moves its own workspace, and the runner writes the manifest there as soon as the stage returns (§4.7). The order is therefore fixed:

1. Make the LLM call and parse the response.
2. Write `Structured transcript/structured-transcript.md` atomically (§4.3).
3. Settle the title, which decides the identity changes the stage returns. The provisional title stands: no changes. `userTitle` is set: `aiDerivedTitle` alone, since the user's title holds and no name on disk changes. Otherwise: `aiDerivedTitle`, `lectureTitle`, and `workspaceFolderName`, the last being the base name `lectureBaseName` builds from the new title (§5, Stage 0).
4. In that last case only, rename the source video, the source slide, any `Final output/` PDF, and the workspace folder via `renameLectureFiles` (§4.7).
5. Return the changes on `StageResult.identityChanges`. The runner writes them into the manifest together with the stage's `complete` entry, re-locating the workspace by `(moduleRoot, lectureDate)` first (§4.2, §4.7).

Stage 3 writes no manifest of its own (§4.2). From the rename in step 4 until the runner's write in step 5, the manifest names the folder the lecture previously occupied. The stage is marked `running` across that interval, so an interrupted launch re-runs Stage 3, which derives the same base name from the same transcript and records the identity.

The rename is last within the stage because step 2 writes into the workspace, so the folder must still stand where the stage was told it is. `filesWritten` is recorded relative to the workspace (§4.5), so the output path survives the move untouched.

#### Transcript Structuring

The same LLM call produces the structured markdown. The LLM:
- Identifies topic boundaries from discourse markers ("Now, moving on to…", "To summarise…")
- Applies H2 headings for major topics, H3 for sub-topics
- Removes filler words only (um, uh, sort of, you know) — all substantive content preserved
- Converts spoken mathematics to LaTeX where detectable
- Marks Q&A sections as `> **Q&A:**` blockquote
- Does not add content not present in the transcript
- Writes in the configured `output.language` (§6)

The last rule is a correction, not an addition, so it does not contradict the one above it. Speech carries no spelling: the transcript's spelling is the transcriber's, and Stage 2 cannot influence it — ElevenLabs' `languageCode` takes an ISO-639-1 or ISO-639-3 code, neither of which can express a regional variant, so `eng` names English and nothing more. An LLM call is therefore the first point in the pipeline at which the output's language can be chosen at all, and Stage 3 is the first such call. The rule is worded by `languageRule` (§6) rather than written into this prompt, so that every prose stage instructs the model identically.

**Context:** A 90-minute transcript is typically 15,000–30,000 tokens — a single call within any 128k-context model.

```typescript
// src/pipeline/stages/transcript-structuring.prompt.ts
buildStructuringMessages(args: { transcriptText: string; provisionalTitle: string;
  language: OutputLanguage }): readonly ChatCompletionMessageParam[]
// The title judgement and the structuring rules above, stated as messages. Asks for the JSON object in the
// prompt as well as through `responseFormat`, which JSON mode requires (§6).

// src/pipeline/stages/transcript-structuring.ts
type TranscriptStructuringInput = { transcriptText: string }
type TranscriptStructuringOutput = { structuredTranscriptPath: string; lectureTitle: string }
createTranscriptStructuringStage(args: { logger: Logger }): PipelineStage<TranscriptStructuringInput, TranscriptStructuringOutput>
// Throws TranscriptStructuringError when the transcript is missing or empty, when the response is not the
// documented JSON object, or when the LLM judges the provisional title unusable yet proposes nothing in its
// place. A failed cost lookup is not a failure (§7).
```

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

`outputRelativePath` is the path used in the final output markdown, relative to the `QA checked/` folder.

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
**Final output:** `QA checked/notes.md` and `QA checked/images/`

#### Two-Prompt Design

QA and revision are two separate LLM calls per iteration. Combining them in one call degrades quality — the model cannot be simultaneously maximally critical and produce fluent prose. Separating the tasks allows each to be done well.

**QA checker call:** Reads source transcript + source slides + image manifest + current draft. Returns a structured `QaDeficienciesReport`. The prompt instructs the model to be thorough and critical, to categorise every deficiency into exactly one of the eight `QaDeficiency.type` values (carrying a short definition of each in-prompt), to hold the `factual-error` / `unsupported-claim` line precisely — contradiction of a source versus mere absence of support — and not to call the notes adequate unless they genuinely are.

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

On successful exit, the final revised draft is written to `QA checked/notes.md` and all included figures are copied to `QA checked/images/`. Stage 8 then converts this to the final PDF.

---

### Stage 8 — PDF Generation

**Input:** `QA checked/notes.md`, `QA checked/images/`
**Output:** `Final output/Lecture N - [title] - YYYY-MM-DD.pdf` (at module level)

Invokes `pandoc` as a child process to convert `QA checked/notes.md` to PDF, placing the result in `Final output/` with the full descriptive filename:

```typescript
spawn('pandoc', [
  'QA checked/notes.md',
  '--resource-path', 'QA checked/images',
  '--pdf-engine=xelatex',
  '--output', '../../Final output/Lecture N - [title] - YYYY-MM-DD.pdf',
], { cwd: workspaceRoot });
```

`xelatex` is used as the PDF engine for correct Unicode and LaTeX equation rendering. The `--resource-path` flag allows pandoc to resolve relative image references in the markdown. The output filename carries the full lecture identity since `Final output/` is a flat folder shared across all lectures in the module. Every argv element is passed to pandoc verbatim — spaces in paths (`Final output/`, the lecture title) need no quoting because there is no shell to interpret them (see §4.4).

**External dependencies:** Both `pandoc` and `xelatex` must be present on the system `PATH`. The stage runs a pre-flight check for each binary at process start (`pandoc --version`, `xelatex --version`, both cached so per-lecture invocations do not re-shell) and fails with a clear install hint if either is missing: `https://pandoc.org/installing.html` plus `brew install pandoc` for pandoc, and the platform's LaTeX distribution for xelatex (`brew install --cask mactex-no-gui` on macOS, `apt install texlive-xetex` on Debian/Ubuntu). `pandoc` missing, `xelatex` missing, and "pandoc ran but LaTeX errored" are distinct failure modes; on a non-zero exit the stage failure message includes pandoc's captured stderr, which usually names the offending construct.

---

## 6. Model Configuration

### OpenRouter Integration

The `openai` npm package is used with a custom `baseURL`:

```typescript
const openrouter = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,           // the one OpenRouter value that is a secret, so it alone is an env var
  baseURL: config.openRouter.baseUrl,               // address, timeout, and retries are all configuration —
  maxRetries: config.openRouter.completionMaxRetries,  // never literals in code (see below)
  timeout: config.openRouter.completionTimeoutMs,
  defaultHeaders: {
    'X-Title': 'Lecture Notes Pipeline',   // display name shown on OpenRouter analytics; no URL header until there is a real public repo
  },
});
```

**How the pipeline talks to OpenRouter is configuration.** The whole `openRouter` section describes the service and how patiently to wait on it — address, timeouts, retry budgets — none of which is a fact about this codebase, and all of which an operator may need to change without a code edit. A slow gateway wants a longer completion timeout; a flaky one wants more retries; neither should require a release. The two timeouts differ deliberately: a completion is the expensive call worth waiting on, while the `/generation` cost lookup is telemetry that must never hold up a run, so it waits less and gives up sooner (§7).

**The service address is configuration.** `openRouter.baseUrl` is the single place OpenRouter's address is stated; no source or test file holds the URL as a literal. It is configuration for the same reason a model ID is — it is an operational detail of the service being called, not a fact about this codebase — and keeping it in one place is what allows the pipeline to be pointed at a gateway, a regional endpoint, or a recording proxy without touching code.

Everything that addresses OpenRouter derives from it:

| Address | Derived as |
|---|---|
| Chat completions, and the `/generation` cost lookup | The SDK's `baseURL`, so both are relative to it |
| The model-ID resolution check | `${baseUrl}/models` |
| The models page named in a failed check | the origin of `baseUrl`, plus `/models` |

The last is a human-facing link rather than an API call, and taking it from the origin assumes the host serving the API also serves that page. That holds for OpenRouter, and a second config field for a documentation link would be more surface than the assumption is worth — but a gateway deployment may want to correct the link it prints.

Validation treats it like any other required field, with one addition: it must be an absolute `http` or `https` URL, so a typo is a `ConfigError` at startup rather than an obscure failure at the first billable call. Those two schemes are the ones that have an origin, which is what the table above derives the models-page link from.

### `pipeline-config.json`

Located in the project root. Specifies model and parameters per stage independently. Changing a model requires only a config edit — no code changes.

Model IDs below are **capability-based placeholders**, not real OpenRouter routing strings. Before running the pipeline, replace each `<...>` with a concrete model ID looked up on `https://openrouter.ai/models`. The config loader checks every configured ID at startup — see **Model-ID resolution check** below.

The filename is stated once, in `src/types/pipeline.ts` as `CONFIG_FILENAME`, and not in the loader: the parties that name the file are not all downstream of the loader. Stage 2 and the OpenRouter client both tell the user to edit it when a stage's configuration is missing or its model rejects the request, and `config.ts` imports from `openrouter.ts`, so a stage importing back would cycle. `types/pipeline.ts` imports nothing, so every layer can reach it.

The loader and the client surface:

```typescript
// src/pipeline/config.ts
loadConfig(args: { projectRoot: string; skipModelCheck?: boolean }): Promise<PipelineConfig>
// Reads and validates pipeline-config.json; throws ConfigError on a missing or mistyped required field,
// or on a model ID the check below rejects. skipModelCheck exists for offline runs against a mocked SDK.

// src/pipeline/openrouter.ts
createOpenRouterClient(args: { openRouter: PipelineConfig["openRouter"] }): OpenAI
// The configured client above. Reused in-process, keyed on the settings it was built from, so a differently
// configured run cannot be served a client pointed elsewhere or waiting to the wrong budget. Not exported as
// a live instance, so importing the module never requires OPENROUTER_API_KEY.
API_KEY_VARIABLE: "OPENROUTER_API_KEY"
// The environment variable the key is read from, named for the same reason the routes are: a suite that stubs
// it names the variable this module reads rather than its own copy. The key itself never leaves the
// environment (§2, Environment Variables). Stage 2 names its own the same way (§5, Stage 2).
class UnconfiguredStageError extends NamedError    // the config holds no entry for the stage; nothing was sent
class ContextLengthError extends NamedError       // the prompt exceeds the model's context window
class CompletionRejectedError extends NamedError  // the provider rejected the request for any other reason
class NoCompletionChoicesError extends NamedError // the call was accepted and carries no choices to read
// One class per way a completion call fails. Context length keeps its own because it has a remedy of its own —
// configure a larger-context model — and no choices is distinct from a model answering with empty content,
// which is a legitimate reply handed back as "".
makeCompletionCall(args: { messages; stageId: StageId; config: PipelineConfig; responseFormat: "text" | "json"; logger: Logger; client?: OpenAI }):
  Promise<{ content: string; cost: StageCost }>
// `logger` is the calling stage's, already bound to it by createPipelineStage; the call is recorded on it
// at `debug` with the model, prompt token count, and latency (§10).
// Wraps the SDK call and resolves cost from /api/v1/generation (§7). `responseFormat: "json"` sends `response_format: json_object` and
// the provider routing that makes it stick (see "JSON mode is routed for" below), which the stages
// returning structured data require; it is stated on every call rather than defaulted so a caller always
// declares the shape it expects back. `client` is injected by tests; it defaults to the shared instance.
```

**JSON mode is routed for, not merely asked for.** OpenRouter honours `response_format` per *endpoint* rather than per model: a model is served by several providers, and by default the parameter only steers routing towards those that support it — where none of a model's providers do, the request still goes through and the parameter is quietly dropped, handing the stage prose where it expected JSON. A `"json"` call therefore also sends `provider: { require_parameters: true }`, which restricts routing to endpoints supporting every parameter in the request, so a model that cannot do JSON fails the call outright instead of returning something unparseable. Failing is the better outcome here: a silently-dropped `response_format` costs a full billable call and surfaces as a parse error that names the wrong culprit, whereas a routing failure names the real one. The flag rides with `"json"` alone — a `"text"` call has nothing to require, and restricting its routing would narrow the model choice for no gain.

Belt and braces, not belt alone: OpenRouter's own parameter reference states that JSON mode requires the prompt to ask for JSON as well, so a `"json"` caller instructs the model in its messages too, and still treats a reply that will not parse as a stage failure.

**A stage key names a stage.** Every key of the `stages` section is checked against the stage IDs, and one that names no stage is a `ConfigError` at startup listing the stages it could have named. Configuration reaches a stage by its key alone, so this check is what makes "the stage is configured" and "the config file mentions the stage" the same statement.

**Model-ID resolution check.** At startup `loadConfig` fetches the model list once from `${openRouter.baseUrl}/models` and asserts every configured `stages[*].modelId` appears in it, so placeholders left un-substituted, typos, and retired IDs are caught before any billable call. A miss throws a `ConfigError` naming the offending stages and linking to the models page. The result is cached in-process.

**Exempting non-OpenRouter providers.** Not every stage calls OpenRouter — Stage 2 transcribes through ElevenLabs — so checking its model ID against OpenRouter's list would always fail. `modelIdCheck.exemptProviders` lists provider prefixes (the part of a model ID before the `/`) that the check skips, so a stage on any non-OpenRouter provider can still declare its model in config and have it recorded in the manifest and cost report. The mechanism is general: it is not specific to ElevenLabs, and a stage whose provider is not exempt is always checked. Exempting a provider trades away the typo protection for its IDs, so keep the list to providers that genuinely sit outside OpenRouter.

**One exemption is not a provider, and is temporary by construction.** A stage that has not been built has no model to name, and the check reads the whole file — so a config describing Stages 4–8 would refuse to start the stages that do exist. Until each is built it carries a `placeholder/` prefix and `placeholder` is exempted, which is what lets the built stages run. **The prefix comes off as its stage is built, and the last one to go takes the exemption with it.** That discipline is the whole of the guarantee: an exemption left standing over a stage that now makes real calls excuses it from the check, and a wrong ID then surfaces at that stage, after every stage before it has been paid for. `docs/user-test-plan.md` carries the same instruction beside the config it applies to.

Both halves of a model ID are read through `splitModelId` in `src/utils/model-id.ts`, which this check and Stage 2 share: the check reads the provider, Stage 2 reads the name (§5, Stage 2). One reader is what fixes what separates the halves, so the two cannot come to disagree about it. An ID that names no provider yields a `null` provider, which no exemption list can hold, so such an ID is always checked.

**Currency.** Every provider bills in US dollars, so costs are stored in USD and converted to pounds only for presentation (§7). `currency.gbpPerUsd` is the rate applied. Because it converts at display time rather than at write time, correcting a stale rate re-renders every historical report consistently — no stored figure is ever rewritten, and none silently mixes rates.

**The ElevenLabs address is configuration too.** `elevenLabs.baseUrl` is the single place ElevenLabs' address is stated, and it is passed to the SDK's own `baseUrl` option so every Scribe call is made against it. The reasoning is the same as for `openRouter.baseUrl` above, and so is the validation — it must parse as an absolute URL or startup fails. It matters more here than the shared reasoning suggests: ElevenLabs serves the same API from several regional residency hosts, and which one an account must use is a fact about that account, not about this codebase. Left to the SDK's default the pipeline would always reach for the global host, and moving to a regional one would be a code edit.

Unlike OpenRouter's, this base URL carries no path — the SDK appends the versioned route itself — so `speechToText` is named alongside it in `transcription.ts` rather than being built by the pipeline, for the same reason `completions` is named in `OPENROUTER_PATHS`: so a test intercepting the call does not have to know the route independently of the code under test.

**The spoken language is configuration, and it is not `output.language`.** `elevenLabs.languageCode` is the language Scribe is told to expect in the audio; `output.language` is the language the notes are written in (§6, Output). They are deliberately separate fields: a lecture delivered in one language may want notes in another, and collapsing them would make that impossible to express. They also take different forms — Scribe wants an ISO-639-3 code (`eng`), while the notes language is a BCP-47 tag carrying a regional spelling convention (`en-GB`) — so neither can be derived from the other without losing something.

**Module prefixes are configuration because a prefix describes a module, not this codebase.** Lecturers put the module at the front of a recording's filename, which is noise in a title: the module is already the folder the lecture sits in. `naming.modulePrefixes` lists what to strip, and it is a list rather than one value for two reasons — the pipeline is pointed at several modules at once, and **one module may be written more than one way**. A lecturer abbreviates it in some filenames (`BOD_Cell injury`) and writes it out in others (`Biology of Disease - Cell injury`), so both forms are listed. Matching ignores case for the same reason: how a filename happens to write a module says nothing about whether it is one. A prefix absent from the list survives into the workspace folder name and the final PDF for every lecture that carries it.

Each prefix is matched literally, so one carrying a pattern character means itself; a blank prefix is refused at load, since it would otherwise match any run of underscores or spaces and take apart every title the run produces. The alternative of stripping any capitals-then-underscore run was rejected: it cannot tell a module prefix from a lecture that opens with an acronym, and `DNA_replication` would lose its subject — and it could never have handled a spelled-out module name at all.

**`output.language` is a closed set, and every stage that writes prose obeys it.** The tag is checked at load against `OUTPUT_LANGUAGES`, which maps each tag to the name a prompt calls it by; a tag with no name is refused at startup, listing the ones it could have been. The pairing is the point — "Write in en-GB" is not an instruction a model can follow, so a language cannot be offered in config without wording for the prompts to use. `languageRule` in `src/utils/language.ts` builds that sentence, and every prose stage's prompt includes it rather than wording the rule itself, so the stages cannot drift into instructing the model differently. Stage 3 is the only such stage built; Stages 4, 5, 6, and 7 join it as they are.

**ElevenLabs cost rate.** The Scribe API returns no price with a transcript, so `elevenLabs.costPerAudioHourUsd` supplies the rate Stage 2 multiplies by the audio's duration to attribute transcription spend (§7). Set it from the ElevenLabs plan in force; it is a billing figure that changes independently of this codebase, which is why it is configuration rather than a constant. The single rate is accurate for the call this pipeline makes — batch Scribe v2 with no diarization, entity detection, or keyterm prompting, each of which ElevenLabs bills as a surcharge on top of the base hourly rate. Enabling any of those later means revisiting this figure, since one number can no longer describe the call.

```jsonc
{
  "version": "1",
  "moduleRoots": [
    "/absolute/path/to/Biology of Disease",
    "/absolute/path/to/Anatomy"
  ],
  "openRouter": {
    "baseUrl": "https://openrouter.ai/api/v1",   // every OpenRouter address is derived from this
    "completionTimeoutMs": 120000,               // per-attempt budget for a completion
    "completionMaxRetries": 5,
    "costLookupTimeoutMs": 30000,                // the /generation lookup is cheap; it waits less
    "costLookupMaxRetries": 3
  },
  "elevenLabs": {
    "baseUrl": "https://api.elevenlabs.io",  // every ElevenLabs call is made against this; use your account's residency host
    "languageCode": "eng",             // language SPOKEN in the lectures (ISO-639-3); not output.language below
    "costPerAudioHourUsd": 0.22        // Scribe v2 list price; set from your current ElevenLabs plan
  },
  "currency": {
    "gbpPerUsd": 0.74                  // USD→GBP rate used to present all costs; refresh periodically
  },
  "modelIdCheck": {
    "exemptProviders": ["elevenlabs"]  // provider prefixes skipped by the OpenRouter model-ID check
  },
  "stages": {
    "transcription": {
      "modelId": "elevenlabs/scribe_v2"          // exempt provider — not checked against OpenRouter
    },
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
  "naming": {
    // stripped from a filename before it becomes a title; one module may be listed more than once,
    // abbreviated and written out, and matching ignores case (§3.2)
    "modulePrefixes": ["BOD", "Biology of Disease", "ANA"]
  },
  "output": {
    "language": "en-GB",               // language the NOTES are written in (en-GB | en-US); not elevenLabs.languageCode above
    "pandocEngine": "xelatex"
  }
}
```

---

## 7. Cost Tracking

### Sources

OpenRouter exposes cost via the `/api/v1/generation?id={response.id}` endpoint. After each LLM call, `response.usage.prompt_tokens` and `response.usage.completion_tokens` are captured synchronously, then `makeCompletionCall` awaits the cost lookup before its own promise resolves — its return value already includes a fully-resolved `StageCost`. Stages that issue multiple completions in parallel therefore get their concurrency naturally: cost lookups fan out with the completions. The stage's `run()` awaits every completion promise before returning, so **the stage is never marked `complete` while a cost lookup is still outstanding**. This eliminates the race where a process exit or crash silently drops cost data.

Each cost lookup has a 30-second timeout and up to 3 exponential-backoff retries (the generation endpoint is briefly eventually-consistent after completion). If a lookup ultimately fails, the stage still succeeds — cost telemetry MUST NOT gate pipeline progress. The manifest and run-log entries record `cost.costUsd = null` along with `cost.costResolutionError` describing why. Tokens and `callCount` are always populated regardless.

ElevenLabs returns no price with a transcript, so Stage 2 derives transcription cost from the audio's duration (read with `ffprobe`) multiplied by the configured `elevenLabs.costPerAudioHourUsd` (§6). The result is recorded as a normal `StageCost` with `callCount: 1` and zero token counts — Scribe is billed by audio duration, not tokens. If the duration cannot be read, the stage still succeeds and records `costUsd: null` with `costResolutionError`, exactly as a failed OpenRouter cost lookup does: cost telemetry MUST NOT gate pipeline progress.

### Currency

Providers bill in US dollars, so **USD is the stored currency and GBP is the presented one**. Every persisted figure — each manifest stage entry's `cost`, and every run-log entry — records the dollar amount actually charged, which is why those fields are named `…Usd`. Conversion happens in the reporting layer alone, at `currency.gbpPerUsd` (§6): the end-of-run summary, all three sections of `cost-report`, and any other user-facing figure render pounds and the `£` symbol.

Keeping the conversion at the edge means a stale or corrected rate never invalidates stored data — re-running a report applies the current rate to the full history at once. Storing pounds instead would freeze each figure at whatever rate happened to be configured when it was written, leaving a single manifest holding amounts converted at several different rates and no way to restate them.

### Two-Level Tracking

| Level | Location | What it tracks |
|---|---|---|
| Current pipeline | `manifest.json` → each stage's `cost` | What each output currently on disk cost to produce |
| All-time expenditure | `runs/*.json` | Every API call ever made, including failures and experiments |

Both levels are read a stage at a time. Neither stores a figure spanning stages, runs, lectures or modules: a stage's cost is compared against the same stage's cost under a different model, which is the comparison the two levels exist to serve, and a sum across stages answers no question the pipeline is asked (NFR-2.2).

### Run Classification

The pipeline runner classifies each run automatically by inspecting the manifest state at the time the run starts:

| Condition | Classification |
|---|---|
| Normal run, no `--from-stage` | `normal` |
| `--from-stage` targets a stage whose output stands — `complete` or `skipped` | `experiment` |
| `--from-stage` targets a stage in any other state — `failed`, `running`, `pending`, or with no entry at all | `error-recovery` |

The two `--from-stage` rows divide on whether the target's output is already on disk, which is the same `complete`-or-`skipped` reading §4.2 gives stage idempotency. Where it stands, the run produces that output a second time under whatever the configuration now names, and the two figures are there to be compared — an experiment. Where it does not, the output the run is after does not exist yet.

This classification is stored in the run log as `runType` and drives the layout of the cost report.

### End-of-Run Summary

Printed after every run, showing only the stages executed in that invocation — a skipped or unreached stage did no work and has nothing to report. The heading names the lecture, since a batch prints one of these per lecture:

```
Run summary — Lecture 1: Cell Injury (2025-10-10)
Stage                   Model                         Calls    Tokens (in / out)      Cost
──────────────────────────────────────────────────────────────────────────────────────────
Slide conversion        google/gemini-2.5-flash          24     41,000 /   8,100    £0.025
Image extraction        openai/gpt-4.1                   12          0 /   2,400    £0.028
Synthesis               anthropic/claude-sonnet-4.6       1     65,000 /  14,200    £0.231
QA loop                 anthropic/claude-sonnet-4.6       4     68,000 /  15,800       n/a
──────────────────────────────────────────────────────────────────────────────────────────
```

The table closes on its last stage; no line sums the run (NFR-2.2). One row per stage this invocation ran that names a model, on the same rule the report's first section applies: the cost cell reads `n/a` wherever no figure was resolved — a lookup that failed, as QA loop's did above, or a stage that failed before it called anything — and a stage naming no model has no row, having no model spend to show. A stage that failed is named beneath the table either way, with its message.

Any stage that failed is named underneath with the message recorded for it (§8).

A batch closes with one further table, per module and then across all of them (§4.7):

```
Batch summary
Module                          Lectures    Status
──────────────────────────────────────────────────
Biology of Disease                     2    failed
Immunology                             1   partial
──────────────────────────────────────────────────
All modules                            3    failed
```

It carries no money: what a module or a batch spent is a sum across lectures, and the figures are kept per stage (NFR-2.2). The rows are what ran and how it went, and each lecture's own summary above says what its stages cost. Modules are grouped by their directory path, so two module directories that share a leaf name are two rows.

### Cost Report Command

`lecture-notes cost-report [--date <YYYY-MM-DD>] [--module <moduleRoot>]` aggregates all run logs across the configured `moduleRoots` and presents three sections. With no flags, aggregates across everything. With `--date`, narrows to lectures on that date (uses `resolveLecturesByDate`; prompts if the date matches multiple modules). With `--module`, restricts to a single module.

(The `lecture-notes` command becomes available after running `./scripts/setup` once, which appends a PATH export to your shell config. During dev the equivalent invocation is `pnpm exec tsx src/index.ts cost-report …`.)

**1 — Current pipeline cost** (what the outputs on disk cost to produce):
```
Stage                    Model                  Calls    Cost
──────────────────────────────────────────────────────────────
Transcription            elevenlabs/scribe_v2      1    £0.031
Transcript structuring   claude-sonnet-4.6         1    £0.060
Slide conversion         gemini-2.5-flash         24    £0.025
Image extraction         gpt-4.1                   12    £0.028
Synthesis                claude-sonnet-4.6         1    £0.231
QA loop                  claude-sonnet-4.6         4       n/a
──────────────────────────────────────────────────────────────
```

One row per stage that names a model and whose output stands on disk — `complete` or `skipped` — taken from that stage's own manifest entry. The cost cell shows `n/a` wherever no figure was resolved: a lookup that failed, as QA loop's did here, or a stage that recorded no cost at all. A stage that names no model — audio extraction, PDF generation — has no row, since it has no model spend to compare. Nothing is summed beneath (NFR-2.2).

**2 — Error recovery cost** (spend from failed runs and retries):
```
Run                    Stage                  Status    Cost
────────────────────────────────────────────────────────────
2025-10-10T09:00Z      slide-conversion       failed   £0.016
2025-10-10T10:30Z      slide-conversion       retry    £0.025
────────────────────────────────────────────────────────────
```

A row is any stage that failed, under whatever classification its run carried, together with every stage of a run started to recover from one. The run that first meets a failure is classified `normal` — as the 09:00 run above is — and the spend that failure cost belongs to this section, which is why a row is selected by what became of the stage as well as by the run's type. The rows stand on their own: what a failure cost is read against the retry underneath it, one stage at a time (NFR-2.2).

**3 — Experiment cost** (deliberate model re-runs, grouped for comparison):
```
Stage: synthesis
  Run 2025-10-11T14:00Z    claude-sonnet-4.6      £0.231
  Run 2025-10-11T15:30Z    anthropic/claude-opus  £0.659
```

### Cost Module

`src/utils/cost.ts` holds the cost helpers the runner and CLI call. `StageCost`, the type they operate on, is defined in `src/types/pipeline.ts` (single source of truth). Nothing here adds one stage to another; the reporting functions render what each stage recorded and nothing else (NFR-2.2).

```typescript
accumulateCost(args: { current: StageCost; incoming: StageCost }): StageCost
// Folds the calls a single stage made into that stage's one StageCost, summing tokens, call counts and cost
// at full precision (rounding is a display concern). Slide conversion issues one call per slide and image
// extraction one per image, and each has a single figure to record — this is how they reach it, and it stays
// inside one stage. The merged cost is resolved only when both inputs resolved; if either is null the result
// is null and the errors are joined, so a stage whose lookup failed for one call reports `n/a` rather than
// the part that happened to come back. Takes no rate and does no formatting: it works entirely in stored USD,
// which is what keeps it unaffected by the presentation currency.

type MoneyFormatter = (amount: number | null) => string
createMoneyFormatter(args: { gbpPerUsd: number }): MoneyFormatter
// The one place a money amount becomes a string: converts a stored USD figure to pounds, or renders `n/a`
// when cost resolution failed. The rate is bound once and the resulting function passed down to each
// section, so no section knows about rates or currency at all (see Currency above).

formatCostReport(args: { runLogs: readonly RunLog[]; manifest: RunManifest; gbpPerUsd: number }): string
// The three sections above, rendered as a single string.

formatRunSummary(args: { outcomes: readonly RunStageOutcome[]; manifest: RunManifest; gbpPerUsd: number }): string
// The end-of-run summary above. The outcomes say which stages this invocation executed; the manifest, read
// after the run, says what each one used and cost — tokens live there and not in the run log. A stage that
// names a model gets a row, its cost cell `n/a` wherever no figure resolved; a stage naming none gets none.
// The table ends at its last stage.

formatBatchSummary(args: { batch: BatchSummary }): string
// One row per module — lectures attempted and combined status — closed by a row across all of them. Takes no
// rate, because it shows no money. A lecture's module comes from moduleRootOf (§3.3), and the rows are
// grouped by that path: two module directories that share a leaf name are two modules with two sets of
// lectures.

stageLabel(args: { stageId: StageId }): string
// A stage's display name. Exported so the CLI names a failed stage exactly as the summary table above does.
```

The tables above share one renderer and one money formatter, so a column of pounds looks the same wherever it appears. The renderer closes every table with a rule and adds no footer of its own; the batch summary, the one table with a line beneath that rule, appends it itself. The Model column is one width across every table that carries one, wide enough for the longest model id §4.5 records, and a value that would still overrun its column is shortened to end in `…` — a column is one character wider than the value it expects, and a shortened value keeps that separating space, so the columns after it stay under their headings whatever a provider names a model.

---

## 8. Error Handling

### Typed Errors

Every way a module can fail raises an error class of its own, the failures the platform raises included — `ConfigError`, `ManifestPathError`, `ManifestUnreadableError`, `ManifestNotJsonError`, `ManifestShapeError`, `UnconfiguredStageError`, `ContextLengthError`, `CompletionRejectedError`, `NoCompletionChoicesError`, `EmptyNameError`, `NoStageOutputFileError`, `SourceNormalisationError`, `AudioExtractionError`, `TranscriptionError`, `TranscriptStructuringError`, `CliUsageError`, `LectureIdentityError`. A caught failure names what happened from its type, so a module with three ways to fail declares three classes; a filesystem error or a `SyntaxError` on its way out through one of them is caught and rethrown as the module's own, its message carried into the new one. Every stage built so far contributes at least one, so each stage still to come adds its own. All extend a shared `NamedError` base that captures the concrete subclass name via `new.target`, so each stays a distinct `instanceof` type without repeating constructor boilerplate and reports its own name in logs.

A `catch` binding is typed `unknown`, because any value can be thrown. Every site that wants to report what went wrong therefore needs the same narrowing, so it lives in one place rather than at each catch.

```typescript
// src/utils/errors.ts
abstract class NamedError extends Error   // subclasses extend with an empty body
errorMessage(error: unknown): string      // the caught value's message, or the value stringified
```

### The CLI Boundary

`runCli` wraps the whole invocation in a single catch. Whatever reaches it — a misused command line, an unreadable config, a stage error, a corrupt manifest — is reported as its message on stderr and a `1` exit code, never as an unhandled rejection or a stack trace; a `CliUsageError` additionally prints the usage text. One catch rather than a case per command is what makes that guarantee hold for failures nobody anticipated, including the one place a stage error escapes the runner's own handling: `runStage` calls `isComplete()` outside its try, so a `ManifestPathError` from a manifest pointing outside the module tree propagates out of `runLecture` rather than becoming a failed stage entry.

### Stage Failure Protocol

1. Manifest updated to `status: 'running'` before the stage begins
2. On exception: manifest updated to `status: 'failed'`, `error: err.message`, `failedAt: now`
3. Partial output files are not deleted — they remain for inspection
4. The error is logged with its stack to the run's debug log (§10), through a child logger bound to the stage
5. The CLI names each failed stage and its message after the run summary, and points at the debug log
6. Default behaviour: pipeline halts. `--continue-on-error` skips to the next stage

Items 4 and 5 split one job in two on purpose. A stage's recorded `error` is a message, and for a typed stage error (`TranscriptionError: no transcript text in response`) the message *is* the diagnosis — a stack would only point back into the runner. But an unanticipated failure inside a stage yields a message that explains nothing on its own (`Cannot read properties of undefined`), and there the stack is the only thing that says where. So the message goes to the user, the stack goes to the debug log, and nothing goes to stderr from the runner: user-facing output is the CLI's job, and the runner is driven by tests that deliberately fail stages. The runner writes to **neither** of the process's streams — the cost report, the one thing it produces for a reader, is handed back as text for the CLI to write (§4.7).

### Intra-Stage Resumability (Slide Conversion)

Each slide's extracted markdown is written to `Slide content/raw/slide-{003d}.md` immediately after its API call completes. On restart after a `failed` stage, the runner checks for each per-slide file before making its API call — already-processed slides are skipped. The stage is only marked `complete` once all slides have been assembled into `Slide content/slides.md`.

### API Error Handling

| Error | Handling |
|---|---|
| Rate limit (429) | Exponential backoff with jitter, up to the SDK's `maxRetries` — configured from `openRouter.completionMaxRetries` (§6) |
| Context length exceeded | Stage fails with a message advising the user to switch to a larger-context model in config |
| Model unavailable | Stage fails; model ID included in error message |
| Network timeout | The SDK's per-attempt `timeout` — configured from `openRouter.completionTimeoutMs` (§6) |

---

## 9. Source File Structure

```
src/
├── index.ts                          # Entry point: loads dotenv, calls runCli, sets the exit code
├── cli/
│   ├── args.ts                       # parseArgs → CliCommand; usage text; CliUsageError
│   ├── prompts.ts                    # The only terminal I/O: confirm, multi-match picker
│   ├── lecture-identity.ts           # rename/delete/change-date on the filesystem
│   ├── commands.ts                   # Carrying a parsed command out; exit codes
│   └── run-cli.ts                    # Composition root: config, logger, runner, stages, prompts
├── types/
│   └── pipeline.ts                   # All shared types: StageId, StageContext, StageResult,
│                                     # StageCost, RunManifest, QaDeficiency
├── pipeline/
│   ├── runner.ts                     # Orchestrator, run log creation, batch mode, cost accumulation
│   ├── layout.ts                     # Every directory and filename, declared once (§3.3)
│   ├── manifest.ts                   # manifest.json location, reading, and atomic writing
│   ├── stage-context.ts              # Assembling the StageContext a stage is handed (§4.7)
│   ├── lecture-files.ts              # Moving and removing the files a lecture's identity is spread across (§4.7)
│   ├── run-status.ts                 # Reducing stage and lecture outcomes to an OverallStatus, and
│   │                                 # reading a stage entry for settled output (§4.2)
│   ├── config.ts                     # Config file loader and validator
│   ├── openrouter.ts                 # OpenAI SDK client configured for OpenRouter
│   ├── fixtures.ts                   # The shared test fixtures — the example lecture, the stub logger,
│   │                                 # the temp-directory trees. Production code never imports it
│   └── stages/
│       ├── pipeline-stage.ts         # The shared isComplete check and the stage factory (§4.2)
│       ├── source-normalisation.ts   # Stage 0 — batch, date parsing, renaming
│       ├── audio-extraction.ts       # Stage 1 — existing, refactored to implement PipelineStage
│       ├── transcription.ts          # Stage 2 — existing, refactored to implement PipelineStage
│       ├── transcript-structuring.prompt.ts  # Stage 3's messages — one prompt module per LLM stage (§5)
│       ├── transcript-structuring.ts # Stage 3 — title determination + structuring
│       ├── slide-conversion.ts       # Stage 4 — PDF render + per-slide vision LLM
│       ├── image-extraction.ts       # Stage 5 — vision-guided crop + labelling
│       ├── synthesis.ts              # Stage 6 — context assembly, chunking fallback
│       ├── qa-loop.ts               # Stage 7 — two-prompt QA pattern, loop termination
│       └── pdf-generation.ts         # Stage 8 — pandoc invocation, Final output/ deposit
└── utils/
    ├── date.ts                       # Date extraction and normalisation (chrono-node)
    ├── naming.ts                     # Lecture folder and file naming helpers
    ├── files.ts                      # Atomic writes (.tmp pattern), directory reads, path resolution
    ├── progress.ts                   # Shared cli-progress bar helpers
    ├── cost.ts                       # Cost accumulation and report formatting
    ├── stage-id.ts                   # Recognising a stage name, for --from-stage and the config keys (§6)
    ├── language.ts                   # Recognising a configured language, and wording it for every prose prompt (§6)
    ├── model-id.ts                   # Reading a model ID's provider and name, for the exemption and Stage 2 (§6)
    ├── record.ts                      # Recognising a parsed value as one with fields to read (§4.4, §6, §7)
    ├── text.ts                        # Closing up the whitespace a removal leaves behind (§3)
    ├── stage-config.ts                # Finding a stage's entry in the config, and reporting its absence (§6)
    ├── errors.ts                     # NamedError, and the narrowing every catch site would repeat (§8)
    └── logger.ts                     # pino instance and child-logger factory
```

---

## 10. Logging

`pino` is used for all structured logging. Each pipeline invocation creates one root logger, writing to a debug log named for the instant the invocation began. One binding is added beneath that root, and it is the stage's: every log entry a stage makes carries `{ stage: stageId }`, but a stage does not call `logger.child()` for itself: `createPipelineStage` binds the child once when the stage is built and hands that to `run` (§4.2). One binding site per stage means a stage cannot log against a stage it is not, and a stage that logs nothing still costs nothing.

Each per-lecture stage factory therefore takes `{ logger }` and passes it to `createPipelineStage`; Stage 0, which is not a `PipelineStage`, takes and binds its own. The runner keeps its own binding for the one thing it logs about a stage — the failure and its stack, which it must record for a stage that threw before it could log anything itself.

### Debug Log File

The pino file transport writes newline-delimited JSON to `<projectRoot>/runs/<timestamp>-debug.log`, the path named by `debugLogPath` (§3.3). This file captures operational detail not stored in the run log:

- Every billable model call: model, prompt token count, latency ms. Stage 2's Scribe upload counts — it is billed by audio duration rather than tokens, so it logs bytes uploaded in place of prompt tokens
- Rate limit retries: attempt number, back-off delay, error message
- Per-slide processing times (Stage 4)
- File I/O errors: path and OS error code
- **Decisions that name things downstream.** Which source video Stage 1 chose, since it selects by base name from whatever the video directory holds; and which of the three ways Stage 3 settled the lecture's title (§5, Stage 3), since every later stage names its output from it
- **Failures the run survives**, at `warn` — chiefly Stage 2's audio-duration lookup, whose only other trace is a `null` in a cost report read days later
- Every stage failure, with its stack, bound to the stage that raised it (§8)

The debug log is for human inspection when diagnosing failures. Its JSON format also makes it trivially parseable if automated analysis is ever needed.

**A debug log belongs to an invocation; a run log belongs to one lecture run.** They are different scopes and cannot share an identity: `batch` runs many lectures against one root logger, so one debug log faces as many run logs as there were lectures. The two are tied together from the other end instead — the runner writes a `debug` entry carrying `{ runId, workspaceRoot }` as each lecture run starts, before any stage does anything, so a reader holding a run log can find the debug output that produced it and a reader holding the debug log can see which runs are in it.

The project root is what the log is anchored to, rather than a workspace or the process's working directory. Stage 0's work over a module happens before any lecture has been chosen, and a batch spans every configured module, so no single workspace could hold the record of an invocation; and a relative path would put the log wherever the user happened to be standing when they typed the command.

### Output Streams

| Level | Destination | When used |
|---|---|---|
| Progress | stdout (cli-progress) | Real-time stage progress bars |
| Info | stdout | Stage start/end messages, skipped-stage notices, run and batch summaries |
| Warning | stderr | Stalled QA loop, max-iterations reached |
| Error | stdout | Each failed stage and its message, printed by the CLI after the run summary (§8) |
| Error | stderr | Anything that ends the invocation: a usage error, an unreadable config, an escaped stage error |
| Error | debug log | Every stage failure, with its stack — the runner logs it; nothing else sees a stack trace |

The pino file transport is configured with `sync: false` and routes only to the debug log file — no debug output reaches stdout or stderr during normal operation, so it does not interfere with cli-progress bars.

### Logging and Progress Helpers

```typescript
// src/utils/logger.ts — file-only; the user-facing messaging in the table above is emitted by the
// CLI and runner, not by this logger.
createRootLogger(args: { logFile: string }): Logger
// Writes newline-delimited JSON to logFile (sync: false, mkdir). Takes the whole path from its caller rather
// than assembling one: every directory and filename is declared in layout.ts (§3.3), and a utility must not
// reach up into the pipeline
// to read it.
createStageLogger(args: { logger: Logger; stageId: StageId }): Logger   // child logger with a { stage } binding

// src/utils/progress.ts — the stdout progress bars from the table above.
createProgressBar(args: { format: string; formatValue?: FormatValueFn }): SingleBar
// Shared SingleBar factory (preset + hideCursor) that the other two build on, so bar construction lives
// in one place; formatValue supports e.g. byte-to-MB display.
createUploadProgressStream(totalBytes: number): Transform    // upload byte progress; used by Stage 2
createParallelWorkBar(args: { label: string; total: number }): {
  bar; start; pick; complete; fail; stop
}
// The in-flight-suffix bar from Stage 4. pick(id) adds an id to the in-flight set, complete(id) removes it
// and ticks, fail(id) marks the item red in the final render. Used by Stages 4 and 5; non-TTY behaviour is
// delegated to cli-progress defaults. **Built with Stage 4** — the two stages that need it shape what it has
// to do, and a version written ahead of them could only be checked against a guess at that.
```
