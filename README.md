# Lecture notes and slides to textbook format

A software harness that uses a number of AI models to turn video recordings of lectures, and the slides that go with them, into textbook-style chapters that can be used for study.

For each lecture the software outputs one PDF: continuous prose with the relevant
pictures from the slides inserted at the right points. It covers everything the lecturer said and
everything on the slides, organised under headings, with summaries of the key concepts and a glossary. It is meant to be read as a standalone resource instead of rewatching the recording or piecing the slides together, so it must be complete and it has to be right.

> **Status: in progress.** The pipeline currently runs from a module's source files to a verbatim transcript. Dividing the transcript into subtopics and topics is still in prototype but works. The stages after that are being redesigned around the divided transcript: the design is being updated first, then the stages will be built. See [Where the project is up to](#where-the-project-is-up-to).

## Design philosophy

**Nothing lost, nothing invented.** A student learning from the PDF output cannot tell what is missing or what was made up. So the standard every stage is held to is **faithfulness**: the notes carry everything the sources carry, and assert nothing they do not. In addition there must be no distortions that would mislead the student.

**All work is verified with separate models.** Wherever a model transforms or edits any content, separate model calls are then made in order to check the result against its source and report any discrepancies. The checker never fixes anything itself, because a model cannot be as critical as possible and write corrections in the same call. All verification findings come with their reasons, including the things the verifier looked at and cleared. That way a verification step that missed something can be told apart from one that checked and found it fine.

**Models are not asked to do anything that would be more reliable using code.** By way of example, when the transcript is divided into parts, the model is asked only *where* each part begins. The text itself is sliced from the original using code, so a divided transcript is always byte-identical to the original. Nothing can be dropped or reworded along the way.

**Never lose work, never pay twice.** Every stage saves its output before the next begins. A failure leaves everything earlier intact, and a stage whose output already exists is not run or paid for again. Nothing is deleted without asking.

**Robust and recoverable.** Files are written whole or not at all, so a crash never leaves a half-written file behind. A stage interrupted mid-run is recognised as unfinished and run again from the start, and long stages pick up where they stopped rather than starting over. A model call that fails is retried; one that still fails makes its stage fail, loudly, rather than recording a partial result as though it were complete. Every failure says which stage failed and why, and any lecture can be re-run from any stage.

**The right model for each job.** Each stage can be configured to use a different AI model, so cheap models handle simple work and strong ones handle the demanding stages. Every stage's cost is recorded in pounds sterling. A cost that could not be established is reported as unknown, never as zero.

## Structure

### What you put in, and what you get

Each subject module lives in its own folder. The module's lecture recordings and associated slide PDFs go into `Source files/`. One PDF per lecture comes out in `Final output/`:

```
Biology of Disease/
├── Source files/
│   ├── Video files/          ← lecture recordings
│   └── Lecture slides/       ← slide PDFs
├── Pipeline processing/      ← one working folder per lecture, holding every intermediate file
└── Final output/
    ├── Lecture 1 - Disease Cell Injury and the Immune System - 2025-10-10.pdf
    └── Lecture 2 - Immunity to Infection - 2025-10-13.pdf
```

A module's lecture is identified by the **date** it was delivered, and its recording and slides are matched by that date. Lectures are numbered in date order, and adding an earlier lecture renumbers the later ones. Titles come from the lecturer's own filenames. The software proposes a better one only when the lecturer's is not sufficiently meaningful, and a title you set yourself is never overwritten.

### The pipeline

Each lecture passes through a number of processing stages. Each stage's name is also what you type to
re-run from it or stop after it.

1. **`normalise-sources`.** Reads the module's source folders, dates and numbers every lecture, gives
   the files consistent names, and creates a working folder for each new lecture.
2. **`extract-audio`.** Takes the audio track from the recording.
3. **`transcribe`.** Sends the audio to ElevenLabs for a verbatim transcript.
4. **`initial-subtopic-splitting`.** Cuts the whole transcript into **subtopics**. This and the next two
   stages divide the transcript so that later stages work on one part of the lecture at a time rather
   than the whole of it at once. Splitting the work up into small pieces leads to much more reliable
   performance against the key faithfulness requirements.
5. **`deepen-subtopic-splitting`.** Sends back only the subtopics that came out too long (over 600
   words), to be divided further.
6. **`define-topics`.** Groups the subtopics into **topics**, and judges whether the lecturer's title is
   meaningful.
7. **`render-slides`.** Renders each slide as an image.
8. **`read-slides`.** A vision model writes out everything on each slide.
9. **`verify-slides`.** A checker compares each slide's written-out content with the slide image and
   lists anything missed, misread or added, and a separate reviser corrects it.
10. **`extract-figures`.** Finds the academically useful figures on the slides, crops and captions them,
    and leaves out logos and decoration.
11. **`verify-figures`.** A checker confirms each caption matches its figure, that the figure was
    captured whole, and that nothing academic was left out as decoration, and a separate reviser
    corrects what it finds.
12. **`assign-slides`.** Decides which slides, with their figures, belong to which topic. A slide that
    belongs to no topic is flagged: it holds content the lecturer never spoke about.
13. **`merge-slides`.** Adds each topic's slide content and figures into the lecturer's words, at the
    points where they are discussed. The model says only where each slide fact or figure belongs; code
    inserts it, so the lecturer's words come through untouched.
14. **`verify-merge`.** Checks that every slide fact and figure was placed, in a sensible place, and that
    nothing was added that is not on a slide, and a separate reviser corrects what it finds.
15. **`write-topics`.** Rewrites each merged topic as textbook prose. This is the one rewrite, made with
    everything already in hand.
16. **`verify-topics`.** Checks each topic's prose against its merged topic: nothing lost, nothing
    added, nothing distorted. A separate reviser fixes what it finds, and the check repeats until it
    passes.
17. **`assemble-chapter`.** Joins the topics into one chapter, with transitions between them and a
    glossary.
18. **`verify-chapter`.** Checks that joining the topics lost nothing and added nothing, and fixes what
    it finds.
19. **`generate-pdf`.** Converts the chapter to a PDF and places it in `Final output/`.


Transcription uses ElevenLabs. Every other model call goes through OpenRouter, so any model it offers can be assigned to any stage.

## Usage

### Setting up

You need:
- **Node.js** with **pnpm**.
- **ffmpeg**, for audio extraction.
- **pandoc** with a LaTeX engine (xelatex by default), once PDF output is built.
- Accounts with **ElevenLabs** (transcription) and **OpenRouter** (every other model).

Then:
1. Run `pnpm install`.
2. Put the two API keys, `ELEVENLABS_API_KEY` and `OPENROUTER_API_KEY`, in a `.env` file at the
   repository root. `.env.example` shows the form, and git ignores `.env`.
3. Copy `pipeline-config.example.json` to `pipeline-config.json`. List your module folders under
   `moduleRoots` as absolute paths, and choose a model for each stage.
4. Run `pnpm run setup` once. It puts the `lecture-notes` command on your `PATH`.

### Commands

```
lecture-notes run <date> [--from-stage <stage>] [--to-stage <stage>] [--continue-on-error]
lecture-notes batch [<moduleRoot>] [--concurrency <n>] [--from-stage <stage>] [--to-stage <stage>] [--continue-on-error]
lecture-notes cost-report [--date <YYYY-MM-DD>] [--module <moduleRoot>]
lecture-notes rename <date> "<new title>"
lecture-notes delete <date>
lecture-notes change-date <date> <new date>
```

- **`run`** takes one lecture, named by its date, through the pipeline. It picks up new source files
  first, so it works on a lecture whose recording was only just added.
- **`batch`** runs every lecture in a module, or in every configured module.
- **`--from-stage`** re-runs from a stage, discarding that stage's output and everything after it.
- **`--to-stage`** stops after a stage. The lecture can be carried on later without repeating or
  re-paying for anything already done.
- **`cost-report`** shows what was spent, by run and by stage.
- **`rename`, `delete` and `change-date`** keep a lecture's source files, working folder and PDF in
  step, and renumber the other lectures where needed.

`lecture-notes --help` lists every option.

## Where the project is up to

| Stage | State |
|---|---|
| `normalise-sources` | Built |
| `extract-audio` | Built |
| `transcribe` | Built |
| `initial-subtopic-splitting` | Prototype |
| `deepen-subtopic-splitting` | Prototype |
| `define-topics` | Prototype |
| `render-slides` | Designed, not built |
| `read-slides` | Designed, not built |
| `verify-slides` | Planned |
| `extract-figures` | Designed, not built |
| `verify-figures` | Planned |
| `assign-slides` | Planned |
| `merge-slides` | Planned |
| `verify-merge` | Planned |
| `write-topics` | Planned |
| `verify-topics` | Planned |
| `assemble-chapter` | Planned |
| `verify-chapter` | Planned |
| `generate-pdf` | Designed, not built |

The commands (`run`, `batch`, `cost-report`, `rename`, `delete`, `change-date`) are built. So are two
earlier stages that rewrote and checked the whole transcript at once. Their work moves into
`write-topics` and `verify-topics`, which will be rewritten to work on the divided transcript.
The built stages still carry their earlier names in the code until the redesign is carried through.


**Known problem:** the cost lookup currently fails on every OpenRouter call, so runs report their costs
as unknown ([#10](https://github.com/ellatarin/AI_study_support/issues/10)).

## Further reading

- [`docs/requirements.md`](docs/requirements.md): what the system must do.
- [`docs/technical-design.md`](docs/technical-design.md): how it does it, stage by stage.
- [`docs/implementation-plan.md`](docs/implementation-plan.md): the order it is being built in.
- [`CONTEXT.md`](CONTEXT.md): the project's vocabulary. Every term used here is defined there.
- [`docs/adr/`](docs/adr/): decisions that would otherwise look strange.
- [`docs/quality/segmentation-prototype/STATE-OF-PLAY.md`](docs/quality/segmentation-prototype/STATE-OF-PLAY.md):
  the transcript-division work in detail.

## Development

Written in TypeScript and run directly with tsx, so there is no build step. `pnpm check` runs every
check the commit gate runs: secret scanning, formatting, type checking, lint rules, duplication
detection, and the tests with a coverage floor. `pnpm test` runs the tests alone.

