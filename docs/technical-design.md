# Lecture Notes Generator — Technical Design

**Suite version:** 1.70-draft. The requirements, the technical design and the implementation plan share this number. A substantive edit to any of the three raises it in all three
**Date:** 2026-10-07
**Status:** For review

---

## 1. System Overview

The system is a TypeScript/Node.js CLI tool made of stages, each named by its id (§4.1). `source-normalisation` is a batch normalisation step across all lectures in a module. Every other stage runs per lecture, orchestrated by a pipeline runner that reads and writes a per-lecture run manifest. Every stage is idempotent — if its output exists and the manifest marks it complete or skipped, it is skipped.

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
│   ├── Video recordings/
│   └── Slide decks/
├── Pipeline processing/
│   └── Lecture 1 - Disease Cell Injury and the Immune System - 2025-10-10/
│       └── (see §3.3)
└── Final output/
    ├── Lecture 1 - Disease Cell Injury and the Immune System - 2025-10-10.pdf
    └── Lecture 2 - Immunity to Infection - 2025-10-13.pdf
```

All pipeline artefacts for a lecture live inside a single named workspace folder. Files inside each folder use simple, stage-agnostic names — the folder itself carries the full lecture identity. This means re-numbering a lecture requires renaming only the folder, not any of its contents.

`Final output/` is a direct subfolder of the module root and is the human-facing deliverable. Because it is a flat folder shared across all lectures, its PDFs carry the full descriptive filename.

**Folder-name convention.** Only `moduleRoots[i]` is configurable (see §6). The subfolder names shown above — `Source files/`, `Video recordings/`, `Slide decks/`, `Pipeline processing/`, `Final output/` — are fixed conventions baked into the pipeline. Every module folder that the pipeline manages MUST follow this layout. The tool creates these subfolders on demand; users should not rename them.

### 3.2 Source Files

#### Video recordings

Source videos may have the date in any position and any format. `source-normalisation` extracts the date, assigns a lecture number by date order, and produces the provisional title by stripping the date, day names (Mon–Sun), configured module prefixes (e.g. `BOD_`, `Biology of Disease -`), any embedded lecture-number token (e.g. `Lecture 1`, which would otherwise duplicate the assigned number), and trailing artefacts (`co`, `copy`) from the original filename, keeping the lecturer's capitalisation as typed. The separators left behind by those removals go too, so a name `source-normalisation` itself produced reads back as the title it was built from: `Lecture 1 - Cell Injury - 2025-10-10.mp4` gives `Cell Injury`, which is how a lecture renamed by a run that stopped before writing its manifest keeps its title on the next one.

An "on" directly before a date belongs to the date, so it is removed with the date. `BOD_Complement on 17102025 Fri.mp4` gives `Complement`. An "on" in any other place stays in the title.

**Dates are read in British convention.** A four-digit component is the year; otherwise the day leads. Month-first is never read. All eight numeric forms are accepted:

| Day first | Year first |
|---|---|
| `10112025` | `20251110` |
| `10-11-2025` | `2025-11-10` |
| `10.11.2025` | `2025.11.10` |
| `10/11/2025` | `2025/11/10` |

Each of those is the tenth of November. Single-digit day and month are accepted (`1/2/2025` is the first of February).

A **two-digit year** is read only in the trailing position, and always as this century: `10-11-26` is the tenth of November 2026. A leading two-digit component is always the day, so `YY-MM-DD` is not a supported form — nothing in `26-11-10` distinguishes it from `DD-MM-YY`, and the year-first convention is written with four digits precisely because it sorts.

`DDMMYY` — six bare digits — is tried **last**, only when the filename yields no date any other way, prose included. Six digits are as likely to be an identifier as a date, and unlike the eight-digit form there is no four-digit year to anchor the reading. Where a stray identifier does resolve, `source-normalisation`'s 1:1 video-to-slide date match is the backstop: an invented date will not have a matching slide deck, so the module is refused and the file named.

The numeric forms are matched in `src/utils/date.ts` rather than delegated to `chrono-node`, because chrono reads `10/11/2025` as the eleventh of October — the American convention, and wrong here in every separated case. Chrono still handles dates written in words (`13 Oct 2025`, `Fri 10th Oct`), which carry no such ambiguity. Note that a prose date omitting the year is anchored to the current year, so a year-less filename dates itself to whenever it was processed.

A date is recognised wherever it sits and whatever abuts it: the boundary is "not a digit", not a word boundary, so `BOD_10112025_Cell Injury.mp4` resolves. This matters because `_` is a word character, and underscore-separated exports (Panopto, Echo360, Zoom) would otherwise hide the date entirely. A bare eight-digit run is read as a date only when one end is a plausible year (2000–2099), so an eight-digit identifier is left alone; separated forms need no such bound, since position alone identifies the year. Combinations naming no real day — `31022025`, `2025-13-10` — are rejected rather than rolled over into March or quietly corrected. A span with a date's shape is claimed even when it names no day, so chrono cannot reinterpret it: chrono reads `2025-13-10` as a valid date with the month adjusted.

| Pass | Example filename |
|---|---|
| Original (user-supplied) | `2025-10-10 BOD_Disease cell injury and the immune system Fri co.mp4` |
| After `source-normalisation` | `Lecture 1 - Disease Cell Injury and the Immune System - 2025-10-10.mp4` |

The provisional title is a best guess from what the filename carries. Some filenames include a full descriptive title. Others hold little more than a date and a lecture number. Whether it is good enough is not decided here. `judge-lecture-title` reads the whole lecture and judges whether the provisional title is meaningful for its content. A title that the lecturer wrote on purpose is authoritative, so the stage keeps a meaningful title. The stage replaces the provisional title only when it is not meaningful:

| Provisional title | After `judge-lecture-title` |
|---|---|
| Meaningful (lecturer's title kept) | `Lecture 1 - Disease Cell Injury and the Immune System - 2025-10-10.mp4` *(unchanged)* |
| Not meaningful (replaced by `judge-lecture-title`) | `Lecture 1 - Innate Immune Response - 2025-10-10.mp4` *(renamed by `judge-lecture-title`)* |

#### Slide decks

Slide PDFs are supplied with the date at the very beginning of the filename (e.g. `2025-10-10 Lecture slides.pdf`). `source-normalisation` matches each slide to the video with the same date and renames it on the same schedule as the video.

#### Date and Naming Helpers

`src/utils/date.ts` and `src/utils/naming.ts` hold the filename parsing described above.

```typescript
extractDate(filename: string): Date | null
// Numeric forms first, read in British convention; chrono for dates written in words.
// null when no date is found with sufficient confidence.
formatDateISO(date: Date): string                    // YYYY-MM-DD, in local time — the zone the date was read in
stripDateTokens(text: string): string                // removes every numeric date, every date and weekday span chrono finds, and an "on" directly before a date
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
// A thin or empty result is acceptable — a date-plus-number filename leaves nothing — and judge-lecture-title judges
// the title once the lecture is grouped into topics. The prefixes come from `naming.modulePrefixes` (§6) rather than
// being written here: a prefix names a module, and the pipeline is pointed at several. Each is matched
// literally and without regard to case, so one carrying a pattern character means itself, and an empty
// list strips nothing.
titledBaseName(args: { lectureNumber: number; title: string; date: Date }): string
// The titled `Lecture N - <title> - YYYY-MM-DD` base name shared by the workspace, sources, and PDF. Takes the
// parsed Date rather than a formatted string so the one place that formats a lecture date is formatDateISO.
lectureBaseName(args: { lectureNumber: number; title: string; date: Date }): string
// The same name, falling back to a bare `Lecture N - YYYY-MM-DD` when the title is empty — which a filename
// carrying nothing but a date and a number leaves it. This is the name every caller that renames a lecture
// asks for; titledBaseName is the form beneath it. It lives here rather than in source-normalisation, which first
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
│   └── audio.m4a                              # audio-extraction
│
├── Transcript/
│   └── transcript.txt                         # transcription
│
├── Initial subtopics/
│   ├── run-01.json                            # initial-subtopic-splitting — one file per splitting run
│   └── ...                                    # up to run-18.json
│
├── Deepened subtopics/
│   ├── run-01.json                            # deepen-subtopic-splitting — one per splitting run
│   └── ...
│
├── Chosen division/
│   ├── subtopics.json                         # choose-division
│   └── choice.json                            # choose-division — which run was chosen, and how far from the vote
│
├── Retitled subtopics/
│   ├── subtopics.json                         # retitle-subtopics
│   └── changes.json                           # retitle-subtopics — which titles changed
│
├── Grouping runs/
│   ├── run-01.json                            # group-into-topics — one file per grouping run
│   └── ...
│
├── Topics/
│   ├── topics.json                            # group-into-topics — the chosen grouping
│   └── choice.json                            # group-into-topics — which run, its support, and the rule that decided
│
├── Title judgement/
│   └── judgement.json                         # judge-lecture-title — the title judgement, its reason and its outcome
│
├── Structured transcript/
│   └── structured-transcript.md              # transcript-structuring
│
├── Transcript verification/
│   ├── verification-report.json               # transcript-verification
│   └── verification-report.md                 # transcript-verification — the same findings, for a reader
│
├── Slide images/
│   ├── slide-001.png                          # render-slides — one image for each page of the slide deck
│   └── ...
│
├── Slide readings/
│   ├── slide-001.json                         # read-slides — one slide reading for each slide
│   └── ...
│
├── Slide placements/
│   └── placements.json                        # place-slides — the subtopic of each placed slide
│
├── Synthesised notes/
│   └── synthesised-notes.md                  # synthesis
│
├── QA iterations/
│   ├── qa-iteration-01-deficiencies.json
│   ├── qa-iteration-01-revised.md
│   └── ...                                    # qa-loop
│
└── QA checked/
    ├── notes.md                               # qa-loop final — simple name
    └── images/
        └── slide-003.png
```

`QA checked/notes.md` uses a simple name because it lives inside the named lecture folder. The full descriptive filename appears only on the PDF in `Final output/` (`pdf-generation`).

The directory is named for the stage that fills it: it holds `qa-loop`'s quality-checked notes, and `pdf-generation` only reads it. `pdf-generation`'s own output is the PDF in the module's `Final output/` (§3.1) — the one place a stage writes outside its workspace, and the one a re-run cannot clear by emptying, because every lecture's PDF is in it. `--from-stage pdf-generation` takes this lecture's PDF and leaves the rest (§4.4).

#### The layout has one owner

Every name in the two trees above — the module's four directories, each stage's workspace directory and the file it writes, `Run logs/`, and `manifest.json` — is declared once, in `src/pipeline/layout.ts`. Nothing else states a directory or filename as a literal.

One owner matters here because each of these names is relied on by two parties at once, and a name changed for one has to reach the other:

- **A stage and the runner.** A stage writes into its directory; `--from-stage` clears the stage's work there (§4.7). Both read the directory from here, so a rename reaches the write and the reset together.
- **A stage and the stage after it.** `transcription` reads what `audio-extraction` wrote, `transcript-structuring` reads what `transcription` wrote. Each hand-off is one name, read at both ends.
- **Production and tests.** A suite asserting a stage's output exists asks the same module the stage asks.

```typescript
// src/pipeline/layout.ts
type ModuleDirs = { video: string; slide: string; processing: string; finalOutput: string }
moduleDirs(args: { moduleRoot: string }): ModuleDirs      // the module layout of §3.1, stated once
MANIFEST_FILE: string                                     // "manifest.json"
RUN_LOGS_DIR: string                                      // "Run logs"
DEBUG_LOGS_DIR: string                                    // "debug-logs", at the project root
runLogsDirPath(args: { workspaceRoot: string }): string
// That directory within one workspace. The runner writes a log into it and reads every log back out of it,
// and the suites look for what it wrote, so the three address it through one name rather than rebuilding it.
debugLogPath(args: { projectRoot: string; invocationId: string }): string
// One invocation's debug log, at <projectRoot>/debug-logs/<invocationId>-debug.log. Anchored to the project because an
// invocation is wider than a pipeline run — a batch spans every configured module, and source-normalisation's work happens
// before any lecture is chosen — and because a relative path would follow the directory the user invoked
// from (§10).
savedRunFileName(args: { runNumber: number }): string
// The file name of one saved run of a panel, such as run-01.json. Two digits keep the files in run order.
workspaceRootFor(args: { moduleRoot: string; baseName: string }): string
// Where one lecture's workspace sits: a folder named with the lecture's base name, inside the module's processing
// directory. Every stage, the runner, the CLI and every suite that lays a lecture out asks for it here.
moduleRootOf(args: { workspaceRoot: string }): string
// The module two levels up from a lecture workspace (`moduleRoot/Pipeline processing/<folder>`) — the inverse
// of the above, so the nesting is stated once. Used to assemble StageContext and to resolve the one stage
// directory that sits outside the workspace.
moduleName(args: { moduleRoot: string }): string
// What a module is called when it is shown to the user: its directory leaf, since a module has no name beyond
// the folder it is. Read by the batch summary's module column and by the CLI's "nothing matched" message.
sharedLectureFileDirs(args: { dirs: ModuleDirs }): readonly string[]
// The three directories holding a file of the lecture's own — video, slides, finished PDF — and so the three a
// lecture is addressed in by its date (§4.7). `processing` is excluded because a workspace is a folder named
// after the lecture rather than a file. Walked by `renameLectureFiles`, by `delete`, and by the fixtures.

type StageDirectoryName = string & { readonly [declaredInLayout]: true }   // branded; minted only in layout.ts
// Branded, and the private constructor that mints it rejects a widened `string`, so a value read back from the
// manifest or an LLM response cannot reach this map. See §4.4, "Stage cleanup boundaries".
type StageOutputLocation =
  | { root: "workspace"; directories: readonly StageDirectoryName[] }
  | { root: "module"; directory: StageDirectoryName }
// Where a stage's work sits, and so what a reset may take. The two variants carry different facts.
// A workspace directory holds one lecture's work and nothing else, so a reset takes the directory. The module's
// `Final output/` holds every lecture in the module, so a reset there takes only the file belonging to the
// lecture being reset — which is why that variant names a directory *deposited into* rather than a set owned.
// A stage cannot declare that it owns a module-wide directory, so no reset can sweep one (§4.7).
type StageFiles = {
  outputLocation: StageOutputLocation
  outputFile: string | null
  markdownVersion: string | null
  stageRecord: string | null
}
// `stageRecord` is a small JSON file beside `outputFile` saying how the stage reached it — which run a panel chose
// and why, or which titles changed. choose-division, retitle-subtopics and group-into-topics declare one
// (§4.5, "How a result was reached is kept beside the result"). It is recorded in `filesWritten` and cleared
// with the output, so the two cannot come apart.
// `markdownVersion` is a second file holding the same content as `outputFile` in a form a person reads, written
// by us from what was already stored rather than produced again. Only transcript-verification declares one
// (transcript-verification), and it is provisional — see transcript-verification, "The verification report Markdown is temporary". A stage's *output* is
// still the one file the stage after it reads, which is why the view is a field beside it rather than a second
// entry in a list: nothing downstream could be pointed at a list and know which member to open.
STAGE_FILES = { … } satisfies Readonly<Record<StageId, StageFiles>>
// What each stage owns: where its work sits, and the single file it writes where it writes one. Every stage but
// pdf-generation works in workspace directories; pdf-generation deposits its PDF in the module's `Final
// output/`. `outputFile` is null for source-normalisation (which writes nothing of its own), for the stages
// producing a set rather than a file (initial-subtopic-splitting and deepen-subtopic-splitting, one file per
// splitting run; render-slides and read-slides, one file per slide; qa-loop), and for pdf-generation, whose one
// file lands outside the workspace where a workspace-relative path cannot reach it. group-into-topics works in two directories, `Grouping runs/` and `Topics/`, and its
// file is `Topics/topics.json`.
// Declared as the literal it is rather than annotated as the map, so the compiler keeps which stages carry a
// file; `satisfies` still proves every stage appears, so one added to StageId and forgotten here fails to
// compile.

type StageWithOutputFile = /* the keys of STAGE_FILES whose outputFile is a string */
// The stages that write one named file, derived from the table rather than listed beside it: giving a
// stage a file or taking one away changes who may be asked, with nothing else edited.
type StageWithMarkdownVersion = /* the keys of STAGE_FILES whose markdownVersion is a string */
// The same derivation for the view, so a stage that does not render one cannot be asked for its path. Today
// that is transcript-verification alone; when the view is withdrawn the set is empty and every caller of the
// two resolvers below stops compiling, which is the point.

type StageInWorkspace = { workspaceRoot: string; stageId: StageId }
// One stage's work within one lecture, the pair every resolver below is addressed by.
type StageFileInWorkspace = { workspaceRoot: string; stageId: StageWithOutputFile }
// The narrower half of it, for the two resolvers that answer with a file.
stageOutputEntry(stageId: StageWithOutputFile): string
// The stage's output path relative to the workspace, as recorded in `filesWritten` (§4.5). The stages
// whose `outputFile` is null have no answer to give, and each is null for one of the reasons above — so rather than
// return a value that would have to be read as "none of these", they cannot be asked: the parameter admits
// only the stages that write one, and naming any other is a compile error.
stageOutputPath(query: StageFileInWorkspace): string
// The same path, absolute. A stage uses it for its own output and for its upstream's input, so a hand-off
// between two stages is stated once rather than at both ends.
stageMarkdownVersionEntry(stageId: StageWithMarkdownVersion): string
stageMarkdownVersionPath(query: { workspaceRoot: string; stageId: StageWithMarkdownVersion }): string
// The view's path relative to the workspace and absolute, answering for the view exactly as the two above
// answer for the output. Both are recorded in `filesWritten`, so a view deleted by hand re-runs its stage.
type StageWithStageRecord = /* the keys of STAGE_FILES whose stageRecord is a string */
stageRecordEntry(stageId: StageWithStageRecord): string
stageRecordPath(query: { workspaceRoot: string; stageId: StageWithStageRecord }): string
// The same three for the record.
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
// factory creates and clears of leftovers before a run (§4.3), and it is wider than what a reset may delete:
// the module directory pdf-generation deposits into appears here, because it must exist before pandoc writes
// into it, and it holds every lecture's PDF. A reset reads `resolveStageOutput` instead, which carries the
// variant that says so.
```

### 3.4 Re-numbering When New Lectures Are Added

If a new lecture is inserted whose date falls between existing lectures, `source-normalisation` re-runs across all lectures in the module, detects the changed sequence, and renames all affected lecture files atomically (via a temporary name to avoid collision):

- Workspace folders in `Pipeline processing/`
- Source video and slide files in `Source files/`
- PDF files in `Final output/`
- Updates `lectureNumber` in each affected manifest

Because all other files inside the workspace use simple names, only the four lecture files above need renaming per affected lecture. Manifests use relative paths throughout and survive folder renames without modification.

---

## 4. Pipeline Architecture

### 4.1 Stage Overview

| Stage | Type | Description |
|---|---|---|
| `source-normalisation` | Batch | Parse dates, extract provisional titles, assign lecture numbers, rename source files, create workspace folders |
| `audio-extraction` | Per-lecture | Extract audio track from video using ffmpeg |
| `transcription` | Per-lecture | Upload audio to ElevenLabs, save raw transcript |
| `initial-subtopic-splitting` | Per-lecture | Cut the whole transcript into subtopics, once per splitting run in the panel |
| `deepen-subtopic-splitting` | Per-lecture | In each splitting run, divide further every subtopic over the size gate |
| `choose-division` | Per-lecture | Vote on where the splitting runs divide the transcript, and keep the run nearest the vote. No model call |
| `retitle-subtopics` | Per-lecture | Give every subtopic of the chosen division a new title from its own text, in one call over the whole lecture |
| `group-into-topics` | Per-lecture | Group the retitled subtopics into topics: a panel of grouping runs, and the grouping most of them made |
| `judge-lecture-title` | Per-lecture | Judge whether the provisional title is meaningful for the grouped lecture. Propose an AI-derived title when it is not, and rename the lecture files unless a user title is set |
| `render-slides` | Per-lecture | Render each page of the slide deck as one image. No model call |
| `read-slides` | Per-lecture | Read each slide image with a vision model: its title, text, diagrams, caption and kind |
| `place-slides` | Per-lecture | Put each subject-matter slide with the subtopic where the lecturer discusses it, in deck order |
| `transcript-structuring` | Per-lecture | Structure the transcript into markdown |
| `transcript-verification` | Per-lecture | Compare the structured transcript against the raw one. Report what was lost, underexplained, distorted, or invented. Reports only — never fails a run |
| `synthesis` | Per-lecture | Combine transcript, slide content, and figures into textbook-style notes |
| `qa-loop` | Per-lecture | Check and revise the notes again and again. Write the final `QA checked/notes.md` |
| `pdf-generation` | Per-lecture | Convert `QA checked/notes.md` to PDF with pandoc. Put the PDF in `Final output/` |

The four division stages, `retitle-subtopics`, `judge-lecture-title` and the three slide stages run after `transcription`. Every older stage stays. Of the later stages, only `judge-lecture-title` and `place-slides` read the subtopics. The move of the rest of the pipeline to the README's stage list is later work.

### 4.2 Stage Interface

Every stage implements a common `PipelineStage<TInput, TOutput>` contract: an idempotency check `isComplete(context)`, an input step `getInput(context)`, and `run({ input, context })` returning a `StageResult`. Stages read an immutable `StageContext` and never change it. The context holds the lecture identity, `workspaceRoot`, `moduleRoot`, the resolved `PipelineConfig` and the current `Manifest`. The runner writes a stage's own bookkeeping in the manifest: its status, its cost and its `filesWritten`. The stage never writes them. The runner also writes the manifest's *lecture identity*. **No per-lecture stage writes `manifest.json`.** `judge-lecture-title` settles the lecture's title (§5, `judge-lecture-title`). It is the only stage that changes the lecture's identity. It reports what it settled on `StageResult.identityChanges`, and the runner writes that with the stage's `complete` entry.

A stage's context is assembled before its own entry is marked `running`, so the manifest copy it carries is out of date in that field for as long as the stage runs. The copy is a read model. The runner re-reads the manifest immediately before each write and is its only writer, so every write has a current base, and the `running` marker survives the stage it belongs to (§4.5). Currency and trust are separate questions: the manifest is untrusted input however fresh it is, bounded by §4.4.

**Authoritative types.** The exact shape of every pipeline contract — `PipelineStage`, `StageId`, `StageContext`, `StageResult`, `StageCost`, `StageConfigUsed`, and the rest — lives in `src/types/pipeline.ts` with per-field documentation. That file is the single source of truth; this section describes intent and the invariants those types encode, not field lists:

- `StageResult.cost` is `null` for stages that make no billable calls (audio-extraction, pdf-generation).
- `StageResult.filesWritten` holds paths relative to `workspaceRoot`, and MAY escape upward with `..` (e.g. pdf-generation writes to `../../Final output/`) but MUST resolve under `moduleRoot` — enforced by §4.4.
- `StageCost` is discriminated on `costUsd`. A resolved cost is a `number`. A failed lookup is `null` paired with an `unknownCostReason` (see §7).
- `StageResult.identityChanges` holds the lecture-identity fields the stage decided — `lectureTitle`, `aiDerivedTitle`, `baseName` — for the runner to write. Absent and `{}` both mean the stage decided nothing. Only `judge-lecture-title` ever decides anything. `baseName` is the lecture's canonical base name recorded in the manifest, not the runner's handle on the workspace — the runner locates that itself (§4.7).
- `lectureTitle` is always non-null — seeded by `source-normalisation`, possibly overwritten by `judge-lecture-title` (see §3.2, and §5, `judge-lecture-title`).

`isComplete()` checks two conditions: the manifest marks the stage `'complete'` or `'skipped'`, AND every path in `manifest.stages[stageId].filesWritten` exists on disk. Both must be true. The two statuses count alike because a run that honours this check records `skipped` in place of the `complete` it read, so from the next run's point of view they describe the same disk — the work is done and does not need paying for again. This means a completed stage whose output was manually deleted returns `false` and re-runs automatically. A recorded path that cannot be resolved at all counts as absent rather than as an error, since deleting a stage's output usually removes its containing directory too; a path resolving *outside* `moduleRoot` is a different matter and always throws (§4.4).

That check is identical for every stage, so stages are not assembled by hand: each is built through a shared factory that supplies `isComplete` for the given stage id, leaving a stage to define only the two things that genuinely differ — how it gathers its input, and what it does.

The factory carries two further things every stage would otherwise restate. It prepares the stage's output directories before `run` begins (§4.3), and it binds the run's logger to the stage **once, at construction**, so `run` is handed a logger already stamping `{ stage }` (§10). `logger` sits on the factory rather than on `PipelineStage.run`: the runner invokes a stage with the input and the context and nothing else, so the logging capability never travels through the stage contract, and `src/types/pipeline.ts` stays free of any dependency on the logging library.

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
// { logger } and forwards it, exactly as createSourceNormalisationStage already does for source-normalisation.
```

After a stage's `run()` succeeds, the runner writes the `filesWritten` list from `StageResult` to `manifest.stages[stageId].filesWritten` before marking the stage `complete`. These are exactly the paths `isComplete()` later verifies.

A stage does not name its own output file and then record it separately: putting the file in place and naming it as `filesWritten` records it are one act, and a stage doing the halves for itself could record a path it had not written to. Both halves are derived from the one stage id, in one place, and the two writers below differ only in how the bytes arrive:

```typescript
// src/pipeline/stages/pipeline-stage.ts
type RecordedStageOutput = { path: string; filesWritten: readonly string[] }
type StageOutputSource = { content: string } | { produce: ProduceFile }
writeStageOutput(args: { stageId: StageWithOutputFile; context: Pick<StageContext, "workspaceRoot"> } & StageOutputSource): Promise<RecordedStageOutput>
// Where the bytes come from is the one thing that varies, so it is a union rather than a second writer: a
// stage either hands over content or produces it into the `.tmp` sibling — audio-extraction has ffmpeg write the audio
// track that way (§4.3). Written as one function because the pairing it protects is one fact.
// It takes a stage that writes one file (§3.3); a stage producing a set builds its own `filesWritten`, and
// pdf-generation names a file outside the workspace, so neither is served by this.
writeStageOutputWithMarkdownVersion(args: {
  stageId: StageWithOutputFile & StageWithMarkdownVersion
  context: Pick<StageContext, "workspaceRoot">
  content: string
  markdownVersion: string
}): Promise<RecordedStageOutput>
// The same act for a stage that also renders its output for a reader (§3.3): it writes both files and returns
// both entries, and `path` is still the machine-readable one. A separate function rather than an optional
// argument, because the parameter type is what ties supplying a view to a stage that declares one — a stage
// that does not cannot be named here, and one that does cannot forget to render it.
writeStageOutputWithStageRecord(args: {
  stageId: StageWithOutputFile & StageWithStageRecord
  context: Pick<StageContext, "workspaceRoot">
  value: unknown
  stageRecord: unknown
}): Promise<RecordedStageOutput>
// The same act for a stage that keeps a stage record of how it reached its output: the output and the stage
// record are each written as JSON, the stage record beside the output, and both entries are returned. Every
// stage keeping a stage record writes JSON, so both are given as values. The two writers share the step that writes an output and
// one file beside it.
```

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

The stage does not do this for itself — `createPipelineStage` does it on every stage's behalf (§4.2), reading the directories from `STAGE_FILES` (§3.3) rather than from the stage's output file, so a stage owning several directories, or one outside the workspace as `pdf-generation` does, is prepared as completely as a stage owning a single one.

Output a stage does not hold in memory — bytes written by a subprocess, such as `audio-extraction`'s ffmpeg extraction — goes through the same discipline via `produceFileAtomic`, which hands the producer the `.tmp` path and renames only once it resolves. A stage reaches it through `writeStageOutput` (§4.2) rather than directly, so the path it writes and the entry recording it still come from one place. This has one consequence for a stage that muxes: a `.tmp` suffix defeats the container inference ffmpeg does from the output extension, so a stage writing through a temporary path names its output format explicitly.

```typescript
// src/utils/files.ts
writeFileAtomic(args: { path: string; content: string | Uint8Array }): Promise<void>   // writes .tmp, renames on success
type ProduceFile = (tmpPath: string) => Promise<void>
// Named because both ends of the convention state it — this module and the stage-level writer that reaches it
// (§4.2) — and a signature written at each end can change at one.
produceFileAtomic(args: { path: string; produce: ProduceFile }): Promise<void>
// the general form: the caller creates the file at the .tmp path it is given
readJsonSafe(path: string): Promise<unknown>
// The read half: the parsed value, or null when the file is missing, unreadable, or not JSON. Answers with a
// value rather than a throw because both callers scan speculatively — the runner over whatever `Run logs/` holds,
// `readManifestSafe` over a folder that may not be a lecture. The value is `unknown`: what the file was
// supposed to hold is the caller's claim, and a parse cannot check it.
writeJsonAtomic(args: { path: string; value: unknown }): Promise<void>
// the same, for a value serialised as JSON. It writes the manifest (§4.5), the run logs (§4.6) and the saved
// runs of a panel (§5).
jsonFileContent(value: unknown): string
// The text of every JSON file that the pipeline writes: indented, with a newline at the end. A person reads
// these files, so they are indented. writeJsonAtomic and the stage-output writer both use it.
cleanTmpFiles(dir: string): Promise<void>                                 // deletes any .tmp files in a directory
```

The same module holds the reads, because a pipeline whose directories are created on demand asks about a
directory that may not be there yet on nearly every path — a workspace with no `Run logs/`, a module with no
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

`--from-stage` cleanup takes no manifest-derived path, so the boundary check has nothing to act on there. Every directory it works in comes from the hard-coded `STAGE_FILES`, and it reads `filesWritten` at no point (see "Stage cleanup boundaries" below): the untrusted input is kept out of the function rather than checked on the way in. `isComplete()` reads `filesWritten` as its whole job, so the check belongs there.

```typescript
// src/pipeline/workspace-paths.ts — the resolver of a path from a manifest
type ManifestPathQuery = { workspaceRoot: string; moduleRoot: string; entry: string }
class ManifestPathError extends NamedError
resolveManifestPath(query: ManifestPathQuery): Promise<string>
// The three steps above, in order; throws ManifestPathError when the result escapes moduleRoot.
// The query is a named type so callers forwarding a path state the shape once.
```

The resolver has a module of its own. It is not with the filesystem helpers in `src/utils/files.ts` (§4.3). A mistake in a helper, such as a directory listing, causes a small problem. A mistake in the resolver lets a path escape the folder that the user gave to the tool. So a reader can review the resolver alone. A path that the code makes from fixed names needs no check. The layout module (§3.3) joins those names itself.

**`filenameSafe(title)`.** Titles reach the filesystem in the base name. The workspace, the renamed source files and the `Final output/` PDF carry the base name. A title comes from a user's filename (`source-normalisation`) or from a model's reply (`judge-lecture-title`). Neither source is a trusted path component. `filenameSafe` MUST:

- Strip path separators (`/`, `\`), directory-traversal segments (`.`, `..`), null bytes, and ASCII control characters.
- Collapse whitespace runs to a single space; trim leading/trailing whitespace and dots.
- Reject an empty result — the caller must fall back to `provisionalTitle` or a stage-defined default.

```typescript
filenameSafe(title: string): string   // src/utils/naming.ts; throws when the result would be empty
```

**Stage cleanup boundaries.** `--from-stage <stageId>` MUST NOT drive its cleanup off `filesWritten` from the manifest. Cleanup works from the hard-coded `STAGE_FILES` of each stage (§3.3), such as `Slide readings/` for `read-slides` and the module's `Final output/` for `pdf-generation`. So a corrupt manifest cannot cause the deletion of unintended files. The type system enforces "hard-coded". A stage directory name is branded, and the private constructor that makes it refuses a widened `string` (§3.3). A `filesWritten` entry or LLM-supplied name reaching that map is a compile error.

`pdf-generation`'s directory is the sole one resolved against `moduleRoot` rather than the workspace, and it holds every lecture in the module. What a stage declares is therefore a `StageOutputLocation` (§3.3), and the variant decides how cleanup proceeds. Its `workspace` variant carries directories, which cleanup takes whole, since each holds one lecture's work and nothing else. Its `module` variant carries the directory the stage deposits into, where cleanup removes the single file carrying the reset lecture's date and leaves the directory and every other lecture's PDF standing. A stage has no way to declare that it owns a module-wide directory, so the reach of a reset is bounded by the type rather than by the care taken at each call site.

The delete target is anchored at the other end too: `workspaceRoot` is always built by `listWorkspaces` as `join(moduleDirs({ moduleRoot }).processing, <directory listing entry>)`, and the manifest is read only to match a lecture date, never to supply a path. So `moduleRootOf(workspaceRoot)` returns the same `moduleRoot` the caller passed in, and neither root nor name is manifest-derived.

**No shell interpolation.** Every child process in the pipeline MUST use `spawn(cmd, argv, opts)` with an explicit argv array. Examples are fluent-ffmpeg in `audio-extraction`, pandoc in `pdf-generation` and any future subprocess call. Never use `exec(shellString)`, or any variant that joins paths into a shell command. This rule removes a class of bug. In that bug, a folder name with spaces breaks out of an argument through unescaped shell metacharacters. Examples are `Final output/`, `Slide images/` and `QA iterations/`. A title string from an attacker can do the same. Paths go into argv unchanged. No quoting is necessary or applied.

### 4.5 Run Manifest

One `manifest.json` per lecture, stored in the workspace root. All paths are relative to `workspaceRoot` so the manifest survives a folder rename.

The manifest tracks the **current pipeline state** and the cost of the most recent successful execution of each stage. Historical cost across multiple runs is the responsibility of the run logs (§4.6). Its TypeScript shape is `Manifest` in `src/types/pipeline.ts` (single source of truth); the example below is illustrative, not the schema.

Three separate callers change the manifest. So this section states once where it lives and how it is written. These are the callers:

- `source-normalisation` creates the manifest and renumbers it.
- The runner changes a stage entry after every stage. With that entry, it writes any lecture-identity change that `judge-lecture-title` decided (§4.2).
- The CLI's identity commands change a lecture's title or date.

```typescript
// src/pipeline/manifest.ts
MANIFEST_VERSION: string   // "1" — the schema version stamped into every manifest the pipeline writes
// Declared beside the format it versions, because both parties that write a version — source-normalisation, which creates a
// manifest, and the fixtures, which seed one per suite — would otherwise hold their own, and nothing reads
// `version` back to notice. Bumping it here bumps what the suites seed, so a migration is tested against the
// version it migrates from.
pendingStages(): Manifest["stages"]   // every stage `pending`, as source-normalisation writes it for a new workspace
// Beside the version and for the same reason: source-normalisation writes this map and the fixtures seed one, and each had
// been building its own. Nothing reads the map back in a way that would notice the two drifting apart.
manifestPath(args: { workspaceRoot: string }): string
class ManifestUnreadableError extends NamedError   // missing, or the filesystem refused it
class ManifestNotJsonError extends NamedError      // read, but does not parse as JSON
class ManifestShapeError extends NamedError        // parses, but describes no lecture
// One class per way `readManifest` fails, the two the platform raises included: a caught failure names which
// of the three happened from its type, and a raw `ENOENT` or `SyntaxError` reaching a caller says only that
// something below went wrong.
readManifest(args: { workspaceRoot: string }): Promise<Manifest>        // throws when missing or malformed
// "Malformed" is judged the same way both readers judge it, on the parsed value rather than on whether parsing
// threw. `{}`, `[]` and `null` all parse and none describes a lecture. The two readers differ only in what they
// do about it: this one throws, `readManifestSafe` answers `null`.
readManifestSafe(args: { workspaceRoot: string }): Promise<Manifest | null>
// null instead: a folder under `Pipeline processing/` with no readable manifest is not a lecture, which is a
// fact to skip over rather than an error, since both source-normalisation and the runner scan those folders speculatively.
// "Readable" is judged on the parsed value, not on whether parsing threw: a `manifest.json` holding `{}` or
// `[]` parses perfectly and still identifies no lecture. The check is the three fields every scanning caller
// goes on to read — `lectureNumber`, `lectureDate`, `stages` — so a manifest with imperfect stage entries
// still describes a lecture and reaches the caller that reads them.
writeManifest(args: { workspaceRoot: string; manifest: Manifest }): Promise<void>   // atomic (§4.3); creates the workspace if absent
patchManifest(args: { workspaceRoot: string; manifest: Manifest; changes: Partial<Manifest>; updatedAt: string }): Promise<Manifest>
// Lays changes over the manifest, stamps `updatedAt`, and writes the result. All three callers do exactly
// that, so an edit cannot leave a manifest claiming nothing happened to it. The instant is given rather than
// read here because the runner's is not simply "now": it stamps the same instant it writes into the stage
// entry, so the manifest and the entry inside it name one moment.
```

Each stage entry records `configUsed` — a `StageConfigUsed` capturing the model ID and tuning parameters (temperature, max tokens, concurrency, calls at once, max QA iterations) actually resolved for that run, or `null` for stages that make no LLM calls. This lets spend be attributed to a specific model and configuration and lets model experiments be compared (NFR-3.2). The run logs (§4.6) record the same `configUsed` per attempt.

```jsonc
{
  "version": "1",
  "lectureNumber": 1,
  "lectureDate": "2025-10-10",
  "provisionalTitle": "Disease Cell Injury and the Immune System",
  "userTitle": null,
  "aiDerivedTitle": null,
  "lectureTitle": "Disease Cell Injury and the Immune System",
  "baseName": "Lecture 1 - Disease Cell Injury and the Immune System - 2025-10-10",
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
    "choose-division": {
      "status": "complete",
      "completedAt": "...",
      "configUsed": null,
      "cost": null,
      "filesWritten": ["Chosen division/subtopics.json", "Chosen division/choice.json"]
    },
    "retitle-subtopics": {
      "status": "complete",
      "completedAt": "...",
      "configUsed": { "modelId": "openai/gpt-6.1-sol-pro" },
      "cost": { "promptTokens": 15100, "completionTokens": 2400, "costUsd": 0.06, "callCount": 1 },
      "filesWritten": ["Retitled subtopics/subtopics.json", "Retitled subtopics/changes.json"]
    },
    "group-into-topics": {
      "status": "complete",
      "completedAt": "...",
      "configUsed": { "modelId": "openai/gpt-6.1-sol-pro", "concurrency": 5, "sendGapSeconds": 0.5 },
      "cost": { "promptTokens": 76000, "completionTokens": 4300, "costUsd": 0.45, "callCount": 5 },
      "filesWritten": ["Grouping runs/run-01.json", "…", "Grouping runs/run-05.json", "Topics/topics.json", "Topics/choice.json"]
    },
    "judge-lecture-title": {
      "status": "complete",
      "completedAt": "...",
      "configUsed": { "modelId": "openai/gpt-6.1-sol-pro" },
      "cost": { "promptTokens": 15200, "completionTokens": 300, "costUsd": 0.05, "callCount": 1 },
      "filesWritten": ["Title judgement/judgement.json"]
    },
    "transcript-structuring": {
      "status": "complete",
      "completedAt": "...",
      "configUsed": { "modelId": "anthropic/claude-sonnet-4.6", "temperature": 0.2, "maxTokens": 8192 },
      "cost": { "promptTokens": 18400, "completionTokens": 3200, "costUsd": 0.081, "callCount": 1 },
      "filesWritten": ["Structured transcript/structured-transcript.md"]
    },
    "read-slides": {
      "status": "complete",
      "completedAt": "...",
      "configUsed": { "modelId": "google/gemini-2.5-flash", "temperature": 0.1, "maxTokens": 4096, "concurrency": 3 },
      "cost": { "promptTokens": 41000, "completionTokens": 8100, "costUsd": 0.034, "callCount": 24 },
      "filesWritten": ["Slide readings/slide-001.json", "...", "Slide readings/slide-024.json"]
    },
    "place-slides": {
      "status": "complete",
      "completedAt": "...",
      "configUsed": { "modelId": "openai/gpt-4.1", "temperature": 0.0, "maxTokens": 2048 },
      "cost": { "promptTokens": 36000, "completionTokens": 400, "costUsd": 0.038, "callCount": 1 },
      "filesWritten": ["Slide placements/placements.json"]
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
        "QA checked/images/slide-003.png"
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

**A stage may record facts of its own in its entry.** `qa-loop` records its iterations and why it stopped. The stage returns them on its `StageResult`, the runner writes them with the `complete` entry, and a `skipped` entry carries them over from the entry it replaces. Each such stage has its own entry type, keyed to its stage id in `ManifestStages`.

**How a result was reached is kept beside the result, not here.** `choose-division`, `retitle-subtopics` and `group-into-topics` each write a small record next to their output saying how they reached it — which run was chosen and why, or which titles changed (§3.3; §5). The manifest is the run's bookkeeping: whether a stage ran, what it cost, and what it wrote. A record describes the result, so it is written and cleared with the result and listed in `filesWritten` like it, and no skip or re-run can separate the two.

**`running` status is written before a stage begins.** A crash mid-stage leaves `running` in the manifest, which is treated as `failed` on next launch — the stage re-runs from scratch, except that a panel stage keeps the runs it already saved (§8, "Intra-Stage Resumability").

### 4.6 Run Logs

Every pipeline invocation creates a new log file in `Run logs/` named by ISO timestamp (e.g. `Run logs/2025-10-10T09-00-00Z.json`). Run logs are append-only and never modified after creation.

Each log records which stages were attempted, skipped, or re-run; cost and model per stage; and whether each stage succeeded or failed. This provides a complete financial audit trail including failed attempts and model experiments.

`Run logs/` is read by scanning it, not from an index, so the cost report is offered every file that sits there — including one the pipeline never wrote, such as a debug log dropped alongside them (§10). Parsing as JSON is not enough to be a run: a file is taken as one only if it carries the `pipelineRunId` it is filed under and the stage map the report iterates. Anything else is skipped, the same judgement `readManifestSafe` makes about a folder that is not a lecture (§4.5).

```jsonc
{
  "pipelineRunId": "2025-10-10T09-00-00Z",
  "startedAt": "2025-10-10T09:00:00.000Z",
  "endedAt": "2025-10-10T09:12:00.000Z",
  "triggeredBy": "manual",          // 'manual' | 'from-stage'
  "runType": "normal",              // 'normal' | 'error-recovery' | 'experiment' — classified at run start (§7)
  "fromStage": null,                // stageId if --from-stage was used
  "toStage": null,                  // stageId if --to-stage was used; the stages after it read `not-reached`
  "stages": {
    "audio-extraction":       { "action": "skipped" },
    "transcription":          { "action": "skipped" },
    "transcript-structuring": { "action": "skipped" },
    "render-slides":          { "action": "skipped" },
    "read-slides": {
      "action": "ran",
      "status": "failed",
      "configUsed": { "modelId": "google/gemini-2.5-flash", "temperature": 0.1, "maxTokens": 4096, "concurrency": 3 },
      "error": "Rate limit exceeded after 3 retries on slide 14",
      "cost": { "costUsd": 0.021, "callCount": 13 }
    },
    "place-slides":      { "action": "not-reached" },
    "synthesis":         { "action": "not-reached" },
    "qa-loop":           { "action": "not-reached" },
    "pdf-generation":    { "action": "not-reached" }
  }
}
```

A run log records what each stage of that run cost and stops there — no figure for the run as a whole (NFR-2.2).

### 4.7 Pipeline Runner

The runner-facing types — `LectureMatch`, `PipelineRunOptions`, `BatchOptions`, `ReportOptions`, `PipelineStageOutcome`, `PipelineRunSummary`, and `BatchSummary` — are defined in `src/types/pipeline.ts` (single source of truth).

`PipelineRunOptions` carries what any run can be told: which stage to restart from, which stage to stop after, and `onStageFailure`, `'halt' | 'continue'`, which the caller always states. `BatchOptions` extends it with `concurrency`, how many lectures are in flight at once; only a batch has more than one lecture to place, so the option lives on the batch's type alone and a single-lecture run cannot express it. What a caller who states no preference gets is named once, as `DEFAULT_PIPELINE_RUN_OPTIONS` and `DEFAULT_BATCH_OPTIONS`: halt at the first failed stage, one lecture at a time. The CLI never relies on the second's `concurrency`: `batch` always states one, from `--concurrency` or else the config's `batch.concurrency`.

The `PipelineRunner` surface:

```typescript
class PipelineRunner {
  // Stages are injected so the runner is driven by stub stages under test and real stages in production.
  constructor(deps: { config: PipelineConfig; sourceNormalisation: Readonly<SourceNormalisationStage>; lectureStages: readonly Readonly<PipelineStage<unknown, unknown>>[]; logger: Logger; reporter: PipelineRunReporter })
  // `reporter` is where the run says what it is doing as it happens (§10). Injected like the logger and for
  // the same reason: the runner states the facts, and the CLI decides how — and whether — a user sees them.
  async normaliseSources(args: { moduleRoots: readonly string[] }): Promise<void>          // source-normalisation
  async runLecture(args: { workspaceRoot: string; options?: PipelineRunOptions }): Promise<PipelineRunSummary>
  async runBatch(args: { moduleRoots: readonly string[]; options?: BatchOptions }): Promise<BatchSummary>
  async costReport(args: { moduleRoots: readonly string[]; options?: ReportOptions }): Promise<readonly string[]>
  // One rendered report per reported lecture, handed back rather than printed. The CLI writes them
  // through its injected stream like every other block of output (§8), so nothing in the pipeline
  // writes to the process's own stdout.
  async resolveLecturesByDate(args: { moduleRoots: readonly string[]; lectureDate: string }): Promise<readonly LectureMatch[]>
  async countLectures(args: { moduleRoots: readonly string[] }): Promise<number>
}

// source-normalisation's per-module contract (Phase 4 supplies the real implementation):
type SourceNormalisationStage = { stageId: "source-normalisation"; normaliseModule(args: { moduleRoot: string }): Promise<void> }

// The runner's supporting logic lives in module-level functions rather than private methods, so each has one
// job and the class stays orchestration. All of them are module-private but `deriveTimestampId`: `PipelineRunner`
// is the module's surface, and the surface its own tests drive. runStage returns its outcome: the caller
// collects the entries, decides whether to halt, and fills `not-reached`, so the run log is assembled from
// return values and concurrent lectures share no state.
export deriveTimestampId(args: { instant: Date }): string     // filesystem-safe id, e.g. 2025-10-10T09-00-00Z
// The id of a pipeline run, and of an invocation. Exported for the CLI, which names an invocation's debug log with it (§10).
decideRunType(args: { options: PipelineRunOptions; manifest: Manifest }): RunType  // normal | experiment | error-recovery (§7)
// Private. The classification reaches the outside world on `RunLog.runType`, which is where the cost report
// reads it and where the runner's tests assert it.
type StageOutcome = { entry: RunLogStageEntry; context: StageContext }
runStage(args: { stage: PipelineStage<unknown, unknown>; context: StageContext; config: PipelineConfig; timestamp: string; logger: Logger }): Promise<StageOutcome>
// Runs or skips one stage: marks it `running`, converts a throw into a failed entry (never throws), and logs
// any failure with its stack (§8). Returns the run-log entry together with the context the next stage runs
// against — see "Following a relocated workspace" below. It owns the decisions — run, skip, map a throw to
// an entry — and delegates every manifest transition to a status writer.
createStageStatusWriter(args: { stageId: StageId; context: StageContext; config: PipelineConfig; timestamp: string }): StageStatusWriter
type StageStatusWriter = { skipped(): Promise<void>; running(): Promise<void>
                           complete(args: { configUsed: StageConfigUsed | null; result: StageResult<unknown> }): Promise<void>
                           failed(args: { configUsed: StageConfigUsed | null; error: string }): Promise<void>
                           context(): StageContext }
// One stage's manifest transitions, and the context that follows from the last of them. Each write locates
// the workspace first (the stage may have moved it), patches the entry through updateManifest, and rebuilds
// the context from what was written. `complete` also carries the stage's `identityChanges` (§4.2).
updateManifest(args: { workspaceRoot: string; manifest: Manifest; stageId: StageId; entry: StageEntry; identityChanges: LectureIdentityChanges; timestamp: string }): Promise<Manifest>
// Atomic per-stage manifest patch via manifest.ts (§4.5). Takes the manifest to patch rather than reading it,
// and returns what it wrote, so the caller rebuilds the stage context without a second read. It is the one
// place a manifest gains a stage entry and a lecture-identity change, so the two always land in a single write.
resolveWorkspace(args: { workspaceRoot: string; moduleRoot: string; lectureDate: string }): Promise<{ workspaceRoot: string; manifest: Manifest }>
// Where the workspace is now, and what its manifest says. Returns the path given when its manifest still
// reads; otherwise finds the lecture again by date (see "Following a relocated workspace").
findLectureByDate(args: { moduleRoot: string; lectureDate: string }): Promise<{ workspaceRoot: string; manifest: Manifest } | null>
// Scans `moduleRoot/Pipeline processing/*/manifest.json` for the lecture carrying this date. Shared by
// resolveWorkspace and resolveLecturesByDate, which apply the same identity rule to different ends.
```

A `PipelineRunSummary` lists its stages as `PipelineStageOutcome` — the run-log entry *paired with the stage id it belongs to*. The run log keys entries by stage id, but a summary is an ordered list, and its consumer (the end-of-run summary, §7) has to name each stage it reports.

**Reducing outcomes to a status.** The same rule applies at every level — a stage within a lecture, a lecture within a module, a module within a batch — so it is stated once in `src/pipeline/run-status.ts` and applied by both the runner and the reporting that prints its summaries.

`OverallStatus` has two values, `success` and `failed`. The question it answers is whether anything in this run failed, and there are only two answers to it: a skipped stage's output is already on disk, and a stage the run never reached — because a failure halted it, or because `--to-stage` bounded it — leaves nothing behind that could have failed.

```typescript
stageOutcomeStatus(entry: RunLogStageEntry): OverallStatus            // failed where the stage ran and failed
// What a stage contributes to the fold, not a verdict on the stage alone: `success` means "nothing here makes
// the run a failure", which is as true of a stage never reached as of one that finished. A skipped stage reads
// as `isCompletedEntry` reads it — its output is on disk, and declining to produce it again is the pipeline
// working rather than work left undone.
summariseOverallStatus(args: { statuses: readonly OverallStatus[] }): OverallStatus  // any failure wins
summariseLectures(args: { lectures: readonly { overallStatus: OverallStatus }[] }): OverallStatus
// The same rule over lectures, which carry their own status: the runner folds a whole batch this way and the
// batch table folds each module's rows, so the projection is written once. The parameter asks for the status
// alone rather than a whole PipelineRunSummary, because that is all the rule reads.
isCompletedEntry(entry: StageEntry | QaStageEntry | undefined): entry is CompletedStageEntry
// Whether a *manifest* entry means the stage's output is on disk — `complete` or `skipped` (§4.2). Three
// unrelated callers ask it: the shared `isComplete`, the run classifier, and the cost report's current-pipeline
// section. A type guard rather than a boolean, so a caller that has checked can read `filesWritten` without a cast.
```

**Run outcome classification.** A `PipelineRunSummary.overallStatus` — and the aggregate `BatchSummary.overallStatus` across a batch's lectures — is `failed` when at least one stage failed, and `success` otherwise, a stage whose output already stood and was skipped included. It reports on this run, not on the lecture: a run bounded by `--to-stage` succeeds with later stages still `pending`, and the manifest is where how far a lecture has got is read.

**Pipeline order comes from `STAGE_IDS`.** `src/types/pipeline.ts` declares `STAGE_IDS` as the ordered stage list, and everything that walks the stages in order — the runner's `--from-stage` reset, the cost report's per-stage breakdown — iterates that array. A map elsewhere in the code is a lookup keyed *by* stage, and its key order is that map's own; the pipeline's order has one statement, and adding a stage to it is what puts the stage in the sequence.

**`--from-stage <stageId>`:** Resets the nominated stage and all downstream stages to `pending` in the manifest. Also deletes the intermediate files of each stage that runs again, such as `Slide readings/*.json` for `read-slides`. So the new run makes entirely fresh output. Upstream stages are untouched. The deletion uses the hard-coded directories of each stage (see §4.4), and never `filesWritten` from the manifest. The module's `Final output/` is shared, so there the deletion takes only this lecture's PDF.

**The reset is confirmed before anything is deleted (NFR-4.3).** The CLI asks once per invocation, leading with the number of lectures that will lose work, and declining runs nothing at all rather than running without the reset. The count is what makes the question worth reading, because nothing the user typed states it: `run <date>` covers however many lectures that date matched and they then chose, and `batch` covers every lecture in the module named — or, with no module named, in every configured one. The question is asked wherever that set first becomes known, which is the CLI for a date and, for a batch, only after `countLectures` has scanned the modules (§4.7, "Counting a batch's scope"). Establishing the count costs that scan, so it is taken only when a stage is nominated; an ordinary run asks nothing and pays nothing. There is no flag to suppress the question.

**`--to-stage <stageId>`:** The last stage the run performs. Stages after it are not run and are recorded `not-reached`, exactly as the stages after a halt are — the run stopped short of them, and the run log should say so in the words it already uses for that. Nothing is reset, nothing is deleted, and no confirmation is asked: a run that stops early destroys no work.

It is a position in `STAGE_IDS`, not a name to match, so a stage the pipeline has not yet built still bounds the run: `--to-stage transcription` stops after `transcription` whether or not the stages beyond it exist. Naming a stage the lecture runs before any lecture stage — `source-normalisation` — runs none of them, which is what a caller asking for normalisation alone means by it.

Given with `--from-stage`, the two bound the run at both ends and the pair must be in pipeline order; `--from-stage transcript-structuring --to-stage transcription` is refused at parse time rather than silently running nothing.

Its reason for existing is the cost of the stages downstream of what a run actually needs. Transcribing five lectures for a segmentation experiment reads `Transcript/transcript.txt` and nothing else, and without this flag that run also pays `transcript-structuring` and `transcript-verification` on every lecture.

**Natural restart after failure:** Does not clear intermediate files. The slide readings from `read-slides` stay, so a failed run continues from the slide where it stopped.

**Lecture identification:** A lecture is uniquely identified by `(moduleRoot, lectureDate)`. `source-normalisation` guarantees `lectureDate` is unique within a module. Across modules, dates may collide — see `resolveLecturesByDate` below.

**`resolveLecturesByDate`:** Scans every `moduleRoots[i]/Pipeline processing/*/manifest.json` and returns matches whose `lectureDate` equals the argument. Zero matches: caller decides (typically an error). One match: caller uses it directly. Multiple matches: caller (the CLI) prompts the user via `@inquirer/prompts` — checkbox list of matches (each labelled `<module name> — Lecture N — <title>`) with "All matches" and "Cancel" affordances. Interactive prompt lives in the CLI layer, not the runner.

**`StageContext` assembly:** Before invoking any stage, the runner reads `manifest.json` at `workspaceRoot` and assembles a `StageContext`. `lectureNumber`, `lectureDate`, `provisionalTitle`, `lectureTitle`, and `workspaceRoot` are sourced from the manifest. `moduleRoot` (the containing module for this lecture) is derived from `workspaceRoot` two levels up (`moduleRoot/Pipeline processing/<folder>`); `config` comes from the runner's construction. Every context is frozen and no stage may mutate one; the per-stage manifest entries are the runner's to write, through `updateManifest()` (§4.2).

The assembly lives in its own module rather than on the runner, because the runner is not its only caller: the stage test fixtures build a context for every stage suite, and building it here means a stage under test is handed one put together exactly as a real run puts it together.

```typescript
// src/pipeline/stage-context.ts
assembleContext(args: { workspaceRoot: string; manifest: Manifest; config: PipelineConfig }): StageContext
// moduleRoot derived two levels up; the result is frozen.
```

The runner **builds the context again between stages**. It does not build one context for the whole run. This costs no extra reads. The runner already reads the manifest again at every change of stage. So `updateManifest` gives back what it wrote, and the runner builds the next context from that. The result is that a stage's manifest changes reach the stages after it. For example, `judge-lecture-title` replaces `lectureTitle`, and `pdf-generation` names the PDF from it.

**Following a relocated workspace.** `judge-lecture-title` renames the workspace folder when it replaces the lecture's title (§5, `judge-lecture-title`). The path that the runner holds is then wrong. Stages do not report the move. The runner finds the lecture again by the identity that this section treats as canonical: `(moduleRoot, lectureDate)`. `resolveWorkspace` reads the manifest at the path it has. If that read fails, it calls `findLectureByDate`, which searches `Pipeline processing/` for the workspace whose manifest carries the date. The runner calls `findLectureByDate` only after a stage moved the folder. Every other change of stage costs only the usual read. The runner writes the run log at the found path, and `PipelineRunSummary.workspaceRoot` reports that path. So a run that renames its own workspace still leaves its log beside the work.

**Counting a batch's scope.** `countLectures({ moduleRoots })` reports how many lectures stand across those modules, applying the same reading as the batch itself: a folder holding no manifest is not a lecture, and a module the pipeline has never processed holds none. It exists because the `--from-stage` confirmation has to state a number the user has no other way of knowing, and it is called only on that path — the scan it costs is not something an ordinary batch should pay for. Sources are normalised before it runs, so a lecture whose video and slides were only just added is counted; the batch is about to run it either way.

**Batch mode:** `runBatch({ moduleRoots })` normalises every listed module, then processes every lecture across them. The CLI passes an array of one for `batch <moduleRoot>` and the full `config.moduleRoots` for `batch` (no argument). Modules processed in the order given; lectures within a module in date order. How many lectures run at once is the config's `batch.concurrency` (§6); `--concurrency N` overrides it for one command. Lectures are drawn from a single global queue rather than per module — with modules in order, a global queue keeps every worker busy where a per-module one would idle at each module boundary. Because lectures from different modules may therefore be in flight together, the per-module and cross-module summaries are printed once the batch completes rather than as each module finishes (§7).

**`cost-report` command:** Reads the run logs of every lecture across the configured `moduleRoots` and renders one three-section report per lecture, each headed by the lecture it covers — what its outputs on disk cost, what its failures and retries cost, and its model experiments grouped for comparison (see §7). Figures are per stage throughout; nothing is summed across stages, runs, lectures or modules (NFR-2.2). The reports are handed back for the CLI to write (§8). Narrowed by `--date` (via `resolveLecturesByDate`, with the same multi-match prompt) or `--module <moduleRoot>`. Where the scope holds no lecture, the command says so and succeeds.

**Identity-change commands (`rename`, `delete`, `change-date`).** A lecture's identity is changed only through these commands — never by editing the filesystem directly — so the manifest and filesystem stay in lock-step (see `source-normalisation`, §5):
- `rename <date> "<new title>"` — sets `userTitle` in the manifest (which then wins the title precedence) and renames the video, slide, workspace folder, and any `Final output/` PDF to match.
- `delete <date>` — removes the lecture's video, slide, workspace, and outputs, then renumbers the remaining lectures.
- `change-date <date> <new date>` — moves the lecture (video, slide, workspace, outputs) to the new date, updates its manifest, and renumbers.

Each performs its change and then re-runs `source-normalisation` to return the module to a consistent, renumbered state. A lecture is addressed by `<date>`, resolved through `resolveLecturesByDate`.

**An identity change acts on exactly one lecture.** FR-6.7 asks for commands to rename *a* lecture, delete *a* lecture, and change *a* lecture's date, so a date that turns out to name several is a question to settle, not a licence to act on all of them: all three use a single-choice picker with no "All matches", and cancelling leaves the module untouched. `run` and `cost-report` keep the multi-select picker, since running or reporting on several lectures at once is exactly what they are for.

Each identity change leaves the module in a state `source-normalisation` can finish, rather than doing its work itself:

- **`rename`** writes `userTitle` (and `lectureTitle`) to the manifest and stops there. The renaming of video, slide, workspace, and PDF falls out of the following `source-normalisation` pass, which names them from the manifest's current `lectureTitle` — the same code path that named them originally, so a rename cannot drift from a normalisation.
- **`delete`** removes the video, the slide, the workspace, and the `Final output/` PDF, having first asked for confirmation. Removing the sources *and* the workspace together is what keeps the module consistent: a workspace left without sources is an orphaned workspace the next `source-normalisation` run would stop to ask about, and sources left without a workspace would simply be normalised back into one. `source-normalisation` then renumbers the lectures that follow.
- **`change-date`** renames the video, slide, and PDF to the base name `source-normalisation` would give them at the new date, renames the workspace folder to match, and writes the new `lectureDate` and `baseName` to the manifest — so the `source-normalisation` pass that follows has only renumbering left, and renames again if the new date changes the lecture's number. It refuses when a source file already carries the target date, since a rename would otherwise overwrite another lecture, and when the lecture's own video or slide is missing.

**Moving a lecture's files.** `change-date` and `judge-lecture-title` both give the same four things a new base name. These are the source video, the source slide, any `Final output/` PDF and the workspace folder. So the code that moves them is written once and shared. It is in `src/pipeline/`, not beside the CLI commands that first called it, because a stage must not import from the CLI layer.

Removing one lecture's file lives here for the same reason. Every directory a lecture's own files sit in is shared with every other lecture in the module, so `delete` and a `--from-stage` re-run at or before `pdf-generation` both have to take one file rather than sweep a directory, and both find it the way everything else here does — by the date it carries.

```typescript
// src/pipeline/lecture-files.ts
baseNameForLecture(args: { lectureNumber: number; title: string; lectureDate: string }): string
// `lectureBaseName` (§3.2) for a caller holding the date as the `YYYY-MM-DD` string the manifest stores.
// Both callers that move a lecture hold it in that form, so the conversion is made here rather than at each:
// the string must be read as *local* midnight, matching how `formatDateISO` writes one, or the base name
// lands a day early west of Greenwich.
findLectureFileByDate(args: { dir: string; lectureDate: string }): Promise<string | null>
// The one file in a directory whose name carries this date. Sources are addressed by date rather than by
// name because a lecture's name changes with its number and title, while its date is what identifies it (§3.2).
// The *last* date in the name is the one compared: these directories hold names source-normalisation has normalised, and
// `lectureBaseName` puts the title before the date, so a title naming a date of its own — a cohort, a study,
// a historical event — precedes the lecture's own.
removeLectureFileByDate(args: { dir: string; lectureDate: string }): Promise<void>
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
// The single-choice picker the identity changes use; `null` when the user cancels.

// src/cli/lecture-identity.ts — the filesystem half of rename/delete/change-date
renameLecture(args: { workspaceRoot: string; title: string }): Promise<void>
deleteLecture(args: { match: LectureMatch }): Promise<void>
changeLectureDate(args: { match: LectureMatch; newLectureDate: string }): Promise<void>
// All three throw LectureIdentityError, having made no change (§8).

// src/cli/commands.ts — carrying a command out
type PipelineRunnerFacade = { readonly [TOperation in RunnerOperation]: PipelineRunner[TOperation] }
// The runner as a command sees it: the five operations above, as readonly properties, so a suite stands a
// stub in without constructing a real runner and its stages.
type CliDeps = { runner: PipelineRunnerFacade; moduleRoots; batchConcurrency; gbpPerUsd; selectMatches; selectMatch; confirm; write }
// Two pickers, because the two questions differ: `selectMatches` is the checkbox picker `run` and
// `cost-report` use, `selectMatch` the single-choice one the identity changes use ("An identity change acts on
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

Parsing is validated in full before anything runs: the command must exist, its positional arguments must be present and well formed, `<date>` must be a real calendar date (`2025-02-30` is rejected as firmly as `yesterday`), `--from-stage` and `--to-stage` must each name a stage that exists and must not be given out of pipeline order, and `--concurrency` must be a whole number of 1 or more.

**Flags belong to commands.** They are declared once for the whole CLI, so `parseArgs` will accept any of them anywhere; each command then declares the ones it acts on, and anything else is a usage error naming the flag and what the command does take. So `run --concurrency 4` is refused and says why: `--concurrency` counts lectures running at once, and only `batch` runs more than one.

**`run <date>` normalises first.** Before resolving the date it runs `source-normalisation` across the configured modules. This is what lets `run` be the first command for a lecture whose video and slides were only just added: `source-normalisation` creates the workspace and manifest the date then resolves against. `source-normalisation` is idempotent, so this costs nothing when there is nothing new.

**Exit codes.** `0` when the command did what was asked, `1` when it could not: an unusable command line, a date matching no lecture, an unreadable configuration, or a run in which any stage failed. A user who cancels a choice has not failed at anything and exits `0`.

**`--help` is answered before the configuration is read**, so the commands can be discovered in a project that is not yet configured.

---

## 5. Stage Designs

**Where prompts live.** A stage that calls an LLM keeps its prompt in a module of its own, `<stage>.prompt.ts`, in the stage's folder (§9), exporting the function that builds the messages. Only stages that make LLM calls have one; `source-normalisation`, `audio-extraction`, `transcription`, `choose-division` and `pdf-generation` do not. Where a stage makes more than one kind of call, its single prompt module exports one builder per call — the QA loop's checker and reviser both belong to `qa-loop`.

Each prompt sits beside the one stage that uses it, so a prompt edit touches that stage alone (NFR-5.2). Keeping it out of the stage module puts prompt changes in a file of their own — a prompt is the part iterated on hardest once real lectures run, and its diffs stay legible apart from file renames and manifest writes.

A prompt module has no test file of its own. Its builder is a pure assembly whose contract is that the stage's inputs reach the messages, and the stage's own tests verify that against the real builder. What a suite of its own could assert is the presence of particular sentences, which pins the wording and makes every prompt iteration a two-file edit.

### `source-normalisation` — Source Normalisation (Batch)

**Runs across all lectures in the module at once, not per-lecture**, and is re-run over the module's life as new lectures are added (they arrive weekly). Each run is a full pass over whatever sources are currently present. Whole-module scope is required because lecture numbers are sequential by date across the module: a newly added, earlier-dated lecture shifts later numbers, so correct numbering and collision-safe renumbering are impossible lecture-in-isolation.

**Inputs:** All files in `Source files/Video recordings/` and `Source files/Slide decks/`.

**Identity and source of truth.** A lecture is identified by its **date** (unique within a module, enforced below). The **filesystem is authoritative for a lecture's existence**: adding a lecture means dropping its `video + slide` into the source folders, which `source-normalisation` picks up on the next run. The **manifest is authoritative for a lecture's title, cost, and history**. Because the two must never drift, **identity changes — rename, delete, change date — are made only through the CLI** (§4.7), which drives the same `source-normalisation` machinery and updates manifest and filesystem together. The user is instructed never to rename, move, or delete sources or workspaces directly; only *adding* a pair is done by dropping files. The sole guard against an accidental direct deletion is orphaned workspace handling (below).

**Title precedence.** The effective `lectureTitle` is the first of these that is set:

1. The user title (`userTitle`), which the CLI `rename` command sets.
2. The AI-derived title (`aiDerivedTitle`), which `judge-lecture-title` sets.
3. The provisional title that `source-normalisation` extracts from the filename.

 `source-normalisation` seeds `lectureTitle = provisionalTitle` for a new lecture. It never overwrites a title set later. When it runs again, it names files and folders from the manifest's current `lectureTitle`. It never parses the canonical filename again.

**Validate, then apply.** `source-normalisation` first validates the whole module with read-only checks. If any check fails it logs every problem found (at `error`) and throws, making **no filesystem changes** — a failed run never leaves a half-normalised module, and the error propagates through the runner to the CLI. Only a module that passes every check is mutated. The following **stop the run** (they are errors, not warnings):
- a video or slide filename with no confidently extractable date;
- a video with no matching slide, or a slide with no matching video (matching is 1:1 by date);
- two videos sharing a date, or two slides sharing a date — `source-normalisation` enforces the "`lectureDate` unique within a module" guarantee the rest of the system relies on (see §4.7).

**What it does** (once validation passes):

1. **Date extraction:** Parse the date from each video filename with `extractDate` (§3.2). Dates may appear in any position and format (e.g. `2025-10-10`, `10 Oct 2025`, `Fri 10th Oct`): the numeric forms are read in British convention by `src/utils/date.ts`, and `chrono-node` handles the ones written in words.

2. **Lecture number assignment:** Sort all video files by extracted date. Assign sequential lecture numbers (`Lecture 1`, `Lecture 2`, …) in date order.

3. **Slide matching:** Parse the date from each slide PDF (date always at the beginning of the filename) and match it to the video with the same date (validation has already guaranteed a 1:1 match).

4. **Title resolution:** For a **new** lecture, extract a provisional title from the video filename (§3.2). Remove the date, day names (Mon–Sun) and a configured module prefix (`naming.modulePrefixes`, §6) where present. Also remove an embedded lecture-number token such as `Lecture 1`, and trailing artefacts (`co`, `copy`, `v2`). Keep the lecturer's capitalisation exactly as typed. A filename with only a date and a lecture number gives an **empty** provisional title, and the lecture gets a bare `Lecture N` name. This step does **not** judge whether the title is meaningful. `judge-lecture-title` does that. For an **existing** lecture, the title comes from its manifest (`lectureTitle`) and is never extracted again. So a CLI `rename` and a `judge-lecture-title` rename both stay.

5. **Base names:** Rename the source video and its matched slide, the workspace folder, and any `Final output/` PDF to the shared base name `Lecture N - <title> - YYYY-MM-DD` (bare `Lecture N - YYYY-MM-DD` when the title is empty). Lecture files already at their target are left untouched.

6. **Workspace + manifest:** Create `Pipeline processing/Lecture N - <title> - YYYY-MM-DD/` for any lecture that does not already have one, writing an initial `manifest.json` with `lectureNumber`, `lectureDate`, `provisionalTitle`, `lectureTitle = provisionalTitle`, `userTitle = null`, `aiDerivedTitle = null`, and all stage statuses `pending`. For an existing lecture whose number or folder changed, update `lectureNumber` and `baseName` in its manifest, preserving everything else.

**Collision-safe renaming.** When the sequence changes, all renames (source files, workspace folders, `Final output/` PDFs) are applied in two phases — each lecture file to a temporary name, then each temporary to its target — so shifting lecture numbers never collide mid-rename. Lecture files already correct are skipped, so a re-run with no changes touches nothing.

The temporary suffix sits outside the `.tmp` convention of §4.3, because the two name opposite things: a `.tmp` file is a partial write and is deleted at stage start, while a `source-normalisation` temporary holds a complete lecture file — the only copy of a source video, or a whole lecture workspace — between leaving one name and reaching the next. A run therefore begins by finishing any rename its predecessor was interrupted partway through: every temporary entry across the module's four directories is moved on to its target before anything is read, so an interrupted run costs the next one nothing. Where a target name is occupied, the run stops and names those entries, leaving every one of them where it stands.

**Orphaned workspace handling (direct-deletion guard).** If a workspace's date has **no source pair present** (both its video and slide are gone — a partial loss already breaks a source rule), the sources were deleted directly rather than via the CLI, which can leave the pipeline inconsistent. `source-normalisation` neither silently deletes work nor silently proceeds. For **each** orphaned workspace it prompts the user — via an injected `confirm` callback the CLI backs with `@inquirer/prompts` — showing the lecture's number, title and date, and asks whether to delete the workspace and its outputs. The prompt quotes no figure: what a lecture has cost is the sum of its stages, and stage costs are not summed (NFR-2.2). What was spent on it is in its own cost report, which `cost-report` will still print until the workspace goes. Only if **every** orphaned workspace is approved does a final "are you sure?" confirm the irreversible deletion; then the workspaces and their `Final output/` PDFs are deleted (their manifests go with them), the module is renumbered, and each deletion is logged with its prior state. If **any** orphaned workspace is declined, or the final confirmation is declined, `source-normalisation` aborts with an informative error and makes **no changes** — protecting against, e.g., the whole source folder being moved by mistake.

**Logging:** Every action — files discovered, dates extracted, numbers assigned, matches, each rename, each workspace/manifest write, each renumber, each approved deletion (with its prior number/title/date) — is recorded at `info` on the run's pino logger; broken source rules and orphaned workspace aborts are recorded at `error` before the throw.

**Where the rules live.** `source-normalisation`'s file holds the order things happen in and what aborting a run means; three modules beside it hold the jobs that can be stated on their own. `lecture-resolution.ts` turns two lists of filenames into numbered lectures or into the problems that stop the run, and touches nothing — every rule under "Validate, then apply" and steps 1–4 above is checkable by calling it with two lists of names. `source-renames.ts` holds the two-pass rename and the recovery that only works by agreeing with it about the temporary suffix. `orphaned-workspaces.ts` holds workspace discovery by manifest date and the confirmation protocol, which is the only code in the project that permanently destroys a user's work. Neither of the latter two throws: each reports its refusal, and the stage decides what a refusal means. Numbering and manifest seeding stay in the stage, being short and used nowhere else.

```typescript
// src/pipeline/stages/source-normalisation/orphaned-workspaces.ts
type ConfirmPrompt = (args: { message: string }) => Promise<boolean>
// Declared by the layer with a question to ask and implemented in the CLI's prompts.ts, so the stage never
// reaches for stdin: the CLI backs it with @inquirer/prompts and tests stub it.

// src/pipeline/stages/source-normalisation/source-normalisation.ts
createSourceNormalisationStage(args: { logger: Logger; confirm: ConfirmPrompt; modulePrefixes: readonly string[] }): SourceNormalisationStage
// Throws SourceNormalisationError on any validation failure or declined confirmation, having made no
// filesystem changes.
```

The stage names and places nothing itself: it takes the module's directories from `moduleDirs` (§3.3) and
every name it writes from `lectureBaseName` (§3.2), which is what lets the CLI's identity commands move the
same files onto the same names a normalisation would give them (§4.7).

---

### `audio-extraction` — Audio Extraction

**Input:** `Source files/Video recordings/Lecture N - YYYY-MM-DD.mp4`
**Output:** `Audio/audio.m4a`

Extracts the audio track from the video using fluent-ffmpeg with `-acodec copy` (no re-encoding). Displays a `cli-progress` bar showing extraction percentage. The extracted audio is retained in `Audio/` for the life of the lecture workspace.

The source video is located by base name: the workspace's base name plus whatever extension the video carries, since `source-normalisation` gives the video, the slide, and the workspace folder the same base name but preserves the original container extension. A missing or ambiguous video is a stage failure, reported before ffmpeg is invoked. fluent-ffmpeg spawns with an explicit argv array, satisfying the no-shell-interpolation rule (§4.4). Extraction writes to a `.tmp` sibling and renames on success (§4.3), so a killed run never leaves a truncated `audio.m4a` that a later run would mistake for complete — and because that `.tmp` suffix stops ffmpeg inferring the container, the m4a muxer is named explicitly. This stage makes no billable call, so its recorded cost is `null`.

```typescript
// src/pipeline/stages/audio-extraction/audio-extraction.ts
type AudioExtractionInput = { videoRecordingPath: string }
type AudioExtractionOutput = { audioPath: string }
createAudioExtractionStage(args: { logger: Logger }): PipelineStage<AudioExtractionInput, AudioExtractionOutput>
// Throws AudioExtractionError when the source video is missing or ambiguous, or when ffmpeg fails.
```

---

### `transcription` — Transcription

**Input:** `Audio/audio.m4a`
**Output:** `Transcript/transcript.txt`

Uploads the audio to ElevenLabs Scribe v2 with a streaming upload progress bar (bytes sent vs total). Parameters: `languageCode` from `elevenLabs.languageCode` (§6), and `noVerbatim: true` — the latter is supported only on `scribe_v2`, so it travels with that model ID.

**Model ID and the provider prefix.** Config holds `stages.transcription.modelId = "elevenlabs/scribe_v2"`, but the ElevenLabs API takes a bare `model_id` of `scribe_v2` with no provider prefix. The prefix therefore exists purely to serve this codebase: `modelIdCheck.exemptProviders` matches on the segment before the `/` (§6), so a model can only be exempted from the OpenRouter check if it is provider-qualified — a bare `scribe_v2` would have no prefix to match and no way to opt out of a check it must fail. The stage strips the prefix before the call, so config keeps the qualified form the exemption and the cost report need, and ElevenLabs receives the form it expects. It takes the name from `splitModelId` (§6), the same reader the exemption asks for the provider.

The client is pointed at `elevenLabs.baseUrl` (§6) rather than left on the SDK's default host. The API key comes from `ELEVENLABS_API_KEY`; its absence is a stage failure raised before any upload begins, as is an unconfigured model — neither costs anything to detect, so both are checked before the file is opened. Cost is derived from audio duration as described in §7. The transcript is written atomically (§4.3).

The SDK types `model_id` as the Scribe versions it shipped with, but the model is configuration (§6): a newer Scribe ID must be usable by editing `pipeline-config.json`, not by waiting for an SDK release, and ElevenLabs rejects an unknown ID itself. The stage therefore widens the configured value to the SDK's parameter type at the call site.

```typescript
// src/pipeline/stages/transcription/transcription.ts
type TranscriptionInput = { audioPath: string; sizeBytes: number }
type TranscriptionOutput = { transcriptPath: string }
createTranscriptionStage(args: { logger: Logger }): PipelineStage<TranscriptionInput, TranscriptionOutput>
// Throws TranscriptionError when the audio, the API key, or the configured model is missing,
// or when the response carries no transcript text. A cost that cannot be established is not a failure (§7).

ELEVENLABS_PATHS: { speechToText: "/v1/speech-to-text" }
// The route the SDK appends to elevenLabs.baseUrl. Named here, not built here (§6).
API_KEY_VARIABLE: "ELEVENLABS_API_KEY"
// The environment variable the key is read from, named for the same reason the route is: a suite that stubs
// or unsets it names the variable the stage reads rather than its own copy. The key itself never leaves the
// environment (§2, Environment Variables).
```

The `v1` in that route is the ElevenLabs **API** version, not the Scribe version: one endpoint serves every Scribe model, and which one runs is decided by the `model_id` in the request body. Moving to a later Scribe stays a config edit, as intended.

---

### Dividing the transcript — `initial-subtopic-splitting`, `deepen-subtopic-splitting`, `choose-division`

Three stages turn the transcript into subtopics. No single splitting run is reliable enough on its own: the same prompt on the same transcript cuts in different places from one run to the next. So the lecture is divided eighteen times over, the eighteen vote on where it divides, and the run nearest the vote is kept. The first two stages make the eighteen splitting runs; the third votes over them and chooses, and makes no model call, so it can be re-run at a different bar without paying for anything again.

The design was settled in the segmentation prototype (`docs/quality/segmentation-prototype/`), which holds the measurements behind every number below. The prompts are the prototype's `s6` and `d13`, carried over word for word. Only what produces the division is carried over: the prototype's rulings, rubrics, scoring and ledgers are how the prompts were tested, stay in the prototype, and appear nowhere in the pipeline.

These three stages, `retitle-subtopics`, `group-into-topics` and `judge-lecture-title` (below) run after transcription and before transcript structuring (§4.1).

**No check step follows them.** Every other stage where a model transforms content is followed by a separate check (README, "All work is verified with separate models"). These four transform nothing: the model says only where the transcript divides and how subtopics group, and the text is sliced by code, so losslessness is guaranteed rather than checked. What remains to judge — whether a cut or a grouping is well placed — is what the panel settles: a cut survives only where enough runs agree, and a grouping is the one most of the panel made. No checker exists for that judgement, and one would have to be designed and calibrated before its verdict could be trusted.

**Panel runs.** The two splitting stages and `group-into-topics` each make a panel of independent runs, and share one behaviour around the model call:

- Runs are made a few at a time, as many at once as the stage's `concurrency` setting (§6) allows; unset, they are made one at a time.
- Once a run fails, no further run is started. Runs already in flight are let finish, and are saved, before the stage fails, so what they cost is not paid again on relaunch.
- Each run is saved to its own file the moment it is complete, so a crash loses only the runs in flight.
- A relaunched stage reads the runs already saved and makes only the missing ones. A saved run file that cannot be read is a named error rather than a run to remake: the file was written whole or not at all (§4.3), so an unreadable one means something outside the pipeline changed it.
- A reply that is empty, is not JSON, or is the wrong shape is sent again after a pause that grows with each attempt, up to three sends. Empty replies are the common case: a provider occasionally answers with success and no content, and a plain resend has always worked. After the third failure the stage fails with an error naming the run and the last cause. A stage never goes on with fewer runs than its panel, because a missing run changes what the vote means. A call the provider refuses is resent as every call is (§6, "A rejection can arrive inside an accepted reply").
- A stage with a `sendGapSeconds` (§6) spaces its sends: every send — a run's first, a resent bad reply, a resent refusal — waits until at least that long after the stage's previous send began. The runs are released together and take their turn, so no two sends land together however the replies and resends fall.
- Every send is costed, failed ones included.
- Every unusable reply is logged as a warning naming the run, which send it was and why it was unusable, so how often replies fail, and in what way, can be read from the run's log even when a later send succeeds.

The retry sits above the SDK's own, which retries only failures at the HTTP level (§8, API Error Handling); an unusable reply arrives as a success and reaches the stage.

**The model never returns text.** Every call is asked only where a subtopic begins, as its first eight to twelve words. Code finds those words in the transcript and cuts there, so each subtopic is sliced from the original and the division always reproduces the transcript exactly. Every stage checks this before writing: its subtopics, joined in order, must equal the transcript character for character. A mismatch is a bug and fails the stage. "The transcript" here is `transcript.txt` with the whitespace at its two ends removed, once, as it is read: several transcripts begin or end with stray spaces, which carry nothing, and removing them is what the prototype did, so the model is sent exactly what the prototype sent.

**Finding the start words.** A subtopic's start words are searched for with case and whitespace ignored, forward from the previous cut, because the model tidies capitalisation and spacing even when told not to. The cut is made in the original text at the matching position. When the start words begin one or two words into their sentence — the model having dropped the lecturer's opening "So", "Now" or similar — the cut moves back to the start of the sentence, so no subtopic ends halfway through one. Start words that cannot be found are never guessed at.

**Configuration.** Each of the two model-calling stages has its own model and `concurrency`, as every stage does, and `deepen-subtopic-splitting` also has `callConcurrency` (§6); the prototype's model is `google/gemini-3.7-flash`. The division's own settings live in one required `division` section of `pipeline-config.json`: `panelSize` (18), `bar` (9, the number of the panel's runs a cut site needs), and `sizeGateWords` (600). Eighteen runs make the division steadier from one panel to the next than nine. Estimated from how often each cut site was cut in the prototype's 18 `d13` runs, leaving out sites the user ruled either way, two panels disagree on 3.8 cut sites across the eight lectures at nine runs with a bar of five, 2.5 at eighteen with a bar of ten and 2.2 at a bar of nine; a panel makes 3.9, 3.2 and 3.1 errors against the user's rulings. Eighteen runs cost about $0.85 more per lecture than nine. At a bar of nine, a cut site made by exactly half the runs is kept. On the live pipeline's own 18 runs, the division chosen matched the one chosen from the prototype's 18 runs at every cut site on six of the eight lectures, and the user judged the three cuts that differed acceptable (`docs/quality/segmentation-prototype/DIVISION-AND-GROUPING-RESULTS.md`). The tolerance within which two cuts are one cut site — one percent of the transcript's length — is fixed in code, not configured: it is a measured property of how runs disagree, not a choice.

#### `initial-subtopic-splitting`

**Input:** `Transcript/transcript.txt`
**Output:** `Initial subtopics/run-01.json` … `run-18.json`

Makes `panelSize` splitting runs, each an independent call that sends the whole transcript with the `s6` prompt and gets back the start words of every subtopic. Each run is written as soon as it is complete, holding each subtopic's start and end position in the transcript, its title, and the model's one-sentence reason for grouping it. The prompt asks for each title as `label`, and the prompt is carried over word for word, so the reply's `label` becomes `title` as the reply is read; nothing past the reply calls it a label. A re-launched stage keeps the run files already written and makes only the missing ones.

A send can fail in four ways: no reply, a reply that is not JSON, a reply of the wrong shape, or start words that cannot be found. Start words that cannot be found count as a wrong shape, so all four take the panel's retry: up to three sends for one run, then the stage fails. A division missing a cut would cast a wrong vote on that cut site, and the principle is to fail loudly rather than record a partial result.

#### `deepen-subtopic-splitting`

**Input:** `Transcript/transcript.txt`, `Initial subtopics/run-*.json`
**Output:** `Deepened subtopics/run-01.json` … `run-18.json`

For each splitting run, every subtopic over the size gate is sent on its own with the `d13` prompt, which asks whether it divides further and, if so, where. The reply is either "one step" or a list of cuts, and a cut is looked for only inside the subtopic it was proposed for, so deepening can add cuts but never move or remove one. A cut that cannot be found there is dropped rather than guessed at, and the rest of the reply is kept; the prototype found every cut in 1,488 sends. Subtopics at or under the size gate are never sent and cannot be disturbed. There are at most two rounds. When the first round cut anything, the second sends every subtopic still over the gate — a piece just cut, and also a subtopic the model called one step the first time. Asking that subtopic again looks redundant but makes the vote steadier: a cut the model makes only some of the time gets a second chance, which moves its cut site away from the bar instead of leaving the vote to chance. Across the prototype's eight lectures, measured with `d9`, two panels of nine disagreed on 3.9 cut sites this way against 9.2 when only cut pieces went back, for about a fifth more calls (`docs/quality/segmentation-prototype/LATER-ROUNDS.md`). When the first round cut nothing, a second would ask the same questions again, so there is none. Word counts are made by code.

`d13` is `d9`, the prompt it extends, plus one instruction: judge a boundary by whether someone who knows the field would say the subject has moved on, whether or not the lecturer marks it. It was chosen over `d9` because two panels of nine disagreed on fewer cut sites (3.3 against 3.9 across the eight lectures) and grouping on its divisions gave better topics and titles, judged by reading them; the topic rulings do not settle this, because a ruling can change once the titles are seen. It makes more errors against the prototype's subtopic rulings (5.6 against 5.0 across the eight lectures), several at cut sites marked unwanted by default rather than judged (`docs/quality/segmentation-prototype/AGGREGATION.md`).

**Inherited titles are not marked.** A cut is given a title for the piece it starts, but the piece before the first cut keeps the title of the whole subtopic it was cut from, which can promise material the later pieces now hold (CONTEXT.md, "Inherited title"). Nothing records which titles those are: `retitle-subtopics` replaces every title, so no stage needs to know.

A call that fails — no reply, not JSON, the wrong shape — takes the panel's retry, and a subtopic that fails all three sends fails the stage. Leaving it whole would record "this subtopic is one step", which the model never said, and the vote would count it.

Within a run, the subtopics of a round are sent together, as many at once as the stage's `callConcurrency` allows (§6); unset, one at a time. Each reply is put back in its subtopic's place, so how many are sent at once never changes the deepened splitting run. The second round waits for the first, because it sends what the first round left. Runs are bounded separately by the stage's `concurrency`, so at most `concurrency` × `callConcurrency` calls are in flight: one run can have a dozen subtopics over the gate, and too many calls at once overload the provider. When a subtopic fails every send, no further subtopic of that run is sent; the calls already in flight are let finish before the stage fails. Each deepened splitting run is saved as soon as it is complete, and a relaunched stage makes only the missing ones.

#### `choose-division`

**Input:** `Transcript/transcript.txt`, `Deepened subtopics/run-*.json`
**Output:** `Chosen division/subtopics.json`

Makes no model call. The panel votes on where the transcript divides, and the deepened splitting run nearest the vote is handed on whole.

**The vote.** The cuts of all the deepened splitting runs are pooled and sorted by position, and grouped into cut sites: a cut belongs to the current cut site when it lies within one percent of the transcript's length of that site's **first** cut, and otherwise opens a new one. Measuring from the first cut rather than the latest stops a site growing cut by cut until it has swallowed a neighbour. A run cuts at a cut site when any of its cuts lies between the site's first and last cut widened by half a percent of the transcript's length each way, so a cut just outside the site still counts for it, and one cut can count for two sites close together; this is the prototype's rule, kept exactly so the stage chooses what the prototype chose. A cut site's support is the number of runs that cut at it; one with support of at least `bar` is kept. The vote is the set of kept cut sites. It is never written out as a division of its own: it is what the runs are measured against.

**Choosing the run.** Each run's division is read as the set of cut sites it cuts at. Its distance from the vote is the number of cut sites where one of the two cuts and the other does not, and the run with the smallest distance is chosen. A tie goes to the tied run closest to all the others — its distance to each other run's division, summed — and then to the earliest run, so the same panel always yields the same division. `group-into-topics` chooses its grouping by a rule of its own (below), which uses closeness to the vote only to break a tie; the two stages share the vote and the distance from it — given each run as a set of positions and a bar — and not the chooser.

A whole run is one reading of the lecture: every boundary, title and reason in it comes from the same run. The vote alone can put together a division no run made, whose titles would come from different runs. On the prototype's `d13` runs the nearest run is as steady and as accurate as the vote itself: two panels of nine disagree on 3.34 cut sites across the eight lectures against the vote's 3.26, and a panel makes 3.09 errors against the user's rulings against the vote's 3.03 (`docs/quality/segmentation-prototype/AGGREGATION.md`).

**What is written.** `Chosen division/subtopics.json` holds the chosen run's subtopics as it saved them: each one's span, title and reason. Beside it, `Chosen division/choice.json` records which run was chosen (counting from 1), its distance from the vote and the panel size (§4.5, "How a result was reached is kept beside the result"), which marks a lecture where even the nearest run is far from what the panel agreed.

The stage fails when fewer than `panelSize` deepened splitting runs are present.

```typescript
// src/pipeline/stages/division.ts — shared by the division stages and retitle-subtopics
type Subtopic = { start: number; end: number; title: string; reason: string }
placeCuts(args: { text: string; startWords: readonly string[] }):
  { cuts: readonly number[] } | { unplaced: string }
// Finds each subtopic's start words in turn, forward from the previous cut, and returns where each subtopic
// starts — the first always at 0, whatever its start words. The first start words that cannot be found are
// returned instead.
sliceSubtopics(args: { text: string; cuts: readonly number[]; titled: readonly { title: string; reason: string }[] }): readonly Subtopic[]
assertLossless(args: { text: string; subtopics: readonly Subtopic[] }): void
subtopicText(args: { text: string; subtopic: Pick<Subtopic, "start" | "end"> }): string
readDivision(value: unknown): readonly Subtopic[] | null   // a run file read back, keeping only what a subtopic holds
type ReplySubtopic = { label: string; groupedBecause: string; startsWith: string }
isReplySubtopic(value: unknown): value is ReplySubtopic   // one subtopic or cut as a reply names it; `label` is the prompt's word

// src/pipeline/stages/stage-input.ts — shared by the stages that read the transcript or an earlier stage's division
readStageText(args: { context: StageContext; stageId: StageWithOutputFile; purpose: string; fail: (message: string) => Error }): Promise<string>
// The earlier stage's output as written; a missing or blank file throws the error `fail` builds from the message.
readTranscript(args: { context: StageContext; fail: (message: string) => Error }): Promise<string>
// The transcript, with the whitespace at its two ends removed.
readStageDivision(args: { context: StageContext; stageId: StageWithOutputFile; purpose: string; fail: (message: string) => Error }): Promise<readonly Subtopic[]>
// The division an earlier stage wrote as its output — what retitle-subtopics reads from choose-division. A missing,
// blank or non-JSON file, or one that is not a list of subtopics, throws the error `fail` builds.

// src/pipeline/stages/stage-output.ts — shared by choose-division and retitle-subtopics, whose output is a division
type DivisionOutput = { subtopics: readonly Subtopic[] }
writeDivisionWithStageRecord(args: { stageId: StageWithStageRecord; context: StageContext; subtopics: readonly Subtopic[]; stageRecord: unknown; cost: StageCost | null }):
  Promise<StageResult<DivisionOutput>>
// Writes the division and its record beside it (§4.5) and gives the stage's result.
readTranscriptAndRuns(args: { context; panelStage: "initial-subtopic-splitting" | "deepen-subtopic-splitting"; fail }):
  Promise<{ transcript: string; runs: readonly (readonly Subtopic[])[] }>
// The transcript and the whole panel an earlier splitting stage saved — what deepening and choose-division start
// from. A missing run is the error `fail` builds, telling the user to run that stage first.
readTranscriptAndDivision(args: { context; stageId: StageWithOutputFile; purpose: string; fail }): Promise<TranscriptAndDivision>
// The transcript and the division an earlier stage wrote — what retitle-subtopics and group-into-topics start from.

// src/pipeline/stages/division.ts
splittingPanel(context: StageContext): { panelSize: number; readRun }
// A splitting panel's size (the division's) and its run reader, for the two stages that make one and the reader above.

// src/pipeline/stages/panel-runs.ts — shared by the panel stages
runStagePanel<TRun>(args: { stageId: StageId; context: StageContext; panelSize: number; readRun; makeRun }): Promise<StageResult<{ runs: readonly TRun[] }>>
// Makes the stage's panel in its own directory at its configured concurrency; a run needing no call reports no cost.
// The panel's size is the caller's: the splitting stages pass the division's, group-into-topics the grouping's.
runOneCallPanel<TReply, TRun>(args: { stageId; context; panelSize; readRun; runName: string; calls: StageModelCalls; request }): Promise<StageResult<{ runs: readonly TRun[] }>>
// runStagePanel where every run is the same one JSON call: initial-subtopic-splitting and group-into-topics.
readPanel<TRun>(args: { panelSize: number; directory: string; readRun; fail }): Promise<readonly TRun[]>
// readRun reads a parsed run file as a run, or gives null when it is not one, which is a named error.
// Reads back a panel an earlier stage finished; a missing run throws the error `fail` builds.
panelDirectory(args: { workspaceRoot: string; stageId: StageId }): string

// src/pipeline/stages/model-stage.ts — shared by every model-calling stage
sendJsonWithResends<TReply, TKept>(args: JsonReplyRequest<TReply> & { what: string; use }): Promise<UsableJsonReply<TKept>>
// tryJsonReplyAs, resent until usable: every call the splitting, retitling, grouping and title-judging stages make.
// The third unusable reply is a ResendsExhaustedError.
type StageModelCalls = { requestJsonReply; sendJsonWithResends }
// A stage's run gets these as `calls`. defineModelStage gives them the stage id, the stage context, the logger,
// the client and the send gate of the stage run. So a stage passes only its own part of each request.

// src/pipeline/stages/panel-vote.ts — shared by choose-division and group-into-topics
panelVote(args: { runs: readonly (readonly number[])[]; bar: number }): readonly number[]
// The positions whose support reaches the bar. Pure: each run as the positions it marks (cut sites, or
// subtopics starting a topic), in run order.
distanceFromVote(args: { run: readonly number[]; vote: readonly number[] }): number
// The positions where one of the two marks and the other does not.

// src/pipeline/stages/choose-division/choose-division.ts
type DivisionChoice = { chosenRun: number; distanceFromVote: number; panelSize: number }
// chosenRun counts from 1, as the run files are numbered.
chooseDivision(args: { text: string; runs: readonly (readonly Subtopic[])[]; bar: number }):
  { subtopics: readonly Subtopic[]; choice: DivisionChoice }
// Groups the runs' cuts into cut sites and chooses the run nearest the vote over them.
// Pure: the panel's runs in, in run order; the chosen run's subtopics and how it was chosen out.
```

---

### `retitle-subtopics` — a title of its own for every subtopic

**Input:** `Transcript/transcript.txt`, `Chosen division/subtopics.json`
**Output:** `Retitled subtopics/subtopics.json`

Gives every subtopic of the chosen division a new title from its own text (CONTEXT.md, "Retitling"). Only titles change: no cut moves, and the transcript is untouched. It runs before `group-into-topics`, which groups on the new titles (below). Deepening leaves some subtopics with a title written for the larger piece they were cut from (CONTEXT.md, "Inherited title"); rather than find those, every title is replaced, so the whole lecture is titled in one pass to one standard.

The prompt is the prototype's `r9`, carried over word for word. It asks for the most precise short description of what each subtopic covers, written for a science undergraduate, and for a subtopic that recaps earlier material to be titled as a summary and the lecture's closing part as its summary or close. Its model is set per stage (§6); the prototype's is `openai/gpt-6.1-sol-pro`, sent no reasoning-effort setting, so the provider's default applies. The user judged its titles precise and stable enough across repeated runs to rely on one (`docs/quality/segmentation-prototype/RETITLING-AND-REVERSE-GROUPING.md`).

**One call for the whole lecture.** The model is sent every subtopic in order, each as its subtopic id and its full text, trimmed, and not its old title. It replies with one title per subtopic, each paired with its subtopic id. A reply is valid when it holds exactly one non-blank title for every subtopic, in order, with no position missing, repeated or out of range. Anything else is a wrong shape and is resent, as a panel run's is (§5, "Dividing the transcript", Panel runs); after the third send the stage fails. There is no panel: one run is enough.

**What is written.** `Retitled subtopics/subtopics.json` holds the whole chosen division with every title replaced; spans and reasons are copied as they were. The old titles stay in `Chosen division/subtopics.json`, so the two can be read side by side. Beside it, `Retitled subtopics/changes.json` records how many subtopics there are, how many titles changed, and each changed title as its subtopic id, the old title and the new; a new title identical to the old one is not a change (§4.5). The call costs about $0.06 per lecture.

No check step follows: the stage writes only titles, as the splitting stages do, and no title is checked anywhere in the pipeline.

The stage fails when the chosen division's subtopics are missing or unreadable, and when the call fails its third send.

---

### `group-into-topics` — grouping subtopics into topics

**Input:** `Transcript/transcript.txt`, `Retitled subtopics/subtopics.json`
**Output:** `Grouping runs/run-01.json` … `run-05.json`, `Topics/topics.json`

Groups the retitled subtopics into topics. The same subtopics given to the same prompt twice can come back grouped differently, so grouping is done by a panel and one grouping is chosen from it. The prompt is the prototype's `g23`, carried over word for word in the form that shows the model each subtopic's title. `g23` is `g15` with one change to how the model reads: it goes through the subtopics from last to first, noting each place where there is a change, before deciding where topics begin; `g15` in turn is `g12` plus a rule that a subtopic only looking back — a summary or recap — ends the topic before rather than starting one. Its model is set per stage (§6); the prototype's is `openai/gpt-6.1-sol-pro`, sent no reasoning-effort setting, so the provider's default applies. The user judged all 32 of the prototype's `g23` groupings acceptable — four runs on each of the eight lectures, grouping the `r9` titles — and the four runs placed 93.2% of the 133 borders between subtopics the same way (`docs/quality/segmentation-prototype/RETITLING-AND-REVERSE-GROUPING.md`).

Grouping sees the new titles, not the chosen run's own. An earlier design grouped before retitling, because replacing inherited titles made `g15` on `google/gemini-3.7-flash` lose a ruled topic start on lecture 4. That finding was for `r3` titles on that model; with `r9` titles on `openai/gpt-6.1-sol-pro`, `g15` found every ruled topic start on lecture 4, along with starts the rulings did not make.

This stage only groups. The next stage, `judge-lecture-title`, reads the chosen topics to judge the provisional title.

**One grouping run.** The model is sent every retitled subtopic in order, each as its subtopic id, its title and its full text, trimmed; the prompt calls a title a `label`, so it is sent under that name. It replies with a list of topics, each a title (the reply's `label`, read as `title`), a one-sentence `groupedBecause`, and the subtopic id of its first subtopic, so a topic can only begin where a subtopic does and the text cannot be touched. A reply is valid when it is a JSON object with a non-empty list of topics; every topic has a non-empty title, a non-empty `groupedBecause` and a first subtopic; the first topic starts at subtopic 1; each later start comes after the one before; and no start is past the last subtopic. Together these put every subtopic in exactly one topic. Anything else is a wrong shape and takes the panel's retry (§5, "Dividing the transcript", Panel runs). The finish reason the provider reports is not one of the checks: `openai/gpt-6.1-sol-pro` sometimes reports `error` on a complete reply, and four such `g23` replies are among those the user accepted. Each run is saved with the reply's `label` as `title`, as the chosen topics are written.

**Sending.** The nine runs are released together, and every send waits until at least `sendGapSeconds` after the stage's previous send (Panel runs, above). In the prototype, several `openai/gpt-6.1-sol-pro` calls at once were taken to be rate-limited upstream, though no refusal message was kept to show it; spacing the sends keeps first sends and resends from landing together, and a refused send is resent (§6, "A rejection can arrive inside an accepted reply"), so a rate limit costs a pause rather than the stage.

**The chosen grouping.** Each run is read as the set of subtopics it starts a topic at, the first excepted; two runs made the same grouping when their topics start at the same subtopics, whatever they named them. The grouping made by the most runs is chosen. When two or more groupings share the most runs, each made by more than one run, the one with more topics wins. When no grouping was made by more than one run, or the tied groupings have as many topics, the one whose topic starts differ least from the vote wins, and then the earliest run (CONTEXT.md, "Chosen grouping"). More topics is not asked when every run differs, because it would then pick the most finely divided run of the panel with nothing but that run behind it. The vote is the set of subtopics where at least `bar` runs start a topic, reckoned with the vote and distance `choose-division` uses. The topics handed on are the earliest run's among those that made the chosen grouping, so its titles are one reading of the lecture; the vote is never handed on, since it could assemble a grouping no run made.

The panel is 9 runs and the bar 5, more than half the panel. Some stretches of a lecture are a close call for the model, and which way single runs lean shifts with small changes of title wording and from one batch of sends to the next; on such a stretch a panel of 5 still chose a grouping the user rejects about once in fifteen panels, where 9 brought that to about once in seventy or fewer (`docs/quality/segmentation-prototype/PANEL-RISK.md`). Each run costs about $0.06, so the panel about $0.54 per lecture.

**What is written.** `Topics/topics.json` holds each topic of the chosen run as its title, its `groupedBecause`, and the subtopic it starts at. Beside it, `Topics/choice.json` records the chosen run, how many of the panel's runs made its grouping, and which rule decided — most runs, more topics, closest to the vote, or earliest run (§4.5) — so a lecture whose grouping rests on a tie can be seen at a glance.

**Configuration.** `panelSize` (9) and `bar` (5) live in a required `grouping` section of `pipeline-config.json`, separate from the division's, so one may be tuned without the other. `sendGapSeconds` (0.5) is on the stage's own entry (§6).

The stage fails when the retitled subtopics are missing or unreadable, and when a run fails its third send.

```typescript
// src/pipeline/stages/group-into-topics/choose-grouping.ts
type Topic = { title: string; groupedBecause: string; firstSubtopicId: number }
type GroupingRun = { topics: readonly Topic[] }
type GroupingChoice = {
  chosenRun: number                 // counts from 1, as the run files are numbered
  support: number                   // how many runs made the chosen grouping
  panelSize: number
  decidedBy: "most-runs" | "more-topics" | "closest-to-vote" | "earliest-run"
}
chooseGrouping(args: { runs: readonly GroupingRun[]; bar: number }): { topics: readonly Topic[]; choice: GroupingChoice }
// Pure: the panel's runs in, in run order; the chosen run's topics and how it was chosen out.
```

---

### `judge-lecture-title` — judging the lecturer's title

**Input:** `Transcript/transcript.txt`, `Retitled subtopics/subtopics.json`, `Topics/topics.json`, and the provisional title from the stage context
**Output:** `Title judgement/judgement.json`
**Conditional side effect:** The stage renames the source video, the source slide, the workspace folder and any `Final output/` PDF. It does this only when the model judges the provisional title not meaningful and no user title is set.

The stage judges whether the provisional title is meaningful for the lecture's content (CONTEXT.md, "Judging the lecture title"). A title that the lecturer wrote is authoritative. So the model keeps a meaningful title and proposes nothing. The model proposes an AI-derived title only when the provisional title is not meaningful: empty, generic, or in conflict with the content.

**The input.** The stage sends the model the whole lecture as JSON. Each topic of the chosen grouping holds its title and its subtopics, in order. Each subtopic holds its retitled title and its full text, trimmed:

```json
{ "topics": [ { "title": "…", "subtopics": [ { "title": "…", "text": "…" } ] } ] }
```

The retitled subtopics hold only the span of each subtopic in the transcript. So the stage reads `Transcript/transcript.txt` and cuts the text of each subtopic from it, as `retitle-subtopics` and `group-into-topics` do. It sends no subtopic ids and no reasons, because they do not help the judgement. The stage also sends the provisional title. An empty provisional title is sent as a statement that the filename carried no title.

**The prompt** is the title part of the prompt that `transcript-structuring` used before this stage existed. It keeps the same rules. The lecturer's title is authoritative. The model must not propose a title only because it can write a better one. An AI-derived title has four to eight plain words, because it becomes a filename. The prompt adds these things:

- It tells the model the shape of the input. It also tells the model that a model wrote the topic titles and subtopic titles, and the lecturer did not.
- An AI-derived title names what all the topics have in common. It is not a list of the topics, and it is not the title of one topic.
- It asks for a one-sentence reason.
- It applies `languageRule` (§6) to the AI-derived title, because the title becomes the lecture's file names and the heading of its notes.

**The reply** is a JSON object with three fields: `provisionalTitleMeaningful` (true or false), `suggestedTitle` (a title, or null), and `judgedBecause` (one sentence). The stage reads `suggestedTitle` as the AI-derived title. A reply is unusable in each of these cases:

- It is not a JSON object with those fields and types.
- `judgedBecause` is empty.
- The provisional title is not meaningful, and `suggestedTitle` is null or empty.
- The provisional title is not meaningful, and `suggestedTitle` gives no base name that a filename can use (§4.4, `filenameSafe`).
- The provisional title is empty, and the model judges it meaningful.

When the provisional title is meaningful, the stage ignores any `suggestedTitle`. The stage resends an unusable reply in the same way as a panel run. It fails after the third send (§5, "Dividing the transcript", Panel runs).

**One call, not a panel.** The stage makes one call. A panel would need a rule to choose one title from several proposed titles. If real lectures show that the judgement changes from one call to the next, a panel can be added later.

**The model** is set on the stage's own entry (§6). It is `openai/gpt-6.1-sol-pro`, with no reasoning-effort setting, as for `group-into-topics`. One call sends about 33,000 prompt tokens. Nine calls on the lectures of one module cost $0.038 to $0.061 each, and $0.051 on average.

**The three outcomes.**

| Title judgement | `outcome` | Action |
|---|---|---|
| Provisional title meaningful | `kept-provisional` | `aiDerivedTitle` becomes `null`. If no user title is set, `lectureTitle` becomes `provisionalTitle`, and `baseName` follows it. The lecture files move only when an earlier run gave the lecture another name. |
| Not meaningful, and no user title | `adopted-derived` | `aiDerivedTitle` and `lectureTitle` take the proposed title. The source video, the source slide, the workspace folder and any `Final output/` PDF move to the new base name. `baseName` changes in the manifest. |
| Not meaningful, and a user title is set | `kept-user-title` | Only `aiDerivedTitle` takes the proposed title. `lectureTitle` and every name on disk stay. |

**A user title outranks the judgement.** A user title is set through `rename`, and it wins the title precedence (§5, `source-normalisation`). The stage still calls the model and records the AI-derived title. That title is a true record of what the model proposed. It is also the title that the lecture falls back to if the user title is cleared.

`context.lectureTitle` is always non-null (§4.2). `source-normalisation` seeds it, and `judge-lecture-title` can overwrite it. Later stages use it with no null check.

**What is written.** `Title judgement/judgement.json` holds five fields:

- `provisionalTitle`: the title that the model judged. It can be empty.
- `provisionalTitleMeaningful`: true or false.
- `aiDerivedTitle`: the proposed title, or `null` when the provisional title is meaningful.
- `judgedBecause`: the model's reason.
- `outcome`: `kept-provisional`, `adopted-derived` or `kept-user-title`.

The file shows at a glance why a lecture has a new name. The debug log records the same outcome (§10).

#### Order of Operations

`judge-lecture-title` is the only per-lecture stage that moves its own workspace. The runner writes the manifest in the workspace as soon as the stage returns (§4.7). So the order is fixed:

1. Make the call, check the reply, and resend an unusable reply.
2. Write `Title judgement/judgement.json` atomically (§4.3).
3. Decide the identity changes that the stage returns. For `kept-user-title`, there is only `aiDerivedTitle`. For `adopted-derived`, there are `aiDerivedTitle`, `lectureTitle` and `baseName`. For `kept-provisional`, there are only the fields that differ from the provisional title's identity. In most lectures there are none. `lectureBaseName` builds the base name from the title (§5, `source-normalisation`).
4. When the changes include `baseName`, move the source video, the source slide, any `Final output/` PDF and the workspace folder with `renameLectureFiles` (§4.7).
5. Return the changes on `StageResult.identityChanges`. The runner finds the workspace again by `(moduleRoot, lectureDate)`. Then it writes the changes into the manifest with the stage's `complete` entry (§4.2, §4.7).

The stage writes no manifest of its own (§4.2). From the move in step 4 until the runner's write in step 5, the manifest names the old folder. The stage is marked `running` for that time. So if the launch stops, the next launch runs `judge-lecture-title` again. That run makes a new call, and the new call can propose a different title. `renameLectureFiles` finds the lecture files by their date, so it moves them from wherever the first run left them.

The move is the last step because step 2 writes into the workspace. The folder must still be where the stage was told it is. `filesWritten` is relative to the workspace (§4.5), so the output path is still true after the move.

```typescript
// src/pipeline/stages/judge-lecture-title/judge-lecture-title.prompt.ts
type GroupedLecture = { topics: readonly { title: string; subtopics: readonly { title: string; text: string }[] }[] }
buildTitleJudgementMessages(args: { lecture: GroupedLecture; provisionalTitle: string;
  language: OutputLanguage }): readonly ChatCompletionMessageParam[]
// The title judgement rules above, as messages. The messages ask for the JSON object, which JSON mode requires (§6).

// src/pipeline/stages/judge-lecture-title/judge-lecture-title.ts
type TitleJudgement = { provisionalTitle: string; provisionalTitleMeaningful: boolean; judgedBecause: string } & (
  | { outcome: "kept-provisional"; aiDerivedTitle: null }
  | { outcome: "adopted-derived" | "kept-user-title"; aiDerivedTitle: string }
)
createJudgeLectureTitleStage(args: { logger: Logger; client: OpenAI }): PipelineStage<GroupedLecture, TitleJudgement>
// Throws JudgeLectureTitleError when the transcript, the retitled subtopics or the topics are missing or unreadable,
// or when the third send gives an unusable reply. An unknown cost is not a failure (§7).
```

---

### `render-slides` — an image of each slide

**Input:** `Source files/Slide decks/<base name>.pdf`
**Output:** `Slide images/slide-001.png`, `slide-002.png` and so on, one for each page

The stage renders each page of the slide deck as one PNG image at 150 DPI, with `pdfjs-dist` and `canvas`. The images are numbered from 1 in deck order. The stage makes no model call, so its cost is `null` (§4.2).

The notes show a slide as one whole image (CONTEXT.md, "Slide"). No figure is cut out of a slide. A vision model gives imprecise position boxes, so a crop can lose an axis label or take part of the text beside the figure. A whole slide is always complete.

The stage fails when the slide deck is missing, or when `pdfjs-dist` cannot read it. The error names the file.

---

### `read-slides` — what each slide holds

**Input:** `Slide images/slide-001.png` and the rest
**Output:** `Slide readings/slide-001.json` and so on, one for each slide

A vision model reads each slide image and returns one slide reading (CONTEXT.md, "Slide reading"). The stage makes one call for each slide. The stage's `concurrency` sets how many calls are in flight at once (§6).

The stage does not take the text from the PDF. Biology slides hold pathway diagrams, tables, formulas and micrographs. A text-extraction library puts columns in the wrong order and loses the structure of a table. A vision model reads a slide as a person does.

**The model reads the slide alone.** The call sends the slide image, the slide number and the number of slides in the deck. It sends no transcript and no lecture title. So a reading says only what is on the slide.

**The reply** is a JSON object with five fields:

- `title`: the slide's title, as the slide writes it. It is empty when the slide has no title.
- `text`: all the text on the slide, word for word. Tables are Markdown tables, and formulas are LaTeX. It is empty when the slide has no text.
- `diagrams`: one description for each diagram, chart or picture, with its parts, labels, arrows and relationships. The list is empty when the slide has none.
- `caption`: one or two sentences that tell a reader what the slide shows.
- `kind`: `subject-matter`, `content-free` or `references` (CONTEXT.md, "Content-free slide").

The prompt applies `languageRule` (§6) to the caption. The title and the text keep the slide's own spelling.

A reply is unusable in each of these cases:

- It is not a JSON object with those fields and types.
- `caption` is empty.
- `kind` is not one of the three values.

The stage resends an unusable reply in the same way as a panel run. It fails after the third send (§5, "Dividing the transcript", Panel runs).

**What is written.** The stage writes each reading to its own file as soon as the reply is usable. The file holds `slideNumber` and the five fields of the reply. A stage that failed and starts again reads only the slides that have no reading. A panel stage makes only its missing runs in the same way. `--from-stage read-slides` clears `Slide readings/`, so every slide is read again.

The stage fails without a model call when `Slide images/` is missing or holds no image. It also fails when a slide's third send is unusable. Then the stage sends no further slide. The calls in flight finish, and the stage keeps their readings.

**The model** is set on the stage's own entry (§6). It must accept images.

---

### `place-slides` — each slide with its subtopic

**Input:** `Transcript/transcript.txt`, `Retitled subtopics/subtopics.json`, `Slide readings/`
**Output:** `Slide placements/placements.json`

The stage puts each subject-matter slide with the subtopic where the lecturer discusses it (CONTEXT.md, "Slide placement").

**One call for the whole lecture.** The model gets every subtopic in order, as its subtopic id, its title and its full text, trimmed. The retitled subtopics hold only spans, so the stage cuts each text from the transcript, as `judge-lecture-title` does. The model also gets every reading in deck order, as its slide number, kind, title, text and diagram descriptions. Content-free slides and references slides are in the list. A section divider shows where the lecture moves on, so it helps the model to place the slides around it.

**The reply** is a JSON object with a list `placements`. Each entry holds a `slideNumber` and a `subtopicId`. The model gives one entry for each subject-matter slide. The stage ignores an entry for a content-free slide or a references slide. A reply is unusable in each of these cases:

- It is not that shape.
- A subject-matter slide has no entry, or more than one.
- An entry names a slide or a subtopic that does not exist.
- A slide's subtopic is earlier than the subtopic of the subject-matter slide before it in the deck.

The stage does not repair a reply, because a repair must guess which slide is wrong. The stage resends an unusable reply in the same way as a panel run. It fails after the third send (§5, "Dividing the transcript", Panel runs).

**Deck order is a rule.** Lecturers show their slides in order. Without the rule, a model can put a slide where its words match the speech, far from where the lecturer showed it. A slide that the lecturer goes back to stays at its first place.

**References slides.** The code puts each references slide with the lecture's last subtopic. The deck-order rule does not apply to references slides. Otherwise a references slide in the middle of a deck would force every later slide into the last subtopic.

**Content-free slides** get no place, and the notes do not show them (CONTEXT.md, "Content-free slide").

**One call, not a panel.** If real lectures show that placements change from one call to the next, a panel can be added later.

**What is written.** `Slide placements/placements.json` holds a list `placements`, with one entry for each placed slide in deck order. Each entry holds `slideNumber` and `subtopicId`.

The stage fails without a model call when the transcript, the retitled subtopics or a reading is missing or unreadable. The error names the file. The stage also fails when the third send is unusable.

#### Gaps in the slide stages

- No checker compares a reading with its slide, or a placement with the transcript. The design gives a checker to every stage that transforms content (README, "Design philosophy"). For the slide stages, the user's own look at one lecture's placements is the first check.
- `place-slides` makes one call. It has no panel.
- No built stage shows the slides with the text. A test page, which a script outside the pipeline builds, shows them.

---

### `transcript-structuring` — Transcript Structuring

**Input:** `Transcript/transcript.txt`
**Output:** `Structured transcript/structured-transcript.md`

`transcript-structuring` makes one JSON-mode call. The reply is `{ structuredMarkdown: string }`. The stage does not judge the title. `judge-lecture-title` does that before this stage runs.

#### Transcript Structuring

The LLM call produces the structured markdown. The LLM:
- Identifies topic boundaries from discourse markers ("Now, moving on to…", "To summarise…")
- Applies H2 headings for major topics, H3 for sub-topics
- Removes filler words only (um, uh, sort of, you know) — all substantive content preserved
- Converts spoken mathematics to LaTeX where detectable
- Marks Q&A sections as `> **Q&A:**` blockquote
- Does not add content not present in the transcript
- Writes in the configured `finalOutput.language` (§6)

The last rule controls how the transcript's words are spelled. The rule above it controls which words are there. Speech has no spelling. The transcript's spelling is the transcriber's, and `transcription` cannot change it. ElevenLabs' `languageCode` takes an ISO-639-1 or ISO-639-3 code, and neither can express a regional variant. So `eng` names English and nothing more. A model call is therefore the first point in the pipeline where the output's language can be chosen. `judge-lecture-title` is the first stage that applies the rule, to the AI-derived title. `transcript-structuring` is the first stage that applies it to prose. `languageRule` (§6) gives the wording of the rule, so that every stage gives the model the same instruction.

**Context:** A 90-minute transcript is typically 15,000–30,000 tokens — a single call within any 128k-context model.

```typescript
// src/pipeline/stages/transcript-structuring/transcript-structuring.prompt.ts
buildStructuringMessages(args: { transcriptText: string;
  language: OutputLanguage }): readonly ChatCompletionMessageParam[]
// The structuring rules above, as messages. The messages ask for the JSON object, which JSON mode requires (§6).

// src/pipeline/stages/transcript-structuring/transcript-structuring.ts
type TranscriptStructuringInput = { transcriptText: string }
type TranscriptStructuringOutput = { structuredTranscriptPath: string }
createTranscriptStructuringStage(args: { logger: Logger }): PipelineStage<TranscriptStructuringInput, TranscriptStructuringOutput>
// Throws TranscriptStructuringError when the transcript is missing or empty, or when the reply is not the
// documented JSON object. An unknown cost is not a failure (§7).
```

---

### `transcript-verification` — Transcript Verification

**Input:** `Transcript/transcript.txt` and `Structured transcript/structured-transcript.md`
**Output:** `Transcript verification/verification-report.json`, and `Transcript verification/verification-report.md` beside it

`transcript-structuring` rewrites a transcript. `synthesis` reads the structured transcript and not the raw one, so from `synthesis` onwards the structured transcript *is* the lecture. So content that `transcript-structuring` drops cannot come back later. No other stage can see that the content is lost. `synthesis` checks the notes against the structured transcript, so it cannot see content lost before that point. This stage is the one place where the two versions are side by side.

It makes a single JSON-mode call carrying both texts, and writes back a `QaCheckerReport` (§4.1, `src/types/pipeline.ts`) — everything a checker is in a position to say, with no iteration number, because this stage runs once and the number belongs to the QA loop that calls its checker repeatedly. The report holds the findings, each with its severity, category, the source passage it is about and where it belongs in the output, plus the `considered` list of what the checker examined and cleared. Only the faithfulness categories are offered — `omission`, `underexplained`, `distortion`, `unsourced-addition`, `other` — because this stage compares two transcripts and has no notes to judge the prose of (`qa-loop`).

**It reports; it never gates.** No verdict fails the stage, ends the run, or changes the exit code, and no severity blocks anything downstream. A lecture whose structured transcript is poor still produces notes and a PDF, and the report is how the user finds out. This is deliberate and is the first half of a two-step plan: a checker has to be shown to be right about a corpus before anything is allowed to act on what it says, and a checker that can stop a run is one whose false positives cost a user their run. A revision loop becomes possible once the reports are trusted; until then the cost of the stage being wrong is a file nobody has to read.

**Tuning is left unset on purpose.** The stage's config entry writes `temperature` and `maxTokens` as `null`, so the only parameter the request carries is the reply format. Under `require_parameters` (§6) every parameter in a request narrows which endpoints may serve it, and a stage whose calls are this long is the worst place to discover that the tuning pinned routing to a provider refusing the account — which is exactly how a `404 No endpoints found that can handle the requested parameters` and a run of `503`s were produced during user testing. No token cap also means no truncated report: the reply length follows the number of findings, which is not known in advance and is largest precisely when the report matters most.

**The prompt is the assessment method, not a new one.** The checker's instructions are the prompt that produced the assessments committed in `docs/quality/`, carried over verbatim with only a reply contract appended, so what the stage does automatically is what was already shown to work by hand. Changing the method and changing the medium at the same time would leave no way to tell which one moved the findings.

**The findings are also written as a document.** `verification-report.md` carries the same report as a page a person reads without a JSON viewer: a heading line with the verdict, the coverage score and how many findings there are; a table of how many findings fell into each category; then the findings themselves, grouped by category with distortions first and ordered critical to minor inside each group, each showing the passage of the source it is about, where that passage sits, and where in the structured transcript the fault is; and last, everything the checker examined and cleared. A report with no findings still produces the document, saying so.

The rendering is ours and is derived from the report already on disk, never from a second call. Two consequences follow. The two files cannot disagree, because one is a projection of the other. And the model is never asked to be good at judgement and at prose in the same breath — the priority order a reader sees comes from the severity the checker assigned, not from a second opinion about what matters.

**The verification report Markdown is temporary.** It exists because the checker is being calibrated by hand: its reports are read, compared against the assessments in `docs/quality/`, and argued with, and a JSON file is the wrong medium for that. Once a checker is settled on, nobody reads these by eye and the stage goes back to writing the one machine-readable file — at which point `verification-report.md`, the renderer, and the layout's `markdownVersion` come out together.

```typescript
// src/pipeline/stages/transcript-verification/transcript-verification.prompt.ts
buildVerificationMessages(args: { transcriptText: string; structuredTranscriptText: string }):
  readonly ChatCompletionMessageParam[]
// The assessment method, with the reply contract appended. Asks for the JSON object in the prompt as well
// as through `responseFormat`, which JSON mode requires (§6).

// src/pipeline/stages/transcript-verification/transcript-verification.view.ts
renderVerificationReport(args: { report: QaCheckerReport }): string
// The report as the document described above. Pure: it is handed the stored report and returns text, calls
// nothing, and reads no file — which is what makes every ordering and counting rule testable on its own.
// Total over `QaDeficiencyType` rather than over the five categories this checker is offered, so the QA loop's
// wider vocabulary could not produce a finding it silently drops.

// src/pipeline/stages/transcript-verification/transcript-verification.ts
type TranscriptVerificationInput = { transcriptText: string; structuredTranscriptText: string }
type TranscriptVerificationOutput = { verificationReportPath: string; deficiencyCount: number }
createTranscriptVerificationStage(args: { logger: Logger; client: OpenRouterClient }):
  PipelineStage<TranscriptVerificationInput, TranscriptVerificationOutput>
// Throws TranscriptVerificationError when either input file is missing or empty, or when the reply is not
// the documented report. A report full of findings is not a failure — that is the stage working.
```

---

### `synthesis` — Synthesis

**Inputs:**
- `Structured transcript/structured-transcript.md`
- `Slide readings/`
- `Slide placements/placements.json`

**Output:** `Synthesised notes/synthesised-notes.md`

A single LLM call assembles all three inputs into a unified textbook-style document. A 90-minute lecture typically produces 25,000–45,000 tokens of combined input — well within a 128k-context model.

**What the LLM produces:**
- Formal British English prose (not bullet lists)
- H2 for major topics, H3 for sub-topics
- The transcript gives the narrative voice. The slide readings give structural anchors and key points. The prose joins both into continuous paragraphs
- Each placed slide with its subtopic: `![{caption}](images/slide-003.png)`
- A "Key Concepts" summary box at the end of each H2 section
- A "Glossary" section at the end defining all technical terms introduced
- No content added beyond what is present in the source materials

**Context window fallback for very long lectures (> ~80,000 input tokens):**
Align transcript sections to slide sections by heading similarity to produce paired section bundles. Synthesise each bundle independently. Concatenate, then make a lightweight "coherence pass" call that smooths transitions without re-reading the full content.

---

### `qa-loop` — QA Loop

**Inputs:** All source materials + current synthesised notes draft.
**Outputs (per iteration):** `QA iterations/qa-iteration-{02d}-deficiencies.json`, `QA iterations/qa-iteration-{02d}-revised.md`
**Final output:** `QA checked/notes.md` and `QA checked/images/`

#### Two-Prompt Design

QA and revision are two separate LLM calls per iteration. Combining them in one call degrades quality — the model cannot be simultaneously maximally critical and produce fluent prose. Separating the tasks allows each to be done well.

**QA checker call:** Reads source transcript + source slides + image manifest + current draft. Returns a structured `QaDeficienciesReport`. The prompt instructs the model to be thorough and critical, to categorise every deficiency into exactly one `QaDeficiency.type` value (carrying a short definition of each in-prompt), to hold the `distortion` / `unsourced-addition` line precisely — contradiction of a source versus content the source does not carry at all — and not to call the notes adequate unless they genuinely are. It also asks what the checker examined and cleared, which lands in `considered`: a findings list alone cannot tell a checker that missed something from one that looked and decided it was not a fault, and only the first is a reason to distrust the report.

**QA reviser call:** Reads current draft + deficiencies report. Applies targeted edits to address each deficiency. Does not rewrite wholesale. Every remedy is grounded in the lecture's own source materials (transcript, slide content, image manifest) — the reviser MUST NOT introduce content from outside the source set. The reviser branches on `type`:

- `omission` → insert the missing content at `outputLocation`, grounded in the quote the finding's `source` carries
- `underexplained` → restore the mechanism or reasoning the passage was stripped of, using that same quote; do not add unrelated material
- `distortion` → correct the claim against the cited source
- `unsourced-addition` → **remove** the content. The reviser MUST NOT go looking for external corroboration — grounding a statement the sources do not carry in a newly-cited one would violate NFR-1.3 (faithful representation) and licenses citation fabrication. This is why the category is distinct from `distortion`: the two look alike in a report and their remedies are opposites
- `other` → no standing action; a category that keeps recurring has earned a name and a branch of its own, and gets one
- `clarity` → rewrite the passage for readability without introducing new content or altering meaning
- `british-english` / `formatting` / `figure-reference` → apply the targeted edit; no other changes

#### Deficiency Schema

The QA checker returns a `QaDeficienciesReport`: an `overallVerdict` (`pass`/`fail`), a self-assessed `coverageScore` (0–100), a list of `QaDeficiency` items, and the `considered` list of what it examined and cleared. Each deficiency carries a `severity` (`critical`/`major`/`minor`), a `type` (the categories listed in the reviser-branch table above, each mapped to FR-4.2/FR-4.3), a `description`, a `suggestedFix`, and both ends of where it applies — an `outputLocation`, and a `source` holding the quote from the source material and where that quote sits. Exact shapes and per-field/per-category documentation are the single source of truth in `src/types/pipeline.ts` (`QaDeficienciesReport`, `QaDeficiency`, `QaDeficiencyType`, `QaSourcePassage`, `QaConsideration`, `QaSeverity`).

**The category set is shared, the prompts are not.** One `QaDeficiencyType` union serves both this stage and transcript verification, so the same fault cannot acquire two names depending on which checker found it — and a finding can be compared across stages, which is what makes the calibration corpus in `docs/quality/` readable against either. What differs is what each prompt offers: transcript verification asks only for the faithfulness categories, because it compares a transcript with a structured transcript and has no notes to judge the prose of. `other` sits in both, deliberately unglamorous — a checker with no way to report a real finding will force it into whichever category fits worst, and a recurring `other` is the evidence that a category is missing.

#### Loop Termination

The loop exits when any one of the following is true:

1. `overallVerdict === 'pass'`
2. `currentIteration >= maxQaIterations` (configurable, default 3) — exits with a warning in the manifest
3. Two consecutive iterations with identical deficiency counts and no severity change — exits to prevent infinite cycling on issues the model cannot resolve

`terminationReason` in the manifest records which condition triggered the exit (`'qa-passed'`, `'max-iterations-reached'`, `'stalled'`).

On successful exit, the final revised draft is written to `QA checked/notes.md` and all included figures are copied to `QA checked/images/`. `pdf-generation` then converts this to the final PDF.

---

### `pdf-generation` — PDF Generation

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

**How the pipeline talks to OpenRouter is configuration.** The whole `openRouter` section describes the service and how patiently to wait on it — address, timeouts, retry budgets — none of which is a fact about this codebase, and all of which an operator may need to change without a code edit. A slow gateway wants a longer completion timeout; a flaky one wants more retries; neither should require a release.

**The service address is configuration.** `openRouter.baseUrl` is the single place OpenRouter's address is stated; no source or test file holds the URL as a literal. It is configuration for the same reason a model ID is — it is an operational detail of the service being called, not a fact about this codebase — and keeping it in one place is what allows the pipeline to be pointed at a gateway, a regional endpoint, or a recording proxy without touching code.

Everything that addresses OpenRouter derives from it:

| Address | Derived as |
|---|---|
| Chat completions | The SDK's `baseURL`, so it is relative to it |
| The model-ID resolution check | `${baseUrl}/models` |
| The models page named in a failed check | the origin of `baseUrl`, plus `/models` |

The last is a human-facing link rather than an API call, and taking it from the origin assumes the host serving the API also serves that page. That holds for OpenRouter, and a second config field for a documentation link would be more surface than the assumption is worth — but a gateway deployment may want to correct the link it prints.

Validation treats it like any other required field, with one addition: it must be an absolute `http` or `https` URL, so a typo is a `ConfigError` at startup rather than an obscure failure at the first billable call. Those two schemes are the ones that have an origin, which is what the table above derives the models-page link from.

### `pipeline-config.json`

Located in the project root. Specifies model and parameters per stage independently. Changing a model requires only a config edit — no code changes.

Model IDs below are **capability-based placeholders**, not real OpenRouter routing strings. Before running the pipeline, replace each `<...>` with a concrete model ID looked up on `https://openrouter.ai/models`. The config loader checks every configured ID at startup — see **Model-ID resolution check** below.

The filename is stated once, in `src/types/pipeline.ts` as `CONFIG_FILENAME`, and not in the loader: the parties that name the file are not all downstream of the loader. `transcription` and the OpenRouter client both tell the user to edit it when a stage's configuration is missing or its model rejects the request, and `config.ts` imports from `openrouter.ts`, so a stage importing back would cycle. `types/pipeline.ts` imports nothing, so every layer can reach it.

The loader and the client surface:

```typescript
// src/pipeline/config.ts
loadConfig(args: { projectRoot: string }): Promise<PipelineConfig>
// Reads and validates pipeline-config.json; throws ConfigError on a missing or mistyped required field,
// or on a model ID the check below rejects. The check is not optional: it costs one request per invocation,
// before any billable call, and a way of turning it off is a way of meeting a typo'd model id at the first
// paid call rather than at startup.

// src/pipeline/openrouter.ts
createOpenRouterClient(args: { openRouter: PipelineConfig["openRouter"] }): OpenAI
// The configured client above. Not exported as a live instance, so importing the module never requires
// OPENROUTER_API_KEY.
type OpenRouterClient = () => OpenAI
createOpenRouterClientProvider(args: { openRouter: PipelineConfig["openRouter"] }): OpenRouterClient
// How the pipeline is given a client: one per invocation, made at the composition root and handed to a stage
// exactly as its logger is (§4.7). A provider rather than a client because building one reads the API key and
// the SDK refuses to build without it, while `delete`, `rename`, `change-date` and `cost-report` reach no
// model and must run without a key — so the client is built at the point a call is actually made. The one it
// builds is remembered in the provider's own closure, which lives exactly as long as the invocation: nothing
// module-level holds a client, so nothing needs a way to clear one.
API_KEY_VARIABLE: "OPENROUTER_API_KEY"
// The environment variable the key is read from, named for the same reason the routes are: a suite that stubs
// it names the variable this module reads rather than its own copy. The key itself never leaves the
// environment (§2, Environment Variables). transcription names its own the same way (§5, transcription).
class UnconfiguredStageError extends NamedError    // the config holds no entry for the stage; nothing was sent
class ContextLengthError extends NamedError       // the prompt exceeds the model's context window
class ProviderError extends NamedError  // the provider returned an error for any other reason
class NoReplyChoicesError extends NamedError // the call was accepted and carries no choices to read
// One class per way a completion call fails. Context length keeps its own because it has a remedy of its own —
// configure a larger-context model — and no choices is distinct from a model answering with empty content,
// which is a legitimate reply handed back as "".
callModel(args: { messages; stageId: StageId; config: PipelineConfig; responseFormat: "text" | "json"; logger: Logger; client?: OpenAI; sendGate: SendGate }):
  Promise<{ content: string; cost: StageCost }>
// `logger` is the calling stage's, already bound to it by createPipelineStage; the call is recorded on it
// at `debug` with the model, prompt token count, latency and finish reason (§10).
// `sendGate` is the stage run's, made by defineModelStage from the stage's `sendGapSeconds` (src/utils/send-gate.ts):
// every send, a refusal's resend included, waits its turn, so the gap holds however sends and resends fall.
// Wraps the SDK call and reads its cost from the reply's `usage` (§7). `responseFormat: "json"` sends `response_format: json_object` and
// the provider routing that makes it stick (see "JSON mode is routed for" below), which the stages
// returning structured data require; it is stated on every call rather than defaulted so a caller always
// declares the shape it expects back. `client` is injected by tests; it defaults to the shared instance.
```

**JSON mode is routed for as well as asked for.** OpenRouter honours `response_format` per *endpoint* rather than per model: a model is served by several providers, and by default the parameter steers routing towards those that support it — where none of a model's providers do, the request still goes through with the parameter dropped, handing the stage prose where it expected JSON. A `"json"` call therefore also sends `provider: { require_parameters: true }`, which restricts routing to endpoints supporting every parameter in the request. A model that cannot do JSON then fails the call, which names the real cause at the point it arises; a dropped `response_format` costs a full billable call and arrives as a parse error naming the reply. The flag rides with `"json"` alone: a `"text"` call has nothing to require, and requiring nothing would only narrow which endpoints can serve it.

OpenRouter's own parameter reference states that JSON mode requires the prompt to ask for JSON as well, so a `"json"` caller instructs the model in its messages too, and still treats a reply that will not parse as a stage failure.

**A stage asks for a JSON reply through one shared act.** Every stage that expects JSON has the same three obligations: send the call in JSON mode, refuse a reply that will not parse, and refuse one that parses into something other than the shape it documented. `requestJsonReply` in `src/pipeline/stages/model-stage.ts` performs all three and hands back the validated reply with the call's cost. The stage supplies what is its own — the messages, the predicate that recognises its reply, the shape in words, and how to raise its own named error — so each stage keeps its own error type while the two sentences a user reads are identical wherever they come from. The same module names the dependency pair (`{ logger, client }`) and the run arguments every model-calling stage takes, which had otherwise been restated per stage.

`requestJsonReply` is built on `tryJsonReply`, which makes the same call and returns a bad reply instead of throwing it: the reply, or the reason it cannot be used — empty, not JSON, the wrong shape — and the call's cost either way. The panel stages resend a bad reply (§5, "Dividing the transcript", Panel runs), and a resend needs the failed call's cost, which a thrown error would lose. An empty reply has its own reason because it is the common case and says something different from prose: the provider answered with nothing, not with the wrong thing.

`tryJsonReplyAs` is `tryJsonReply` followed by the stage turning the reply into what it keeps — where the stage may still find it unusable, as a splitting reply naming words the transcript does not contain — so that failure is resent like any other. The same module builds the two messages a stage sends (`promptMessages`: the prompt as the system message, the material as the user message) and defines a model-calling stage from its id, input reader and run (`defineModelStage`), returning the factory the CLI calls with the logger and client.

**A rejection can arrive inside an accepted reply.** OpenRouter answers some upstream failures with HTTP 200 and a body carrying `{"error": {…}}` where the choices should be, which the SDK reports as a success. The provider's own sentence is the only account of what happened — it says whether the failure is transient and whether retrying is the remedy — so an accepted reply carrying one is logged as a warning quoting it beside the stage and the model, and the call is sent again, up to three sends, pausing two seconds and then four between them. The third refusal is a `ProviderError` quoting the last one. This holds for every call, in every stage, so no stage needs its own copy of it. A refusal can be transient — a provider rate-limiting several calls at once — and a relaunch would pay for the same call again anyway; a permanent one, such as a prompt too long for the model, costs two extra sends and a few seconds before it fails the stage. Each refused send counts as a call. Its cost is read from its `usage` like any other reply's when the refusal reports one; when it reports none it is counted as costing nothing, because OpenRouter does not bill a request that produced no output. A reply carrying neither choices nor an explanation is the `NoReplyChoicesError` above.

A reply that carries the provider's error and an answer as well — a choice whose content is not empty — is not a refusal: the answer is handed back, and the error is logged as a warning quoting the provider's sentence beside the stage, the model, the finish reason and which send it was. Resending it would throw away a complete answer — `openai/gpt-6.1-sol-pro` reported `error` as the finish reason on 11 of the prototype's 72 grouping calls, every one of them a usable answer — and the stage's own check of the answer still resends one that is unusable. A reply's finish reason is never itself a reason to resend.

**A tuning parameter can be left unset out loud.** Every optional field of a stage entry — `temperature`, `maxTokens`, `concurrency`, `callConcurrency`, `sendGapSeconds`, `maxIterations` — may be written as `null`, which means what leaving the key out means: the request carries no such parameter. There are two ways to say it because the choice is worth writing down. Under the routing restriction above, the parameters a request carries decide which endpoints may serve it, and providers differ in what they accept — the same model reached through one provider takes a `temperature` and through another does not. Which tuning a stage sets is therefore part of choosing what can answer it, and a `null` records a deliberate omission beside the tuning that is set, where a missing key reads as an oversight.

**Three settings say how much runs at once.** `batch.concurrency` is how many lectures a batch runs at once (§4.7). A stage's `concurrency` is how many of its runs, slides or images are in flight at once. `callConcurrency` is how many calls one run makes at once, and only `deepen-subtopic-splitting` has one: it is the only stage whose run makes more than one call (§5). Unset, runs and calls are each made one at a time. `sendGapSeconds` is the least time between two of a stage's sends, and only `group-into-topics` has one (§5, "Dividing the transcript", Panel runs); unset, sends are not spaced. Either setting on any other stage would be read by nothing, so it is a `ConfigError` at startup naming the stage, rather than a setting that silently does nothing.

**A stage key names a stage.** Every key of the `stages` section is checked against the stage IDs, and one that names no stage is a `ConfigError` at startup listing the stages it could have named. Configuration reaches a stage by its key alone, so this check is what makes "the stage is configured" and "the config file mentions the stage" the same statement.

**Model-ID resolution check.** At startup `loadConfig` fetches the model list once from `${openRouter.baseUrl}/models` and asserts every configured `stages[*].modelId` appears in it, so placeholders left un-substituted, typos, and retired IDs are caught before any billable call. A miss throws a `ConfigError` naming the offending stages and linking to the models page. The list is fetched once per invocation, which is the only time it is wanted: `loadConfig` runs once, and asks for the list once.

**Exempting non-OpenRouter providers.** Not every stage calls OpenRouter — `transcription` transcribes through ElevenLabs — so checking its model ID against OpenRouter's list would always fail. `modelIdCheck.exemptProviders` lists provider prefixes (the part of a model ID before the `/`) that the check skips, so a stage on any non-OpenRouter provider can still declare its model in config and have it recorded in the manifest and cost report. The mechanism is general: it is not specific to ElevenLabs, and a stage whose provider is not exempt is always checked. Exempting a provider trades away the typo protection for its IDs, so keep the list to providers that genuinely sit outside OpenRouter.

**One exemption is not a provider, and is temporary by construction.** A stage that has not been built has no model to name, and the check reads the whole file — so a config describing the stages not yet built would refuse to start the stages that do exist. Until each is built it carries a `placeholder/` prefix and `placeholder` is exempted, which is what lets the built stages run. **The prefix comes off as its stage is built, and the last one to go takes the exemption with it.** That discipline is the whole of the guarantee: an exemption left standing over a stage that now makes real calls excuses it from the check, and a wrong ID then surfaces at that stage, after every stage before it has been paid for. `docs/user-test-plan.md` carries the same instruction beside the config it applies to.

Both halves of a model ID are read through `splitModelId` in `src/utils/model-id.ts`, which this check and `transcription` share: the check reads the provider, `transcription` reads the name (§5, `transcription`). One reader is what fixes what separates the halves, so the two cannot come to disagree about it. An ID that names no provider yields a `null` provider, which no exemption list can hold, so such an ID is always checked.

**Currency.** Every provider bills in US dollars, so costs are stored in USD and converted to pounds only for presentation (§7). `currency.gbpPerUsd` is the rate applied. Because it converts at display time rather than at write time, correcting a stale rate re-renders every historical report consistently — no stored figure is ever rewritten, and none silently mixes rates.

**The ElevenLabs address is configuration too.** `elevenLabs.baseUrl` is the single place ElevenLabs' address is stated, and it is passed to the SDK's own `baseUrl` option so every Scribe call is made against it. The reasoning is the same as for `openRouter.baseUrl` above, and so is the validation — it must parse as an absolute URL or startup fails. It matters more here than the shared reasoning suggests: ElevenLabs serves the same API from several regional residency hosts, and which one an account must use is a fact about that account. Naming the host in config is what lets an account on a regional one be served by a config edit.

Unlike OpenRouter's, this base URL carries no path — the SDK appends the versioned route itself — so `speechToText` is named alongside it in `transcription.ts` rather than being built by the pipeline, for the same reason `completions` is named in `OPENROUTER_PATHS`: so a test intercepting the call does not have to know the route independently of the code under test.

**The spoken language is configuration, and it is not `finalOutput.language`.** `elevenLabs.languageCode` is the language Scribe is told to expect in the audio; `finalOutput.language` is the language the notes are written in (§6, Output). They are deliberately separate fields: a lecture delivered in one language may want notes in another, and collapsing them would make that impossible to express. They also take different forms — Scribe wants an ISO-639-3 code (`eng`), while the notes language is a BCP-47 tag carrying a regional spelling convention (`en-GB`) — so neither can be derived from the other without losing something.

**Module prefixes are configuration because a prefix describes a module, not this codebase.** Lecturers put the module at the front of a recording's filename, which is noise in a title: the module is already the folder the lecture sits in. `naming.modulePrefixes` lists what to strip, and it is a list rather than one value for two reasons — the pipeline is pointed at several modules at once, and **one module may be written more than one way**. A lecturer abbreviates it in some filenames (`BOD_Cell injury`) and writes it out in others (`Biology of Disease - Cell injury`), so both forms are listed. Matching ignores case for the same reason: how a filename happens to write a module says nothing about whether it is one. A prefix absent from the list survives into the workspace folder name and the final PDF for every lecture that carries it.

Each prefix is matched literally, so one carrying a pattern character means itself; a blank prefix is refused at load, since it would otherwise match any run of underscores or spaces and take apart every title the run produces. A listed prefix is what makes the strip safe: the module names are known, where the shape of a prefix is not — an opening acronym belongs to the subject (`DNA_replication`), and a module written out in full has no shape to match at all.

**`finalOutput.language` is a closed set, and every stage that writes prose obeys it.** The loader checks the tag against `OUTPUT_LANGUAGES`. That list maps each tag to the name that a prompt uses for it. A tag with no name is refused at startup, with a list of the valid tags. The name is necessary because "Write in en-GB" is not an instruction that a model can follow. So config cannot offer a language without wording for the prompts to use. `languageRule` in `src/utils/language.ts` builds that sentence. Every prompt that asks for prose or for a lecture title includes it, and words no rule of its own. So the stages cannot give the model different instructions. `judge-lecture-title` and `transcript-structuring` are the stages built that use it. `transcript-verification`, `read-slides` and `synthesis` will use it when they are built.

**The subtopic splitting and grouping settings are required sections.** `subtopicSplitting` and `grouping` carry the panel sizes, the bars and the size gate (§5, "Dividing the transcript" and `group-into-topics`). Like every other section they must be present, and a missing or mistyped field is a `ConfigError` at startup. Neither bar may exceed its section's panel size, since nothing could then be kept. Each is a whole number of at least 1.

**So is the batch section.** `batch.concurrency` is how many lectures `batch` runs at once, a whole number of at least 1, and `--concurrency N` overrides it for one command (§4.7). It is required rather than defaulted so the file says how wide a batch runs; the example sets 1.

**ElevenLabs cost rate.** The Scribe API returns no price with a transcript, so `elevenLabs.costPerAudioHourUsd` supplies the rate `transcription` multiplies by the audio's duration to attribute transcription spend (§7). Set it from the ElevenLabs plan in force; it is a billing figure that changes independently of this codebase, which is why it is configuration rather than a constant. The single rate is accurate for the call this pipeline makes — batch Scribe v2 with no diarization, entity detection, or keyterm prompting, each of which ElevenLabs bills as a surcharge on top of the base hourly rate. Enabling any of those later means revisiting this figure, since one number can no longer describe the call.

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
    "completionMaxRetries": 5
  },
  "elevenLabs": {
    "baseUrl": "https://api.elevenlabs.io",  // every ElevenLabs call is made against this; use your account's residency host
    "languageCode": "eng",             // language SPOKEN in the lectures (ISO-639-3); not finalOutput.language below
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
    "initial-subtopic-splitting": {
      "modelId": "<FAST_LONG_CONTEXT_MODEL>",     // called once per splitting run with the whole transcript
      "concurrency": 3                            // runs in flight at once; unset means one at a time
    },
    "deepen-subtopic-splitting": {
      "modelId": "<FAST_LONG_CONTEXT_MODEL>",     // called once per oversized subtopic
      "concurrency": 6,
      "callConcurrency": 10                       // calls in flight at once within one run
    },
    "retitle-subtopics": {
      "modelId": "<REASONING_MODEL>"              // called once per lecture with every subtopic's text
    },
    "group-into-topics": {
      "modelId": "<REASONING_MODEL>",             // called once per grouping run with every subtopic's title and text
      "concurrency": 9,
      "sendGapSeconds": 0.5                       // least time between two sends, resends included
    },
    "judge-lecture-title": {
      "modelId": "<REASONING_MODEL>"              // called once per lecture with every topic and subtopic
    },
    "transcript-structuring": {
      "modelId": "<REASONING_MODEL>",             // long-context text model with strong structure/summarisation
      "temperature": 0.2,                         // any tuning field may be null instead: no such parameter is sent
      "maxTokens": 8192
    },
    "read-slides": {
      "modelId": "<COST_EFFICIENT_VISION_MODEL>", // vision model — called once for each slide, so the cost of one call matters most
      "temperature": 0.1,
      "maxTokens": 4096,
      "concurrency": 3
    },
    "place-slides": {
      "modelId": "<REASONING_MODEL>"              // one call with the whole lecture and every slide reading
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
  "subtopicSplitting": {
    "panelSize": 18,                   // splitting runs per lecture
    "bar": 9,                          // runs a cut site needs to be kept
    "sizeGateWords": 600               // a subtopic over this many words is deepened
  },
  "grouping": {
    "panelSize": 9,                    // grouping runs per lecture
    "bar": 5                           // runs a topic start needs to count in the vote, which only breaks ties
  },
  "batch": {
    "concurrency": 1                   // lectures a batch runs at once; --concurrency N overrides it
  },
  "naming": {
    // stripped from a filename before it becomes a title; one module may be listed more than once,
    // abbreviated and written out, and matching ignores case (§3.2)
    "modulePrefixes": ["BOD", "Biology of Disease", "ANA"]
  },
  "finalOutput": {
    "language": "en-GB",               // language the NOTES are written in (en-GB | en-US); not elevenLabs.languageCode above
    "pandocEngine": "xelatex"
  }
}
```

---

## 7. Cost Tracking

### Sources

OpenRouter prices every reply in the reply itself: `response.usage.cost` is the call's cost in US dollars, beside `usage.prompt_tokens` and `usage.completion_tokens`. `callModel` reads all three from the reply, so its return value already includes the call's `StageCost`, and **no stage is ever marked `complete` with a cost still to arrive**. The pipeline makes no second request for the price. OpenRouter's `/generation` endpoint also reports it, but its record appears only 10–18 seconds after the reply (measured 2026-09-30), and asking sooner is answered "not found".

If a reply carries no numeric `usage.cost`, the call and the stage still succeed — cost telemetry MUST NOT gate pipeline progress. The manifest and run-log entries record `cost.costUsd = null` along with `cost.unknownCostReason` describing why; when a stage's calls go unpriced for the same reason, the reason is recorded once. Tokens and `callCount` are always populated regardless.

ElevenLabs returns no price with a transcript, so `transcription` derives transcription cost from the audio's duration (read with `ffprobe`) multiplied by the configured `elevenLabs.costPerAudioHourUsd` (§6). The result is recorded as a normal `StageCost` with `callCount: 1` and zero token counts — Scribe is billed by audio duration, not tokens. If the duration cannot be read, the stage still succeeds and records `costUsd: null` with `unknownCostReason`, exactly as an unpriced OpenRouter reply does: cost telemetry MUST NOT gate pipeline progress.

### Currency

Providers bill in US dollars, so **USD is the stored currency and GBP is the presented one**. Every persisted figure — each manifest stage entry's `cost`, and every run-log entry — records the dollar amount actually charged, which is why those fields are named `…Usd`. Conversion happens in the reporting layer alone, at `currency.gbpPerUsd` (§6): the end-of-run summary, all three sections of `cost-report`, and any other user-facing figure render pounds and the `£` symbol.

Keeping the conversion at the edge means a stale or corrected rate never invalidates stored data — re-running a report applies the current rate to the full history at once. Storing pounds instead would freeze each figure at whatever rate happened to be configured when it was written, leaving a single manifest holding amounts converted at several different rates and no way to restate them.

### Two-Level Tracking

| Level | Location | What it tracks |
|---|---|---|
| Current pipeline | `manifest.json` → each stage's `cost` | What each output currently on disk cost to produce |
| All-time expenditure | `Run logs/*.json` | Every API call ever made, including failures and experiments |

Both levels are read a stage at a time. Neither stores a figure spanning stages, runs, lectures or modules: a stage's cost is compared against the same stage's cost under a different model, which is the comparison the two levels exist to serve, and a sum across stages answers no question the pipeline is asked (NFR-2.2).

**Known limitations.** Both levels record only what a stage's launch returned, and in two edge cases that falls short. Neither is worth the machinery that would close it:

- **A panel stage relaunched over saved runs** (§5, "Dividing the transcript", Panel runs) records in the manifest only the cost of the runs that launch made, not the runs it reused, so the manifest under-states what the output cost.
- **A stage that fails** records no cost in either level, so the calls it made before failing, resends and refusals included, appear nowhere.

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
Immunology                             1   success
──────────────────────────────────────────────────
All modules                            3    failed
```

It carries no money: what a module or a batch spent is a sum across lectures, and the figures are kept per stage (NFR-2.2). The rows are what ran and how it went, and each lecture's own summary above says what its stages cost. Modules are grouped by their directory path, so two module directories that share a leaf name are two rows.

### Cost Report Command

`lecture-notes cost-report [--date <YYYY-MM-DD>] [--module <moduleRoot>]` reads the run logs of every lecture across the configured `moduleRoots` and presents three sections for each. With no flags, it covers every configured module. With `--date`, narrows to lectures on that date (uses `resolveLecturesByDate`; prompts if the date matches multiple modules). With `--module`, restricts to a single module.

Each lecture's report opens with the lecture it is about, named by `lectureHeading` (Cost Module, below), because a report with no flags prints several one after another. The figures are per stage throughout: each lecture's sections stand on their own, and nothing is summed across stages, runs, lectures or modules (NFR-2.2). Where the scope holds no lecture, the command says so and succeeds — nothing has been spent is an answer, and a report that printed nothing at all could not be told from one that failed to look.

(The `lecture-notes` command becomes available after running `./scripts/setup` once, which appends a PATH export to your shell config. During dev the equivalent invocation is `pnpm exec tsx src/index.ts cost-report …`.)

**1 — Current pipeline cost** (what the outputs on disk cost to produce), under the lecture's heading:
```
Lecture 1: Cell Injury (2025-10-10)

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
2025-10-10T09:00Z      read-slides            failed   £0.016
2025-10-10T10:30Z      read-slides            retry    £0.025
────────────────────────────────────────────────────────────
```

A row is any stage that failed, under whatever classification its run carried, together with every stage of a run started to recover from one. The run that first meets a failure is classified `normal` — as the 09:00 run above is — and the spend that failure cost belongs to this section, which is why a row is selected by what became of the stage as well as by the run's type. The rows stand on their own: what a failure cost is read against the retry underneath it, one stage at a time (NFR-2.2).

**3 — Experiment cost** (deliberate model re-runs, grouped for comparison):
```
Stage: synthesis
  Run 2025-10-11T14:00Z    claude-sonnet-4.6      £0.231
  Run 2025-10-11T15:30Z    anthropic/claude-opus  £0.659
```

### Cost and Reporting Modules

Two modules, split by what they know. `src/utils/cost.ts` holds the arithmetic: one operation, working entirely in stored US dollars, knowing nothing about how a figure is shown. `src/pipeline/reports.ts` holds everything that turns a run into text a reader sees — the three reports, the table engine beneath them, the stage labels and the money formatting.

The split is by kind rather than by size. Rendering reads manifests, run logs and stage ids, and knows how a lecture is named and how wide a model column must be; it is pipeline presentation, not a general-purpose helper, and while it sat in `src/utils/` it reached back into the pipeline for its material — a utility needing the pipeline being the tell. It sits under `src/pipeline/` rather than `src/cli/` because the runner renders the cost report itself (§4.7) and pipeline code does not import from the CLI layer.

`StageCost`, the type both operate on, is defined in `src/types/pipeline.ts` (single source of truth). Nothing in either adds one stage to another; the reports render what each stage recorded and nothing else (NFR-2.2).

**Money is formatted by a formatter, never a rate.** Every report takes a `MoneyFormatter` rather than `gbpPerUsd`, so nothing in `reports.ts` knows what currency it is showing or what it converts from. The caller builds one and passes it down: the CLI builds a single formatter where it is assembled and uses it for the live stage notices and every summary that follows them, and the runner builds one for the whole of a cost report. A rate is read once per invocation rather than carried to each place that prints a figure.

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

lectureHeading(args: { manifest: Manifest }): string
// How a lecture is named at the head of anything written about it — "Lecture 1: Cell Injury (2025-10-10)".
// Three places name a lecture this way: the end-of-run summary, the cost report, and the notice the CLI
// writes as a run starts (§10). A batch shows several one after another, so two of them identifying a
// lecture differently would read as two lectures.

formatCostReport(args: { runLogs: readonly RunLog[]; manifest: Manifest; formatMoney: MoneyFormatter }): string
// The three sections above, rendered as a single string.

formatRunSummary(args: { outcomes: readonly PipelineStageOutcome[]; manifest: Manifest; formatMoney: MoneyFormatter }): string
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

Every way a module can fail raises an error class of its own, the failures the platform raises included — `ConfigError`, `ManifestPathError`, `ManifestUnreadableError`, `ManifestNotJsonError`, `ManifestShapeError`, `UnconfiguredStageError`, `ContextLengthError`, `ProviderError`, `NoReplyChoicesError`, `EmptyNameError`, `SourceNormalisationError`, `AudioExtractionError`, `TranscriptionError`, `TranscriptStructuringError`, `CliUsageError`, `LectureIdentityError`. A caught failure names what happened from its type, so a module with three ways to fail declares three classes; a filesystem error or a `SyntaxError` on its way out through one of them is caught and rethrown as the module's own, its message carried into the new one. Every stage built so far contributes at least one, so each stage still to come adds its own. All extend a shared `NamedError` base that captures the concrete subclass name via `new.target`, so each stays a distinct `instanceof` type without repeating constructor boilerplate and reports its own name in logs.

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

Items 4 and 5 split one job in two, because the two audiences need different things. For a typed stage error (`TranscriptionError: no transcript text in response`) the message *is* the diagnosis, and a stack would point back into the runner. An unanticipated failure yields a message that explains nothing on its own (`Cannot read properties of undefined`), and there the stack is what says where. So the message goes to the user, the stack goes to the debug log, and nothing goes to stderr from the runner: user-facing output is the CLI's job, and the runner is driven by tests that deliberately fail stages. The runner writes to **neither** of the process's streams — the cost report, the one thing it produces for a reader, is handed back as text for the CLI to write (§4.7).

### Intra-Stage Resumability

**Panel stages.** `initial-subtopic-splitting`, `deepen-subtopic-splitting` and `group-into-topics` save each run to its own file the moment it is complete. On restart after a `failed` or interrupted stage, the runs already saved are read back and only the missing ones are made; the stage is marked `complete` once every run in the panel is present and its result is written (§5, "Dividing the transcript", Panel runs). A reset with `--from-stage` still clears the stage's directories, runs included.

**`read-slides`.** The stage writes each slide reading to `Slide readings/slide-001.json` and so on, as soon as its reply is usable. On restart after a `failed` stage, the stage reads only the slides that have no reading. The stage is marked `complete` when every slide has a reading.

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
│   ├── pipeline-run-reporter.ts               # The wording of the notices a run writes as it goes (§10)
│   └── run-cli.ts                    # Composition root: config, logger, runner, stages, prompts
├── types/
│   └── pipeline.ts                   # All shared types: StageId, StageContext, StageResult,
│                                     # StageCost, Manifest, QaDeficiency
├── pipeline/
│   ├── runner.ts                     # Orchestrator, run log creation, batch mode, cost accumulation
│   ├── layout.ts                     # Every directory and filename, declared once (§3.3)
│   ├── manifest.ts                   # manifest.json location, reading, and atomic writing
│   ├── stage-context.ts              # Assembling the StageContext a stage is handed (§4.7)
│   ├── lecture-files.ts              # Moving and removing the files a lecture's identity is spread across (§4.7)
│   ├── workspace-paths.ts            # The two path resolvers: trusted segments, and the untrusted-entry
│   │                                 # boundary check that keeps a manifest inside moduleRoot (§4.4)
│   ├── reports.ts                    # Every report a reader sees, the table engine, stage labels and
│   │                                 # money formatting (§7)
│   ├── run-status.ts                 # Reducing stage and lecture outcomes to an OverallStatus, and
│   │                                 # reading a stage entry as completed (§4.2)
│   ├── config.ts                     # Config file loader and validator
│   ├── openrouter.ts                 # OpenAI SDK client configured for OpenRouter
│   ├── fixtures.ts                   # The shared test fixtures — the example lecture, the stub logger,
│   │                                 # the temp-directory trees. Production code never imports it
│   └── stages/                       # One folder per stage; shared stage machinery at this level
│       ├── pipeline-stage.ts         # The shared isComplete check and the stage factory (§4.2)
│       ├── model-stage.ts            # The JSON-reply calls, prompt messages, and the model-stage factory (§6)
│       ├── panel-runs.ts             # Panel runs: bounded concurrency, save-as-you-go, resume, resend (§5)
│       ├── division.ts               # Placing cuts, slicing subtopics, the lossless check — shared by the
│       │                             # three division stages (§5, "Dividing the transcript")
│       ├── source-normalisation/     # source-normalisation.ts (the order things happen in, and
│       │                             # manifest seeding), with lecture-resolution.ts, source-renames.ts and
│       │                             # orphaned-workspaces.ts, the three parts only it uses
│       ├── audio-extraction/         # ffmpeg audio extraction
│       ├── transcription/            # ElevenLabs Scribe transcription
│       ├── initial-subtopic-splitting/  # stage module and its s6 prompt module
│       ├── deepen-subtopic-splitting/   # stage module and its d13 prompt module
│       ├── choose-division/          # no model call, no prompt
│       ├── panel-vote.ts             # The vote and the distance from it — shared by choose-division and group-into-topics
│       ├── retitle-subtopics/        # stage module and its r9 prompt module
│       ├── group-into-topics/            # stage module, its g23 prompt module, choose-grouping.ts
│       ├── judge-lecture-title/          # stage module and its prompt module
│       ├── transcript-structuring/   # stage module and its prompt module
│       ├── transcript-verification/  # stage module, prompt module and the verification report Markdown
│       ├── render-slides/            # stage module: one image for each page of the slide deck
│       ├── read-slides/              # stage module and its prompt module
│       ├── place-slides/             # stage module and its prompt module
│       ├── synthesis/                # context assembly, chunking fallback
│       ├── qa-loop/                  # two-prompt QA pattern, loop termination
│       └── pdf-generation/           # pandoc invocation, Final output/ deposit
└── utils/
    ├── date.ts                       # Date extraction and normalisation (chrono-node)
    ├── naming.ts                     # Lecture folder and file naming helpers
    ├── files.ts                      # Atomic writes (.tmp pattern) and directory reads — conveniences only
    ├── progress.ts                   # Shared cli-progress bar helpers
    ├── cost.ts                       # Cost accumulation only — the arithmetic, in stored USD (§7)
    ├── resend.ts                     # Sending a call again after a curable failure — shared by the completion call and the panels (§5, §6)
    ├── stage-id.ts                   # Recognising a stage name, for --from-stage and the config keys (§6)
    ├── language.ts                   # Recognising a configured language, and wording it for every prose prompt (§6)
    ├── model-id.ts                   # Reading a model ID's provider and name, for the exemption and transcription (§6)
    ├── record.ts                      # Recognising a parsed value as one with fields to read (§4.4, §6, §7)
    ├── text.ts                        # Closing up the whitespace a removal leaves behind (§3)
    ├── stage-config.ts                # Finding a stage's entry in the config, and reporting its absence (§6)
    ├── errors.ts                     # NamedError, and the narrowing every catch site would repeat (§8)
    └── logger.ts                     # pino instance and child-logger factory
```

**Each stage owns a folder.** A stage's module, its prompt module, any Markdown version, the parts only it uses, and the tests of all of them live in the folder named for its stage id. A stage used to be one file; the division stages are several — a prompt, the reply's validation, the choice of result — and a folder keeps what belongs to one stage together without making any of it look shared. What more than one stage uses sits one level up, beside the stage factory: the model-call and panel-run machinery every model stage reaches, and `division.ts`, which the three division stages share. A stage folder never imports from another stage's folder; ESLint enforces it alongside the existing rule that pipeline infrastructure never imports from a stage. No stage folder has an `index.ts`.

---

## 10. Logging

`pino` is used for all structured logging. Each pipeline invocation creates one root logger, writing to a debug log named for the instant the invocation began. Beneath that root, every log entry a stage makes carries the stage and the lecture — `{ stage, module, lectureNumber, lectureDate }` — but a stage does not call `logger.child()` for itself: `createPipelineStage` binds the stage once when the stage is built, binds the lecture each time `run` is called, and hands that to `run` (§4.2). The lecture is bound per call because a batch runs one stage object for several lectures at once, and a line that did not name its lecture could not be told apart from another lecture's. One binding site means a stage cannot log against a stage or a lecture it is not, and a stage that logs nothing still costs nothing.

Each per-lecture stage factory therefore takes `{ logger }` and passes it to `createPipelineStage`; `source-normalisation`, which is not a `PipelineStage`, takes and binds its own. The runner keeps its own binding for the one thing it logs about a stage — the failure and its stack, which it must record for a stage that threw before it could log anything itself.

### Debug Log File

The pino file transport writes newline-delimited JSON to `<projectRoot>/debug-logs/<timestamp>-debug.log`, the path named by `debugLogPath` (§3.3). This file captures operational detail not stored in the run log:

- Every billable model call: model, prompt token count, latency ms, and the finish reason the provider reported, or `null` when it reported none. `transcription`'s Scribe upload counts — it is billed by audio duration rather than tokens, so it logs bytes uploaded in place of prompt tokens
- Rate limit retries: attempt number, back-off delay, error message
- The time of each slide's call (`read-slides`)
- File I/O errors: path and OS error code
- **Decisions that name things downstream.** The log records which source video `audio-extraction` chose, because it selects by base name from what the video directory holds. It also records the outcome by which `judge-lecture-title` decided the lecture's title (§5, `judge-lecture-title`), because every later stage names its output from that title
- **Failures the run survives**, at `warn`. The main one is `transcription`'s audio-duration lookup. Its only other trace is a `null` in a cost report that someone reads days later. The log also records every unusable model reply that a stage resends (§5, "Dividing the transcript", Panel runs, and `judge-lecture-title`)
- Every stage failure, with its stack, bound to the stage that raised it (§8)

The debug log is for human inspection when diagnosing failures. Its JSON format also makes it trivially parseable if automated analysis is ever needed.

**A debug log belongs to an invocation; a run log belongs to one pipeline run.** They are different scopes and cannot share an identity: `batch` runs many lectures against one root logger, so one debug log faces as many run logs as there were lectures. The two are tied together from the other end instead — the runner writes a `debug` entry carrying `{ pipelineRunId, workspaceRoot }` as each pipeline run starts, before any stage does anything, so a reader holding a run log can find the debug output that produced it and a reader holding the debug log can see which pipeline runs are in it.

The project root is what the log is anchored to, rather than a workspace or the process's working directory. `source-normalisation`'s work over a module happens before any lecture has been chosen, and a batch spans every configured module, so no single workspace could hold the record of an invocation; and a relative path would put the log wherever the user happened to be standing when they typed the command.

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

### Stage Notices

The runner tells the user what it is doing, one stage at a time, through a `PipelineRunReporter` it is given the way it is given a logger. A pipeline run summary describes a pipeline run that has finished; these describe one still going, and for a pipeline run that repeats nothing they are the only sign it did anything at all.

```typescript
type PipelineRunEvent =
  | { event: "lecture-started"; manifest: Manifest }
  | { event: "stage-started"; stageId: StageId }
  | { event: "stage-skipped"; stageId: StageId }
  | { event: "stage-completed"; stageId: StageId; cost: StageCost | null }
  | { event: "stage-failed"; stageId: StageId }
type PipelineRunReporter = (event: PipelineRunEvent) => void
// Facts, not sentences. The wording is `src/cli/pipeline-run-reporter.ts`'s, which is what keeps the runner out of the
// business of writing to a user (§8) while still letting it speak at the moment there is something to say.
```

```
Lecture 1: Cell Injury (2025-10-10)
▶ Transcription…
✔ Transcription — 1 call, £0.031
− Slide conversion — output already present, skipping
✖ Synthesis — failed
```

A completed stage that bought nothing — audio extraction, PDF generation — is named with no tail rather than one reading zero. A failed stage is marked but its message is not repeated here: the message and the pointer to the debug log follow the run summary (§8), and this line exists so that a stage announced as started is not left hanging. The lecture is named from `lectureHeading` (§7), the same way the end-of-run summary and the cost report name it, so a batch's notices cannot identify one lecture two ways.

### Logging and Progress Helpers

```typescript
// src/utils/logger.ts — file-only; the user-facing messaging in the table above is emitted by the
// CLI and runner, not by this logger.
type DebugLog = { logger: Logger; close(): Promise<void> }
createDebugLogger(args: { debugLogFile: string }): DebugLog
// Writes newline-delimited JSON to debugLogFile (sync: false, mkdir). The file is made and written in the
// background. `close` writes each entry still waiting and closes the file. runCli closes the debug log before it
// returns, so the log is complete on disk when a command ends. Takes the whole path from its caller rather
// than assembling one: every directory and filename is declared in layout.ts (§3.3), and a utility must not
// reach up into the pipeline
// to read it.
createStageLogger(args: { logger: Logger; stageId: StageId }): Logger   // child logger with a { stage } binding

// src/utils/progress.ts — the stdout progress bars from the table above.
createProgressBar(args: { format: string; formatValue?: FormatValueFn }): SingleBar
// Shared SingleBar factory (preset + hideCursor) that the other two build on, so bar construction lives
// in one place; formatValue supports e.g. byte-to-MB display.
createUploadProgressStream(totalBytes: number): Transform    // upload byte progress; used by transcription
createParallelWorkBar(args: { label: string; total: number }): {
  bar; start; pick; complete; fail; stop
}
// The bar that shows the slides in flight, for read-slides. pick(id) adds an id to the in-flight set. complete(id)
// removes the id and moves the bar on. fail(id) marks the item red in the final render. cli-progress gives the
// behaviour when the output is not a terminal. **Built with read-slides**, because the stage that needs the bar
// decides what it must do.
```
