# Lecture Notes Generator — Technical Design

**Suite version:** 1.97-draft. The requirements, the technical design and the implementation plan share this number. A substantive edit to any of the three raises it in all three
**Date:** 2026-10-15
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
| LLM access (all new stages) | `openai` SDK pointed at OpenRouter | OpenRouter is compatible with the OpenAI API. So the project needs no client of its own, and it gets retry logic and TypeScript types from the SDK |
| PDF-to-image rendering | `pdfjs-dist` + `@napi-rs/canvas` | Pure Node, with a prebuilt canvas. It needs no system library and no build toolchain. `pdfjs-dist` uses this canvas in Node |
| Notes PDF | `puppeteer` | Chrome prints the PDF from HTML, so the PDF and the notes page use the same HTML and maths. `pnpm install` downloads puppeteer's Chrome |
| Image metadata in tests | `sharp` | Standard Node image processing library |
| Date parsing | `chrono-node` | Parses natural-language dates in the many forms that source filenames use |
| CLI prompts | `@inquirer/prompts` | Already in use |
| Progress bars | `cli-progress` | Already in use |
| Logging | `pino` | Structured JSON log output. Child loggers carry the stage. The file transport keeps debug output off stdout and stderr |
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
    └── Lecture 1 - Disease Cell Injury and the Immune System - 2025-10-10/
        ├── notes.html
        ├── notes.pdf
        └── slides/
```

All pipeline artefacts for a lecture live inside a single named workspace folder. Files inside each folder use simple, stage-agnostic names — the folder itself carries the full lecture identity. This means re-numbering a lecture requires renaming only the folder, not any of its contents.

`Final output/` is a direct subfolder of the module root and is the human-facing deliverable. It holds one folder for each lecture, named by the lecture's base name. The folder holds `notes.html`, the Notes PDF `notes.pdf` and `slides/`. `build-notes-page` writes the folder (§5, "After the fact correction"). The folder is a lecture file, as the video and the slide deck are. So the commands that rename or delete a lecture move or delete the folder with everything in it (§4.7).

**Folder-name convention.** Only `moduleRoots[i]` is configurable (see §6). The subfolder names shown above — `Source files/`, `Video recordings/`, `Slide decks/`, `Pipeline processing/`, `Final output/` — are fixed conventions baked into the pipeline. Every module folder that the pipeline manages MUST follow this layout. The tool creates these subfolders on demand; users should not rename them.

### 3.2 Source Files

#### Video recordings

Source videos may have the date in any position and any format. `source-normalisation` extracts the date and assigns a lecture number by date order. It makes the provisional title from the original filename. It removes these parts:

- the date and the day names (Mon–Sun)
- the configured module prefixes, such as `BOD_`, `CGD-` or `Biology of Disease -`, in any case. A prefix needs a space, `_` or `-` after it, or the end of the name. A letter or digit directly before or after it keeps it in the title, so `HPIx` stays.
- an embedded lecture-number token, such as `Lecture 1`, `Lecture_1`, `Lecture-1` or `Lecture1`, in any case. The token would otherwise duplicate the assigned number.
- the word `lecture` with no number, in any case, as a whole word. This removal comes after the removal of the numbered token, so `Lecture 6` does not leave its `6`. `Lectures` and `Lecturer` stay.
- the trailing artefacts, such as `co` and `copy`.

The capitals stay as the lecturer typed them. The separators left behind by those removals go too. So a name that `source-normalisation` produced reads back as the title that it was built from. `Lecture 1 - Cell Injury - 2025-10-10.mp4` gives `Cell Injury`. So a lecture keeps its title on the next run when a run renamed it and stopped before it wrote the manifest.

An "on" directly before a date belongs to the date, so it is removed with the date. `BOD_Complement on 17102025 Fri.mp4` gives `Complement`. An "on" in any other place stays in the title.

**Dates are read in British convention.** A four-digit component is the year. Otherwise the day leads. Month-first is never read. All fourteen numeric forms are accepted:

| Day first | Year first |
|---|---|
| `10112025` | `20251110` |
| `10-11-2025` | `2025-11-10` |
| `10.11.2025` | `2025.11.10` |
| `10/11/2025` | `2025/11/10` |
| `10:11:2025` | `2025:11:10` |
| `10_11_2025` | `2025_11_10` |
| `10 11 2025` | `2025 11 10` |

Each of those is the tenth of November. A date uses the same separator twice, so `26:09.2026` is not a date. The `:` form exists because macOS Finder stores a `/` that a user types in a name as `:` on disk. Single-digit day and month are accepted (`1/2/2025` is the first of February).

When two candidates in digits overlap, the candidate with a four-digit year wins, also when the other candidate starts earlier. So `Lecture 3 12 10 2026` gives the twelfth of October 2026, and not `3 12 10`. The digits of the losing candidate that are outside the winning date stay in the title, where the lecture-number removal can take them.

A **two-digit year** is read only in the trailing position, and always as this century: `10-11-26` is the tenth of November 2026. It is read with every separator. When another date in digits in the filename names a real day with a four-digit year, each date with a two-digit year gives no date. Its text is still removed from the title. So `Lecture 2026-10-14 10:05:20` gives only the fourteenth of October 2026. When a filename has no four-digit year, a clock time with seconds can read as a date: `Rec 10:05:20` is the tenth of May 2020. A leading two-digit component is always the day. So `YY-MM-DD` is not a supported form, because nothing in `26-11-10` makes it different from `DD-MM-YY`. The year-first convention is written with four digits because that form sorts.

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
// exactly as typed — the title becomes the workspace folder and the source file names, so re-casing it
// misspells the subject in both, and no rule can tell `mRNA` from an ordinary word since either may mix
// cases. The cost is that a filename typed in lower case yields a lower-case title: names are exactly as
// consistent as the filenames are, and nothing here invents a spelling of its own.
// A thin or empty result is acceptable — a date-plus-number filename leaves nothing — and judge-lecture-title judges
// the title once the lecture is grouped into topics. The prefixes come from `naming.modulePrefixes` (§6) rather than
// being written here: a prefix names a module, and the pipeline is pointed at several. Each is matched
// literally and without regard to case, so one carrying a pattern character means itself, and an empty
// list strips nothing.
titledBaseName(args: { lectureNumber: number; title: string; date: Date }): string
// The titled `Lecture N - <title> - YYYY-MM-DD` base name shared by the workspace and the sources. Takes the
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
│   └── structured-transcript.json             # structure-transcript — the lecture's topics and subtopics, with the lecturer's words
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
│   └── placements.json                        # place-slides — the subtopic and the point of each placed slide
│
├── Term corrections/
│   ├── subtopic-1.json                        # correct-terms — the corrections of one subtopic
│   └── ...
│
├── Rewrites/
│   ├── subtopic-1.json                        # rewrite-subtopics — the rewritten subtopic of one subtopic
│   └── ...
│
├── Fact checks/
│   ├── <model>.json                           # check-facts — the reply of one model, named by the model and not by its role
│   └── factual-errors.json                    # check-facts — the merged factual errors of the lecture
│
├── Fact corrections/
│   ├── subtopic-1.json                        # correct-factual-errors — the fact-corrected subtopic of one subtopic
│   ├── ...
│   └── fact-corrected-subtopics.json          # correct-factual-errors — the fact-corrected subtopic of each subtopic
│
└── Slide relocations/
    ├── subtopic-1.json                        # relocate-slides — the paragraphs and the slide points of one subtopic
    ├── ...
    └── slide-relocations.json                 # relocate-slides — the entry of each subtopic, in lecture order
```

`build-notes-page` writes into `Final output/`, not into the workspace (§3.1).

#### The layout has one owner

Every name in the two trees above — the module's four directories, each stage's workspace directory and the file it writes, `Run logs/`, and `manifest.json` — is declared once, in `src/pipeline/layout.ts`. Nothing else states a directory or filename as a literal.

One owner matters here because each of these names is relied on by two parties at once, and a name changed for one has to reach the other:

- **A stage and the runner.** A stage writes into its directory. `--from-stage` clears the stage's work there (§4.7). Both read the directory from here, so a rename reaches the write and the reset together.
- **A stage and the stage after it.** `transcription` reads what `audio-extraction` wrote, `place-slides` reads what `structure-transcript` wrote. Each hand-off is one name, read at both ends.
- **Production and tests.** A suite asserting a stage's output exists asks the same module the stage asks.

```typescript
// src/pipeline/layout.ts
type ModuleDirs = { videoRecording: string; slideDeck: string; processing: string; finalOutput: string }
moduleDirs(args: { moduleRoot: string }): ModuleDirs      // the module layout of §3.1, stated once
type LectureInModule = { moduleRoot: string; baseName: string }
NOTES_PAGE_FILE: string                                   // "notes.html"
NOTES_PDF_FILE: string                                    // "notes.pdf"
NOTES_SLIDES_DIR: string                                  // "slides"
lectureNotesDirPath(lecture: LectureInModule): string
// The lecture's folder in `Final output/`, named by the base name. build-notes-page writes it, and a reset
// of the stage deletes it (§4.7).
notesPagePath(lecture: LectureInModule): string           // notes.html in that folder
notesPdfPath(lecture: LectureInModule): string            // notes.pdf in that folder
notesSlideImageEntry(slideNumber: number): string
// The path of a slide image relative to the notes page, such as `slides/slide-004.png`. The page links to
// the image by this path, and the stage copies the image to it.
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
workspaceRootFor(lecture: LectureInModule): string
// Where one lecture's workspace sits: a folder named with the lecture's base name, inside the module's processing
// directory. Every stage, the runner, the CLI and every suite that lays a lecture out asks for it here.
moduleRootOf(args: { workspaceRoot: string }): string
// The module two levels up from a lecture workspace (`moduleRoot/Pipeline processing/<folder>`) — the inverse
// of the above, so the nesting is stated once. Used to assemble StageContext.
moduleName(args: { moduleRoot: string }): string
// What a module is called when it is shown to the user: its directory leaf, since a module has no name beyond
// the folder it is. Read by the batch summary's module column and by the CLI's "nothing matched" message.
sharedLectureFileDirs(args: { dirs: ModuleDirs }): readonly string[]
// The three directories holding a lecture file — video, slide deck, notes folder — and so the three a
// lecture is addressed in by its date (§4.7). `processing` is excluded because a workspace is not found
// by its date in a shared directory. Walked by `renameLectureFiles`, by `delete`, and by the fixtures.

type StageDirectoryName = string & { readonly [declaredInLayout]: true }   // branded; minted only in layout.ts
// Branded, and the private constructor that mints it rejects a widened `string`, so a value read back from the
// manifest or an LLM response cannot reach this map. See §4.4, "Stage cleanup boundaries".
type StageFiles = {
  directories: readonly StageDirectoryName[]
  outputFile: string | null
  stageRecord: string | null
}
// `directories` are the workspace directories the stage works in. Each holds one lecture's work and nothing
// else, so a reset takes the whole directory (§4.7). build-notes-page has none, because it writes the
// lecture's folder in `Final output/` (§4.4, "Stage cleanup boundaries").
// `stageRecord` is a small JSON file beside `outputFile` saying how the stage reached it — which run a panel chose
// and why, or which titles changed. choose-division, retitle-subtopics and group-into-topics declare one
// (§4.5, "How a result was reached is kept beside the result"). It is recorded in `filesWritten` and cleared
// with the output, so the two cannot come apart.
STAGE_FILES = { … } satisfies Readonly<Record<StageId, StageFiles>>
// What each stage owns: the directories its work sits in, and the single file it writes where it writes one.
// `outputFile` is null for source-normalisation (which writes nothing of its own), for build-notes-page
// (which writes outside the workspace), and for the stages
// producing a set rather than a file (initial-subtopic-splitting and deepen-subtopic-splitting, one file per
// splitting run; render-slides and read-slides, one file per slide; correct-terms and rewrite-subtopics, one
// file per subtopic). check-facts, correct-factual-errors and relocate-slides write a set of files and also
// one file for the whole lecture. Their `outputFile` is that lecture file, which a later stage reads. group-into-topics works in two directories, `Grouping runs/`
// and `Topics/`, and its file is `Topics/topics.json`.
// Declared as the literal it is rather than annotated as the map, so the compiler keeps which stages carry a
// file; `satisfies` still proves every stage appears, so one added to StageId and forgotten here fails to
// compile.

type StageWithOutputFile = /* the keys of STAGE_FILES whose outputFile is a string */
// The stages that write one named file, derived from the table rather than listed beside it: giving a
// stage a file or taking one away changes who may be asked, with nothing else edited.

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
type StageWithStageRecord = /* the keys of STAGE_FILES whose stageRecord is a string */
stageRecordEntry(stageId: StageWithStageRecord): string
stageRecordPath(query: { workspaceRoot: string; stageId: StageWithStageRecord }): string
// The same three for the record.
stageDirectoryPaths(query: StageInWorkspace): readonly string[]
// Every directory the stage works in, as absolute paths, in declaration order. `[]` for a stage working in
// none. The factory creates these and clears them of leftovers before a run (§4.3), and a reset deletes them
// (§4.7).
```

### 3.4 Re-numbering When New Lectures Are Added

If a new lecture is inserted whose date falls between existing lectures, `source-normalisation` re-runs across all lectures in the module, detects the changed sequence, and renames all affected lecture files atomically (via a temporary name to avoid collision):

- Workspace folders in `Pipeline processing/`
- Source video and slide files in `Source files/`
- Lecture folders in `Final output/`
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
| `structure-transcript` | Per-lecture | Write the structured transcript: the lecture title, the topics and their subtopics, each subtopic with its own text. No model call |
| `render-slides` | Per-lecture | Render each page of the slide deck as one image. No model call |
| `read-slides` | Per-lecture | Read each slide image with a vision model: its title, body, tables, figures, caption and kind |
| `place-slides` | Per-lecture | Put each subject-matter slide at its point in the subtopic where the lecturer discusses it, in deck order |
| `correct-terms` | Per-lecture | Correct the misheard terms of each subtopic from the slides placed in it |
| `rewrite-subtopics` | Per-lecture | Rewrite the corrected text of each subtopic as prose |
| `check-facts` | Per-lecture | Find the factual errors in the whole rewrite, with one or two models and no transcript. Merge the factual errors of the two models |
| `correct-factual-errors` | Per-lecture | Correct the factual errors of each subtopic that has one, and write the fact-corrected subtopic of each subtopic in one file |
| `relocate-slides` | Per-lecture | Move each placed slide to its point in the fact-corrected subtopic, and give the figure numbers |
| `build-notes-page` | Per-lecture | Write the lecture's notes as one HTML page and as a Notes PDF, with its slide images, into `Final output/`. No model call |

Each stage runs once. No stage sends work back to an earlier stage (ADR 0003).

### 4.2 Stage Interface

Every stage implements a common `PipelineStage<TInput, TOutput>` contract. It has an idempotency check `isComplete(context)` and an input step `getInput(context)`. Its `run({ input, context, costTally })` returns a `StageResult`. The runner makes a new cost tally for each stage run, and records its total as the stage's cost. Each send of a model call adds its cost to the tally (§7). A `StageResult` holds no cost. Stages read an immutable `StageContext` and never change it. The context holds the lecture identity, `workspaceRoot`, `moduleRoot`, the resolved `PipelineConfig` and the current `Manifest`. The runner writes a stage's own bookkeeping in the manifest: its status, its cost and its `filesWritten`. The stage never writes them. The runner also writes the manifest's *lecture identity*. **No per-lecture stage writes `manifest.json`.** `judge-lecture-title` settles the lecture's title (§5, `judge-lecture-title`). It is the only stage that changes the lecture's identity. It reports what it settled on `StageResult.identityChanges`, and the runner writes that with the stage's `complete` entry.

A stage's context is assembled before its own entry is marked `running`, so the manifest copy it carries is out of date in that field for as long as the stage runs. The copy is a read model. The runner re-reads the manifest immediately before each write and is its only writer, so every write has a current base, and the `running` marker survives the stage it belongs to (§4.5). Currency and trust are separate questions: the manifest is untrusted input however fresh it is, bounded by §4.4.

**Authoritative types.** The exact shape of every pipeline contract — `PipelineStage`, `StageId`, `StageContext`, `StageResult`, `StageCost`, `StageConfigUsed`, and the rest — lives in `src/types/pipeline.ts` with per-field documentation. That file is the single source of truth; this section describes intent and the invariants those types encode, not field lists:

- `StageResult.cost` is `null` for stages that make no billable calls (audio-extraction, choose-division, structure-transcript, render-slides, build-notes-page).
- `StageResult.filesWritten` holds paths relative to `workspaceRoot`. They MUST resolve under `moduleRoot` — enforced by §4.4.
- `StageCost` is discriminated on `costUsd`. A resolved cost is a `number`. A failed lookup is `null` paired with an `unknownCostReason` (see §7).
- `StageResult.identityChanges` holds the lecture-identity fields the stage decided — `lectureTitle`, `aiDerivedTitle`, `baseName` — for the runner to write. Absent and `{}` both mean the stage decided nothing. Only `judge-lecture-title` ever decides anything. `baseName` is the lecture's canonical base name recorded in the manifest, not the runner's handle on the workspace — the runner locates that itself (§4.7).
- `StageResult.notices` holds the stage notices that the user must see (§10, "Stage Notices"). Absent means none.
- `lectureTitle` is always non-null — seeded by `source-normalisation`, possibly overwritten by `judge-lecture-title` (see §3.2, and §5, `judge-lecture-title`).

`isComplete()` checks two conditions: the manifest marks the stage `'complete'` or `'skipped'`, AND every path in `manifest.stages[stageId].filesWritten` exists on disk. Both must be true. The two statuses count alike because a run that honours this check records `skipped` in place of the `complete` it read, so from the next run's point of view they describe the same disk — the work is done and does not need paying for again. This means a completed stage whose output was manually deleted returns `false` and re-runs automatically. A recorded path that cannot be resolved at all counts as absent rather than as an error, since deleting a stage's output usually removes its containing directory too; a path resolving *outside* `moduleRoot` is a different matter and always throws (§4.4).

That check is the same for every stage but one. `build-notes-page` is complete when `notes.html` and `notes.pdf` are both in the lecture's folder in `Final output/`, under the lecture's current base name. Its manifest entry does not count. So the next run builds both files again when the user deletes either one (§5, "After the fact correction"). Each stage is built through a shared factory that supplies `isComplete` for the stage id. A stage defines only the two things that differ: how it gets its input, and what it does.

The factory carries two further things every stage would otherwise restate. It prepares the stage's output directories before `run` begins (§4.3), and it binds the run's logger to the stage **once, at construction**, so `run` is handed a logger already stamping `{ stage }` (§10). `logger` sits on the factory rather than on `PipelineStage.run`: the runner invokes a stage with the input and the context and nothing else, so the logging capability never travels through the stage contract, and `src/types/pipeline.ts` stays free of any dependency on the logging library.

```typescript
// src/pipeline/stages/pipeline-stage.ts
isStageComplete(args: { context: StageContext; stageId: StageId }): Promise<boolean>
createPipelineStage<TInput, TOutput>(args: {
  stageId: StageId
  logger: Logger                                        // the run's; bound to the stage here, once
  getInput: (context: StageContext) => Promise<TInput>
  run: (args: { input: TInput; context: StageContext; logger: Logger; costTally: CostTally }) => Promise<StageResult<TOutput>>
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
// It takes a stage that writes one file (§3.3). A stage producing a set builds its own `filesWritten`.
writeStageOutputWithStageRecord(args: {
  stageId: StageWithOutputFile & StageWithStageRecord
  context: Pick<StageContext, "workspaceRoot">
  value: unknown
  stageRecord: unknown
}): Promise<RecordedStageOutput>
// The same act for a stage that keeps a stage record of how it reached its output: the output and the stage
// record are each written as JSON, the stage record beside the output, and both entries are returned. Every
// stage keeping a stage record writes JSON, so both are given as values.
```

**Stage status semantics:**

| Status | Meaning |
|---|---|
| `pending` | Has not run in this pipeline configuration |
| `running` | Currently executing, or crashed mid-run — treated as `failed` on the next run |
| `complete` | `run()` succeeded and all output files are on disk |
| `failed` | `run()` threw an exception. `error` and `failedAt` are set |
| `skipped` | `isComplete()` returned `true` before the stage was invoked — output already existed from a prior run |

`skipped` is distinct from `not-reached`, the run log action used when an upstream failure prevented a stage from being attempted at all. A `skipped` stage was eligible to run; a `not-reached` stage was never considered.

### 4.3 Atomic File Writes

Every file is written to a `.tmp`-suffixed path first, then renamed on success. Any file that exists on disk without a `.tmp` suffix is guaranteed to be complete. At the start of every stage run, the stage's output directories are created if absent and any `.tmp` files left by a previous crashed run are deleted, before processing begins. This is automatic and requires no user intervention.

The stage does not do this for itself. `createPipelineStage` does it for every stage (§4.2). It reads the directories from `STAGE_FILES` (§3.3), not from the stage's output file. So a stage that owns several directories is prepared as completely as a stage that owns one.

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
`Final output/`, a lecture with no page. Each answers with an ordinary value rather than a throw, so no caller
wraps a listing in a try/catch:

```typescript
readDirSafe(dir: string): Promise<readonly Dirent[]>          // `[]` when the directory does not exist
pathExists(path: string): Promise<boolean>                    // whatever kind of entry it is
listFileNames(dir: string): Promise<readonly string[]>        // real files only, dotfiles excluded
listSubdirectoryNames(dir: string): Promise<readonly string[]>
// The last is how `Pipeline processing/` is scanned for lectures (§4.7). `listFileNames` is how a stage
// finds its source file by base name (§5, `audio-extraction`).
```

### 4.4 Path Validation

`filesWritten` entries and any other path derived from manifest or LLM output MUST be validated before any filesystem operation. The manifest is trusted only to the extent that the runner enforces its bounds — a corrupted or hand-edited manifest must never be able to delete, overwrite, or observe files outside the module tree.

**Boundary check.** For every path derived from the manifest or a stage's `filesWritten`:

1. Resolve with `path.resolve(workspaceRoot, entry)`.
2. Resolve the parent directory (or file, if it exists) with `fs.promises.realpath(...)` to collapse any symlinks.
3. Verify the resulting absolute path is a descendant of `moduleRoot`. Reject otherwise as a corrupt manifest.

This is enforced in every place a path from `filesWritten` or the manifest is used. Today that is one place — the `isComplete()` existence checks, via `recordedFileExists` — and it extends to `cost-report` file discovery as that is built.

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

**`filenameSafe(title)`.** Titles reach the filesystem in the base name. The workspace and the renamed source files carry the base name. A title comes from a user's filename (`source-normalisation`) or from a model's reply (`judge-lecture-title`). Neither source is a trusted path component. `filenameSafe` MUST:

- Strip path separators (`/`, `\`), directory-traversal segments (`.`, `..`), null bytes, and ASCII control characters.
- Collapse whitespace runs to a single space; trim leading/trailing whitespace and dots.
- Reject an empty result — the caller must fall back to `provisionalTitle` or a stage-defined default.

```typescript
filenameSafe(title: string): string   // src/utils/naming.ts; throws when the result would be empty
```

**Stage cleanup boundaries.** `--from-stage <stageId>` MUST NOT drive its cleanup off `filesWritten` from the manifest. Cleanup works from the hard-coded `STAGE_FILES` of each stage (§3.3), such as `Slide readings/` for `read-slides`. So a corrupt manifest cannot cause the deletion of unintended files. The type system enforces "hard-coded". A stage directory name is branded, and the private constructor that makes it refuses a widened `string` (§3.3). A `filesWritten` entry or LLM-supplied name reaching that map is a compile error.

Every stage directory is in the workspace, and each holds one lecture's work and nothing else. So cleanup takes each directory whole. No stage can declare a directory outside the workspace, so a reset cannot reach another lecture's work. `build-notes-page` declares no directory. It writes the lecture's folder in `Final output/`, which also holds the folder of each other lecture. A reset of the stage deletes the folder that `lectureNotesDirPath` gives for the lecture's base name, and no other folder (§3.3).

The delete target is anchored at the other end too: `workspaceRoot` is always built by `listWorkspaces` as `join(moduleDirs({ moduleRoot }).processing, <directory listing entry>)`, and the manifest is read only to match a lecture date, never to supply a path. So `moduleRootOf(workspaceRoot)` returns the same `moduleRoot` the caller passed in, and neither root nor name is manifest-derived.

**No shell interpolation.** Every child process in the pipeline MUST use `spawn(cmd, argv, opts)` with an explicit argv array. Examples are fluent-ffmpeg in `audio-extraction` and any future subprocess call. Never use `exec(shellString)`, or any variant that joins paths into a shell command. This rule removes a class of bug. In that bug, a folder name with spaces breaks out of an argument through unescaped shell metacharacters. Examples are `Final output/`, `Slide images/` and `Term corrections/`. A title string from an attacker can do the same. Paths go into argv unchanged. No quoting is necessary or applied.

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
// goes on to read — `lectureNumber`, `lectureDate`, `stages`. The check reads nothing in a stage entry.
writeManifest(args: { workspaceRoot: string; manifest: Manifest }): Promise<void>   // atomic (§4.3); creates the workspace if absent
patchManifest(args: { workspaceRoot: string; manifest: Manifest; changes: Partial<Manifest>; updatedAt: string }): Promise<Manifest>
// Lays changes over the manifest, stamps `updatedAt`, and writes the result. All three callers do exactly
// that, so an edit cannot leave a manifest claiming nothing happened to it. The instant is given rather than
// read here because the runner's is not simply "now": it stamps the same instant it writes into the stage
// entry, so the manifest and the entry inside it name one moment.
```

Each stage entry records `configUsed`, a `StageConfigUsed`. It holds the model ID and the tuning that the run resolved: temperature, max tokens, concurrency, calls at once and send gap. It is `null` for stages that make no LLM calls, except `build-notes-page`. That stage records `pageViews` and `highlightSlideSentences`, the two values of `finalOutput` that shape the page, and `pdf`, the settings of the Notes PDF (§6). `correct-factual-errors` records `bypass` with its model settings. Each value is the one that the run used, after any flag of the run (§4.7, "Flags that override the config"). This lets spend be attributed to a specific model and configuration and lets model experiments be compared (NFR-3.2). The run logs (§4.6) record the same `configUsed` per attempt.

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
    "structure-transcript": {
      "status": "complete",
      "completedAt": "...",
      "configUsed": null,
      "cost": null,
      "filesWritten": ["Structured transcript/structured-transcript.json"]
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
    "correct-terms": {
      "status": "complete",
      "completedAt": "...",
      "configUsed": { "modelId": "google/gemini-3.8-flash", "concurrency": 5 },
      "cost": { "promptTokens": "…", "completionTokens": "…", "costUsd": "…", "callCount": "…" },
      "filesWritten": ["Term corrections/subtopic-1.json", "…", "Term corrections/subtopic-21.json"]
    }
  }
}
```

**A stage with a list of models** (§6) records the cost of each model as well as its total. Its entry has `costByModel`, a list of `{ modelId, cost }` with one item for each model that the stage called. Its `configUsed` holds `models`, the config of each model that the stage used, with its `role`. A model is used when the stage calls it, or reads its saved reply. The run log entry of the stage has the same two fields. In the stage entry, the cost of each model includes that model's cost in the earlier runs since the last reset, as `cost` does. In the run log, it is the cost of this run only. Today only `check-facts` has a list of models.

Each stage's `cost` is the only record of what that stage cost, and the manifest holds no roll-up of them. A reader that wants a stage's spend reads that stage's entry. Nothing has to be kept in step with anything else. A stage that `--from-stage` resets takes its cost with it when its entry goes back to `pending` (NFR-2.2).

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
    "structure-transcript":   { "action": "skipped" },
    "render-slides":          { "action": "skipped" },
    "read-slides": {
      "action": "ran",
      "status": "failed",
      "configUsed": { "modelId": "google/gemini-2.5-flash", "temperature": 0.1, "maxTokens": 4096, "concurrency": 3 },
      "error": "Rate limit exceeded after 3 retries on slide 14",
      "cost": { "costUsd": 0.021, "callCount": 13 }
    },
    "place-slides":      { "action": "not-reached" },
    "rewrite-subtopics": { "action": "not-reached" }
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
isCompletedEntry(entry: StageEntry | undefined): entry is CompletedStageEntry
// Whether a *manifest* entry means the stage's output is on disk — `complete` or `skipped` (§4.2). Three
// unrelated callers ask it: the shared `isComplete`, the run classifier, and the cost report's current-pipeline
// section. A type guard rather than a boolean, so a caller that has checked can read `filesWritten` without a cast.
```

**Run outcome classification.** A `PipelineRunSummary.overallStatus` — and the aggregate `BatchSummary.overallStatus` across a batch's lectures — is `failed` when at least one stage failed, and `success` otherwise, a stage whose output already stood and was skipped included. It reports on this run, not on the lecture: a run bounded by `--to-stage` succeeds with later stages still `pending`, and the manifest is where how far a lecture has got is read.

**Pipeline order comes from `STAGE_IDS`.** `src/types/pipeline.ts` declares `STAGE_IDS` as the ordered stage list, and everything that walks the stages in order — the runner's `--from-stage` reset, the cost report's per-stage breakdown — iterates that array. A map elsewhere in the code is a lookup keyed *by* stage, and its key order is that map's own; the pipeline's order has one statement, and adding a stage to it is what puts the stage in the sequence.

**`--from-stage <stageId>`:** Resets the nominated stage and all downstream stages to `pending` in the manifest. Also deletes the intermediate files of each stage that runs again, such as `Slide readings/*.json` for `read-slides`. So the new run makes entirely fresh output. Upstream stages are untouched. The deletion uses the hard-coded directories of each stage (see §4.4), and never `filesWritten` from the manifest.

**The reset is confirmed before anything is deleted (NFR-4.3).** The CLI asks once per invocation, leading with the number of lectures that will lose work, and declining runs nothing at all rather than running without the reset. The count is what makes the question worth reading, because nothing the user typed states it: `run <date>` covers however many lectures that date matched and they then chose, and `batch` covers every lecture in the module named — or, with no module named, in every configured one. The question is asked wherever that set first becomes known, which is the CLI for a date and, for a batch, only after `countLectures` has scanned the modules (§4.7, "Counting a batch's scope"). Establishing the count costs that scan, so it is taken only when a stage is nominated; an ordinary run asks nothing and pays nothing. There is no flag to suppress the question.

**`--to-stage <stageId>`:** The last stage the run performs. Stages after it are not run and are recorded `not-reached`, exactly as the stages after a halt are — the run stopped short of them, and the run log should say so in the words it already uses for that. Nothing is reset, nothing is deleted, and no confirmation is asked: a run that stops early destroys no work.

It is a position in `STAGE_IDS`, not a name to match, so a stage the pipeline has not yet built still bounds the run: `--to-stage transcription` stops after `transcription` whether or not the stages beyond it exist. Naming a stage the lecture runs before any lecture stage — `source-normalisation` — runs none of them, which is what a caller asking for normalisation alone means by it.

Given with `--from-stage`, the two flags bound the run at both ends, and the pair must be in pipeline order. The parser refuses `--from-stage place-slides --to-stage transcription`, so the run does not silently do nothing.

The flag exists because of the cost of the stages after the ones that a run needs. A segmentation experiment on five lectures reads only `Transcript/transcript.txt`. Without this flag, that run also pays for every model stage after `transcription` on every lecture.

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

The runner **builds the context again between stages**. It does not build one context for the whole run. This costs no extra reads. The runner already reads the manifest again at every change of stage. So `updateManifest` gives back what it wrote, and the runner builds the next context from that. The result is that a stage's manifest changes reach the stages after it. For example, `judge-lecture-title` replaces `lectureTitle`, and `structure-transcript` writes it as the lecture title.

**Following a relocated workspace.** `judge-lecture-title` renames the workspace folder when it replaces the lecture's title (§5, `judge-lecture-title`). The path that the runner holds is then wrong. Stages do not report the move. The runner finds the lecture again by the identity that this section treats as canonical: `(moduleRoot, lectureDate)`. `resolveWorkspace` reads the manifest at the path it has. If that read fails, it calls `findLectureByDate`, which searches `Pipeline processing/` for the workspace whose manifest carries the date. The runner calls `findLectureByDate` only after a stage moved the folder. Every other change of stage costs only the usual read. The runner writes the run log at the found path, and `PipelineRunSummary.workspaceRoot` reports that path. So a run that renames its own workspace still leaves its log beside the work.

**Counting a batch's scope.** `countLectures({ moduleRoots })` reports how many lectures stand across those modules, applying the same reading as the batch itself: a folder holding no manifest is not a lecture, and a module the pipeline has never processed holds none. It exists because the `--from-stage` confirmation has to state a number the user has no other way of knowing, and it is called only on that path — the scan it costs is not something an ordinary batch should pay for. Sources are normalised before it runs, so a lecture whose video and slides were only just added is counted; the batch is about to run it either way.

**Batch mode:** `runBatch({ moduleRoots })` normalises every listed module, then processes every lecture across them. The CLI passes an array of one for `batch <moduleRoot>` and the full `config.moduleRoots` for `batch` (no argument). Modules processed in the order given; lectures within a module in date order. How many lectures run at once is the config's `batch.concurrency` (§6); `--concurrency N` overrides it for one command. Lectures are drawn from a single global queue rather than per module — with modules in order, a global queue keeps every worker busy where a per-module one would idle at each module boundary. Because lectures from different modules may therefore be in flight together, the per-module and cross-module summaries are printed once the batch completes rather than as each module finishes (§7).

**`cost-report` command:** Reads the run logs of every lecture across the configured `moduleRoots` and renders one three-section report per lecture, each headed by the lecture it covers — what its outputs on disk cost, what its failures and retries cost, and its model experiments grouped for comparison (see §7). Figures are per stage throughout; nothing is summed across stages, runs, lectures or modules (NFR-2.2). The reports are handed back for the CLI to write (§8). Narrowed by `--date` (via `resolveLecturesByDate`, with the same multi-match prompt) or `--module <moduleRoot>`. Where the scope holds no lecture, the command says so and succeeds.

**Identity-change commands (`rename`, `delete`, `change-date`).** A lecture's identity changes only through these commands, never by an edit of the filesystem. So the manifest and the filesystem stay in step (see `source-normalisation`, §5):
- `rename <date> "<new title>"` — sets `userTitle` in the manifest, which then wins the title precedence. It renames the video, slide, workspace folder, and any notes folder in `Final output/` to match.
- `delete <date>` — removes the lecture's video, slide, workspace, and outputs, then renumbers the remaining lectures.
- `change-date <date> <new date>` — moves the lecture (video, slide, workspace, outputs) to the new date, updates its manifest, and renumbers.

Each performs its change and then re-runs `source-normalisation` to return the module to a consistent, renumbered state. A lecture is addressed by `<date>`, resolved through `resolveLecturesByDate`.

**An identity change acts on exactly one lecture.** FR-6.7 asks for commands to rename *a* lecture, delete *a* lecture, and change *a* lecture's date, so a date that turns out to name several is a question to settle, not a licence to act on all of them: all three use a single-choice picker with no "All matches", and cancelling leaves the module untouched. `run` and `cost-report` keep the multi-select picker, since running or reporting on several lectures at once is exactly what they are for.

Each identity change leaves the module in a state `source-normalisation` can finish, rather than doing its work itself:

- **`rename`** trims the new title and makes each run of whitespace in it one space. It writes the result as `userTitle` and `lectureTitle` to the manifest and stops there. The `source-normalisation` pass that follows renames the video, slide, workspace and notes folder. It names them from the manifest's current `lectureTitle`, with the code that named them first. So a rename cannot drift from a normalisation.
- **`delete`** asks for confirmation. Then it removes the video, the slide, the workspace and the notes folder in `Final output/`. The sources and the workspace go together, and this keeps the module consistent. The next `source-normalisation` run would stop to ask about a workspace left without sources, because it is an orphaned workspace. Sources left without a workspace would be normalised back into one. `source-normalisation` then renumbers the lectures that follow.
- **`change-date`** renames the video, slide and notes folder to the base name that `source-normalisation` would give them at the new date. It renames the workspace folder to match, and writes the new `lectureDate` and `baseName` to the manifest. So the `source-normalisation` pass that follows has only renumbering left. That pass renames again if the new date changes the lecture's number. `change-date` refuses when a source file already carries the target date, because a rename would overwrite another lecture. It also refuses when the lecture's own video or slide is missing.

**Moving a lecture's files.** `change-date` and `judge-lecture-title` both give the same four things a new base name. These are the source video, the source slide, any notes folder in `Final output/` and the workspace folder. So the code that moves them is written once and shared. It is in `src/pipeline/`, not beside the CLI commands that first called it, because a stage must not import from the CLI layer.

Removing one lecture's file lives here for the same reason. Every directory a lecture's own files sit in is shared with every other lecture in the module. So `delete` takes one lecture file from each, not the whole directory. It finds the lecture file by the date that its name carries, as everything else here does. A lecture file is a file or a folder. The notes of a lecture are a folder, and `delete` deletes it with everything in it.

```typescript
// src/pipeline/lecture-files.ts
listWorkspaces(args: { moduleRoot: string }): Promise<readonly string[]>
// The absolute path of each folder in the module's `Pipeline processing/`. A folder in the list can lack a
// manifest, so each caller reads it before it treats it as a lecture. The runner uses it (§4.4, "Stage
// cleanup boundaries").
baseNameForLecture(args: { lectureNumber: number; title: string; lectureDate: string }): string
// `lectureBaseName` (§3.2) for a caller holding the date as the `YYYY-MM-DD` string the manifest stores.
// Both callers that move a lecture hold it in that form, so the conversion is made here rather than at each:
// the string must be read as *local* midnight, matching how `formatDateISO` writes one, or the base name
// lands a day early west of Greenwich.
findLectureFileByDate(args: { dir: string; lectureDate: string }): Promise<string | null>
// The name of the one lecture file in a directory whose name carries this date. A lecture file is a file
// or a folder, and a dotfile is never one. Lecture files are addressed by date rather than by name because
// a lecture's name changes with its number and title, while its date is what identifies it (§3.2).
// The *last* date in the name is the one compared: these directories hold names source-normalisation has normalised, and
// `lectureBaseName` puts the title before the date, so a title naming a date of its own — a cohort, a study,
// a historical event — precedes the lecture's own.
removeLectureFileByDate(args: { dir: string; lectureDate: string }): Promise<void>
// Removes the one lecture file in a directory carrying this date, where there is one, and a folder with
// everything in it. Used by `delete` across all three of a lecture's directories. It may not sweep a
// directory: all three hold every lecture in the module.
renameLectureFiles(args: { dirs: ModuleDirs; workspaceRoot: string; lectureDate: string; baseName: string }): Promise<string>
// Renames the video, the slide, any notes folder in Final output/, and the workspace folder onto `baseName`,
// and returns the workspace's new path. A file keeps its extension. A folder gets the whole base name,
// because a title such as "Dr. Smith" puts a full stop in a folder name that has no extension. Anything
// absent is skipped, so a lecture with no notes yet moves cleanly. A caller that requires a file to be
// present checks for it first, as `change-date` does for the source pair.
```

#### CLI Structure

`src/index.ts` is a bootstrap and nothing more: it loads `dotenv`, hands `process.argv` to `runCli`, and sets the exit code. Everything else lives under `src/cli/` so that it can be tested without a process, a terminal, or a real pipeline:

```typescript
// src/cli/args.ts — the command line, parsed and validated
type CliCommand = { command: 'run'; lectureDate; options; configOverrides }
                | { command: 'batch'; moduleRoot: string | null; options; configOverrides; concurrency }
                | { command: 'cost-report'; lectureDate: string | null; moduleRoot: string | null }
                | { command: 'rename'; lectureDate; title } | { command: 'delete'; lectureDate }
                | { command: 'change-date'; lectureDate; newLectureDate } | { command: 'help' }
parseCliArgs(args: { argv: readonly string[] }): CliCommand   // throws CliUsageError. USAGE holds the help text
// `configOverrides` holds the word of each of the three flags above, or `null` for a flag not given.
// applyConfigOverrides (src/pipeline/config.ts) lays them over the loaded config in runCli.

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

The CLI checks the command line in full before anything runs:

- The command must exist.
- Its positional arguments must be present and well formed.
- `<date>` must be a real calendar date. `2025-02-30` is rejected as firmly as `yesterday`.
- `--from-stage` and `--to-stage` must each name a stage that exists, and must be in pipeline order.
- `--concurrency` must be a whole number of 1 or more.
- Each flag that overrides the config must have a value that it accepts.

**Flags belong to commands.** They are declared once for the whole CLI, so `parseArgs` will accept any of them anywhere; each command then declares the ones it acts on, and anything else is a usage error naming the flag and what the command does take. So `run --concurrency 4` is refused and says why: `--concurrency` counts lectures running at once, and only `batch` runs more than one.

**Flags that override the config.** `run` and `batch` take three flags. Each flag replaces one config value for this invocation only. The config file does not change. With no flag, the config value applies.

| Flag | Values | Replaces |
|---|---|---|
| `--fact-correction` | `run` or `bypass` | `stages.correct-factual-errors.bypass` |
| `--page-views` | a list with commas, such as `notes,transcript`, or `all` | `finalOutput.pageViews` |
| `--highlight-slide-sentences` | `on` or `off` | `finalOutput.highlightSlideSentences` |

- `--page-views` takes the names of `finalOutput.pageViews`, with the same checks (§6). The list must name `notes`. `all` gives the four views, and it cannot be in a list with names.
- A flag with another value is a usage error. The error names the values that the flag accepts.
- The CLI applies the flags to the config once, after it reads the config. So each stage reads the value of the flag as a config value, and the run log records that value (§4.5).
- A flag changes only the stages that run. A complete stage does not run again because of a flag, as with `--concurrency`. To build a page again with other views, the user adds `--from-stage build-notes-page`. To run the fact correction again, the user adds `--from-stage correct-factual-errors`, and the reset question applies as usual.

**`run <date>` normalises first.** Before resolving the date it runs `source-normalisation` across the configured modules. This is what lets `run` be the first command for a lecture whose video and slides were only just added: `source-normalisation` creates the workspace and manifest the date then resolves against. `source-normalisation` is idempotent, so this costs nothing when there is nothing new.

**Exit codes.** `0` when the command did what was asked, `1` when it could not: an unusable command line, a date matching no lecture, an unreadable configuration, or a run in which any stage failed. A user who cancels a choice has not failed at anything and exits `0`.

**`--help` is answered before the configuration is read**, so the commands can be discovered in a project that is not yet configured.

---

## 5. Stage Designs

**Where prompts live.** A stage that calls an LLM keeps its prompt in a module of its own, `<stage>.prompt.ts`, in the stage's folder (§9). The module exports the function that builds the messages. Only stages that make LLM calls have one. `source-normalisation`, `audio-extraction`, `transcription`, `choose-division`, `structure-transcript`, `render-slides` and `build-notes-page` do not. A stage that makes more than one kind of call has one prompt module, with one builder for each kind. Two prompts that share a text take it from a module of its own beside the stage folders. The writer's rules R2 to R9 are such a text (`rewrite-subtopics`).

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

5. **Base names:** Rename the source video and its matched slide, the workspace folder, and any notes folder in `Final output/` to the shared base name `Lecture N - <title> - YYYY-MM-DD`. The base name is a bare `Lecture N - YYYY-MM-DD` when the title is empty. Lecture files already at their target are left untouched.

6. **Workspace + manifest:** Create `Pipeline processing/Lecture N - <title> - YYYY-MM-DD/` for any lecture that does not already have one, writing an initial `manifest.json` with `lectureNumber`, `lectureDate`, `provisionalTitle`, `lectureTitle = provisionalTitle`, `userTitle = null`, `aiDerivedTitle = null`, and all stage statuses `pending`. For an existing lecture whose number or folder changed, update `lectureNumber` and `baseName` in its manifest, preserving everything else.

**Collision-safe renaming.** When the sequence changes, all renames of source files, workspace folders and notes folders in `Final output/` are made in two passes. The first pass moves each lecture file to a temporary name. The second moves each temporary name to its target. So shifting lecture numbers never collide during a rename. Lecture files already correct are skipped, so a re-run with no changes touches nothing.

The temporary suffix sits outside the `.tmp` convention of §4.3, because the two name opposite things: a `.tmp` file is a partial write and is deleted at stage start, while a `source-normalisation` temporary holds a complete lecture file — the only copy of a source video, or a whole lecture workspace — between leaving one name and reaching the next. A run therefore begins by finishing any rename its predecessor was interrupted partway through: every temporary entry across the module's four directories is moved on to its target before anything is read, so an interrupted run costs the next one nothing. Where a target name is occupied, the run stops and names those entries, leaving every one of them where it stands.

**Orphaned workspace handling (direct-deletion guard).** A workspace can have a date with **no source pair present**: both its video and its slide are gone. (A partial loss already breaks a source rule.) Then the sources were deleted directly, not through the CLI, and the pipeline can be inconsistent. `source-normalisation` does not silently delete work, and it does not silently continue. For **each** orphaned workspace, it asks the user whether to delete the workspace and its outputs. The question shows the lecture's number, title and date. It goes through an injected `confirm` callback, which the CLI backs with `@inquirer/prompts`. The question quotes no figure. What a lecture cost is the sum of its stages, and stage costs are not summed (NFR-2.2). The lecture's own cost report shows what was spent on it, and `cost-report` prints it until the workspace goes. A final "are you sure?" question comes only when the user approves **every** orphaned workspace. After a yes, the workspaces and their notes folders in `Final output/` are deleted, with their manifests. The module is renumbered, and each deletion is logged with its prior state. If the user declines **any** orphaned workspace, or the final question, `source-normalisation` stops with an informative error and makes **no changes**. This protects the work when, for example, the whole source folder was moved by mistake.

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

These three stages, `retitle-subtopics`, `group-into-topics` and `judge-lecture-title` (below) run after `transcription` and before `structure-transcript` (§4.1).

**No check step follows them.** Every other stage where a model transforms content is followed by a separate check (README, "All work is verified with separate models"). These four transform nothing: the model says only where the transcript divides and how subtopics group, and the text is sliced by code, so losslessness is guaranteed rather than checked. What remains to judge — whether a cut or a grouping is well placed — is what the panel settles: a cut survives only where enough runs agree, and a grouping is the one most of the panel made. No checker exists for that judgement, and one would have to be designed and calibrated before its verdict could be trusted.

**Panel runs.** The two splitting stages and `group-into-topics` each make a panel of independent runs, and share one behaviour around the model call:

- The stage makes a few runs at a time. The stage's `concurrency` setting (§6) sets how many. When the setting is unset, the stage makes one run at a time.
- Once a run fails, no further run is started. Runs already in flight are let finish, and are saved, before the stage fails, so what they cost is not paid again on relaunch.
- Each run is saved to its own file the moment it is complete, so a crash loses only the runs in flight.
- A relaunched stage reads the runs already saved and makes only the missing ones. A saved run file that cannot be read is a named error, not a run to make again. The pipeline writes each file whole or not at all (§4.3). So an unreadable file means that something outside the pipeline changed it.
- The stage sends a call again when its reply is empty, is not JSON, or is the wrong shape. It sends each call up to three times, with a longer pause before each resend. Empty replies are the common case: a provider occasionally answers with success and no content, and a plain resend has always worked. After the third failure the stage fails with an error naming the run and the last cause. A stage never goes on with fewer runs than its panel, because a missing run changes what the vote means. A call the provider refuses is resent as every call is (§6, "A rejection can arrive inside an accepted reply").
- A stage with a `sendGapSeconds` (§6) spaces its sends. Each send waits until at least that time has passed since the stage's previous send began. This applies to the first send of a run, to a resent unusable reply and to a resent refusal. The runs are released together and take their turn, so no two sends land together however the replies and resends fall.
- Every send is costed, failed ones included.
- Every unusable reply is logged as a warning. The warning names the run, the send number and the reason that the reply was unusable. So the log of a run shows how often replies fail, and in what way, even when a later send succeeds. The warning also holds the text of the reply in `replyText`. For a reply that a stage refuses after parsing, `replyText` holds the parsed reply as JSON. The reason names only the kind of fault. So the text is the only record of which part of the reply was wrong.

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
writeDivisionWithStageRecord(args: { stageId: StageWithStageRecord; context: StageContext; subtopics: readonly Subtopic[]; stageRecord: unknown }):
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
// Makes the stage's panel in its own directory at its configured concurrency.
// The panel's size is the caller's: the splitting stages pass the division's, group-into-topics the grouping's.
runOneCallPanel<TReply, TRun>(args: { stageId; context; panelSize; readRun; runName: string; calls: StageModelCalls; request }): Promise<StageResult<{ runs: readonly TRun[] }>>
// runStagePanel where every run is the same one JSON call: initial-subtopic-splitting and group-into-topics.
readPanel<TRun>(args: { panelSize: number; directory: string; readRun; fail }): Promise<readonly TRun[]>
// readRun reads a parsed run file as a run, or gives null when it is not one, which is a named error.
// Reads back a panel an earlier stage finished; a missing run throws the error `fail` builds.

// src/pipeline/stages/saved-files.ts — shared by the panel stages and read-slides
readOrMakeSavedFiles<TFile extends { path: string }, TContent>(args: { files: readonly TFile[]; label: string;
  concurrency: number | undefined; readSaved; unreadable; make }): Promise<{ contents }>
// Reads each saved file that exists and makes each missing one, `concurrency` at a time, saving each as it is made.
// A saved file that holds nothing readable throws the error `unreadable` builds, so each stage raises its own error.
// A parallel work bar (§10) shows each file by its number from 1, after `label`: "Runs" for a panel, "Slides" for
// read-slides. A saved file counts as done at once. A file whose make fails shows in red.

// src/pipeline/layout.ts
stageDirectoryPath(args: { workspaceRoot: string; stageId: StageId }): string
// The first folder that a stage owns, or the workspace when it owns none. The panel stages save their runs there.

// src/pipeline/stages/model-stage.ts — shared by every model-calling stage
sendJsonWithResends<TReply, TKept>(args: JsonReplyRequest<TReply> & { what: string; use }): Promise<UsableJsonReply<TKept>>
// tryJsonReplyAs, resent until usable: every call the splitting, retitling, grouping and title-judging stages make.
// The third unusable reply is a ResendsExhaustedError.
type StageModelCalls = { sendJsonWithResends }
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
**Conditional side effect:** The stage renames the source video, the source slide, the workspace folder and any notes folder in `Final output/`. It does this only when the model judges the provisional title not meaningful and no user title is set.

The stage judges whether the provisional title is meaningful for the lecture's content (CONTEXT.md, "Judging the lecture title"). A title that the lecturer wrote is authoritative. So the model keeps a meaningful title and proposes nothing. The model proposes an AI-derived title only when the provisional title is not meaningful: empty, generic, or in conflict with the content.

**The input.** The stage sends the model the whole lecture as JSON. Each topic of the chosen grouping holds its title and its subtopics, in order. Each subtopic holds its retitled title and its full text, trimmed:

```json
{ "topics": [ { "title": "…", "subtopics": [ { "title": "…", "text": "…" } ] } ] }
```

The retitled subtopics hold only the span of each subtopic in the transcript. So the stage reads `Transcript/transcript.txt` and cuts the text of each subtopic from it, as `retitle-subtopics` and `group-into-topics` do. It sends no subtopic ids and no reasons, because they do not help the judgement. The stage also sends the provisional title. An empty provisional title is sent as a statement that the filename carried no title.

**The prompt** is the title part of the prompt of an earlier stage, which structured the whole transcript in one call. It keeps the same rules. The lecturer's title is authoritative. The model must not propose a title only because it can write a better one. An AI-derived title has four to eight plain words, because it becomes a filename. The prompt adds these things:

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
| Not meaningful, and no user title | `adopted-derived` | `aiDerivedTitle` and `lectureTitle` take the proposed title. The source video, the source slide, the workspace folder and any notes folder in `Final output/` move to the new base name. `baseName` changes in the manifest. |
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
4. When the changes include `baseName`, move the source video, the source slide, any notes folder in `Final output/` and the workspace folder with `renameLectureFiles` (§4.7).
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

### `structure-transcript` — the lecture in one file

**Input:** `Transcript/transcript.txt`, `Retitled subtopics/subtopics.json`, `Topics/topics.json`, and `lectureTitle` from the manifest
**Output:** `Structured transcript/structured-transcript.json`

The stage writes the structured transcript (CONTEXT.md, "Structured transcript"). It makes no model call, so its cost is `null` (§4.2). It runs directly after `judge-lecture-title`, so the lecture title is final.

The stage does not read the chosen division or the title judgement. The retitled subtopics hold the whole chosen division with the new titles. The manifest's `lectureTitle` obeys a user title (§5, `source-normalisation`, "Title precedence"). The title judgement does not.

The file holds `lectureTitle` and `topics`, the topics in lecture order. Each topic holds its `title` and its `subtopics` in order. Each subtopic holds its `subtopicId`, its `title` and its `text`. The stage cuts each text from the transcript by the subtopic's span, and removes the whitespace at the two ends. The text is the lecturer's words, unchanged. The file holds no position in the transcript and no reason that a model gave. So each subtopic stands alone, and the later stages read the lecture from this one file.

The stage fails when an input file is missing, unreadable or the wrong shape. The error names the file.

---

### `render-slides` — an image of each slide

**Input:** `Source files/Slide decks/<base name>.pdf`
**Output:** `Slide images/slide-001.png`, `slide-002.png` and so on, one for each page

The stage renders each page of the slide deck as one PNG image at 150 DPI, with `pdfjs-dist` and `@napi-rs/canvas`. The stage gives `pdfjs-dist` the folder of the WebAssembly image decoders that ship with it. Without them, `pdfjs-dist` draws nothing for a fax-encoded or JBIG2 image, such as a scanned chemical structure. The images are numbered from 1 in deck order. The stage makes no model call, so its cost is `null` (§4.2).

The notes show a slide as one whole image (CONTEXT.md, "Slide"). No figure is cut out of a slide. A vision model gives imprecise position boxes, so a crop can lose an axis label or take part of the text beside the figure. A whole slide is always complete.

The stage fails when the slide deck is missing, or when `pdfjs-dist` cannot read it. The error names the file.

---

### `read-slides` — what each slide holds

**Input:** `Slide images/slide-001.png` and the rest
**Output:** `Slide readings/slide-001.json` and so on, one for each slide

A vision model reads each slide image and returns one slide reading (CONTEXT.md, "Slide reading"). The stage makes one call for each slide. The stage's `concurrency` sets how many calls are in flight at once (§6).

The stage does not take the text from the PDF. Biology slides hold pathway diagrams, tables, formulas and micrographs. A text-extraction library puts columns in the wrong order and loses the structure of a table. A vision model reads a slide as a person does.

**The model reads the slide alone.** The call sends the slide image and nothing else. It sends no slide number, no transcript and no lecture title. So a reading says only what is on the slide. The kind comes from what the slide shows, and not from its place in the deck. A learning-objectives slide can be first and last, and a section divider can be in the middle.

**The reply** is a JSON object with six fields. Each word on the slide goes into one field only.

- `title`: the slide's title, word for word. It is empty when the slide has no title.
- `body`: the words that are not in the title, a table or a figure, word for word and in reading order, as Markdown. A subheading is a Markdown heading, a bullet is a list item, and a formula is LaTeX. It is empty when the slide has no such words.
- `tables`: one Markdown table for each table on the slide.
- `figures`: one entry for each figure (CONTEXT.md, "Figure"). An entry holds `type` and `description`. `type` is `diagram`, `chart`, `micrograph`, `photograph`, `drawing` or `printed page`. The description holds the figure's parts, labels, arrows and relationships. It also holds what each mark on the figure shows, such as an outline, a circle or a highlight. A printed page is described, and only its headings and the parts that the slide marks are copied word for word. Image credits, URLs and copyright lines are left out, unless one tells what a figure is. Then it goes in the description of that figure.
- `caption`: one sentence of at most 20 words that tells a student what the slide shows. It starts with the subject itself, as a textbook caption does. It never starts with words for the slide or the figure, such as "The slide shows" or "An overview of".
- `kind`: `subject-matter`, `content-free` or `references` (CONTEXT.md, "Content-free slide").

**The prompt** is in Markdown sections: task, purpose, input, the structure of a reading, method, fields, rules and output. The purpose section tells the model that a later step places the slide from the reading. So the model copies the words exactly and describes each figure fully. The structure section comes before the method, because the model must know which words go into which field before it starts. The prompt applies `languageRule` (§6) to the caption and to the figure descriptions. The title, the body and the tables keep the slide's own spelling. A word that the model cannot read is written as `[illegible]`.

A reply is unusable in each of these cases:

- It is not a JSON object with those fields and types.
- `caption` is empty.
- `kind` is not one of the three values.
- The `type` of a figure is not one of the six values.

The stage resends an unusable reply in the same way as a panel run. It fails after the third send (§5, "Dividing the transcript", Panel runs).

**What is written.** The stage writes each reading to its own file as soon as the reply is usable. The file holds `slideNumber` and the six fields of the reply. A stage that failed and starts again reads only the slides that have no reading. A panel stage makes only its missing runs in the same way. `--from-stage read-slides` clears `Slide readings/`, so every slide is read again.

The stage fails without a model call when `Slide images/` is missing or holds no image. It also fails when a slide's third send is unusable. Then the stage sends no further slide. The calls in flight finish, and the stage keeps their readings.

**The model** is set on the stage's own entry (§6). It must accept images. It is `google/gemini-3.8-flash`, at the same price as the 3.7 Flash of the division stages.

---

### `place-slides` — each slide with its subtopic

**Input:** `Structured transcript/structured-transcript.json`, `Slide images/`, `Slide readings/`
**Output:** `Slide placements/placements.json`

The stage puts each subject-matter slide with the subtopic where the lecturer discusses it (CONTEXT.md, "Slide placement"). The slide goes at the sentence where the lecturer starts to discuss it.

**One call for the whole lecture.** The model gets every subtopic in order, as its subtopic id, its title and its full text, trimmed. The stage takes them from the structured transcript. The model also gets the reading of each subject-matter slide in deck order, whole, as `read-slides` wrote it. So the model sees the caption that a student sees. The subtopics go without their topics. Some topic borders are disputed, and the placements must not depend on those borders. Content-free slides and references slides are not in the list. A content-free slide tells the model nothing about where a slide goes, and the code places the references slides.

**The prompt** is in Markdown sections: task, what the model gets, key considerations, method, rules, a check before the reply, and the reply format. The method places each slide on its own first. Then it goes through the slides in deck order. When two neighbour places disagree, the model moves only the slide whose place is wrong, and it repeats the pass until no two places disagree. So one wrong place does not push every later slide late. The prompt has a version, `p2`, and a change to its text gets a new version.

**The reply** is a JSON object with a list `placements`. Each entry holds a `slideNumber`, a `subtopicId`, `startsWith` and `placedBecause`. `startsWith` holds the start words of the sentence where the lecturer starts to discuss the slide (CONTEXT.md, "Start words"). The stage finds them only in the text of the named subtopic. It finds them in the same way as the division stages find the start words of a cut. `placedBecause` is one sentence that says why the slide goes at that place. The user reads the reasons to judge the placements. The model gives one entry for each subject-matter slide. The stage ignores an entry for a content-free slide or a references slide, and makes no check on it. A reply is unusable in each of these cases:

- It is not that shape.
- The `placedBecause` of a subject-matter slide is blank.
- A subject-matter slide has no entry, or more than one.
- An entry names a slide or a subtopic that does not exist.
- The start words of a subject-matter slide are not in the text of its subtopic.
- A slide's place is earlier in the lecture than the place of the subject-matter slide before it in the deck. The stage compares two places by their subtopic order first, then by their `positionInSubtopic`.

The stage does not repair a reply, because a repair must guess which slide is wrong. The stage resends an unusable reply in the same way as a panel run. It fails after the third send (§5, "Dividing the transcript", Panel runs).

**Deck order is a rule.** Lecturers show their slides in order. Without the rule, a model can put a slide where its words match the speech, far from where the lecturer showed it. A slide that the lecturer goes back to stays at its first place.

**References slides.** The code puts each references slide at the end of the lecture's last subtopic. The deck-order rule does not apply to references slides. Otherwise a references slide in the middle of a deck would force every later slide into the last subtopic.

**Content-free slides** get no place, and the notes do not show them (CONTEXT.md, "Content-free slide").

**Every subject-matter slide gets a place**, also a slide that the lecturer does not discuss. Deck order then puts that slide between its neighbours. A student loses less from a slide in an approximate place than from a slide that is not in the notes.

**A duplicate slide** is a separate slide, with its own image, number and reading. The stage places each copy. A recap slide that repeats an earlier slide therefore shows twice.

**One call, not a panel.** If real lectures show that placements change from one call to the next, a panel can be added later.

**What is written.** `Slide placements/placements.json` holds `promptVersion`, the version of the prompt that made the placements. It also holds a list `placements`, with one entry for each placed slide in deck order. Each entry holds `slideNumber`, `subtopicId`, `startWords`, `positionInSubtopic` and `placedBecause`. `positionInSubtopic` is the number of characters from the start of the subtopic's text to the point where the slide goes. A references slide has `startWords` null, the end of the last subtopic as its `positionInSubtopic`, and a fixed `placedBecause`, because the code places it.

**The point does not go through the rewrite.** `rewrite-subtopics` rewrites each subtopic as prose, and a position in the lecturer's words means nothing in the prose. So the slides are placed again after the rewrite, at the figure marks of the writer (§5, "After the fact correction"). `correct-terms` uses the subtopic of each placement. The position stays for the deck-order check, for the test page, and as a possible hint to the placement after the rewrite.

The stage fails without a model call when the structured transcript or a reading is missing or unreadable. The error names the file. The stage finds a missing reading from `Slide images/`. Each slide image must have a reading with its slide number. The stage also fails when the third send is unusable.

**The model** is set on the stage's own entry (§6). It is `google/gemini-3.8-flash`, the model of `read-slides`. It has no temperature and no token cap, for the same reasons as `read-slides`.

#### Gaps in the slide stages

- No checker compares a reading with its slide, or a placement with the transcript. The design gives a checker to every stage that transforms content (README, "Design philosophy"). For the slide stages, the user's own look at one lecture's placements is the first check.
- `place-slides` makes one call. It has no panel.
- No built stage shows the slides with the text. A test page, which a script outside the pipeline builds, shows them.

---

### The rewrite — `correct-terms`, `rewrite-subtopics`

These two stages turn the text of each subtopic into prose (CONTEXT.md, "Rewriting a subtopic"). The fact check and the fact correction follow them ("Checking facts", below). Each stage runs once. No stage sends a subtopic back (ADR 0003).

Each of the stages that works on one subtopic at a time works on several subtopics at the same time, up to its `concurrency` (§6). These are `correct-terms`, `rewrite-subtopics` and `correct-factual-errors`. Its `sendGapSeconds` spaces its sends. As in the other stages, one send gate serves all the lectures of a batch (§6, "The send gap is shared by the whole invocation"). Each model call takes the shared resend of an unusable reply (§5, "Dividing the transcript", Panel runs).

**The files of each subtopic.** Each of these stages writes one file for each subtopic, named `subtopic-<id>.json`. It writes the file as soon as the reply is usable. A stage that starts again reads its saved files, and makes no call for them.

### `correct-terms` — term correction

**Input:** `Structured transcript/structured-transcript.json`, `Slide placements/placements.json`, `Slide readings/`
**Output:** `Term corrections/subtopic-<id>.json` for each subtopic

The transcriber mishears technical terms, and a slide often prints the right form. For example, a lecture says "beta-naphthylene" where its slide prints "β-naphthylamine". The stage makes one call for each subtopic that has a placed subject-matter slide, and no call for a subtopic with none. The call gets the subtopic text and the readings of the subject-matter slides placed in that subtopic. The references slide is never sent. The reply is a list of corrections (CONTEXT.md, "Correction"). Each correction holds a wrong form, a right form and a reason. Each form has one to four words, and the prompt states that limit. A reply that gives a blank form is unusable, and the stage resends it.

Code then checks each correction, in this order. A correction that fails a check is ignored, and the stage records the first check that it failed:

1. `form-too-long`: a form has more than four words.
2. `right-form-not-on-slide`: the right form is not in the reading of a slide placed in the subtopic.
3. `wrong-form-not-in-text`: the wrong form is not in the subtopic text.

Each check is an exact match, with case, hyphens and spaces as written. A form must sit inside one piece of a reading: the title, the body, one table, one figure description or the caption. So a form never joins the end of one piece to the start of the next. The prompt asks the model to copy each form exactly, because the code does not accept a near match.

Code changes each occurrence of the wrong form of each kept correction to its right form, and records the number of changes. The longest wrong form goes first. A shorter wrong form changes only the text that no longer form changed. Code finds each wrong form in the text before term correction, so it never changes a right form again.

A correction that fails a check is not resent. The stage writes the corrections into its own file for the subtopic. It never edits the file of an earlier stage.

The file of each subtopic holds these fields:

| Field | What it holds |
|---|---|
| `subtopicId` | The subtopic |
| `termCorrectionPromptVersion` | The version of the term-correction prompt |
| `slideNumbers` | The slides placed in the subtopic. An empty list means that term correction made no call |
| `corrections` | Each kept correction: `wrongForm`, `rightForm`, `reason` and `occurrencesChanged` |
| `ignoredCorrections` | Each ignored correction: `wrongForm`, `rightForm`, `reason` and `ignoredBecause`, the first check that it failed |
| `correctedText` | The subtopic text after term correction |

**The model** is `google/gemini-3.8-flash`, set on the stage's own entry (§6).

### `rewrite-subtopics` — each subtopic as prose

**Input:** `Structured transcript/structured-transcript.json`, `Term corrections/`
**Output:** `Rewrites/subtopic-<id>.json` for each subtopic

The stage takes the list of subtopics from the structured transcript. So a missing term-correction file fails the stage, and the error names the file. The writer gets the corrected text of one subtopic, and nothing else: no title, no slides and no other subtopic. It writes the rewritten subtopic (CONTEXT.md, "Rewritten subtopic"):

- paragraphs with no heading
- every point in the lecturer's order
- LaTeX for formulas, where the lecturer speaks one
- a figure mark, with no number, where the lecturer points at a slide (CONTEXT.md, "Figure mark").

The writer drops filler, jokes and course arrangements. It keeps these exactly:

1. scientific nomenclature and precise terms
2. names, small molecules and protein subunits included
3. exact amino acid residues
4. the lecturer's statistics and numbers
5. each step of a mechanism in order, with each causal link that the lecturer states.

R2 forbids an omission, R3 an addition, R4 to R8 are the five kinds of detail above, and R9 says what the writer drops. The prompt also tells the writer to write in the language of `finalOutput.language` (§6).

The reply is `{ "paragraphs": [...] }`. A reply with a blank paragraph is unusable, and the stage resends it. The stage keeps the paragraphs as the rewritten subtopic. A reply with no paragraph is usable. A subtopic that holds only filler or course arrangements, such as a lecturer's closing words, has no prose to keep. No stage compares the rewrite with the transcript, so no stage finds a point that an empty rewrite drops (ADR 0003).

The file of each subtopic holds these fields:

| Field | What it holds |
|---|---|
| `subtopicId` | The subtopic |
| `writerPromptVersion` | The version of the writer prompt |
| `rewrittenSubtopic` | The paragraphs of the rewritten subtopic, in order |

**The model** is `google/gemini-3.8-flash` in the example config, set on the stage's own entry (§6). It is the model of term correction.

---

### Checking facts — `check-facts`, `correct-factual-errors`

The rewrite can state a factual error. The lecturer can state one too, and the writer keeps it. These two stages find the factual errors in the whole rewrite and correct them (CONTEXT.md, "Checking facts"). Where the lecturer states a factual error, the notes state the correct fact (CONTEXT.md, **Faithfulness**). No stage compares the notes with the transcript (ADR 0003).

### `check-facts` — the fact check

**Input:** `Structured transcript/structured-transcript.json`, `Rewrites/`
**Output:** `Fact checks/<model>.json` for each model that the stage calls, and `Fact checks/factual-errors.json`

**The models.** The stage's config entry has `models`, a list of model entries in place of one `modelId` (§6). Each entry has the usual model settings and a `role`:

- `primary`: the stage calls the model, and the model's text wins in a merged factual error.
- `secondary`: the stage calls the model, and the model's factual errors join the primary model's errors.
- `disabled`: the stage does not call the model. The entry stays in the config, so that the user can turn the model on again with one word.

The list must have exactly one primary model and no more than one secondary model. Otherwise the config loader stops with an error that names the rule (§6).

**The call.** The stage makes one call for each model that is not disabled. The calls go at the same time. Each call gets prompt f2, copied word for word from the prototype, with the current title of the lecture. The structured transcript keeps the title of its own run, which is out of date after a rename. The user message is the whole rewrite: the rewritten subtopics in lecture order. Each subtopic is under the heading `## Subtopic <id>: <title>`, with the id and the title from the structured transcript. The call gets no transcript and no slide. The stage records `factCheckPromptVersion`.

The reply is a list of errors, each with a subtopic number, a passage, a problem, a correction and a severity (`serious` or `minor`). A subtopic number written as a string of digits, such as `"3"`, is read as that number. Any other value that is not a whole number makes the reply unusable. A reply that names a subtopic id that is not in the lecture is unusable too. The stage resends an unusable reply. Code translates the reply's words into the project's words where it reads the reply. A reply's "error" is a factual error, and its "correction" is the `correctStatement`. The word "correction" means a term correction in this project (CONTEXT.md, "Correction").

**The file of each model.** The stage writes the factual errors of each model to `Fact checks/<model>.json` as soon as the reply is usable. `<model>` is the model id without its provider part, such as `gpt-5.6-sol-pro.json` for `openai/gpt-5.6-sol-pro`. The file is named by the model and not by its role, so a change of role does not make the reply stale. The file holds `modelId`, `factCheckPromptVersion` and `factualErrors`. Each factual error has `subtopicId`, `passage`, `problem`, `correctStatement` and `severity`. The reply's list of checked subtopics is not stored, because no stage reads it.

**The words of a factual error.** Code looks for the passage of each factual error in the text of its subtopic, as an exact match. Sometimes the passage is not there, because the model changed a word when it quoted. The stage keeps the factual error with `wordsFound` false. The terminal shows a stage notice that names the subtopic (§10). The fact correction still gets the factual error, and its model finds the words from the problem.

**The merge.** With two models, two factual errors of different models become one merged factual error under two conditions. They are in the same subtopic, and their passages share a run of three words. Code compares the words in lower case, with each punctuation mark read as a space. A passage of three words or fewer is one run. Each factual error of the secondary model joins the primary model's factual error whose passage shares the most runs with it. On a tie, the factual error that comes first in the primary model's reply wins. A primary model's factual error takes no more than one secondary model's factual error. The prototype merge ranks by the shared runs as a share of the shorter passage. That share favours a short passage, so the stage ranks by the count.

- A merged factual error takes the primary model's text, and `foundBy` lists both model ids.
- A factual error that only one model reports goes into the file with that model's text, and `foundBy` lists that model.
- With one model, the stage merges nothing.

The stage writes `Fact checks/factual-errors.json`, with `factCheckPromptVersion`, `checkedBy` and `factualErrors`. `checkedBy` holds the ids of the models that the stage called, the primary model first. `correct-factual-errors` copies it into the file of each subtopic. The list holds each factual error in lecture order of its subtopic, with the fields of a model file's factual error, `foundBy` and `wordsFound`. Within a subtopic, the primary model's factual errors come first, in the order of its reply.

**A failed model.** When one model fails each send, the stage fails, and the file of the other model stays on disk. A stage that starts again makes no call for a model with a saved file. So the next run calls only the model with no saved file. A saved file of a model that is now disabled is not used.

**The cost.** The stage's `cost` is the total of its models. The stage entry also holds `costByModel`, a list of `{ modelId, cost }` with one item for each model that the stage called (§4.5). Its `configUsed` holds `models`, the config of each model that the stage used, with its `role` (§4.5). The run summary has one row for each model of the stage, with its calls, tokens and cost (§7).

### `correct-factual-errors` — the fact correction

**Input:** `Structured transcript/structured-transcript.json`, `Rewrites/`, `Fact checks/factual-errors.json`
**Output:** `Fact corrections/subtopic-<id>.json` for each subtopic, and `Fact corrections/fact-corrected-subtopics.json`

The stage sends each subtopic that has a factual error to the model, with its factual errors, in one call for each subtopic. The call gets the subtopic id and title, the paragraphs of the rewritten subtopic and a numbered list of its factual errors. Each factual error gives its passage, its problem and its `correctStatement`. The user message has the layout of the prototype, word for word. It gets no transcript, no slide and no other subtopic. The paragraphs go as a JSON list, with no labels such as "[1]". The prompt is k3 from the prototype, copied word for word. The stage records `factCorrectionPromptVersion`.

The reply holds the paragraphs of the fact-corrected subtopic and a list of changes. Each change names the factual error by its number, the words before and the words after. Code translates the reply's word "error" into `factualError` where it reads the reply. When the model judges that a factual error is wrong, the change keeps the words and gives the reason. Each change must give its four fields as text, and the stage stores `note` as the reply gives it. The stage resends an unusable reply. A reply is unusable in these cases:

- a blank paragraph
- a change that names a factual error number that the call did not send.

A reply with a different number of paragraphs is kept. `paragraphCountBefore` and `paragraphCountAfter` show the change. The terminal shows no notice, because the notes can join or split a paragraph with no loss.

A subtopic with no factual errors gets no call. Its file holds its rewrite unchanged, an empty `factualErrors` list and the full `checkedBy` list.

The file of each subtopic holds these fields:

| Field | What it holds |
|---|---|
| `subtopicId` | The subtopic |
| `factCorrectionPromptVersion` | The version of the fact-correction prompt |
| `factualErrors` | The merged factual errors of the subtopic, as `Fact checks/factual-errors.json` holds them, with `foundBy` and `wordsFound` |
| `factCorrectedSubtopic` | The paragraphs of the fact-corrected subtopic, in order |
| `changes` | Each change of the reply, with four fields. `factualError` is the number of the factual error in `factualErrors`, from 1. `before` and `after` are the words. `note` is the reason when the words did not change |
| `checkedBy` | The models that checked the facts of the subtopic, from the `checkedBy` of `Fact checks/factual-errors.json` |
| `paragraphCountBefore` | The number of paragraphs of the rewritten subtopic |
| `paragraphCountAfter` | The number of paragraphs of the fact-corrected subtopic |

**The end of the stage.** When each subtopic has its file, the stage writes `Fact corrections/fact-corrected-subtopics.json`. Its `factCorrectedSubtopics` holds the entry of each subtopic in lecture order, with the fields of the subtopic's file. The entries have no titles. The titles are in the structured transcript.

**The model** is `anthropic/claude-sonnet-5.5`, with `concurrency` 10 and `sendGapSeconds` 0.25, set on the stage's own entry (§6).

**The bypass.** The stage's entry has a required `bypass` switch (§6). With `bypass` on, the stage makes no call. The file of each subtopic holds its rewrite unchanged and no changes. It still holds the factual errors that `check-facts` found, so the page can show them. The stage writes `fact-corrected-subtopics.json` as usual, so the stages after it run unchanged. The `--fact-correction` flag replaces the switch for one invocation (§4.7).

---

### After the fact correction

Two stages follow `correct-factual-errors`. The prototype of slide relocation on lecture 4 decided the prompt, the model and the shape of the files of `relocate-slides`. The user approved its folder, files and fields on 2026-10-14.

**`relocate-slides` — slide relocation.** `place-slides` puts each slide at a point in the transcript. The notes are prose, so that point is not in them. The stage moves each placed slide to the start of a sentence in its fact-corrected subtopic (CONTEXT.md, "Slide relocation"). It makes one call for each subtopic that has slides, and no call for a subtopic with none. The subtopic of each slide comes from `place-slides`. The call uses prompt `r4` of the prototype, and the model is set in the stage's own config entry (`google/gemini-3.8-flash`). The call gets the paragraphs of the subtopic as a JSON list, with a number on each figure mark. For each slide, it gets the whole slide reading. It gets no transcript words and no reason from `place-slides`. The reply gives the start words of a sentence for each slide, and the slide that each figure mark points at, or no slide.

A reply is unusable, and the stage resends it, in these cases:

- start words that are not in the text
- a slide with no point, or with two points
- an unknown slide
- a figure mark with no answer. "No slide" is an answer, but silence is not, because then the stage cannot tell whether the mark points at a slide
- slides out of deck order.

A slide that a figure mark points at goes at that mark. Code gives each slide its figure number, and writes "(Figure N)" in place of each mark that points at a slide (CONTEXT.md, "Figure number"). A mark that points at no slide stays as `[FIGURE]`, and the stage records it. The references slide goes after the last sentence of the last subtopic, with no call and no figure number.

A subtopic can have no paragraph, because the rewrite can make an empty list. Lecture 3 of Biology of Disease has one: its last subtopic is 50 words of closing remarks. A subtopic with no paragraph gets no call, and its file lists no slide. Each slide of that subtopic, the references slide included, goes to a subtopic that has a paragraph:

- The slide goes after the last sentence of the nearest earlier subtopic that has a paragraph. It comes after the slides that are already at that point, in deck order.
- If no earlier subtopic has a paragraph, the slide goes before the first sentence of the nearest later subtopic that has a paragraph.

The file of that subtopic lists the slide. The slide keeps its figure number. If no subtopic of the lecture has a paragraph, the stage fails with `RelocateSlidesError`.

The stage writes `Slide relocations/subtopic-<id>.json` for each subtopic. The file holds:

- `subtopicId`, and `slideRelocationPromptVersion`
- `paragraphs`: the fact-corrected paragraphs, with "(Figure N)" in place of each figure mark that points at a slide
- `slides`: each slide that the subtopic shows, in deck order, with `slideNumber`, `paragraphIndex` (from 0), `characterOffset` and `figureNumber`. The offset is the start of the slide's sentence, in characters. For the references slide, the offset is the end of the last paragraph, and `figureNumber` is `null`. For a slide of an earlier subtopic with no paragraph, the offset is 0 in the first paragraph. For a slide of a later subtopic with no paragraph, the offset is the end of the last paragraph
- `figureMarksWithNoSlide`: the `paragraphIndex` and `characterOffset` of each `[FIGURE]` mark that points at no slide.

When each subtopic has its file, the stage writes `Slide relocations/slide-relocations.json`. Its `slideRelocations` holds the entry of each subtopic in lecture order, with the fields of the subtopic's file. The entries have no titles. The titles are in the structured transcript.

**`build-notes-page` — the notes page.** The stage makes no model call. It writes `Final output/<base name>/notes.html`, `Final output/<base name>/notes.pdf` and `Final output/<base name>/slides/`, with each slide as the PNG file that `render-slides` writes, copied unchanged. The page shows the topic and subtopic titles and the text of each subtopic, from the output of `relocate-slides`. Each slide is small and floats at its sentence, with its figure number and its caption in the right margin. A slide at the end of a paragraph, such as the references slide, floats next to the paragraph and has no highlight. LaTeX becomes maths when the stage builds the page, so the page loads nothing from the internet. A click on a slide opens it in a window that the user can move and change in size, and the page behind stays readable. The Notes PDF holds the Notes view only, for print or a tablet ("The Notes PDF", below). A test page, which a script outside the pipeline builds, is the prototype of its layout.

The page follows these rules:

- **Header.** The header shows the lecture title, the date and the switch of the page views. It also shows a list of the topics, with a link to each. A link goes to the topic in the page view that shows. One line explains the page view that shows, such as what the highlight means in the Notes view.
- **References slide.** The references slide floats next to the last paragraph. Its label is "References", not a figure number. Its caption comes from its slide reading. Its sentence has no highlight.
- **Maths.** Maths is text between two dollar signs. The opening dollar sign has no space after it. The closing dollar sign has no space before it and no digit after it. So "$5 and $10" stays as text. KaTeX writes the maths as MathML, so the page needs no maths fonts.
- **A lone Greek letter.** Maths that is one Greek letter only, such as `$\beta$`, shows as the plain letter in the text font. A word such as "β-catenin" then stays on one line, and the letter matches the words around it. Longer maths gets the full maths format.
- **Fonts and colours.** The page uses fonts that come with the computer, so it loads nothing from the internet. The colours are warm: plum for headings and links, and brick red for the figure labels.
- **A second build.** The stage checks that the image of each slide is on disk before it deletes the earlier build. So a missing image leaves the earlier page in place. Then the stage deletes the lecture's folder and writes it again. It copies the slide images, prints `notes.pdf` and writes `notes.html` last. So a stage that stops part of the way leaves no page, and the stage is not complete.

The lecture's folder in `Final output/` is a lecture file, as the video and the slide deck are (§3.1). A reset of the stage deletes this lecture's folder and keeps the folders of the other lectures. Every stage comes before `build-notes-page`, so a reset from any stage deletes the folder. Rename, change-date, delete and normalisation move or delete the folder (§4.7).

**When the stage is complete.** The stage is complete when `notes.html` and `notes.pdf` are both in the lecture's folder under the lecture's current base name (§4.2). When either file is missing, the next run builds both again, at no cost. So a notes folder from before the Notes PDF gets its PDF on the next run. To build the notes again, the user deletes `notes.html` and runs the lecture again. `filesWritten` holds the paths of `notes.pdf` and `notes.html`.

**Slides and subtopics with no entry.** A subtopic with no entry in `slide-relocations.json` stops the stage with `BuildNotesPageError`, which names the subtopic. A placed slide that no subtopic's entry holds does not stop the stage. The page leaves the slide out, and the stage returns a stage notice that names the slide (§10). Two causes exist: the slide has no reading, or `place-slides` gave it a subtopic that is not in the lecture.

**The two switches of the page.** Two values of `finalOutput` shape the page (§6). `pageViews` lists the page views that the page holds, and the switch at the top shows only those views. `highlightSlideSentences` sets whether the Notes view highlights the sentence of each slide. With the highlight off, the line that explains the Notes view does not mention a highlight. The flags `--page-views` and `--highlight-slide-sentences` replace the two values for one invocation (§4.7). The run log records the values that the stage used (§4.5).

**The Notes PDF.** The stage prints the Notes PDF from the same input as the page (CONTEXT.md, "Notes PDF"). Chrome prints it through `puppeteer`, from HTML that holds each slide image as data. So the stage writes no temporary page. The PDF has a stylesheet of its own. It takes the colours and the fonts from the stylesheet of the page, so the two state them once. The text, the maths and the slide labels come from the same code as the page.

- **What it shows.** The PDF shows the lecture date and the lecture title. Then it shows each topic title and subtopic title, with the text of the Notes view, in lecture order. It shows no other page view, no view switch, no list of topic links and no highlight. `pageViews` and `highlightSlideSentences` have no effect on it.
- **Slides.** Each slide is at the start of its sentence, as on the page. The paragraph stops there, the slide is in the middle of the column, and the paragraph continues under it. A slide at the end of a paragraph goes after the paragraph. The slide image has its label and its caption under it, as "Figure N. caption" or "References. caption". Slides at one point keep the deck order of `relocate-slides`.
- **Page.** The page is A4. The page number is at the bottom, in the middle, in the margin. The settings of `finalOutput.pdf` give the text size, the margin, the slide width and the space above and below each slide (§6). The text is justified.
- **Page breaks.** A slide never splits across two pages, and a title never splits. A page never ends with a title. A topic title stays with the first subtopic title of the topic. A subtopic title stays with the start of the subtopic. The start is the first 3 lines of the first paragraph, or the whole paragraph when it is shorter. When the subtopic starts with a slide, the start is that slide. When a slide comes after line 1, the start is the lines before it and the slide. A block of text that splits across two pages keeps at least 3 lines on each page.
- **Failure.** When Chrome cannot print the PDF, the stage fails with `BuildNotesPageError`. The message names the path of `notes.pdf` and the cause. The stage then writes no `notes.html`.

The look, such as the sizes of the titles and the space below a paragraph, is in the stylesheet of the PDF. A test cannot judge how a page looks. So the user checks these on real lectures:

- the slide size and the space around each slide
- the text size and the margins
- the empty areas at page breaks
- the space between the page number and the text.

**Input:** `Structured transcript/structured-transcript.json`, `Slide images/`, `Slide readings/`, `Slide placements/placements.json`, `Term corrections/`, `Rewrites/`, `Fact corrections/fact-corrected-subtopics.json` and `Slide relocations/slide-relocations.json`.

**The page views.** One switch at the top of the page chooses the page view (CONTEXT.md, "Page view"). The page opens on the Notes view. The page holds each view that `finalOutput.pageViews` lists. With the four views, it is about four times as large as the notes alone. The stage makes no model call for the views.

- **Notes.** The page as the rules above describe it.
- **Rewrite.** The rewritten subtopic of each subtopic under its title, before the fact correction. The view has no highlight and no colour. Each slide is in front of the rewrite word that the word comparison of the Corrections view links to the slide's word in the notes.
- **Corrections.** The notes, with the changes that the fact correction made to the rewrite. A word that is only in the rewrite is red, with a line through it. A word that is only in the fact-corrected subtopic is green. Each slide is at the sentence that it has in the Notes view, with no highlight. The view also shows a change that the model did not report.
- **Transcript.** The term-corrected text of each subtopic under its title (`correctedText` in `Term corrections/`). The rewrite received this text, so a term that term correction changed does not show as dropped. Each spoken word that is not in the notes at the same place has a red highlight, with no line through it. A subtopic with no paragraph shows all its spoken text in red.

**The word comparison.** The stage compares two texts one subtopic at a time (CONTEXT.md, "Word comparison"). It splits each text at whitespace, and keeps the longest run of words that both texts have in the same order. Two words match when they are the same in lower case and without their punctuation marks. A figure label such as "(Figure 3)" counts as one word, and it matches a figure mark `[FIGURE]`. So the figure numbers that `relocate-slides` writes are not changes. A phrase that the notes move to another place shows as removed where it was, and as added where it is now. The user accepts this extra colour.

- The Corrections view compares the rewrite with the notes text of `relocate-slides`. The notes text is the fact-corrected subtopic with its figure numbers.
- The Transcript view compares the term-corrected text with the same notes text. That is the text that the reader of the notes gets.

**Paragraphs.** The Corrections view and the Transcript view take their paragraph breaks from the notes. A word that the comparison links to a notes word goes in the paragraph of that notes word. A word with no link goes in the paragraph of the word before it. The notes paragraphs are the paragraphs of the rewrite, unless the fact correction joined or split a paragraph.

**Slides in the Transcript view.** Each slide is in the subtopic that `place-slides` gave it. The stage counts the words of the subtopic's text before the slide's `positionInSubtopic`. The slide goes in front of the word with that number in the term-corrected text. A correction changes a phrase of one to four words to another phrase of one to four words. So the slide moves by a few words at most. This rough place is enough. The references slide is after the last word.

**The note of a change.** A red or green word of the Corrections view can have a note. A box shows the note when the mouse rests on the word, or when a tap or the keyboard selects it. The page script draws the box. In Safari, a `title` attribute showed no note (user, 2026-10-14). Esc and a scroll of the page hide the box. A run of red and green words between two unchanged words takes the note of one reported change. That change is the first reported change whose `before` holds all the red words in order. Its `after` must also hold all the green words in order. The match ignores case and punctuation. The note is the `problem` of the factual error that the change names in `factualErrors`, counting from 1. A run that no reported change matches has no note.

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
callModel(args: { messages; stageId: StageId; config: PipelineConfig; responseFormat: "text" | "json"; logger: Logger; client?: OpenAI; sendGate: SendGate; costTally: CostTally }):
  Promise<{ content: string }>
// `logger` is the calling stage's, already bound to it by createPipelineStage; the call is recorded on it
// at `debug` with the model, prompt token count, latency and finish reason (§10).
// `sendGate` is the stage's, made by defineModelStage from the stage's `sendGapSeconds` at the stage's first run
// (src/utils/send-gate.ts). Every run of the stage in the invocation shares it, so the lectures of a batch share the gap.
// Every send, a refusal's resend included, waits its turn, so the gap holds however sends and resends fall.
// Wraps the SDK call. Each send reads its cost from the reply's `usage` and adds it to `costTally` (§7). `responseFormat: "json"` sends `response_format: json_object` and
// the provider routing that makes it stick (see "JSON mode is routed for" below), which the stages
// returning structured data require; it is stated on every call rather than defaulted so a caller always
// declares the shape it expects back. `client` is injected by tests; it defaults to the shared instance.
```

**JSON mode is routed for as well as asked for.** OpenRouter honours `response_format` per *endpoint* rather than per model: a model is served by several providers, and by default the parameter steers routing towards those that support it — where none of a model's providers do, the request still goes through with the parameter dropped, handing the stage prose where it expected JSON. A `"json"` call therefore also sends `provider: { require_parameters: true }`, which restricts routing to endpoints supporting every parameter in the request. A model that cannot do JSON then fails the call, which names the real cause at the point it arises; a dropped `response_format` costs a full billable call and arrives as a parse error naming the reply. The flag rides with `"json"` alone: a `"text"` call has nothing to require, and requiring nothing would only narrow which endpoints can serve it.

OpenRouter's own parameter reference states that JSON mode requires the prompt to ask for JSON as well, so a `"json"` caller instructs the model in its messages too, and still treats a reply that will not parse as a stage failure.

**A stage asks for a JSON reply through one shared act.** Every stage that expects JSON has the same three obligations:

- send the call in JSON mode
- refuse a reply that does not parse
- refuse a reply that parses into a shape other than the documented shape.

`tryJsonReply` in `src/pipeline/stages/model-stage.ts` does all three. The stage supplies its messages and the predicate that recognises its reply. It also supplies the shape in words. The same module names the dependency pair (`{ logger, client }`) and the run arguments that every model-calling stage takes. Without it, each stage would state them again.

`tryJsonReply` returns a bad reply and does not throw it. It gives the reply, or the reason that the reply cannot be used: empty, not JSON, or the wrong shape. The panel stages resend a bad reply (§5, "Dividing the transcript", Panel runs). A thrown error would end the stage before the resend. An empty reply has its own reason, because it is the common case. It also says something different from prose: the provider answered with nothing, not with the wrong thing.

`tryJsonReplyAs` is `tryJsonReply` followed by the stage turning the reply into what it keeps — where the stage may still find it unusable, as a splitting reply naming words the transcript does not contain — so that failure is resent like any other. The same module builds the two messages a stage sends (`promptMessages`: the prompt as the system message, the material as the user message) and defines a model-calling stage from its id, input reader and run (`defineModelStage`), returning the factory the CLI calls with the logger and client.

**A rejection can arrive inside an accepted reply.** OpenRouter answers some upstream failures with HTTP 200 and a body carrying `{"error": {…}}` where the choices should be, which the SDK reports as a success. The provider's own sentence is the only account of what happened — it says whether the failure is transient and whether retrying is the remedy — so an accepted reply carrying one is logged as a warning quoting it beside the stage and the model, and the call is sent again, up to three sends, pausing two seconds and then four between them. The third refusal is a `ProviderError` quoting the last one. This holds for every call, in every stage, so no stage needs its own copy of it. A refusal can be transient — a provider rate-limiting several calls at once — and a relaunch would pay for the same call again anyway; a permanent one, such as a prompt too long for the model, costs two extra sends and a few seconds before it fails the stage. Each refused send counts as a call. Its cost is read from its `usage` like any other reply's when the refusal reports one; when it reports none it is counted as costing nothing, because OpenRouter does not bill a request that produced no output. A reply carrying neither choices nor an explanation is the `NoReplyChoicesError` above.

A reply that carries the provider's error and an answer as well — a choice whose content is not empty — is not a refusal: the answer is handed back, and the error is logged as a warning quoting the provider's sentence beside the stage, the model, the finish reason and which send it was. Resending it would throw away a complete answer — `openai/gpt-6.1-sol-pro` reported `error` as the finish reason on 11 of the prototype's 72 grouping calls, every one of them a usable answer — and the stage's own check of the answer still resends one that is unusable. A reply's finish reason is never itself a reason to resend.

**A tuning parameter can be left unset out loud.** Each optional field of a stage entry can be `null`: `temperature`, `maxTokens`, `concurrency`, `callConcurrency` and `sendGapSeconds`. A `null` means the same as a missing key: the request carries no such parameter. There are two ways to say it, because the choice is worth a record. Under the routing restriction above, the parameters of a request decide which endpoints can serve it. Providers differ in what they accept. The same model takes a `temperature` through one provider and not through another. So the tuning that a stage sets is part of the choice of what can answer it. A `null` records a deliberate omission beside the tuning that is set. A missing key reads as an oversight.

**Three settings say how much runs at once.** `batch.concurrency` is how many lectures a batch runs at once (§4.7). A stage's `concurrency` is how many of its runs, slides, images or subtopics are in flight at once. `callConcurrency` is how many calls one run makes at once. Only `deepen-subtopic-splitting` has one, because it is the only stage whose run makes more than one call on one piece of work (§5). `correct-terms`, `rewrite-subtopics`, `correct-factual-errors` and `relocate-slides` make one call for each subtopic, so their `concurrency` counts their calls. Unset, runs and calls are each made one at a time. On any other stage, nothing would read `callConcurrency`. So the loader raises a `ConfigError` at startup that names the stage.

**The send gap is shared by the whole invocation.** `sendGapSeconds` is the least time between the starts of two sends of a stage. Unset, sends are not spaced (§5, "Dividing the transcript", Panel runs). The CLI builds each stage once, and a batch runs every lecture through that one stage. So the gap holds across all the lectures of a batch. It limits the rate of the stage's sends, however many lectures run at once. Without it, two lectures with a `concurrency` of 20 each could start 40 sends at once. The gap spaces sends that run at the same time. So a stage that sets `sendGapSeconds` must also set `concurrency`, or the loader raises a `ConfigError` that names the stage.

**A stage with a list of models.** The entry of `check-facts` has `models` in place of `modelId` (§5, `check-facts`). Each item of the list is a model entry with the usual fields, and a `role`: `primary`, `secondary` or `disabled`. The loader raises a `ConfigError` that names the stage and the rule in each of these cases:

- the list has no primary model, or more than one
- the list has more than one secondary model
- an item has a `role` that is not one of the three
- two items have the same model id without its provider part, because each model's file is named by that part (§5, `check-facts`).

The other stages keep one `modelId`. A `models` list on any other stage is a `ConfigError` that names the stage.

**The switches of the fact correction and the notes page.** Three keys turn a part of the last stages on or off. Each key is required, so the file says what the pipeline does. The three flags of §4.7 override them for one invocation.

- `stages.correct-factual-errors.bypass` is `true` or `false`. `true` makes the stage copy each rewrite with no call (§5, `correct-factual-errors`).
- `finalOutput.pageViews` lists the page views of the notes page: `notes`, `rewrite`, `corrections` and `transcript`. The list must name `notes`, because the page opens on it. A name that is not a page view, or a name that comes twice, is a `ConfigError`.
- `finalOutput.highlightSlideSentences` is `true` or `false`. `true` highlights the sentence of each slide in the Notes view (§5, "After the fact correction").

**The settings of the Notes PDF.** `finalOutput.pdf` holds five numbers: `fontSizePt`, `marginMm`, `slideWidthPercent`, `slideSpaceBeforeMm` and `slideSpaceAfterMm` (§5, "The Notes PDF"). Each key is required. No flag overrides these settings. The loader raises a `ConfigError` that names the key in these cases:

- a missing section or key
- a value that is not a number
- a value of 0 or less
- a `slideWidthPercent` above 100.

**A stage key names a stage.** The loader checks each key of the `stages` section against the stage IDs. A key that names no stage is a `ConfigError` at startup, which lists the stages that the key could name. Configuration reaches a stage by its key alone. So with this check, "the stage is configured" and "the config file mentions the stage" mean the same thing.

**Model-ID resolution check.** At startup, `loadConfig` fetches the model list once from `${openRouter.baseUrl}/models`. It checks that each configured `stages[*].modelId` is in the list. It also checks each model id of a `models` list, the disabled ones included. So the check finds placeholders, typos and retired IDs before any billable call. A miss throws a `ConfigError` naming the offending stages and linking to the models page. The list is fetched once per invocation, which is the only time it is wanted: `loadConfig` runs once, and asks for the list once.

**Exempting non-OpenRouter providers.** Not every stage calls OpenRouter — `transcription` transcribes through ElevenLabs — so checking its model ID against OpenRouter's list would always fail. `modelIdCheck.exemptProviders` lists provider prefixes (the part of a model ID before the `/`) that the check skips, so a stage on any non-OpenRouter provider can still declare its model in config and have it recorded in the manifest and cost report. The mechanism is general: it is not specific to ElevenLabs, and a stage whose provider is not exempt is always checked. Exempting a provider trades away the typo protection for its IDs, so keep the list to providers that genuinely sit outside OpenRouter.

**One exemption is not a provider, and is temporary by construction.** A stage that has not been built has no model to name, and the check reads the whole file — so a config describing the stages not yet built would refuse to start the stages that do exist. Until each is built it carries a `placeholder/` prefix and `placeholder` is exempted, which is what lets the built stages run. **The prefix comes off as its stage is built, and the last one to go takes the exemption with it.** That discipline is the whole of the guarantee: an exemption left standing over a stage that now makes real calls excuses it from the check, and a wrong ID then surfaces at that stage, after every stage before it has been paid for. `docs/user-test-plan.md` carries the same instruction beside the config it applies to.

Both halves of a model ID are read through `splitModelId` in `src/utils/model-id.ts`, which this check and `transcription` share: the check reads the provider, `transcription` reads the name (§5, `transcription`). One reader is what fixes what separates the halves, so the two cannot come to disagree about it. An ID that names no provider yields a `null` provider, which no exemption list can hold, so such an ID is always checked.

**Currency.** Every provider bills in US dollars, so costs are stored in USD and converted to pounds only for presentation (§7). `currency.gbpPerUsd` is the rate applied. Because it converts at display time rather than at write time, correcting a stale rate re-renders every historical report consistently — no stored figure is ever rewritten, and none silently mixes rates.

**The ElevenLabs address is configuration too.** `elevenLabs.baseUrl` is the single place ElevenLabs' address is stated, and it is passed to the SDK's own `baseUrl` option so every Scribe call is made against it. The reasoning is the same as for `openRouter.baseUrl` above, and so is the validation — it must parse as an absolute URL or startup fails. It matters more here than the shared reasoning suggests: ElevenLabs serves the same API from several regional residency hosts, and which one an account must use is a fact about that account. Naming the host in config is what lets an account on a regional one be served by a config edit.

Unlike OpenRouter's, this base URL carries no path — the SDK appends the versioned route itself — so `speechToText` is named alongside it in `transcription.ts` rather than being built by the pipeline, for the same reason `completions` is named in `OPENROUTER_PATHS`: so a test intercepting the call does not have to know the route independently of the code under test.

**The spoken language is configuration, and it is not `finalOutput.language`.** `elevenLabs.languageCode` is the language Scribe is told to expect in the audio; `finalOutput.language` is the language the notes are written in (§6, Output). They are deliberately separate fields: a lecture delivered in one language may want notes in another, and collapsing them would make that impossible to express. They also take different forms — Scribe wants an ISO-639-3 code (`eng`), while the notes language is a BCP-47 tag carrying a regional spelling convention (`en-GB`) — so neither can be derived from the other without losing something.

**Module prefixes are configuration because a prefix describes a module, not this codebase.** Lecturers put the module at the front of a recording's filename. In a title it is noise, because the module is already the folder that holds the lecture. `naming.modulePrefixes` lists what to strip. It is a list, not one value, for two reasons. The pipeline works on several modules at once, and **one module can be written in more than one way**. A lecturer abbreviates it in some filenames (`BOD_Cell injury`) and writes it in full in others (`Biology of Disease - Cell injury`). So both forms are listed. Matching ignores case for the same reason. How a filename writes a module says nothing about whether it is one. A prefix that is not in the list stays in the base name of each lecture that carries it.

Each prefix is matched literally, so one carrying a pattern character means itself; a blank prefix is refused at load, since it would otherwise match any run of underscores or spaces and take apart every title the run produces. A listed prefix is what makes the strip safe: the module names are known, where the shape of a prefix is not — an opening acronym belongs to the subject (`DNA_replication`), and a module written out in full has no shape to match at all.

**`finalOutput.language` is a closed set, and every stage that writes prose obeys it.** The loader checks the tag against `OUTPUT_LANGUAGES`. That list maps each tag to the name that a prompt uses for it. A tag with no name is refused at startup, with a list of the valid tags. The name is necessary because "Write in en-GB" is not an instruction that a model can follow. So config cannot offer a language without wording for the prompts to use. `languageRule` in `src/utils/language.ts` builds that sentence. Every prompt that asks for prose or for a lecture title includes it, and words no rule of its own. So the stages cannot give the model different instructions. `judge-lecture-title`, `read-slides` and `rewrite-subtopics` are the stages built that use it. A model call is the first point in the pipeline where the language of the output can be chosen. Speech has no spelling, and ElevenLabs' `languageCode` cannot name a regional variant, so `eng` names English and nothing more.

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
    "read-slides": {
      "modelId": "google/gemini-3.8-flash",       // vision model — called once for each slide, so the cost of one call matters most
      "temperature": null,                        // a temperature limits JSON-mode calls to the providers that accept one
      "maxTokens": null,                          // reasoning counts against a cap, so a cap can cut a reply of a dense slide
      "concurrency": 10                           // slides read at once
    },
    "place-slides": {
      "modelId": "google/gemini-3.8-flash",       // one call with the whole lecture and every slide reading
      "temperature": null,                        // any tuning field may be null: no such parameter is sent
      "maxTokens": null
    },
    "correct-terms": {
      "modelId": "google/gemini-3.8-flash",       // one call for each subtopic with a placed slide
      "temperature": null,
      "maxTokens": null,
      "concurrency": 5                            // subtopics corrected at once
    },
    "rewrite-subtopics": {
      "modelId": "google/gemini-3.8-flash",       // the writer: one call for each subtopic
      "temperature": null,
      "maxTokens": null,
      "concurrency": 10,                          // subtopics rewritten at once
      "sendGapSeconds": 0.25                      // the least time between two sends of the stage
    },
    "check-facts": {
      "models": [                                 // one call for each model that is not disabled, all at once
        { "modelId": "openai/gpt-5.6-sol-pro", "role": "primary", "temperature": null, "maxTokens": null },
        { "modelId": "anthropic/claude-opus-5.5", "role": "secondary", "temperature": null, "maxTokens": null }
      ]
    },
    "correct-factual-errors": {
      "bypass": false,                            // true: no call, each subtopic keeps its rewrite. --fact-correction overrides it
      "modelId": "anthropic/claude-sonnet-5.5",   // one call for each subtopic with a factual error
      "temperature": null,
      "maxTokens": null,
      "concurrency": 10,                          // subtopics corrected at once
      "sendGapSeconds": 0.25                      // the least time between two sends of the stage
    },
    "relocate-slides": {
      "modelId": "google/gemini-3.8-flash",       // one call for each subtopic with a slide
      "temperature": null,
      "maxTokens": null,
      "concurrency": 10,                          // subtopics sent at once
      "sendGapSeconds": 0.25
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
    "language": "en-GB",               // language the NOTES are written in (en-GB | en-US). Not elevenLabs.languageCode above
    "pageViews": ["notes", "rewrite", "corrections", "transcript"],   // the views of the notes page. The list must name "notes"
    "highlightSlideSentences": true,   // highlight the sentence of each slide in the Notes view
    "pdf": {                           // the page settings of the Notes PDF
      "fontSizePt": 11,                // the text size, in points
      "marginMm": 18,                  // the margin on each of the four sides, in millimetres
      "slideWidthPercent": 60,         // the slide width, as a percent of the text column
      "slideSpaceBeforeMm": 5,         // the space above each slide, in millimetres
      "slideSpaceAfterMm": 5           // the space below each slide, under its caption, in millimetres
    }
  }
}
```

---

## 7. Cost Tracking

### Sources

OpenRouter prices every reply in the reply itself: `response.usage.cost` is the call's cost in US dollars, beside `usage.prompt_tokens` and `usage.completion_tokens`. Each send of `callModel` reads all three from its reply and adds the `StageCost` to the stage run's cost tally. So **no stage is ever marked `complete` with a cost still to arrive**. The pipeline makes no second request for the price. OpenRouter's `/generation` endpoint also reports it, but its record appears only 10–18 seconds after the reply (measured 2026-09-30), and asking sooner is answered "not found".

If a reply carries no numeric `usage.cost`, the call and the stage still succeed — cost telemetry MUST NOT gate pipeline progress. The manifest and run-log entries record `cost.costUsd = null` along with `cost.unknownCostReason` describing why; when a stage's calls go unpriced for the same reason, the reason is recorded once. Tokens and `callCount` are always populated regardless.

ElevenLabs returns no price with a transcript. So `transcription` multiplies the audio's duration (read with `ffprobe`) by the configured `elevenLabs.costPerAudioHourUsd` (§6). The stage adds the result to its cost tally as a normal `StageCost`, with `callCount: 1` and zero token counts. Scribe is billed by audio duration, not tokens. If the duration cannot be read, the stage still succeeds. It records `costUsd: null` with `unknownCostReason`, as an unpriced OpenRouter reply does. Cost telemetry MUST NOT gate pipeline progress.

### Currency

Providers bill in US dollars, so **USD is the stored currency and GBP is the presented one**. Every persisted figure — each manifest stage entry's `cost`, and every run-log entry — records the dollar amount actually charged, which is why those fields are named `…Usd`. Conversion happens in the reporting layer alone, at `currency.gbpPerUsd` (§6): the end-of-run summary, all three sections of `cost-report`, and any other user-facing figure render pounds and the `£` symbol.

Keeping the conversion at the edge means a stale or corrected rate never invalidates stored data — re-running a report applies the current rate to the full history at once. Storing pounds instead would freeze each figure at whatever rate happened to be configured when it was written, leaving a single manifest holding amounts converted at several different rates and no way to restate them.

### Two-Level Tracking

| Level | Location | What it tracks |
|---|---|---|
| Current pipeline | `manifest.json` → each stage's `cost` | What each output currently on disk cost to produce, with the failed runs before it |
| All-time expenditure | `Run logs/*.json` | Every API call ever made, including failures and experiments |

Both levels are read a stage at a time. Neither stores a figure spanning stages, runs, lectures or modules: a stage's cost is compared against the same stage's cost under a different model, which is the comparison the two levels exist to serve, and a sum across stages answers no question the pipeline is asked (NFR-2.2).

**A stage that fails.** A stage that calls a model records what it spent in a run, also when the run fails. The spend is the tokens, the calls and the cost of each reply that the stage received. Unusable replies that the stage resent are included. A send that the provider refuses with no answer carries no usage, so it counts as nothing.

- The run-log entry holds the spend of that run only.
- The manifest entry adds the spend of each run of the stage. A reset (`--from-stage`) starts the sum again from zero.

So the manifest cost of an output includes the failed runs before it. A panel stage that starts again over saved runs (§5, "Dividing the transcript", Panel runs) includes the cost of those runs.

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
Group into topics       openai/gpt-6.1-sol-pro            9     76,000 /   4,300    £0.333
Judge lecture title     openai/gpt-6.1-sol-pro            1     15,200 /     300    £0.037
Read slides             google/gemini-3.8-flash          24     41,000 /   8,100    £0.025
Place slides            google/gemini-3.8-flash           1     22,616 /  38,475       n/a
──────────────────────────────────────────────────────────────────────────────────────────
```

A stage with a list of models has one row for each model that it called, from its `costByModel` (§4.5). Each row shows the model's calls, tokens and cost. No row shows the stage's total, for the reason below.

The table closes on its last stage. No line sums the run (NFR-2.2). Each stage that this invocation ran and that names a model has one row, by the rule of the report's first section. The cost cell reads `n/a` wherever no figure was resolved. That is a lookup that failed, as for Place slides above, or a stage that failed before it called anything. A stage that names no model has no row, because it has no model spend to show. A stage that failed is named beneath the table either way, with its message.

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
Retitle subtopics        gpt-6.1-sol-pro           1    £0.044
Read slides              gemini-3.8-flash         24    £0.025
Place slides             gemini-3.8-flash          1       n/a
──────────────────────────────────────────────────────────────
```

Each stage that names a model and whose output stands on disk, `complete` or `skipped`, has one row. The row comes from that stage's own manifest entry. The cost cell shows `n/a` wherever no figure was resolved. That is a lookup that failed, as for Place slides here, or a stage that recorded no cost at all. A stage that names no model, such as audio extraction or render slides, has no row, because it has no model spend to compare. Nothing is summed beneath (NFR-2.2).

**2 — Error recovery cost** (spend from failed runs and retries):
```
Run                       Stage                 Model                         Status      Cost
──────────────────────────────────────────────────────────────────────────────────────────────
2025-10-10T09:00:00.000Z  read-slides           google/gemini-2.5-flash       failed    £0.016
2025-10-10T10:30:00.000Z  read-slides           google/gemini-2.5-flash        retry    £0.025
──────────────────────────────────────────────────────────────────────────────────────────────
```

Each row names its model. A stage with a list of models has one row for each model that it called, as in the run summary.

A row is any stage that failed, under whatever classification its run carried, together with every stage of a run started to recover from one. The run that first meets a failure is classified `normal` — as the 09:00 run above is — and the spend that failure cost belongs to this section, which is why a row is selected by what became of the stage as well as by the run's type. The rows stand on their own: what a failure cost is read against the retry underneath it, one stage at a time (NFR-2.2).

**3 — Experiment cost** (deliberate model re-runs, grouped for comparison):
```
Stage: place-slides
  Run 2025-10-11T14:00Z    gemini-3.8-flash       £0.055
  Run 2025-10-11T15:30Z    gemini-3.8-flash       £0.086
```

A stage with a list of models has one line for each model of each run.

### Cost and Reporting Modules

Two modules, split by what they know. `src/utils/cost.ts` holds the arithmetic: one operation, working entirely in stored US dollars, knowing nothing about how a figure is shown. `src/pipeline/reports.ts` holds everything that turns a run into text a reader sees — the three reports, the table engine beneath them, the stage labels and the money formatting.

The split is by kind rather than by size. Rendering reads manifests, run logs and stage ids, and knows how a lecture is named and how wide a model column must be; it is pipeline presentation, not a general-purpose helper, and while it sat in `src/utils/` it reached back into the pipeline for its material — a utility needing the pipeline being the tell. It sits under `src/pipeline/` rather than `src/cli/` because the runner renders the cost report itself (§4.7) and pipeline code does not import from the CLI layer.

`StageCost`, the type both operate on, is defined in `src/types/pipeline.ts` (single source of truth). Nothing in either adds one stage to another; the reports render what each stage recorded and nothing else (NFR-2.2).

**Money is formatted by a formatter, never a rate.** Every report takes a `MoneyFormatter` rather than `gbpPerUsd`, so nothing in `reports.ts` knows what currency it is showing or what it converts from. The caller builds one and passes it down: the CLI builds a single formatter where it is assembled and uses it for the live stage notices and every summary that follows them, and the runner builds one for the whole of a cost report. A rate is read once per invocation rather than carried to each place that prints a figure.

```typescript
accumulateCost(args: { current: StageCost; incoming: StageCost }): StageCost
// Folds the calls a single stage made into that stage's one StageCost, summing tokens, call counts and cost
// at full precision (rounding is a display concern). read-slides makes one call for each slide, and
// correct-terms, rewrite-subtopics, correct-factual-errors and relocate-slides one call for each subtopic. Each has a single
// figure to record — this is how they reach it, and it stays inside one stage. check-facts also folds the
// calls of each model into that model's own StageCost (§4.5). The merged cost is resolved only when both inputs resolved; if either is null the result
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

Each way a module can fail raises an error class of its own, and this includes the failures that the platform raises. Examples are `ConfigError`, `ManifestPathError`, `ManifestUnreadableError`, `ManifestNotJsonError`, `ManifestShapeError`, `UnconfiguredStageError`, `ContextLengthError`, `ProviderError`, `NoReplyChoicesError`, `EmptyNameError`, `SourceNormalisationError`, `AudioExtractionError`, `TranscriptionError`, `CliUsageError` and `LectureIdentityError`. A caught failure names what happened by its type. So a module with three ways to fail declares three classes. A filesystem error or a `SyntaxError` that leaves through one of them is caught. It is thrown again as the module's own error, with its message carried into the new one. Each built stage adds at least one class, and each stage still to come adds its own. All of them extend a shared `NamedError` base. The base takes the name of the concrete subclass from `new.target`. So each class stays a distinct `instanceof` type with no repeated constructor code, and logs show its own name.

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

**The stages that work on one subtopic at a time.** `correct-terms`, `rewrite-subtopics` and `correct-factual-errors` write the file of each subtopic as soon as its reply is usable. On restart, each stage reads its saved files, and makes calls only for the subtopics without one (§5, "The rewrite").

**`check-facts`.** The stage writes the file of each model as soon as its reply is usable. On restart, the stage calls only the models with no saved file (§5, `check-facts`).

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
│   ├── run-cli.ts                    # Composition root: config, logger, runner, stages, prompts
│   └── fixtures.ts                   # The test fixtures of the CLI suites. Production code never imports it
├── types/
│   └── pipeline.ts                   # All shared types: StageId, StageContext, StageResult,
│                                     # StageCost, Manifest
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
│       ├── structure-transcript/     # stage module: no model call, no prompt
│       ├── render-slides/            # stage module: one image for each page of the slide deck
│       ├── read-slides/              # stage module and its prompt module
│       ├── place-slides/             # stage module and its prompt module
│       ├── correct-terms/            # stage module and its prompt module
│       ├── rewrite-subtopics/        # stage module and its writer prompt module
│       ├── check-facts/              # stage module, its fact-check prompt module, and the merge
│       ├── factual-errors.ts         # The factual errors that check-facts writes, for the stages that write and read them
│       ├── correct-factual-errors/   # stage module and its fact-correction prompt module
│       ├── fact-corrections.ts       # The files that correct-factual-errors writes, for the stages that write and read them
│       ├── relocate-slides/          # stage module, its r4 prompt module, and the checks and text changes (slide-relocation.ts)
│       ├── slide-relocations.ts      # The files that relocate-slides writes, for the stages that write and read them
│       └── build-notes-page/         # stage module, the page HTML, its style and script, and the word comparison: no model call, no prompt.
│                                     # The text HTML that the page and the Notes PDF share, the PDF HTML and its style, and the printer (print-notes-pdf.ts)
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

**Each stage owns a folder.** The folder has the name of the stage id. It holds the stage's module, its prompt module, the parts only it uses, and the tests of all of them. A stage used to be one file. The division stages are several: a prompt, the check of the reply and the choice of result. A folder keeps together what belongs to one stage, and none of it looks shared. What more than one stage uses sits one level up, beside the stage factory. Examples are the model-call and panel-run code that every model stage uses, and `division.ts`, which the three division stages share. A stage folder never imports from another stage's folder. ESLint enforces this rule, and the rule that pipeline infrastructure never imports from a stage. No stage folder has an `index.ts`.

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
| Progress | stderr (cli-progress) | Real-time stage progress bars |
| Info | stdout | Stage start/end messages, skipped-stage notices, run and batch summaries |
| Error | stdout | Each failed stage and its message, printed by the CLI after the run summary (§8) |
| Error | stderr | Anything that ends the invocation: a usage error, an unreadable config, an escaped stage error |
| Error | debug log | Every stage failure, with its stack. The runner logs it. Nothing else sees a stack trace |

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
  | { event: "stage-notice"; stageId: StageId; notice: string }
type PipelineRunReporter = (event: PipelineRunEvent) => void
// Facts, not sentences. The wording is `src/cli/pipeline-run-reporter.ts`'s, which is what keeps the runner out of the
// business of writing to a user (§8) while still letting it speak at the moment there is something to say.
```

```
Lecture 1: Cell Injury (2025-10-10)
▶ Transcription…
✔ Transcription — 1 call, £0.031
✔ Render slides — no model call
− Read slides — output already present, skipping
✔ Build notes page — no model call
⚠ Build notes page — Slide 7 is placed, but no subtopic's relocation entry has it, so the notes page leaves it out.
✖ Relocate slides — failed
```

A stage notice is a fact that the stage found and that the user must see. One example is the passage of a factual error that `check-facts` did not find in its subtopic (§5, `check-facts`). Another is a placed slide that the notes page leaves out (§5, "After the fact correction"). The stage returns its notices on `StageResult.notices`. The runner reports each notice after the stage's completed line, as a line that starts with `⚠` and the stage's name. So a stage never writes to the terminal.

A completed stage that makes no model call, such as `audio-extraction` or `render-slides`, ends with "no model call". It shows no zero, because a zero would read as a measured cost. It shows no blank, because a blank would read as an unknown cost (§7). A failed stage is marked, but its message is not repeated here. The message and the pointer to the debug log follow the run summary (§8). This line exists so that a stage announced as started is not left open. The lecture's name comes from `lectureHeading` (§7). The end-of-run summary and the cost report name it in the same way, so a batch's notices cannot identify one lecture in two ways.

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

// src/utils/progress.ts — the progress bars from the table above. Every bar writes to stderr.
createProgressBar(args: { format: string; formatValue?: FormatValueFn }): SingleBar
// Shared SingleBar factory (preset + hideCursor) that the other two build on, so bar construction lives
// in one place; formatValue supports e.g. byte-to-MB display.
createUploadProgressStream(totalBytes: number): Transform    // upload byte progress; used by transcription
createParallelWorkBar(args: { label: string; total: number }): {
  start; pick; complete; fail; stop
}
// The bar for work on many numbered items at the same time, used by readOrMakeSavedFiles (§5), so read-slides and
// every panel stage show it. It shows the items done, the total, a time estimate and the number of each item in
// flight. pick(n) adds item n to the items in flight. complete(n) removes it and counts it done. fail(n) removes
// it and keeps it in the list in red. The bar writes nothing when stderr is not a terminal, so the red never
// gets into a captured log.
```
