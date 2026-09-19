# Lecture Notes Generator

Turns a set of lecture recordings and their slide decks into one coherent, textbook-quality set of notes per lecture. The hard part is not the transcription — it is not losing or inventing anything on the way from what a lecturer said to what a student reads.

## Language

### The material

**Module**:
A taught university module whose lectures are processed together as a set, and the unit everything else is scoped within.
_Avoid_: course, subject, class

**Lecture**:
One taught session, identified within its module by the date it was delivered.
_Avoid_: session, class, recording, video

**Source pair**:
The recording and the slide deck for a single lecture. Every lecture has exactly one of each, matched by date; a lecture missing either half is not processable.
_Avoid_: inputs, raw files, assets

**Workspace**:
The folder holding everything one lecture accumulates on its way through the pipeline, from audio to finished notes. Named for the lecture, so renumbering a lecture renames the folder and nothing inside it.
_Avoid_: output directory, working directory, scratch folder

**Transcript**:
The verbatim text of what was said, as the transcriber produced it. Carries no spelling of its own — speech has none.
_Avoid_: raw transcript (except where contrasted with the structured transcript), captions

**Structured transcript**:
The transcript reorganised into headed, readable prose with filler removed. From synthesis onwards this *is* the lecture — the verbatim transcript is never read again, which is why it is checked against its source exactly once.
_Avoid_: cleaned transcript, formatted transcript

**Notes**:
The finished document for one lecture: continuous academic prose with figures, key-concept summaries and a glossary, delivered as a PDF. The only artefact a student is meant to read.
_Avoid_: summary, write-up, output, document

### A lecture's identity

**Lecture date**:
The day a lecture was delivered, unique within its module, and the handle a user names a lecture by. Identity rests on it rather than on a title, because a title can change and does.
_Avoid_: id, key, slug

**Lecture number**:
A lecture's position in its module, assigned by date order. Adding an earlier lecture renumbers every later one, so it is a derived fact rather than a stable identifier.
_Avoid_: index, sequence number

**Provisional title**:
The title guessed from the lecturer's own filename. Best-effort and sometimes empty — whether it is any good is judged later, not here.
_Avoid_: draft title, filename title

**AI-derived title**:
A replacement title proposed from reading the transcript, and only when the lecturer's provisional title is judged not meaningful. A title the lecturer wrote deliberately is treated as authoritative, so most lectures never get one.
_Avoid_: generated title, suggested title

**User title**:
A title set explicitly by the user, which outranks both other kinds outright and is never overwritten.
_Avoid_: manual title, override

**Lecture title**:
The title actually in force: the user's if set, otherwise the AI-derived one, otherwise the provisional. Always present, so nothing downstream has to ask which kind it got.
_Avoid_: name, display title, effective title

**Base name**:
The single name a lecture's recording, slide deck, workspace and PDF all share. Renaming a lecture means moving four things onto one new name together.
_Avoid_: filename, stem, prefix

### Running the pipeline

**Stage**:
One unit of work in the fixed sequence that takes a source pair to finished notes. A stage is resumable: if its output already stands, it declines to do the work again.
_Avoid_: step, phase, task, job

**Normalisation**:
The whole-module pass that reads the source folders, dates and numbers the lectures, names everything canonically, and creates any workspace that does not exist yet. Whole-module because numbering is sequential across the module, so one new lecture can shift every later one.
_Avoid_: ingest, import, setup, scan

**Pipeline run**:
One invocation of the pipeline against one lecture. What a pipeline run reports is whether it failed, not how far the lecture has got — that is the manifest's to say.
_Avoid_: run (alone, since a splitting run is something else), execution, job

**Batch**:
A pipeline run across many lectures, and possibly many modules, drawn from one queue.
_Avoid_: bulk run, sweep, campaign

**Manifest**:
A lecture's own record: its identity, how far each stage has got, and what each stage cost. Authoritative for a lecture's title, cost and history — where the filesystem is authoritative for whether the lecture exists at all.
_Avoid_: state file, metadata, db

**Run log**:
The append-only record of a single invocation, kept as the financial audit trail. Includes the attempts that failed, which is the point of keeping it separately from the manifest.
_Avoid_: history, audit file, journal

**Settled**:
Said of work whose output stands on disk, whether this pipeline run produced it or an earlier one did. A settled stage is not re-run and not paid for twice.
_Avoid_: done, cached, finished

**Orphaned workspace**:
A workspace whose source pair has been deleted directly rather than through the tool. Never cleaned up silently — deleting one is the only thing here that destroys a user's work irreversibly.
_Avoid_: stale workspace, dangling folder

**Unknown cost**:
What a spend that could not be established is reported as. Never zero and never blank: a lookup that failed and a call that cost nothing are different facts, and conflating them corrupts the only spending record there is.
_Avoid_: missing cost, null cost, zero

### Checking quality

**Faithfulness**:
The standard the output is held to: it carries everything the sources carry and asserts nothing they do not. Both halves matter — the failure modes are opposite and so are their remedies.
_Avoid_: accuracy, correctness, fidelity (reserved below for the segmentation sense)

**Checker**:
The call that reads an output against the source it was made from and reports what is wrong with it. Kept separate from the reviser because a model cannot be maximally critical and write fluent prose in the same breath.
_Avoid_: reviewer, critic, validator, judge

**Reviser**:
The call that applies targeted fixes to the findings a checker raised, working only from the lecture's own sources. It edits; it does not rewrite.
_Avoid_: fixer, editor, rewriter

**Deficiency**:
A single fault a checker found, carrying what is wrong, how bad it is, where in the output it sits, and the passage of the source it is about.
_Avoid_: issue, error, bug, defect, problem

**Consideration**:
Something a checker examined and decided was *not* a fault, with its reason. Recorded because a bare findings list cannot tell a checker that missed something from one that looked and cleared it, and only the first is grounds to distrust it.
_Avoid_: dismissed item, non-issue, false positive

**Omission**:
Source content entirely absent from the output. The remedy is to put it back.
_Avoid_: gap, missing content

**Underexplained**:
Source content that is present but stripped of the mechanism or reasoning that made it usable. Distinct from an omission because nothing is missing — what is missing is the *why*.
_Avoid_: oversimplified, too brief, shallow

**Distortion**:
The output asserts something its source contradicts. The remedy is to correct it against the source.
_Avoid_: hallucination, inaccuracy, error

**Unsourced addition**:
Content in the output that the source does not carry at all. The remedy is deletion — never a hunt for some other source that would support it, which is how citation fabrication starts. Kept apart from distortion precisely because the two look alike in a report and their remedies are opposites.
_Avoid_: hallucination, invention, embellishment

**QA loop**:
The repeated check-then-revise cycle the notes go through until a checker passes them, the iteration limit is reached, or the findings stop moving.
_Avoid_: review cycle, polish pass, refinement

### Dividing a transcript

*Vocabulary of the segmentation work — the change of the unit of work from "the whole transcript" to one piece of it at a time. There are two levels of granularity, found by separate model calls: the transcript is cut into subtopics, and those subtopics are then grouped into topics. Not yet part of the pipeline.*

**Subtopic**:
The finer of the two levels: one continuous stretch of transcript on a single point, and the unit the transcript is actually cut into. Fixed once cut — whatever groups them afterwards may not split one, merge two, reorder them, or alter their text.
_Avoid_: section, block, topic block, chunk, segment

**Topic**:
The coarser of the two levels: a major division of the lecture, made of a run of consecutive subtopics. How many a lecture has is whatever its material turns out to support, never a number settled in advance.
_Avoid_: theme, part, chapter, heading

**Cut**:
A position where the transcript divides between two subtopics. Cuts are what a model is asked for and what a vote keeps or discards — never the text itself, which is sliced from the original so that nothing can be lost or reworded in the asking. Every topic division falls on a cut, a topic being a whole number of subtopics.
_Avoid_: boundary, split, break point

**Cut site**:
A place in the lecture where splitting runs cut. Cuts from different runs within about one percent of the lecture's length of each other are one cut site, because runs rarely choose the identical word. Support is counted per cut site, never per cut.
_Avoid_: boundary, cluster, seam

**Initial subtopic splitting**:
The call that cuts the whole transcript into subtopics in one go, before anything is deepened. "Splitting" names the act of dividing; the place it divides at is still a cut.
_Avoid_: pass one, first pass, first cutting

**Deepening**:
The step after initial subtopic splitting that takes only the subtopics that came out oversized and asks where each divides further. It can add cuts inside a subtopic but never move or lose one already made, so anything under the size gate cannot be disturbed. A call that fails every attempt makes the whole splitting run void, never "this subtopic does not divide".
_Avoid_: refinement, second pass, pass 1.5, recursion

**Size gate**:
The word count above which a subtopic is sent for deepening. Counted by code rather than judged by the model, because a model can only estimate length by eye.
_Avoid_: gate (alone), threshold, limit

**Splitting run**:
One complete attempt at dividing one lecture into subtopics: initial subtopic splitting, then deepening. The unit a panel is made of.
_Avoid_: run (alone, since a pipeline run is something else), trial, sample

**Grouping**:
The separate call that assembles finished subtopics into topics. Kept apart from cutting because the subtopic layer holds steady across splitting runs and models while the grouping of them does not.
_Avoid_: clustering, merging, roll-up

**Grouping run**:
One attempt at grouping one lecture's finished subtopics into topics. Separate from a splitting run, and repeated for the same reason: the grouping of the same subtopics varies from one attempt to the next.
_Avoid_: run (alone), trial

**Singleton**:
A topic made of exactly one subtopic. Not wrong in itself, but the rate of them is watched: a grouping that returns mostly singletons has not really grouped anything.
_Avoid_: orphan, lone topic

**Kind rule**:
The constraint that subtopics differing in kind do not share a topic — a chemical agent and a biological one, an experiment in living animals and one in cultured cells — however adjacent they are in the lecture, and however much they serve the same argument. A thing and its own mechanism are exempt.
_Avoid_: grouping rule, similarity rule, cohesion rule

**Panel**:
A set of repeated splitting runs over one lecture, voted over so that a cut site survives only if enough of the runs cut there. What turns a prompt that is usually right into a division that is reliably right.
_Avoid_: sample, ensemble, trial set

**Support**:
How many of a panel's splitting runs cut at a cut site, said as a count out of the panel: "14 of 18".
_Avoid_: votes (as a count), supporters, frequency

**Bar**:
The share of a panel's splitting runs a cut site needs to be kept. Set by weighing how wide a range of bars still gives the right division, not by which single bar scores best, because a lecture nobody has ruled needs the margin.
_Avoid_: threshold, cutoff, quorum

**Unanimous** / **Kept** / **Contested** / **Rare**:
Where a cut site stands against the bar. Unanimous: every splitting run cut there. Kept: its support reaches the bar. Contested: its support sits so close to the bar, either side, that where the bar is set decides it rather than the model. Rare: a quarter of the runs or fewer cut there.
_Avoid_: strong, weak, borderline, noise

**Consistency**:
How alike a panel's splitting runs are. For any two runs, the share of their cut sites that both cut at; averaged over every pair. Needs no ruled division, so it can be measured on a lecture nobody has ruled — unlike scoring, which asks whether a division is right and needs one.
_Avoid_: agreement, stability, reliability

**Ruled division**:
The user's hand judgement of how one lecture divides into subtopics — which cuts are right, which are wrong, and which they are content to do without. The standard the cutting is scored against; nothing about it is inferred.
_Avoid_: ground truth, gold standard, expected output

**Rubric**:
The topic-level counterpart to a ruled division: the named things one lecture's grouping must get right, taken from the user's critique of a grouping run. A lecture with no rubric of its own is unjudged rather than failed, and its grouping runs are scored as neither.
_Avoid_: criteria (as a bare noun), checklist, test cases

**Losslessness**:
The guarantee that a divided transcript is still the original transcript: every change must be a deletion, and only a handful of characters may go. An insertion or a substitution is rejected however small, because a model tidying `50 mils` into `50 mm` is the same size of edit as tidying a seam.
_Avoid_: fidelity, accuracy, integrity
