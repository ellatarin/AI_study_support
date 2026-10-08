# Lecture recordings and slides to textbook format

A software harness that uses a number of AI models to turn video recordings of lectures, and the slides that go with them, into textbook-style chapters that can be used for study.

For each lecture the software outputs one HTML page: continuous prose under the lecture's topic and
subtopic titles, with each slide at the point where the lecturer discusses it. It covers everything
the lecturer said. A student reads it in place of the recording and the slides. So it must be
complete, and it must be right.

> **Status: in progress.** The pipeline currently runs from a module's source files to the placed slides. The rewrite of each subtopic is designed and is being built. The placement of the slides in the rewritten text, and the HTML page, are designed in outline only. See [Where the project is up to](#where-the-project-is-up-to).

## Design philosophy

**Nothing lost, nothing invented.** A student learning from the notes cannot tell what is missing or what was made up. So the standard every stage is held to is **faithfulness**: the notes carry everything the sources carry, and assert nothing they do not. In addition there must be no distortions that would mislead the student.

**All work is verified with separate models.** Wherever a model transforms or edits any content, separate model calls are then made in order to check the result against its source and report any discrepancies. The checker never fixes anything itself, because a model cannot be as critical as possible and write corrections in the same call. All verification findings come with their reasons, including the things the verifier looked at and cleared. That way a verification step that missed something can be told apart from one that checked and found it fine.

**Models are not asked to do anything that would be more reliable using code.** By way of example, when the transcript is divided into parts, the model is asked only *where* each part begins. The text itself is sliced from the original using code, so a divided transcript is always byte-identical to the original. Nothing can be dropped or reworded along the way.

**Never lose work, never pay twice.** Every stage saves its output before the next begins. A failure leaves everything earlier intact, and a stage whose output already exists is not run or paid for again. Nothing is deleted without asking.

**Robust and recoverable.** Files are written whole or not at all, so a crash never leaves a half-written file behind. A stage interrupted mid-run is recognised as unfinished and run again from the start, and long stages pick up where they stopped rather than starting over. A model call that fails is retried; one that still fails makes its stage fail, loudly, rather than recording a partial result as though it were complete. Every failure says which stage failed and why, and any lecture can be re-run from any stage.

**The right model for each job.** Each stage can be configured to use a different AI model, so cheap models handle simple work and strong ones handle the demanding stages. Every stage's cost is recorded in pounds sterling. A cost that could not be established is reported as unknown, never as zero.

## Structure

### What you put in, and what you get

Each subject module lives in its own folder. The module's lecture recordings and associated slide PDFs go into `Source files/`. One HTML page per lecture comes out in `Final output/`:

```
Biology of Disease/
├── Source files/
│   ├── Video recordings/     ← lecture recordings
│   └── Slide decks/          ← slide PDFs
├── Pipeline processing/      ← one working folder per lecture, holding every intermediate file
└── Final output/             ← one HTML page per lecture
```

A module's lecture is identified by the **date** it was delivered, and its recording and slides are matched by that date. Lectures are numbered in date order, and adding an earlier lecture renumbers the later ones. Titles come from the lecturer's own filenames. The software proposes a better one only when the lecturer's is not sufficiently meaningful, and a title you set yourself is never overwritten.

### The pipeline

Each lecture passes through a number of processing stages. Each stage's name is also what you type to
re-run from it or stop after it.

1. **`normalise-sources`.** Reads the module's source folders, dates and numbers every lecture, gives
   the files consistent names, and creates a working folder for each new lecture.
2. **`extract-audio`.** Takes the audio track from the recording.
3. **`transcribe`.** Sends the audio to ElevenLabs for a verbatim transcript.
4. **`initial-subtopic-splitting`.** Cuts the whole transcript into **subtopics**, eighteen separate times.
   This and the next three stages divide the transcript so that later stages work on one part of the
   lecture at a time rather than the whole of it at once. Splitting the work up into small pieces leads
   to much more reliable performance against the key faithfulness requirements.
5. **`deepen-subtopic-splitting`.** In each of the eighteen divisions, sends back only the subtopics that
   came out too long (over 600 words), to be divided further.
6. **`choose-division`.** The eighteen divisions vote: a cut counts where at least half of them made it.
   No single division is reliable on its own, so the division kept is the one nearest the vote, taken
   whole, so its subtopics all come from one reading of the lecture. It uses no AI model, so it can be
   re-run for free.
7. **`retitle-subtopics`.** Gives every subtopic a new title, reading the whole lecture in one pass and
   titling each subtopic in turn: the most precise short description of what it covers, written for a
   science undergraduate. A subtopic that recaps earlier material is titled as a summary, and the
   lecture's closing part as its summary or close. It comes before grouping, which uses these titles.
8. **`group-into-topics`.** Groups the subtopics into **topics**. The model reads them from last to
   first, with their titles and full text. Nine groupings are made, and the grouping that most of them
   give is kept. Two groupings can tie when more than one run gives each of them. Then the grouping
   with more topics is kept. Any other tie goes to the grouping closest to a vote of all nine, and
   then to the earliest run.
9. **`judge-lecture-title`.** Reads the whole lecture as its topics and subtopics, and judges whether
   the lecturer's title is meaningful. A meaningful title stays. Otherwise the model proposes a new
   title, and the lecture's files take it. A title that you set yourself always stays.
10. **`structure-transcript`.** Writes the **structured transcript**: the lecture title, then each
    topic with its title, and in each topic its subtopics, each with its title and its own text. The
    text is the lecturer's words, unchanged. It uses no AI model. The later stages read the lecture
    from this one file.
11. **`render-slides`.** Renders each slide as an image.
12. **`read-slides`.** A vision model reads each slide on its own. It writes out the slide's title, its
    text and its diagrams, and a caption for the reader. It also marks the slide as subject matter,
    content-free (such as a title, outline or "any questions?" slide) or references. The notes show
    each slide as one whole image, so no figure is cut out.
13. **`verify-slides`.** A checker compares each slide reading with the slide image and lists anything
    missed, misread or added, and a separate reviser corrects it.
14. **`place-slides`.** Puts each subject-matter slide at the sentence where the lecturer starts to
    discuss it. The model names the subtopic and the sentence. Code checks that every slide has one
    place and that the slides keep their deck order. A references slide goes at the end of the last
    subtopic, and content-free slides are left out.
15. **`rewrite-subtopics`.** Rewrites each subtopic as textbook prose, in three steps:
    - **Term correction.** A model compares the subtopic text with the readings of the slides placed
      in it, and proposes corrections of misheard terms. Code accepts a correction only when its right
      form is on one of those slides and its wrong form is in the text.
    - **The rewrite.** A writer gets the corrected text of that one subtopic and nothing else. It
      writes paragraphs in the lecturer's order, drops filler and jokes, and keeps every fact. It puts
      a **figure mark** where the lecturer points at a slide.
    - **The check.** A checker compares the rewritten subtopic with the lecturer's own words and the
      corrections. One omission, distortion or addition fails the attempt, and the subtopic is written
      again, up to three times.
16. **Placing the slides in the rewritten text.** Puts a slide at each figure mark and numbers the
    figures. Designed in outline only.
17. **The HTML page.** Joins the rewritten subtopics under their topic and subtopic titles, with the
    slides at their places, and puts the page in `Final output/`. Designed in outline only.


Transcription uses ElevenLabs. Every other model call goes through OpenRouter, so any model it offers can be assigned to any stage.

## Usage

### Setting up

You need:
- **Node.js** with **pnpm**.
- **ffmpeg**, for audio extraction.
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
- **`rename`, `delete` and `change-date`** keep a lecture's source files, working folder and page in
  `Final output/` in step, and renumber the other lectures where needed.

`lecture-notes --help` lists every option.

## Where the project is up to

| Stage | State |
|---|---|
| `normalise-sources` | Built |
| `extract-audio` | Built |
| `transcribe` | Built |
| `initial-subtopic-splitting` | Built |
| `deepen-subtopic-splitting` | Built |
| `choose-division` | Built |
| `retitle-subtopics` | Built |
| `group-into-topics` | Built |
| `judge-lecture-title` | Built |
| `structure-transcript` | Designed, not built |
| `render-slides` | Built |
| `read-slides` | Built |
| `verify-slides` | Planned |
| `place-slides` | Built |
| `rewrite-subtopics` | Designed, not built |
| Placing the slides in the rewritten text | Designed in outline |
| The HTML page | Designed in outline |

The commands (`run`, `batch`, `cost-report`, `rename`, `delete`, `change-date`) are built. The code
still holds two earlier stages that rewrote and checked the whole transcript at once. They are being
removed, and `rewrite-subtopics` replaces them.
Some built stages still carry their earlier names in the code until the redesign is carried through.


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
check the commit gate runs: secret scanning, a check that `.veraignore` repeats every `.gitignore`
pattern (Vera reads one instead of the other), formatting, type checking, lint rules, duplication
detection, and the tests with a coverage floor. `pnpm test` runs the tests alone.

