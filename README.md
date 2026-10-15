# Lecture recordings and slides to textbook format

This software uses a number of AI models to turn lecture recordings and their slides into
textbook-style chapters. A student can study from these chapters.

For each lecture the software outputs one HTML page and one PDF: continuous prose under the
lecture's topic and subtopic titles, with each slide at the sentence where its explanation starts. It
covers everything the lecturer said. A student reads it in place of the recording and the slides. So
it must be complete, and it must be right.

> **Status: every stage is built.** The pipeline runs from a module's source files to the notes page
> and the Notes PDF of each lecture. The end-to-end check on real lectures is the next step. See
> [Where the project is up to](#where-the-project-is-up-to).

## Design philosophy

**Nothing lost, nothing invented.** A student learning from the notes cannot tell what is missing or what was made up. So the standard every stage is held to is **faithfulness**: the notes carry everything the sources carry, and assert nothing they do not. In addition there must be no distortions that would mislead the student. There is one exception: where the lecturer states a factual error, the notes state the correct fact.

**A model that checks never corrects.** The fact check reads the whole rewrite and lists the factual errors that it finds. It changes nothing. A separate model call then corrects each subtopic that has a factual error, with the smallest change to the text. A model cannot be as critical as possible and write corrections in the same call. The fact check can use two models. Where both report the same error, the two reports become one.

**Not every step has a checker, and each gap is named.** An earlier design checked each stage that changes content against its source. The current design has two gaps:

- No stage compares the rewrite with the lecturer's words. The fact check reads the rewrite alone. The student needed notes soon, and a check against the transcript would also need a loop that sends faults back to the writer. In a trial on one lecture, the user found five faults that show only against the transcript. The fact check did not report them. ADR 0003 in `docs/adr/` gives the full reasons.
- No checker compares a slide reading with its slide, or a slide's place with the transcript.

The technical design lists each gap. In place of a checker, the notes page lets the reader see the work (see the next principle).

**The reader can see what the pipeline did.** The notes page has four page views. The Notes view is the notes. The Rewrite view is the rewrite before the fact correction. The Corrections view shows each change that the fact correction made, in red and green, with the reason for the change. The Transcript view marks each spoken word that the notes do not keep. A line under the title names the models that checked and corrected the facts, their prompt versions and the date. The same line is at the top of each page of the PDF. When the fact check or the fact correction was turned off, the line says "Uncorrected".

**Models are not asked to do anything that would be more reliable using code.** The transcript is an example. The model says only *where* each part of it starts. The text itself is sliced from the original using code, so a divided transcript is always byte-identical to the original. Nothing can be dropped or reworded along the way. Code also checks each reply before the pipeline uses it. For example, a term correction counts only when its right form is on a slide and its wrong form is in the text. A reply that fails a check is sent again.

**Agreement over a single answer.** Where one model call is not reliable enough, a panel of calls is made and the panel votes. The transcript is divided eighteen times, and the subtopics are grouped into topics nine times.

**Each stage runs once.** No stage sends work back to an earlier stage. The pipeline is a straight line from the source files to the notes.

**Never lose work, never pay twice.** Every stage saves its output before the next begins. A failure leaves everything earlier intact, and a stage whose output already exists is not run or paid for again. Nothing is deleted without asking.

**Recoverable after a crash.** Files are written whole or not at all, so a crash never leaves a half-written file behind. A stage interrupted mid-run is recognised as unfinished and run again from the start. Long stages continue from where they stopped. A model call that fails is retried. One that still fails makes its stage fail, loudly, rather than recording a partial result as though it were complete. Every failure says which stage failed and why, and any lecture can be re-run from any stage.

**Say what was done, not what was hoped.** A stage that its config or a flag turned off is recorded as bypassed, not as complete. A cost that could not be established is reported as unknown, never as zero.

**The right model for each job.** Each stage can use a different AI model. Cheap models do simple work, and strong ones do the demanding stages. Every stage's cost is recorded in pounds sterling.

## Structure

### What you put in, and what you get

Each subject module lives in its own folder. The module's lecture recordings and associated slide PDFs go into `Source files/`. One folder per lecture comes out in `Final output/`:

```
Biology of Disease/
├── Source files/
│   ├── Video recordings/     ← lecture recordings
│   └── Slide decks/          ← slide PDFs
├── Pipeline processing/      ← one working folder per lecture, holding every intermediate file
└── Final output/             ← one folder per lecture
    └── <lecture>/
        ├── notes.html        ← the notes page
        ├── notes.pdf         ← the Notes PDF
        └── slides/           ← the slide images that the page shows
```

A module's lecture is identified by the **date** it was delivered, and its recording and slides are matched by that date. Lectures are numbered in date order, and adding an earlier lecture renumbers the later ones. Titles come from the lecturer's own filenames. The software proposes a better one only when the lecturer's is not sufficiently meaningful, and a title you set yourself is never overwritten.

### The pipeline

Each lecture passes through a number of processing stages. Each stage's name is also what you type to
re-run from it or stop after it.

1. **`source-normalisation`.** Reads the module's source folders, dates and numbers every lecture,
   gives the files consistent names, and creates a working folder for each new lecture.
2. **`audio-extraction`.** Takes the audio track from the recording.
3. **`transcription`.** Sends the audio to ElevenLabs for a verbatim transcript.
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
13. **`place-slides`.** Puts each subject-matter slide at the sentence where the lecturer starts to
    discuss it. The model names the subtopic and the sentence. Code checks that every slide has one
    place and that the slides keep their deck order. A references slide goes at the end of the last
    subtopic, and content-free slides are left out.
14. **`correct-terms`.** A model compares the text of each subtopic with the readings of the slides
    placed in it, and proposes corrections of misheard terms. Code accepts a correction only when its
    right form is on one of those slides and its wrong form is in the text.
15. **`rewrite-subtopics`.** A writer gets the corrected text of one subtopic and nothing else. It
    writes paragraphs in the lecturer's order, drops filler and jokes, and keeps every fact. It puts a
    **figure mark** where the lecturer points at a slide.
16. **`check-facts`.** One or two models read the whole rewrite, with no transcript, and list its
    factual errors. The config names one model as primary. Where both models report the same error,
    the error takes the primary model's text.
17. **`correct-factual-errors`.** A model corrects the factual errors of each subtopic that has one,
    with the smallest change to the text. It records each change. When the model judges that a reported
    error is not an error, it keeps the words and gives its reason.
18. **`relocate-slides`.** Moves each placed slide from its point in the transcript to the sentence of
    the notes where its explanation starts, and numbers the figures.
19. **`build-notes-page`.** Writes the notes page, the Notes PDF and the slide images into a folder
    for the lecture in `Final output/`. It uses no AI model. The page loads nothing from the internet.
    The PDF is A4 and shows the Notes view only. A page of the PDF never ends with a title, and a slide
    never splits across two pages.

The fact check and the fact correction can each be turned off, in the config or for one run with a
flag. A stage that is turned off makes no model call, but it still writes the files that the next
stages read, so the pipeline runs on to the notes.

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
   `moduleRoots` as absolute paths, and choose a model for each stage. `check-facts` takes a list of
   models, each with a role: `primary`, `secondary` or `disabled`. `check-facts` and
   `correct-factual-errors` each need a `bypass` switch. `finalOutput` sets the page views, the
   highlight of each slide's sentence and the layout of the PDF.
4. Run `pnpm run setup` once. It puts the `lecture-notes` command on your `PATH`.

### Commands

```
lecture-notes run <date> [--from-stage <stage>] [--to-stage <stage>] [--continue-on-error]
    [--fact-check <run|bypass>] [--fact-correction <run|bypass>]
    [--page-views <views|all>] [--highlight-slide-sentences <on|off>]
lecture-notes batch [<moduleRoot>] [--concurrency <n>] (and the same options as run)
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
- **`--fact-check`** and **`--fact-correction`** run or bypass the fact check or the fact correction
  for this run, in place of the `bypass` switch in the config.
- **`--page-views`** chooses the page views of the notes page (`notes`, `rewrite`, `corrections`,
  `transcript`, or `all`). **`--highlight-slide-sentences`** turns on or off the highlight of the
  sentence of each slide in the Notes view. Both replace the values in the config for this run.
- **`cost-report`** shows what was spent, by run and by stage.
- **`rename`, `delete` and `change-date`** keep a lecture's source files, working folder and folder
  in `Final output/` in step, and renumber the other lectures where needed.

The flags change nothing in the config file. `lecture-notes --help` lists every option.

## Where the project is up to

Every stage is built, and the pipeline runs every stage in order. The commands (`run`, `batch`,
`cost-report`, `rename`, `delete`, `change-date`) are built.

Next:
- **End-to-end check.** Run the full pipeline on real lectures, and check the output and the pipeline
  mechanics (phase 29 of the implementation plan).
- **Checks still missing.** No stage compares the rewrite with the transcript, and no checker reads
  the slide readings or the slide places (see [Design philosophy](#design-philosophy)).

A lecture that ran before the fact check could be bypassed has fact files without the bypass mark.
To build its notes again, run it with `--from-stage check-facts` or an earlier stage.

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
